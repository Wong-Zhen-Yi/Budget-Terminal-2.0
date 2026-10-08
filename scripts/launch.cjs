const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { supportedNodeVersion, supportedNpmVersion, runtimeEnvironment } = require('./runtime.cjs')
const { engines } = require('../package.json')

const root = path.resolve(__dirname, '..')

function platformName(platform) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return null
}

function launch({ platform = process.platform, nodeVersion = process.versions.node, environment = process.env, spawn = spawnSync, log = console } = {}) {
  const os = platformName(platform)
  if (!os) {
    log.error(`Budget Terminal supports Windows, macOS, and Linux; found ${platform}.`)
    return 1
  }

  if (!supportedNodeVersion(nodeVersion)) {
    log.error(`Unsupported Node.js ${nodeVersion}. Required: ${engines.node}. Latest Node.js 24 LTS is recommended.`)
    return 1
  }

  const env = runtimeEnvironment(environment)

  const npm = (args, capture = false) => {
    const command = platform === 'win32' ? env.ComSpec || 'cmd.exe' : 'npm'
    const commandArgs = platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args
    return spawn(command, commandArgs, { cwd: root, env, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' })
  }

  const installed = npm(['--version'], true)
  if (installed.error || installed.status !== 0) {
    log.error('npm is required. Install the latest Node.js 24 LTS with npm, then relaunch Budget Terminal.')
    return 1
  }
  const npmVersion = installed.stdout?.trim()
  if (!supportedNpmVersion(npmVersion)) {
    log.error(`Unsupported npm ${npmVersion || '(unknown)'}. Required: ${engines.npm}. npm 11 is recommended.`)
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
