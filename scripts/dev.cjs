const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { launch } = require('./launch.cjs')
const { runtimeEnvironment, assertCertificateEnvironment } = require('./runtime.cjs')

// This dependency-free entry point can recover from an old shell Node on Windows.
function dev({ platform = process.platform, environment = process.env, spawn = spawnSync, runLaunch = launch, log = console } = {}) {
  const env = runtimeEnvironment(environment)
  try { assertCertificateEnvironment(env) } catch (error) {
    log.error(error.message)
    return 1
  }
  if (platform !== 'win32') return runLaunch({ platform, environment: env, development: true, log })
  const result = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'launch-windows.ps1'), '-Dev',
  ], { cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit' })
  if (result.error) log.error(`Could not start the Windows development launcher: ${result.error.message}`)
  return result.status ?? 1
}

if (require.main === module) process.exitCode = dev()

module.exports = { dev }
