// Ubuntu 23.10+ (kernel.apparmor_restrict_unprivileged_userns=1) blocks the unprivileged user
// namespace that Chromium's sandbox needs. Without it, and without a setuid-root chrome-sandbox,
// Electron aborts at startup with SIGTRAP before it opens a window. Chrome, VS Code and other
// Electron apps ship an AppArmor profile that allows `userns` for their binary; this installs the
// same profile for this checkout's Electron. It survives `npm install` re-extracting Electron
// (unlike chown/chmod on chrome-sandbox) and keeps the Chromium sandbox on.
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { runtimeEnvironment } = require('./runtime.cjs')

const root = path.resolve(__dirname, '..')
const restrictionFile = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'

function electronBinary() {
  return require(require.resolve('electron', { paths: [root] }))
}

function userNamespacesRestricted(read = readFileSync) {
  try { return read(restrictionFile, 'utf8').trim() === '1' } catch { return false }
}

// AppArmor treats * ? [ ] { } ^ as globs and needs " and \ escaped inside a quoted path.
function apparmorPath(value) {
  if (/[\0\n\r]/.test(value)) throw new Error(`Electron path cannot be used in an AppArmor profile: ${value}`)
  return value.replace(/[\\"*?[\]{}^]/g, '\\$&')
}

function sandboxProfile(binary) {
  const name = `budget-terminal-${createHash('sha256').update(binary).digest('hex').slice(0, 12)}`
  const text = [
    `# Budget Terminal (${path.dirname(path.dirname(path.dirname(path.dirname(binary))))}).`,
    '# Lets this checkout\'s Electron create the user namespace Chromium\'s sandbox needs.',
    '# Installed by scripts/linux-sandbox.cjs; remove this file and run apparmor_parser -R on it to undo.',
    'abi <abi/4.0>,',
    'include <tunables/global>',
    '',
    `profile ${name} "${apparmorPath(binary)}" flags=(unconfined) {`,
    '  userns,',
    '',
    `  include if exists <local/${name}>`,
    '}',
    '',
  ].join('\n')
  return { name, file: `/etc/apparmor.d/${name}`, text }
}

// `--version` initialises the zygote sandbox, so a restricted host aborts here exactly as the app would.
function sandboxStarts(binary, { spawn = spawnSync, environment = process.env } = {}) {
  const result = spawn(binary, ['--version'], { env: runtimeEnvironment(environment), encoding: 'utf8', timeout: 30_000 })
  if (result.error) return { ok: false, reason: result.error.code || result.error.message }
  if (result.status !== 0) return { ok: false, reason: result.signal ? `signal ${result.signal}` : `exit ${result.status}` }
  return { ok: true }
}

function installSandboxProfile(binary, { spawn = spawnSync, temporaryRoot = tmpdir() } = {}) {
  const profile = sandboxProfile(binary)
  const directory = mkdtempSync(path.join(temporaryRoot, 'budget-terminal-apparmor-'))
  const staged = path.join(directory, profile.name)
  try {
    writeFileSync(staged, profile.text, { mode: 0o644 })
    const result = spawn('sudo', ['sh', '-c', 'install -m 0644 -o root -g root "$1" "$2" && apparmor_parser -r "$2"', 'sh', staged, profile.file], { stdio: 'inherit' })
    return { ok: !result.error && result.status === 0, profile }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const setupCommand = 'npm run setup:linux-sandbox'

function ensureLinuxSandbox({
  output,
  spawn = spawnSync,
  environment = process.env,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  binary = electronBinary,
  restricted = userNamespacesRestricted,
  install = installSandboxProfile,
} = {}) {
  const bin = typeof binary === 'function' ? binary() : binary
  const first = sandboxStarts(bin, { spawn, environment })
  if (first.ok) return true

  if (!restricted()) {
    output.error(`Electron's Chromium sandbox could not start (${first.reason}). If the output mentions "No usable sandbox", run: sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`)
    return false
  }
  if (!interactive) {
    output.error(`This Linux system restricts the user namespaces Electron's sandbox needs (${first.reason}). Run ${setupCommand} once in a terminal; it asks for your sudo password to install an AppArmor profile for this checkout's Electron.`)
    return false
  }

  output.warn('This Linux system restricts the user namespaces Electron\'s sandbox needs.')
  output.note('Installing an AppArmor profile for this checkout\'s Electron, as Chrome and VS Code do.')
  output.note('sudo asks for your password once; the sandbox stays on and later launches skip this step.')
  const installed = install(bin, { spawn })
  if (!installed.ok) {
    output.error(`The AppArmor profile could not be installed. Run ${setupCommand} in a terminal and enter your sudo password.`)
    return false
  }
  const second = sandboxStarts(bin, { spawn, environment })
  if (!second.ok) {
    output.error(`Electron still cannot start its sandbox after installing ${installed.profile.file} (${second.reason}).`)
    return false
  }
  output.note(`Installed ${installed.profile.file}.`)
  return true
}

if (require.main === module) {
  const output = {
    note: message => console.log(message),
    warn: message => console.log(message),
    error: message => console.error(message),
  }
  if (process.platform !== 'linux') {
    console.log('The Electron sandbox profile is only needed on Linux.')
  } else if (ensureLinuxSandbox({ output, interactive: true })) {
    console.log('Electron sandbox ready.')
  } else {
    process.exitCode = 1
  }
}

module.exports = { ensureLinuxSandbox, installSandboxProfile, sandboxProfile, sandboxStarts, userNamespacesRestricted }
