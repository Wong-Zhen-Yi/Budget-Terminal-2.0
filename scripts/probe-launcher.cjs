const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { launch: runLaunch, createLauncherOutput, parseCommandLine, commandHelp, detachedDesktopCommand } = require('./launch.cjs')
const { dev } = require('./dev.cjs')
const { verifyDesktopBuild } = require('./verify-desktop-build.cjs')
const launch = options => runLaunch({ verifyBuild() {}, linuxSandbox() { return true }, ...options })
const { tryRun, ensureElectron, versionArgs } = require('./ensure-electron.cjs')
const { ensureLinuxSandbox, sandboxProfile } = require('./linux-sandbox.cjs')
const { supportedNodeVersion, supportedNpmVersion, runtimeEnvironment, assertCertificateEnvironment } = require('./runtime.cjs')
const { createUpdater, updateErrorMessage } = require('./update.cjs')
const { version: electronVersion } = require('electron/package.json')

const log = { log() {}, error() {} }
// A fresh checkout must reach installation without importing installed packages.
const firstRunDirectory = mkdtempSync(join(tmpdir(), 'budget-first-launch-'))
try {
  const scripts = join(firstRunDirectory, 'scripts')
  mkdirSync(scripts)
  copyFileSync(resolve(__dirname, '../package.json'), join(firstRunDirectory, 'package.json'))
  for (const file of ['launch.cjs', 'runtime.cjs', 'verify-desktop-build.cjs']) {
    copyFileSync(join(__dirname, file), join(scripts, file))
  }
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict')
    const { existsSync } = require('node:fs')
    const { launch } = require('./scripts/launch.cjs')
    assert(!existsSync('node_modules'))
    for (const platform of ['win32', 'darwin', 'linux']) {
      for (const failedStep of [null, 'install', 'ensure:electron', 'build']) {
        const steps = []
        const status = launch({ platform, nodeVersion: '24.22.1', environment: {},
          log: { log() {}, error() {} },
          verifyBuild() { steps.push('verify') },
          linuxSandbox() { steps.push('sandbox'); return true },
          spawn(_command, args, options) {
            assert.equal(options.cwd, process.cwd())
            const command = args.join(' ')
            const step = command.includes('--version') ? 'npm' : command.includes('install --') ? 'install'
              : command.includes('ensure:electron') ? 'ensure:electron' : command.includes('run build') ? 'build' : 'open'
            steps.push(step)
            return { status: step === failedStep ? 1 : 0, stdout: '11.0.0' }
          },
        })
        const expected = ['npm', 'install', 'ensure:electron', ...(platform === 'linux' ? ['sandbox'] : []), 'build', 'verify', 'open']
        assert.equal(status, failedStep ? 1 : 0)
        assert.deepEqual(steps, failedStep ? expected.slice(0, expected.indexOf(failedStep) + 1) : expected)
      }
    }
  `], { cwd: firstRunDirectory, env: runtimeEnvironment(), encoding: 'utf8', timeout: 10_000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  console.log('PASS: fresh checkout starts without node_modules; dependencies, Electron, build and asset checks precede opening; failures stop startup on every platform.')
} finally {
  rmSync(firstRunDirectory, { recursive: true, force: true })
}
if (process.platform !== 'win32') {
  const directory = mkdtempSync(join(tmpdir(), 'budget-posix-launcher-'))
  try {
    const checkout = join(directory, 'checkout with spaces')
    const home = join(directory, 'home with spaces')
    const output = join(directory, 'launch-output')
    const scripts = join(checkout, 'scripts')
    mkdirSync(scripts, { recursive: true })
    copyFileSync(join(__dirname, 'launch-posix.sh'), join(scripts, 'launch-posix.sh'))
    mkdirSync(join(home, '.local/bin'), { recursive: true })
    // macOS and Linux start from the shared script; Windows keeps the only double-click launcher.
    const launcher = join(scripts, 'launch-posix.sh')
    const node = join(home, '.local/bin/node')
    writeFileSync(node, `#!/bin/sh
case "$1" in
  scripts/runtime.cjs) exit 0 ;;
  scripts/launch.cjs)
    printf '%s\\n' "$PWD" "$@" > "$BUDGET_LAUNCHER_PROBE_OUTPUT"
    exit "$BUDGET_LAUNCHER_PROBE_STATUS"
    ;;
esac
exit 99
`)
    chmodSync(node, 0o755)
    const run = (file, args, status) => spawnSync('/bin/sh', [file, ...args], {
      cwd: tmpdir(), encoding: 'utf8', input: '', timeout: 10_000,
      env: { ...process.env, HOME: home, BUDGET_LAUNCHER_PROBE_OUTPUT: output, BUDGET_LAUNCHER_PROBE_STATUS: String(status) },
    })
    for (const status of [0, 7]) {
      const result = run(launcher, ['--logs', 'argument with spaces'], status)
      assert.equal(result.status, status, result.stderr || result.error?.message)
      assert.deepEqual(readFileSync(output, 'utf8').trim().split('\n'), [checkout, 'scripts/launch.cjs', '--logs', 'argument with spaces'], 'Launcher must resolve its checkout, find Node outside PATH, forward arguments and preserve errors')
    }
    if (process.platform === 'darwin') {
      const bootstrap = join(scripts, 'bootstrap-mac.sh')
      copyFileSync(join(__dirname, 'bootstrap-mac.sh'), bootstrap)
      const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
      const bin = join(home, 'Library/Application Support/BudgetTerminal/runtimes', `node-v24.22.1-darwin-${architecture}`, 'bin')
      mkdirSync(bin, { recursive: true })
      for (const command of ['node', 'npm']) {
        copyFileSync(node, join(bin, command))
        chmodSync(join(bin, command), 0o755)
      }
      const result = run(bootstrap, ['--setup'], 0)
      assert.equal(result.status, 0, result.stderr || result.error?.message)
      assert.deepEqual(readFileSync(output, 'utf8').trim().split('\n'), [checkout, 'scripts/launch.cjs', '--setup'], 'Reuse the private runtime and forward arguments')
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
for (const platform of ['win32', 'darwin', 'linux']) {
  const calls = []
  assert.equal(launch({ logs: true, platform, nodeVersion: '24.22.1', log,
    spawn(command, args, options) { calls.push([command, args, options]); return { status: 0, stdout: '10.9.8' } },
  }), 0)
  assert(calls.some(([, args]) => args.some(arg => String(arg).includes('preview'))), 'Diagnostics launcher must start the main application')
  assert(calls.every(([, , options]) => options.env.BUDGET_TERMINAL_OPEN_DIAGNOSTICS === '1'), 'Launch request must reach the main application')
  assert(!calls.some(([, args]) => args.some(arg => String(arg).includes('logViewer'))), 'No separate diagnostic application')
}
const demoFixture = require('../fixtures/demo-user-data.json')
const personalEnvironment = { APPDATA: 'personal-roaming', LOCALAPPDATA: 'personal-local',
  BUDGET_TERMINAL_DATA_DIR: 'personal-mcp', PI_CODING_AGENT_DIR: 'personal-pi', CLAUDE_CONFIG_DIR: 'personal-claude', openai_api_key: 'test-placeholder', ANTHROPIC_API_KEY: 'test-placeholder' }
const demoDirectories = []
for (const exitCode of [0, 7]) {
  assert.equal(launch({ demo: true, detach: true, platform: 'win32', nodeVersion: '24.22.1', log,
    environment: personalEnvironment,
    openDetached() { assert.fail('Demo must stay attached so its profile can be removed on exit') },
    spawn(_command, args, { env }) {
      if (!args.join(' ').includes('run preview')) {
        assert.equal(env.APPDATA, personalEnvironment.APPDATA, 'Toolchain steps use the normal runtime paths')
        return { status: 0, stdout: '11.0.0' }
      }
      const directory = env.BUDGET_TERMINAL_DEMO_DIR
      demoDirectories.push(directory)
      assert.equal(env.APPDATA, join(directory, 'roaming'))
      assert.equal(env.LOCALAPPDATA, join(directory, 'local'))
      assert.equal(env.PI_CODING_AGENT_DIR, join(directory, 'pi'), 'Demo Pi credentials, models and settings are isolated')
      assert.equal(env.CLAUDE_CONFIG_DIR, join(directory, 'claude'), 'Demo Claude Code is signed out')
      assert.equal(env.openai_api_key, undefined)
      assert.equal(env.ANTHROPIC_API_KEY, undefined, 'Demo never inherits model provider keys')
      const store = join(env.APPDATA, 'BudgetTerminalElectron')
      assert.equal(env.BUDGET_TERMINAL_DATA_DIR, store)
      for (const [name, field] of [['portfolio', 'userData'], ['strategies', 'cards'], ['settings', 'settings'], ['articles', 'articles']]) {
        assert.deepEqual(JSON.parse(readFileSync(join(store, name + '.json'), 'utf8')), demoFixture[field])
      }
      writeFileSync(join(store, 'portfolio.json'), '{}')
      return { status: exitCode }
    },
  }), exitCode)
  assert(!existsSync(demoDirectories.at(-1)), 'Remove only the temporary profile after success or failure')
}
assert.notEqual(demoDirectories[0], demoDirectories[1], 'Each demo launch starts with a new profile')
assert.equal(personalEnvironment.BUDGET_TERMINAL_DATA_DIR, 'personal-mcp')
console.log('PASS: demo uses a fresh profile per launch, seeds the saved stores, and cleans up after exit.')

let previewDirectory
assert.equal(launch({ mobilePreview: true, detach: true, platform: 'win32', nodeVersion: '24.22.1', log,
  environment: personalEnvironment,
  openDetached() { assert.fail('The preview stays attached to clean up its sample data') },
  spawn(_command, args, { env }) {
    if (args.join(' ').includes('run preview')) {
      assert.equal(env.BUDGET_TERMINAL_MOBILE_PREVIEW, '1')
      previewDirectory = env.BUDGET_TERMINAL_DEMO_DIR
      assert(existsSync(join(env.BUDGET_TERMINAL_DATA_DIR, 'portfolio.json')))
    }
    return { status: 0, stdout: '11.0.0' }
  },
}), 0)
assert(previewDirectory && !existsSync(previewDirectory), 'Remove the preview profile on exit')
const devPreviewCalls = []
const devPreviewLines = []
assert.equal(launch({ mobilePreview: true, development: true, platform: 'win32', nodeVersion: '24.22.1',
  log: { log: line => devPreviewLines.push(line), error: line => devPreviewLines.push(line) }, environment: personalEnvironment,
  verifyBuild() { assert.fail('The dev preview serves the phone UI from Vite instead of a verified build') },
  spawn(_command, args, { env }) {
    devPreviewCalls.push(args.join(' '))
    if (args.join(' ').includes('run dev')) assert.equal(env.BUDGET_TERMINAL_MOBILE_PREVIEW, '1')
    return { status: 0, stdout: '11.0.0' }
  },
}), 0)
assert(devPreviewCalls.some(call => call.includes('run build:mcp')) && devPreviewCalls.some(call => call.includes('run dev --workspace')), 'Dev mobile preview runs the Vite dev server')
assert(!devPreviewCalls.some(call => /run (build|preview)\b(?!:)/.test(call)), 'Dev mobile preview skips the production build')
assert(devPreviewLines.some(line => /Vite \d+\.\d+/.test(line)), 'Development launches name the Vite version')
console.log('PASS: btd -MobilePreview -Dev opens the phone UI on the Vite dev server.')

{
  // Windows and Linux btd have 1:1 parity: identical help and the same commands and options.
  const windowsHelp = readFileSync(join(__dirname, 'launch-windows.ps1'), 'utf8').replace(/\r\n/g, '\n').match(/Write-Output @'\n([\s\S]*?)\n'@/)[1]
  assert.equal(commandHelp, windowsHelp, 'btd --help must match on Windows and Linux')
  const parse = argv => { const { command, flags } = parseCommandLine(argv); return [command, [...flags].sort()] }
  assert.deepEqual(parse([]), ['start', []])
  assert.deepEqual(parse(['restart', '-Dev', '-Logs']), ['restart', ['--dev', '--logs']])
  assert.deepEqual(parse(['mobile']), ['mobile', ['--mobile']])
  assert.deepEqual(parse(['update']), ['update', []])
  assert.deepEqual(parse(['-Demo', '-Dev']), ['start', ['--demo', '--dev']])
  assert.deepEqual(parse(['-MobilePreview']), ['start', ['--mobile-preview']])
  assert.deepEqual(parse(['-RuntimeOnly']), ['start', ['--runtime-only']])
  assert.deepEqual(parse(['-Help']), ['start', ['--help']])
  // launch-windows.ps1 forwards long flags after handling restart and mobile itself.
  assert.deepEqual(parse(['--mobile', '--detach']), ['start', ['--detach', '--mobile']])
  const linux = readFileSync(resolve(__dirname, '../launchers/linux/Launch Budget Terminal.sh'), 'utf8')
  assert.match(linux, /"\$launcher" --attached\n/, 'Linux double-click keeps the app attached, like Windows -Attached')
}
console.log('PASS: btd commands, options and help match on Windows and Linux.')

const windowsLaunchers = resolve(__dirname, '../launchers/windows')
// One double-click launcher per OS (Windows .cmd, Linux .sh). Demo and phone previews start from launch-windows.ps1 flags instead.
assert.deepEqual(readdirSync(resolve(__dirname, '../launchers'), { recursive: true }).map(String).filter(name => name.includes('.')).sort(),
  [join('linux', 'Launch Budget Terminal.sh'), join('windows', 'Launch Budget Terminal.cmd')].sort(), 'Only the Windows .cmd and Linux .sh double-click launchers may exist')
{
  const linux = readFileSync(resolve(__dirname, '../launchers/linux/Launch Budget Terminal.sh'), 'utf8')
  assert.match(linux, /scripts\/launch-posix\.sh/, 'Linux launcher must use the shared POSIX launch path')
  assert(!/--demo|--dev|--mobile-preview/.test(linux), 'Linux double-click launcher must open the production build')
}

for (const [file, command] of [
  ['Launch Budget Terminal.cmd', /powershell\.exe[^\r\n]*launch-windows\.ps1" -Attached\n/],
]) {
  const source = readFileSync(join(windowsLaunchers, file), 'utf8').replace(/\r\n/g, '\n')
  assert.match(source, command, `${file} must launch the application on double click`)
  const windowsSource = readFileSync(join(__dirname, 'launch-windows.ps1'), 'utf8')
  assert.match(windowsSource, /install-bt\.ps1'\)/, 'Setup must check or install the BTD desktop command')
  assert(!windowsSource.includes('$Tui'), 'Windows launcher must not expose the retired interface')
  assert(!source.includes('-Dev'), `${file} must check the production build`)
  assert(!source.includes('%*'), 'Double-click setup must not forward app launch options')
  assert(!source.includes('-Setup'), 'Double-click startup must open the app without a separate setup-only pass')
  assert.equal(source.match(/^powershell\.exe/gm)?.length, 1, 'Double-click startup must launch once')
  assert.match(source, /-Attached\nif (?:not )?errorlevel 1/, 'Double-click startup must retain the terminal for dependency checks, build output and errors')
  assert(!source.includes('launch-menu.ps1'), 'Double-click startup must not show an interface chooser')
  assert.match(source, /pause >nul/, 'Double-click startup keeps failures visible')
}
for (const platform of ['win32', 'darwin', 'linux']) {
  for (const failedCall of [0, 2, 3, 4]) {
    const calls = []
    let verified = false
    assert.equal(launch({ setupOnly: true, platform, nodeVersion: '24.22.1', environment: {}, log,
      verifyBuild() { verified = true },
      spawn(command, args) {
        calls.push({ command, args })
        return { status: calls.length === failedCall ? 7 : 0, stdout: '11.0.0' }
      },
    }), failedCall ? 1 : 0)
    assert.equal(calls.length, failedCall || 4, 'Setup stops at the failed check')
    assert(!calls.some(call => /\b(preview|dev)\b/.test(call.args.join(' '))), 'Setup never opens an application')
    assert.equal(verified, !failedCall, 'Verify desktop assets only after a successful build')
    assert(!calls.some(call => call.args.join(' ').includes('tui')), 'Setup must not build the retired interface')
  }
}
for (const options of [{ development: true }, { logs: true }, { demo: true }, { mobilePreview: true }]) {
  assert.equal(launch({ setupOnly: true, ...options, nodeVersion: '24.22.1', log,
    spawn() { assert.fail('Setup must reject launch options before running commands') },
  }), 1)
}
function assertCurrentStartupMessages(messages) {
  const plain = messages.map(message => message.replace(/\x1b\[[0-9;]*m/g, ''))
  assert(plain.some(message => message.includes('BUDGET TERMINAL')), 'Show the launcher title')
  const stages = plain.filter(message => /\[\d\/5\]/.test(message))
  assert.equal(stages.length, 5, 'Show five startup stages')
  for (let index = 0; index < 5; index++) assert(stages[index].includes(`[${index + 1}/5]`), 'Stage numbers must follow execution order')
  assert(plain.some(message => message.includes('LAUNCH CHECKS PASSED')), 'Report successful checks before opening')
  assert(plain.some(message => message.includes('Keep this terminal open')), 'Explain the attached terminal lifetime')
  assert(plain.length < 40, 'Keep launcher messages concise; do not print a feature changelog')
}

for (const options of [{ terminal: false, environment: {} }, { terminal: true, environment: { NO_COLOR: '' } }, { terminal: true, environment: { TERM: 'dumb' } }]) {
  const lines = []
  let time = 0
  const output = createLauncherOutput({ ...options, now: () => time, log: { log: line => lines.push(line), error: line => lines.push(line) } })
  output.header('Desktop launcher', 'Windows')
  output.stage(1, 'Check toolchain')
  time = 1250
  output.done('Toolchain ready')
  output.warn('Optional runtime unavailable')
  output.error('Fixture build failure')
  output.ready('SETUP COMPLETE')
  assert(!lines.join('\n').includes('\x1b'), 'Redirected logs and NO_COLOR must not contain ANSI codes')
  assert(lines.some(line => line.includes('(1.3s)')), 'Display measured step duration')
  assert(lines.some(line => line.includes('[FAIL] Fixture build failure')), 'Keep failure details readable')
}
const colourLines = []
createLauncherOutput({ terminal: true, environment: {}, log: { log: line => colourLines.push(line) } }).header('Desktop launcher', 'Windows')
assert(colourLines.some(line => line.includes('\x1b[38;2;47;111;208m')), 'Interactive output uses the existing blue accent')
for (const version of ['22.23.4', '22.24.0', '24.22.1', '24.23.0', '26.12.1', '26.13.0']) assert(supportedNodeVersion(version), version)
for (const version of ['20.19.0', '22.20.0', '22.23.2', '22.23.3', '23.0.0', '24.12.0', '24.22.0', '25.0.0', '26.0.0', '26.12.0', '27.0.0', '26.12.1-rc.1', 'invalid']) assert(!supportedNodeVersion(version), version)
for (const version of ['10.9.8', '10.10.0', '11.0.0', '12.2.0']) assert(supportedNpmVersion(version), version)
for (const version of ['9.9.9', '10.8.9', '10.9.7', '11.0.0-beta.1', 'invalid']) assert(!supportedNpmVersion(version), version)

const environment = { PATH: 'unchanged', ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1' }
assert.deepEqual(runtimeEnvironment(environment), { PATH: 'unchanged' })
assert.equal(environment.ELECTRON_RUN_AS_NODE, '1', 'Do not change the parent environment')
for (const key of ['NODE_TLS_REJECT_UNAUTHORIZED', 'node_tls_reject_unauthorized']) {
  assert.throws(() => assertCertificateEnvironment({ [key]: '0' }), /verification is disabled/)
  assert.equal(launch({ nodeVersion: '22.23.4', environment: { [key]: '0' }, log,
    spawn() { assert.fail('Disabled TLS verification must stop before any child process') },
  }), 1)
}
assertCertificateEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '1' })

for (const platform of ['win32', 'darwin', 'linux']) {
  const calls = []
  const messages = []
  const status = launch({ platform, nodeVersion: '22.23.4', environment,
    log: { ...log, log: message => messages.push(message) }, spawn(command, args, options) {
    calls.push({ command, args, options })
    return { status: 0, stdout: calls.length === 1 ? '10.9.8\n' : '' }
  } })
  assert.equal(status, 0)
  assertCurrentStartupMessages(messages)
  assert.equal(calls.length, 5)
  assert.equal(calls[0].command, platform === 'win32' ? 'cmd.exe' : 'npm')
  assert.equal(calls[0].options.stdio, 'pipe', 'Capture npm version before installation')
  assert(calls[1].args.join(' ').includes('install --no-audit --no-fund'))
  assert(calls[1].args.includes('--strict-ssl=true') || calls[1].args.join(' ').includes('--strict-ssl=true'), 'Dependency installs must override insecure npm SSL configuration')
  assert(calls[2].args.join(' ').includes('run ensure:electron'))
  assert(calls[3].args.join(' ').includes('run build'), 'Local launchers must build the restored snapshot-sync application')
  assert(calls[4].args.join(' ').includes('run preview --workspace budget-terminal-desktop'))
  for (const call of calls.slice(1)) assert.equal(call.options.stdio, 'inherit', 'Dependency checks, Electron checks, build and app output must stay visible in the launcher terminal')
  for (const call of calls) assert.deepEqual(call.options.env, { PATH: 'unchanged' })
}

for (const platform of ['win32', 'darwin', 'linux']) {
  const calls = []
  const messages = []
  assert.equal(launch({ platform, development: true, nodeVersion: '24.22.1', environment,
    log: { ...log, log: message => messages.push(message) },
    verifyBuild() { assert.fail('Live mode must not verify production renderer assets') },
    spawn(command, args, options) {
      calls.push({ command, args, options })
      return { status: 0, stdout: '11.0.0' }
    },
  }), 0)
  assertCurrentStartupMessages(messages)
  assert.equal(calls.length, 5)
  assert(calls[3].args.join(' ').includes('run build:mcp'))
  assert(calls[4].args.join(' ').includes('run dev --workspace budget-terminal-desktop'))
  assert(!calls.some(call => call.args.join(' ').includes('preview')))
}
for (const failedCall of [2, 3, 4, 5]) {
  let calls = 0
  assert.equal(launch({ development: true, nodeVersion: '24.22.1', log, spawn() {
    calls++
    return { status: calls === failedCall ? 7 : 0, stdout: '11.0.0' }
  } }), failedCall === 5 ? 7 : 1)
  assert.equal(calls, failedCall, 'Live mode must stop after failed dependency/runtime/MCP/app startup')
}
for (const result of [{ status: 0 }, { status: 7 }, { status: null, error: { message: 'missing PowerShell' } }]) {
  assert.equal(dev({ platform: 'win32', environment, log, runLaunch() { assert.fail('Windows dev must select a supported runtime first') },
    spawn(command, args, options) {
      assert.equal(command, 'powershell.exe')
      assert.equal(args.at(-1), '-Dev')
      assert.equal(args.at(-2), join(__dirname, 'launch-windows.ps1'))
      assert.deepEqual(options.env, { PATH: 'unchanged' })
      return result
    },
  }), result.status ?? 1)
}
for (const platform of ['darwin', 'linux']) {
  assert.equal(dev({ platform, environment, log, spawn() { assert.fail('No PowerShell on macOS/Linux') },
    runLaunch(options) {
      assert.equal(options.platform, platform)
      assert.equal(options.development, true)
      assert.deepEqual(options.environment, { PATH: 'unchanged' })
      return 7
    },
  }), 7)
}
assert.equal(dev({ environment: { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, log,
  spawn() { assert.fail('Dev must reject disabled TLS before runtime recovery') },
  runLaunch() { assert.fail('Dev must reject disabled TLS before launching') },
}), 1)

const buildDirectory = mkdtempSync(join(tmpdir(), 'budget-launcher-build-'))
try {
  const directory = join(buildDirectory, 'desktop with spaces # %')
  assert.throws(() => verifyDesktopBuild(directory), /desktop build is incomplete/)
  for (const file of ['out/main/main.js', 'out/main/quantWorker.js', 'out/main/cacheWorker.js', 'out/preload/preload.cjs', 'out/renderer/assets/entry.js', 'out/renderer/assets/theme.css']) {
    mkdirSync(resolve(directory, file, '..'), { recursive: true })
    writeFileSync(join(directory, file), 'fixture')
  }
  const html = join(directory, 'out/renderer/index.html')
  writeFileSync(html, '<script src="./assets/entry.js"></script><link href="./assets/theme.css" rel="stylesheet">')
  assert.throws(() => verifyDesktopBuild(directory), /mobile\.html/)
  writeFileSync(join(directory, 'out/renderer/mobile.html'), '<script src="./assets/entry.js"></script>')
  verifyDesktopBuild(directory)
  rmSync(join(directory, 'out/renderer/assets/entry.js'))
  assert.throws(() => verifyDesktopBuild(directory), /desktop build is incomplete/)
  let calls = 0
  const messages = []
  assert.equal(launch({ nodeVersion: '22.23.4',
    log: { log() {}, error: message => messages.push(message) },
    verifyBuild: () => verifyDesktopBuild(directory),
    spawn() { calls++; return { status: 0, stdout: '10.9.8' } },
  }), 1)
  assert.equal(calls, 4, 'A successful build command with missing assets must never launch Electron')
  assert(messages.some(message => message.includes('launchers folder')))
  writeFileSync(join(directory, 'out/renderer/assets/entry.js'), '')
  assert.throws(() => verifyDesktopBuild(directory), /Missing or empty build file/)
  writeFileSync(html, '<div>Not a built renderer</div>')
  assert.throws(() => verifyDesktopBuild(directory), /does not reference a built JavaScript entry/)
} finally {
  rmSync(buildDirectory, { recursive: true, force: true })
}

for (const configuration of [{ platform: 'freebsd' }, { nodeVersion: '22.23.3' }, { nodeVersion: '24.22.0' }, { nodeVersion: '26.12.0' }]) {
  assert.equal(launch({ log, ...configuration, spawn() { assert.fail('Unsupported platform/runtime must stop before spawning npm') } }), 1)
}
for (const result of [{ error: { code: 'ENOENT' }, status: null }, { status: 1 }, { status: 0, stdout: '10.9.7' }, { status: 0, stdout: '' }]) {
  let calls = 0
  assert.equal(launch({ log, nodeVersion: '22.23.4', spawn() { calls++; return result } }), 1)
  assert.equal(calls, 1, 'No installation after missing/unsupported npm')
}
for (const failedCall of [2, 3, 4, 5]) {
  let calls = 0
  const messages = []
  assert.equal(launch({ log: { log() {}, error: message => messages.push(message) }, nodeVersion: '22.23.4', spawn() {
    calls++
    return { status: calls === failedCall ? 7 : 0, stdout: '10.9.8' }
  } }), failedCall === 5 ? 7 : 1)
  assert.equal(calls, failedCall, 'Stop after failed install, readiness check, build, or application')
  if (failedCall === 4) assert(messages.some(message => /bundle remains locked.*disconnect.*MCP/.test(message)), 'Build failures must explain how to recover from a persistent MCP lock')
}

{
  const calls = []
  const messages = []
  const status = launch({ platform: 'win32', nodeVersion: '22.23.4', environment,
    log: { log: message => messages.push(message), error: message => messages.push(message) },
    spawn(command, args, options) { calls.push({ command, args, options }); return { status: 0, stdout: '10.9.8' } },
  })
  assert.equal(status, 0)
  assert(!calls.some(call => /codex|claude|pi-coding-agent/i.test([call.command, ...call.args].join(' '))), 'Launcher never starts an agent runtime, signs in or runs inference')
  assert(messages.some(message => message.includes('built-in Pi runtime') && message.includes('Autonomous mode starts off')))
}

assert.deepEqual(tryRun('electron', { expectedVersion: '43.7.9', environment, spawn(_command, _args, options) {
  assert.deepEqual(options.env, { PATH: 'unchanged' })
  return { status: 0, stdout: 'v43.7.9\n' }
} }), { ok: true, version: 'v43.7.9' })
for (const reported of ['v24.21.0', 'v43.7.7', '']) {
  const result = tryRun('electron', { expectedVersion: '43.7.9', spawn: () => ({ status: 0, stdout: reported }) })
  assert.equal(result.ok, false, 'Embedded Node or mismatched Electron is not ready')
  assert.equal(result.retry, false)
}
assert.equal(tryRun('electron', { spawn: () => ({ error: { code: 'EBUSY' } }) }).ok, false)
assert.equal(tryRun('electron', { spawn: () => ({ status: 1 }) }).ok, false)

let attempts = 0
let pauses = 0
assert.equal(ensureElectron({ log, attempts: 2, pause() { pauses++ }, spawn() {
  attempts++
  return attempts === 1 ? { error: { code: 'EBUSY' } } : { status: 0, stdout: `v${electronVersion}` }
} }), 0)
assert.equal(attempts, 2)
assert.equal(pauses, 1, 'Transient Windows scan locks remain retryable')
assert.equal(ensureElectron({ log, attempts: 1, pause() { assert.fail('Last failure must not wait') }, spawn: () => ({ status: 1 }) }), 1)

// Linux: the postinstall version check skips the sandbox; the launcher verifies and repairs it in stage 3.
assert.deepEqual(versionArgs('linux'), ['--no-sandbox', '--version'])
assert.deepEqual(versionArgs('win32'), ['--version'])
assert.equal(tryRun('electron', { spawn: () => ({ status: null, signal: 'SIGTRAP' }) }).reason, 'signal SIGTRAP', 'Report crashes as signals, not "exit null"')
{
  const profile = sandboxProfile('/home/user/My [Repo]/node_modules/electron/dist/electron')
  assert.match(profile.name, /^budget-terminal-[0-9a-f]{12}$/)
  assert.equal(profile.file, `/etc/apparmor.d/${profile.name}`)
  assert.equal(profile.name, sandboxProfile('/home/user/My [Repo]/node_modules/electron/dist/electron').name, 'One stable profile per checkout')
  assert(profile.text.includes('"/home/user/My \\[Repo\\]/node_modules/electron/dist/electron" flags=(unconfined) {'), 'Quote and escape globs in the binary path')
  assert(profile.text.includes('  userns,'))
  assert.throws(() => sandboxProfile('/tmp/bad\npath/electron'))

  const sandboxRun = (outcomes, options = {}) => {
    const messages = []
    const installs = []
    const output = { note: m => messages.push(m), warn: m => messages.push(m), error: m => messages.push(m) }
    const ok = ensureLinuxSandbox({ output, binary: '/x/electron', interactive: true, restricted: () => true,
      spawn(command, args) { assert.deepEqual([command, args], ['/x/electron', ['--version']], 'Sandbox check runs Electron with its sandbox'); return outcomes.shift() },
      install(bin) { installs.push(bin); return { ok: options.installOk ?? true, profile: { file: '/etc/apparmor.d/test' } } },
      ...options })
    return { ok, messages, installs }
  }
  const crash = { status: null, signal: 'SIGTRAP' }
  let run = sandboxRun([{ status: 0 }])
  assert.equal(run.ok, true); assert.equal(run.installs.length, 0, 'Working sandbox never asks for sudo')
  run = sandboxRun([crash, { status: 0 }])
  assert.equal(run.ok, true); assert.deepEqual(run.installs, ['/x/electron'], 'Restricted user namespaces install the AppArmor profile once')
  run = sandboxRun([crash, crash])
  assert.equal(run.ok, false); assert(run.messages.some(m => m.includes('still cannot start')))
  run = sandboxRun([crash], { installOk: false })
  assert.equal(run.ok, false); assert(run.messages.some(m => m.includes('npm run setup:linux-sandbox')))
  run = sandboxRun([crash], { interactive: false })
  assert.equal(run.ok, false); assert.equal(run.installs.length, 0, 'Never prompt for sudo without a terminal')
  assert(run.messages.some(m => m.includes('npm run setup:linux-sandbox') && m.includes('signal SIGTRAP')))
  run = sandboxRun([crash], { restricted: () => false })
  assert.equal(run.ok, false); assert.equal(run.installs.length, 0); assert(run.messages.some(m => m.includes('chrome-sandbox')))

  for (const ready of [true, false]) {
    let checked = 0
    const status = runLaunch({ platform: 'linux', nodeVersion: '24.22.1', environment: { PATH: 'unchanged' }, setupOnly: true,
      log: { log() {}, error() {} }, verifyBuild() {},
      spawn() { return { status: 0, stdout: '11.0.0' } },
      linuxSandbox({ output, spawn }) { checked++; assert.equal(typeof output.error, 'function'); assert.equal(typeof spawn, 'function'); return ready },
    })
    assert.equal(checked, 1, 'Linux launches verify the Electron sandbox')
    assert.equal(status, ready ? 0 : 1)
  }
  assert.equal(runLaunch({ platform: 'win32', nodeVersion: '24.22.1', environment: { PATH: 'unchanged' }, setupOnly: true,
    log: { log() {}, error() {} }, verifyBuild() {}, spawn() { return { status: 0, stdout: '11.0.0' } },
    linuxSandbox() { assert.fail('Windows has no Linux sandbox step') } }), 0)
  console.log('PASS: Linux sandbox check installs an AppArmor userns profile only when restricted, prompts only in a terminal and blocks launch on failure.')
}

const configCheck = spawnSync(process.execPath, [require.resolve('tsx/cli'), '-e',
  "import './apps/desktop/electron.vite.config.ts'; if (process.env.ELECTRON_RUN_AS_NODE !== undefined) throw new Error('Direct dev/preview retained Node mode')",
], { cwd: resolve(__dirname, '..'), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000 })
assert.equal(configCheck.status, 0, configCheck.stderr || configCheck.error?.message)
if (process.platform === 'win32') {
  const windowsCheck = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    join(__dirname, 'probe-windows-launcher.ps1'), '-NodePath', process.execPath,
  ], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(windowsCheck.status, 0, windowsCheck.stdout + windowsCheck.stderr || windowsCheck.error?.message)
  console.log(windowsCheck.stdout.trim())
}
console.log('Launcher checks passed: supported toolchains, production and live platform commands, dev runtime recovery, inherited environment, built-in Agents runtime note, failure paths, complete renderer/asset verification, exact Electron version and transient locks.')

async function probeUpdates() {
  const directory = mkdtempSync(join(tmpdir(), 'budget-update-'))
  try {
    const source = join(directory, 'published')
    const local = join(directory, 'installed checkout')
    const git = (cwd, ...args) => {
      const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', timeout: 10_000 })
      assert.equal(result.status, 0, result.stderr || result.error?.message)
      return result.stdout.trim()
    }
    const commit = (cwd, message) => {
      git(cwd, 'add', '.')
      git(cwd, '-c', 'user.name=Budget Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', message)
      return git(cwd, 'rev-parse', 'HEAD')
    }
    git(directory, 'init', '-b', 'main', source)
    writeFileSync(join(source, '.gitignore'), '/ignored.txt\n')
    const initial = commit(source, 'Initial revision')
    git(directory, 'clone', source, local)
    const updater = createUpdater(local, async (command, args, options) => {
      assert.equal(command, 'git')
      const fixtureArgs = args.map(arg => arg === 'https://github.com/Wong-Zhen-Yi/Budget-Terminal-2.0.git' ? source : arg)
      const result = spawnSync(command, ['-c', 'protocol.file.allow=always', ...fixtureArgs], options)
      if (result.error) throw result.error
      if (result.status !== 0) throw Object.assign(new Error(result.stderr), { code: result.status })
      return result
    })
    assert.deepEqual(await updater.check(), { status: 'current', revision: initial })
    writeFileSync(join(source, 'app.txt'), 'updated source')
    const revision = commit(source, 'Published update')
    const pending = await updater.check()
    assert.deepEqual(pending, { status: 'available', revision, current: initial })
    assert.equal(git(local, 'rev-parse', 'HEAD'), initial, 'Check preserves the checked-out revision')
    assert(!existsSync(join(local, 'app.txt')), 'Check preserves the working tree')
    writeFileSync(join(local, 'app.txt'), 'local work')
    assert.deepEqual(await updater.check(), pending, 'Local work must not prevent checking for an update')
    await assert.rejects(updater.install(pending), /local changes/)
    assert.equal(readFileSync(join(local, 'app.txt'), 'utf8'), 'local work')
    rmSync(join(local, 'app.txt'))
    assert.deepEqual(await updater.install(pending), { status: 'updated', revision })
    assert.equal(git(local, 'rev-parse', 'HEAD'), revision)
    assert.equal(readFileSync(join(local, 'app.txt'), 'utf8'), 'updated source')
    assert.deepEqual(await updater.check(), { status: 'current', revision })

    writeFileSync(join(source, 'ignored.txt'), 'published file')
    git(source, 'add', '-f', 'ignored.txt')
    commit(source, 'Published file previously ignored')
    writeFileSync(join(local, 'ignored.txt'), 'local ignored file')
    await assert.rejects(updater.install(await updater.check()), /could not apply/)
    assert.equal(git(local, 'rev-parse', 'HEAD'), revision)
    assert.equal(readFileSync(join(local, 'ignored.txt'), 'utf8'), 'local ignored file')
    git(local, 'switch', '-c', 'work')
    await assert.rejects(updater.check(), /main branch/)
    git(local, 'switch', 'main')
    writeFileSync(join(local, 'app.txt'), 'local commit')
    const diverged = commit(local, 'Local work')
    await assert.rejects(updater.check(), /fast-forward/)
    assert.equal(git(local, 'rev-parse', 'HEAD'), diverged)
    await assert.rejects(createUpdater(directory).check(), /Git clone/)
    assert(!updateErrorMessage(Object.assign(new Error('private path'), { code: 128 })).includes('private path'))
    console.log('PASS: source updates check and fast-forward through Git, preserve local and ignored files, and reject other branches and diverged histories.')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function probeDetachedLaunch() {
  for (const shouldFail of [false, true]) {
    let verified = false
    let npmCalls = 0
    const messages = []
    const status = await launch({ platform: 'win32', nodeVersion: '24.22.1', environment: { ELECTRON_RUN_AS_NODE: '1' },
      detach: true, logs: true,
      log: { log: message => messages.push(message), error: message => messages.push(message) },
      verifyBuild() { verified = true },
      spawn() { npmCalls++; return { status: 0, stdout: '11.0.0' } },
      async openDetached(env) {
        assert(verified, 'Verify the build before starting the detached desktop app')
        assert(messages.some(message => message.includes('[5/5]')))
        assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
        assert.equal(env.BUDGET_TERMINAL_OPEN_DIAGNOSTICS, '1')
        if (shouldFail) throw new Error('test spawn failure')
        return 0
      },
    })
    assert.equal(status, shouldFail ? 1 : 0)
    assert.equal(npmCalls, 4, 'Detached startup must not run an attached preview or rebuild the verified app')
    assert(!messages.some(message => message.includes('Keep this terminal open')))
    assert.equal(messages.some(message => message.includes('test spawn failure')), shouldFail)
  }
  assert.equal(await launch({ mobile: true, detach: true, platform: 'win32', nodeVersion: '24.22.1', log,
    environment: personalEnvironment,
    spawn() { return { status: 0, stdout: '11.0.0' } },
    async openDetached(env) {
      assert.equal(env.BUDGET_TERMINAL_OPEN_MOBILE, '1')
      assert.equal(env.BUDGET_TERMINAL_DEMO_DIR, undefined)
      assert.equal(env.BUDGET_TERMINAL_DATA_DIR, personalEnvironment.BUDGET_TERMINAL_DATA_DIR)
      return 0
    },
  }), 0)
  console.log('PASS: detached desktop starts after all five visible stages and reports launch failures to the terminal.')
}

function probeDetachedScope() {
  const direct = { command: '/electron', args: ['.'] }
  for (const platform of ['win32', 'darwin']) {
    assert.deepEqual(detachedDesktopCommand('/electron', { platform, spawn() { assert.fail(`${platform} has no systemd scope`) } }), direct)
  }
  // Linux runs the whole process tree in its own user scope, so closing the launching terminal or agent cannot kill Electron's helpers.
  const calls = []
  const scoped = detachedDesktopCommand('/electron', { platform: 'linux', session: 'abc', env: {}, spawn(command, args) { calls.push([command, ...args]); return { status: 0 } } })
  assert.deepEqual(calls, [['systemd-run', '--user', '--scope', '--quiet', '--collect', 'true']])
  assert.equal(scoped.command, 'systemd-run')
  assert.deepEqual(scoped.args, ['--user', '--scope', '--quiet', '--collect', '--unit=budget-terminal-abc', '--description=Budget Terminal', '--', '/electron', '.'])
  // Without a reachable user manager, start Electron directly instead of failing the launch.
  assert.deepEqual(detachedDesktopCommand('/electron', { platform: 'linux', spawn() { return { status: 1 } } }), direct)
  assert.deepEqual(detachedDesktopCommand('/electron', { platform: 'linux', spawn() { return { error: new Error('ENOENT') } } }), direct)
  console.log('PASS: Linux detached launches own their systemd scope and fall back when systemd is unavailable.')
}

Promise.all([probeDetachedLaunch(), probeDetachedScope(), probeUpdates()]).catch(error => {
  console.error(error)
  process.exitCode = 1
})
