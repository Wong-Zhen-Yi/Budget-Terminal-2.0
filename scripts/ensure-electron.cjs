// Prove the Electron binary can actually be spawned before `npm run dev` tries to.
//
// `require('electron')` only resolves `path.txt`, so it passes even when the
// launcher's `npm install` has just re-extracted `dist/electron.exe` and
// Defender still holds the fresh binary for scanning — electron-vite then dies
// with `spawn UNKNOWN`. Running `--version` with a retry window waits that out,
// and a missing or mismatched dist is repaired with Electron's own installer.
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

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

function reinstall() {
  console.log(`Electron ${version} runtime missing or stale; downloading...`)
  const result = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error('Electron download failed.')
    process.exit(1)
  }
}

function tryRun(bin) {
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30_000 })
  if (result.error) return { ok: false, reason: `${result.error.code || result.error.message}` }
  if (result.status !== 0) return { ok: false, reason: `exit ${result.status}` }
  return { ok: true, version: result.stdout.trim() }
}

let bin = binaryPath()
if (!bin || !fs.existsSync(bin) || distVersion() !== version) {
  reinstall()
  bin = binaryPath()
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const run = tryRun(bin)
  if (run.ok) {
    console.log(`Electron ${run.version} ready.`)
    process.exit(0)
  }
  if (attempt === ATTEMPTS) {
    console.error(`Electron binary at ${bin} cannot be started (${run.reason}).`)
    console.error('If an antivirus is scanning it, wait a moment and relaunch; otherwise delete node_modules\electron and run npm install.')
    process.exit(1)
  }
  console.log(`Electron not spawnable yet (${run.reason}); retrying in ${DELAY_MS / 1000}s (${attempt}/${ATTEMPTS})...`)
  sleep(DELAY_MS)
}
