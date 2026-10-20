const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { supportedNodeVersion, supportedNpmVersion, runtimeEnvironment } = require('./runtime.cjs')
const { engines } = require('../package.json')
const { findCodex } = require('./codex-runtime.cjs')
const { verifyDesktopBuild } = require('./verify-desktop-build.cjs')

const root = path.resolve(__dirname, '..')

function platformName(platform) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return null
}

function launch({ platform = process.platform, nodeVersion = process.versions.node, environment = process.env, spawn = spawnSync, locateCodex = findCodex, verifyBuild = verifyDesktopBuild, log = console } = {}) {
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
  log.log('Checking Codex for the Agents page...')
  const codexPath = locateCodex({ platform, environment: env })
  if (codexPath) {
    const codex = spawn(codexPath, ['--version'], { cwd: root, env, windowsHide: true, stdio: 'pipe', encoding: 'utf8', timeout: 10_000 })
    if (!codex.error && codex.status === 0 && /^codex(?:-cli)?\s+\d+\.\d+/i.test(codex.stdout?.trim() || '')) {
      env.BUDGET_TERMINAL_CODEX_PATH = codexPath
      log.log(`Agents runtime ready: ${codex.stdout.trim()}. Codex connects automatically at app startup; New chat keeps the connection. Autonomous mode starts off.`)
    } else {
      log.log('Codex could not run. The app will open; check your Codex installation before connecting from Agents.')
    }
  } else {
    log.log('Codex was not found. The app will open; Agents includes installation and sign-in instructions.')
  }

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

  log.log('Building the latest desktop-only Budget Terminal source. Remote browser access and pairing have been removed; all implemented pages still load at startup. Local Agents, MCP tools and backups remain available. The top-bar Ask Agent box opens a full dropdown chat on any page, sharing the existing conversation and connection, with live Thinking, Researching and Done activity badges. Agents chat supports native image generation, image editing and inline private image cards, plus pie charts and full-history interactive price charts with in-chat ranges, candle intervals, crosshair OHLC, zoom and pan. Restored chat charts preload at startup. Charts includes a toggleable 50-day simple moving average. Quant now includes a redesigned research workspace with larger, more readable fonts across tables, controls and diagnostics, plus scan overview cards, an interactive factor inspector and a pairs lab with spread charts. IPOs now includes pending filings with dates marked TBD and backup calendar sources.')
  log.log('Updating MCP bundles safely: unchanged files are left alone, changed files are replaced atomically, and temporary Windows file locks are retried. No MCP clients are forcibly stopped.')
  const build = npm(['run', 'build'])
  if (build.error || build.status !== 0) {
    log.error('Budget Terminal could not build. See the error above. If an MCP bundle remains locked, close Budget Terminal and disconnect its MCP connection in Codex or other MCP clients, then run this launcher again.')
    return 1
  }

  log.log('Verifying the built desktop interface and its assets...')
  try {
    verifyBuild()
  } catch (error) {
    log.error(error.message)
    return 1
  }

  log.log('Opening Budget Terminal in Electron. Keep this terminal open while using the app.')
  const app = npm(['run', 'preview', '--workspace', 'budget-terminal-desktop'])
  if (app.error || app.status !== 0) {
    log.error('Budget Terminal stopped with an error. See the output above.')
    return app.status || 1
  }
  return 0
}

if (require.main === module) process.exitCode = launch()

module.exports = { launch, platformName }
