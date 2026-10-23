// Prove the Electron binary can actually be spawned before `npm run dev` tries to.
//
// `require('electron')` only resolves `path.txt`, so it passes even when the
// launcher's `npm install` has just re-extracted `dist/electron.exe` and
// Defender still holds the fresh binary for scanning — electron-vite then dies
// with `spawn UNKNOWN`. Running `--version` with a retry window waits that out,
// and a missing or mismatched dist is repaired with Electron's own installer.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { runtimeEnvironment, supportedNodeVersion, assertCertificateEnvironment } = require('./runtime.cjs')

const electronDir = path.dirname(require.resolve('electron/package.json'))
const { version } = require('electron/package.json')

const ATTEMPTS = 15
const DELAY_MS = 2000

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function binaryPath() {
  try {
    return path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim())
  } catch {
    return null
  }
}

function distVersion() {
  try {
    return fs.readFileSync(path.join(electronDir, 'dist', 'version'), 'utf8').trim().replace(/^v/, '')
  } catch {
    return null
  }
}

function tryRun(bin, { spawn = spawnSync, environment = process.env, expectedVersion = version } = {}) {
  const result = spawn(bin, ['--version'], { env: runtimeEnvironment(environment), encoding: 'utf8', timeout: 30_000 })
  if (result.error) return { ok: false, reason: `${result.error.code || result.error.message}` }
  if (result.status !== 0) return { ok: false, reason: `exit ${result.status}` }
  const reported = result.stdout?.trim() || ''
  if (reported.replace(/^v/, '') !== expectedVersion) {
    return { ok: false, retry: false, reason: `reported ${reported || '(no version)'}, expected Electron ${expectedVersion}` }
  }
  return { ok: true, version: reported }
}

function ensureElectron({ spawn = spawnSync, environment = process.env, log = console, pause = sleep, attempts = ATTEMPTS } = {}) {
  let bin = binaryPath()
  if (!bin || !fs.existsSync(bin) || distVersion() !== version) {
    log.log(`Electron ${version} runtime missing or stale; downloading...`)
    const result = spawn(process.execPath, [path.join(electronDir, 'install.js')], { env: runtimeEnvironment(environment), stdio: 'inherit' })
    if (result.error || result.status !== 0) {
      log.error('Electron download failed.')
      return 1
    }
    bin = binaryPath()
    if (!bin || !fs.existsSync(bin) || distVersion() !== version) {
      log.error(`Electron ${version} download did not produce the expected runtime.`)
      return 1
    }
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const run = tryRun(bin, { spawn, environment })
    if (run.ok) {
      log.log(`Electron ${run.version} ready.`)
      return 0
    }
    if (run.retry === false || attempt === attempts) {
      log.error(`Electron binary at ${bin} cannot be started (${run.reason}).`)
      log.error('If a security scanner is inspecting it, wait a moment and relaunch; otherwise reinstall dependencies with npm install.')
      return 1
    }
    log.log(`Electron not spawnable yet (${run.reason}); retrying in ${DELAY_MS / 1000}s (${attempt}/${attempts})...`)
    pause(DELAY_MS)
  }
  return 1
}

if (require.main === module) {
  try {
    if (!supportedNodeVersion(process.versions.node)) throw new Error('Install Node.js 22.23.4+, 24.22.1+, or 26.12.1+ before downloading Electron (eMudhra certificate security update).')
    assertCertificateEnvironment()
    process.exitCode = ensureElectron()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { ensureElectron, tryRun }
