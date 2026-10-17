const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const { launch } = require('./launch.cjs')
const { findCodex } = require('./codex-runtime.cjs')
const { tryRun, ensureElectron } = require('./ensure-electron.cjs')
const { supportedNodeVersion, supportedNpmVersion, runtimeEnvironment } = require('./runtime.cjs')
const { version: electronVersion } = require('electron/package.json')

const log = { log() {}, error() {} }
for (const version of ['22.20.0', '22.23.2', '24.12.0', '24.21.0', '26.0.0']) assert(supportedNodeVersion(version), version)
for (const version of ['20.19.0', '22.19.9', '23.0.0', '24.11.9', '25.0.0', '27.0.0', '26.0.0-rc.1', 'invalid']) assert(!supportedNodeVersion(version), version)
for (const version of ['10.9.8', '10.10.0', '11.0.0', '12.2.0']) assert(supportedNpmVersion(version), version)
for (const version of ['9.9.9', '10.8.9', '10.9.7', '11.0.0-beta.1', 'invalid']) assert(!supportedNpmVersion(version), version)

const environment = { PATH: 'unchanged', ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1' }
assert.deepEqual(runtimeEnvironment(environment), { PATH: 'unchanged' })
assert.equal(environment.ELECTRON_RUN_AS_NODE, '1', 'Do not change the parent environment')

for (const platform of ['win32', 'darwin', 'linux']) {
  const calls = []
  const status = launch({ platform, nodeVersion: '22.23.2', environment, locateCodex: () => null, log, spawn(command, args, options) {
    calls.push({ command, args, options })
    return { status: 0, stdout: calls.length === 1 ? '10.9.8\n' : '' }
  } })
  assert.equal(status, 0)
  assert.equal(calls.length, 5)
  assert.equal(calls[0].command, platform === 'win32' ? 'cmd.exe' : 'npm')
  assert.equal(calls[0].options.stdio, 'pipe', 'Capture npm version before installation')
  assert(calls[1].args.join(' ').includes('install --no-audit --no-fund'))
  assert(calls[2].args.join(' ').includes('run ensure:electron'))
  assert(calls[3].args.join(' ').includes('run build'))
  assert(calls[4].args.join(' ').includes('run preview --workspace budget-terminal-desktop'))
  for (const call of calls) assert.deepEqual(call.options.env, { PATH: 'unchanged' })
}

for (const configuration of [{ platform: 'freebsd' }, { nodeVersion: '22.19.9' }]) {
  assert.equal(launch({ log, ...configuration, spawn() { assert.fail('Unsupported platform/runtime must stop before spawning npm') } }), 1)
}
for (const result of [{ error: { code: 'ENOENT' }, status: null }, { status: 1 }, { status: 0, stdout: '10.9.7' }, { status: 0, stdout: '' }]) {
  let calls = 0
  assert.equal(launch({ log, locateCodex: () => null, nodeVersion: '22.23.2', spawn() { calls++; return result } }), 1)
  assert.equal(calls, 1, 'No installation after missing/unsupported npm')
}
for (const failedCall of [2, 3, 4, 5]) {
  let calls = 0
  assert.equal(launch({ log, locateCodex: () => null, nodeVersion: '22.23.2', spawn() {
    calls++
    return { status: calls === failedCall ? 7 : 0, stdout: '10.9.8' }
  } }), failedCall === 5 ? 7 : 1)
  assert.equal(calls, failedCall, 'Stop after failed install, readiness check, build, or application')
}

for (const [platform, environment, expected] of [
  ['win32', { Path: 'C:\\tools', LOCALAPPDATA: 'C:\\User Data' }, 'C:\\User Data\\Programs\\OpenAI\\Codex\\bin\\codex.exe'],
  ['win32', { PATH: '"C:\\Program Files\\Codex"' }, 'C:\\Program Files\\Codex\\codex.exe'],
  ['win32', { PATH: 'C:\\npm' }, 'C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe'],
  ['darwin', { PATH: '/bin', HOME: '/Users/person' }, '/opt/homebrew/bin/codex'],
  ['linux', { PATH: '/bin', HOME: '/home/person' }, '/home/person/.local/bin/codex'],
  ['linux', { BUDGET_TERMINAL_CODEX_PATH: '/custom/codex', PATH: '/bin' }, '/custom/codex'],
]) {
  assert.equal(findCodex({ platform, architecture: 'x64', environment, exists: candidate => candidate === expected }), expected)
}
assert.equal(findCodex({ platform: 'win32', environment: { PATH: 'C:\\empty' }, exists: () => false }), null)
for (const ready of [true, false]) {
  const calls = []
  const messages = []
  const codexPath = 'C:\\Codex with spaces\\codex.exe'
  const status = launch({ platform: 'win32', nodeVersion: '22.23.2', environment,
    locateCodex: () => codexPath, log: { log: message => messages.push(message), error: message => messages.push(message) },
    spawn(command, args, options) {
      calls.push({ command, args, options: { ...options, env: { ...options.env } } })
      if (command === codexPath) return ready ? { status: 0, stdout: 'codex-cli 0.159.0\n' } : { status: null, error: { code: 'ENOENT' } }
      return { status: 0, stdout: '10.9.8' }
    },
  })
  assert.equal(status, 0, 'Missing/broken Codex must not prevent opening the app')
  assert.deepEqual(calls[0].args, ['--version'], 'Launcher never signs in or runs agent inference')
  assert.equal(calls[0].options.windowsHide, true)
  assert.equal(calls.at(-1).options.env.BUDGET_TERMINAL_CODEX_PATH, ready ? codexPath : undefined)
  assert.equal(environment.BUDGET_TERMINAL_CODEX_PATH, undefined, 'Do not change parent environment')
  assert(messages.some(message => ready ? message.includes('Autonomous mode starts off') : message.includes('app will open')))
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

const configCheck = spawnSync(process.execPath, [require.resolve('tsx/cli'), '-e',
  "import './apps/desktop/electron.vite.config.ts'; if (process.env.ELECTRON_RUN_AS_NODE !== undefined) throw new Error('Direct dev/preview retained Node mode')",
], { cwd: resolve(__dirname, '..'), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000 })
assert.equal(configCheck.status, 0, configCheck.stderr || configCheck.error?.message)
console.log('Launcher checks passed: supported toolchains, platform commands, inherited environment, Codex discovery and handoff, optional Agents runtime, failure paths, exact Electron version and transient locks.')
