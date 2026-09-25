const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function platformName(platform) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return null
}

function launch({ platform = process.platform, spawn = spawnSync, log = console } = {}) {
  const os = platformName(platform)
  if (!os) {
    log.error(`Budget Terminal supports Windows, macOS, and Linux; found ${platform}.`)
    return 1
  }

  const npm = (args, quiet = false) => {
    const command = platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm'
    const commandArgs = platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args
    return spawn(command, commandArgs, { cwd: root, stdio: quiet ? 'ignore' : 'inherit' })
  }

  const installed = npm(['--version'], true)
  if (installed.error || installed.status !== 0) {
    log.error('npm is required. Install Node.js 24 or newer with npm, then relaunch Budget Terminal.')
    return 1
  }

  log.log(`Starting Budget Terminal for ${os}...`)
  log.log('Installing dependencies...')
  const install = npm(['install', '--no-audit', '--no-fund'])
  if (install.error || install.status !== 0) {
    log.error('Dependency installation failed. See the npm error above.')
    return 1
  }

  log.log('Checking Electron runtime...')
  const electron = npm(['run', 'ensure:electron'])
  if (electron.error || electron.status !== 0) {
    log.error('Electron runtime could not start. See the error above.')
    return 1
  }

  log.log('Opening Budget Terminal in Electron. Keep this terminal open while using the app.')
  const app = npm(['run', 'dev'])
  if (app.error || app.status !== 0) {
    log.error('Budget Terminal stopped with an error. See the output above.')
    return app.status || 1
  }
  return 0
}

if (require.main === module) process.exitCode = launch()

module.exports = { launch, platformName }
