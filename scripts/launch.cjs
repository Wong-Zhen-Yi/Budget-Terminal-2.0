const { spawn: spawnProcess, spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { closeSync, mkdirSync, openSync } = require('node:fs')
const { once } = require('node:events')
// Ethereum Research workbench and current MCP sources rebuild through this shared path.
// Macro cycle compass shows nine states and release changes through the shared build path.
// Agents includes the Summarize macro quick prompt; rebuild current source through the shared launcher.
// Macro Focus, shared economic startup data and MCP screenshot schemas rebuild through the shared launcher.
// Heatmap historical replay speed follows the selected timeframe; rebuild desktop and MCP through the shared launcher.
// Anthropic funding, customer depth, compute ratios and capital visualisations rebuild through the shared launcher.
// Anthropic Focus research, source update checks and MCP tools rebuild through the shared launcher.
// Finnhub streaming-first refresh, visible-stock priorities and idle/session savings rebuild through the shared launcher.
// Shared snapshot validation, account quotas and typed cloud contracts rebuild here; backend policies deploy separately.
// Auth lifecycle passed live two-device acceptance; the shared launcher rebuilds current source.
// Auth workspace ownership, async credential storage and session controls rebuild on every launch.
// Auth restores saved sign-in before opening and remembers the device's Don't show again preference.
// GitHub sign-in requires the exact v2 callback registered in its OAuth App; see docs/convex-sync.md.
// Convex Auth v2 runs in the main process; launch always builds current desktop and MCP sources.
// Windows terminal command: btd restart saves, rebuilds and reopens the app.
// Telegram: natural screenshot requests use MCP and send photos without captions or follow-up text.
const path = require('node:path')
const { supportedNodeVersion, supportedNpmVersion, runtimeEnvironment, assertCertificateEnvironment } = require('./runtime.cjs')
const { engines, version } = require('../package.json')
const { findCodex } = require('./codex-runtime.cjs')
const { verifyDesktopBuild } = require('./verify-desktop-build.cjs')

const root = path.resolve(__dirname, '..')
const desktopRoot = path.join(root, 'apps', 'desktop')

function platformName(platform) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return null
}

// Use the app's semantic accents, with plain text for redirected logs and NO_COLOR.
function createLauncherOutput({ log = console, environment = process.env, terminal = Boolean(process.stdout.isTTY), now = Date.now } = {}) {
  const colour = terminal && !('NO_COLOR' in environment) && environment.TERM !== 'dumb'
  const palette = { accent: '47;111;208', muted: '125;142;166', up: '38;194;129', down: '240;85;78', warn: '214;178;94' }
  const paint = (role, text) => colour ? `\x1b[38;2;${palette[role]}m${text}\x1b[0m` : text
  const started = now()
  let stageStarted = started
  const elapsed = start => `${Math.max(0, (now() - start) / 1000).toFixed(1)}s`
  const rule = paint('muted', '  ' + '-'.repeat(58))
  return {
    header(mode, os) {
      log.log('')
      log.log(paint('accent', '  BUDGET TERMINAL') + paint('muted', `  /  ${version}`))
      log.log(paint('muted', `  ${mode}  |  ${os}`))
      log.log(rule)
    },
    stage(number, title) {
      stageStarted = now()
      log.log('')
      log.log(paint('accent', `  [${number}/5]`) + ` ${title}`)
    },
    note(message) { log.log(paint('muted', `        ${message}`)) },
    warn(message) { log.log(paint('warn', `  [NOTE] ${message}`)) },
    done(message) { log.log(paint('up', '  [ OK ]') + ` ${message}` + paint('muted', `  (${elapsed(stageStarted)})`)) },
    ready(message) {
      log.log('')
      log.log(rule)
      log.log(paint('up', `  ${message}`) + paint('muted', `  |  ${elapsed(started)}`))
    },
    error(message) {
      log.error('')
      log.error(paint('down', '  [FAIL]') + ` ${message}`)
      log.error(paint('muted', '         Fix the error above, then run the launcher again.'))
    },
  }
}

async function startDetachedDesktop(env, output) {
  // Resolve Electron only after installation and build verification have passed.
  const executable = require('electron')
  const logDirectory = path.join(env.LOCALAPPDATA, 'BudgetTerminal', 'launcher-logs')
  mkdirSync(logDirectory, { recursive: true })
  const session = randomUUID()
  const stdout = openSync(path.join(logDirectory, `${session}.log`), 'wx')
  try {
    const stderr = openSync(path.join(logDirectory, `${session}.error.log`), 'wx')
    try {
      // Windows must allow Electron to show its first window.
      const app = spawnProcess(executable, ['.'], {
        cwd: desktopRoot, env, detached: true, stdio: ['ignore', stdout, stderr],
      })
      await once(app, 'spawn')
      app.unref()
    } finally {
      closeSync(stderr)
    }
  } finally {
    closeSync(stdout)
  }
  output.ready('BUDGET TERMINAL LAUNCHED')
  output.note('You can close this terminal.')
  output.note(`Desktop logs: ${logDirectory}`)
  return 0
}

// Every double-click launcher builds the current desktop, mobile and MCP bundles.
function launch({ development = false, demo = false, mobilePreview = false, mobile = false, logs = false, setupOnly = false, detach = false, platform = process.platform, nodeVersion = process.versions.node, environment = process.env, spawn = spawnSync, locateCodex = findCodex, verifyBuild = verifyDesktopBuild, openDetached = startDetachedDesktop, log = console } = {}) {
  const output = createLauncherOutput({ log, environment })
  const os = platformName(platform)
  const sampleData = demo || mobilePreview
  output.header(mobile ? 'Connected mobile window' : mobilePreview ? 'iPhone 17 preview' : demo ? 'Demo data' : setupOnly ? 'Setup check' : development ? 'Live development' : 'Desktop launcher', os || platform)
  output.stage(1, 'Check toolchain')
  if (!os) {
    output.error(`Budget Terminal supports Windows, macOS, and Linux; found ${platform}.`)
    return 1
  }
  if (!supportedNodeVersion(nodeVersion)) {
    output.error(`Unsupported Node.js ${nodeVersion}. Required: ${engines.node}. Latest Node.js 24 LTS is recommended.`)
    return 1
  }

  const env = runtimeEnvironment(environment)
  try { assertCertificateEnvironment(env) } catch (error) {
    output.error(error.message)
    return 1
  }
  if (logs) env.BUDGET_TERMINAL_OPEN_DIAGNOSTICS = '1'
  if (setupOnly && (development || logs || sampleData)) {
    output.error('Setup cannot be combined with launch options.')
    return 1
  }
  if (mobilePreview && development) {
    output.error('The iPhone 17 preview uses the built mobile interface. Run it without --dev.')
    return 1
  }
  if (mobile && (platform !== 'win32' || development || sampleData || setupOnly || logs)) {
    output.error('Open the connected mobile window on Windows with btd mobile.')
    return 1
  }

  // Codex is optional: preserve discovery and handoff without starting inference.
  const codexPath = sampleData ? null : locateCodex({ platform, environment: env })
  if (codexPath) {
    const codex = spawn(codexPath, ['--version'], { cwd: root, env, windowsHide: true, stdio: 'pipe', encoding: 'utf8', timeout: 10_000 })
    if (!codex.error && codex.status === 0 && /^codex(?:-cli)?\s+\d+\.\d+/i.test(codex.stdout?.trim() || '')) {
      env.BUDGET_TERMINAL_CODEX_PATH = codexPath
      output.note(`Agents: ${codex.stdout.trim()}. Autonomous mode starts off.`)
    } else {
      output.warn('Codex could not run; the app will open. Check Agents for setup help.')
    }
  } else if (!sampleData) {
    output.note('Agents: optional Codex runtime not found; setup help is in the app.')
  }

  const npm = (args, capture = false, childEnv = env) => {
    const command = platform === 'win32' ? env.ComSpec || 'cmd.exe' : 'npm'
    const commandArgs = platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args
    return spawn(command, commandArgs, { cwd: root, env: childEnv, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' })
  }
  const installed = npm(['--version'], true)
  if (installed.error || installed.status !== 0) {
    output.error('npm is required. Install the latest Node.js 24 LTS with npm, then relaunch Budget Terminal.')
    return 1
  }
  const npmVersion = installed.stdout?.trim()
  if (!supportedNpmVersion(npmVersion)) {
    output.error(`Unsupported npm ${npmVersion || '(unknown)'}. Required: ${engines.npm}. npm 11 is recommended.`)
    return 1
  }
  output.done(`Node.js ${nodeVersion}  /  npm ${npmVersion}`)

  output.stage(2, 'Check and install dependencies')
  output.note('First launch may take a few minutes. Installation output follows.')
  const install = npm(['install', '--no-audit', '--no-fund', '--strict-ssl=true'])
  if (install.error || install.status !== 0) {
    output.error('Dependency installation failed. See the npm error above.')
    return 1
  }
  output.done('Dependencies ready')

  output.stage(3, 'Verify Electron runtime')
  const electron = npm(['run', 'ensure:electron'])
  if (electron.error || electron.status !== 0) {
    output.error('Electron runtime could not start. See the error above.')
    return 1
  }
  output.done('Electron ready')

  output.stage(4, development ? 'Build local MCP tools' : 'Build desktop app')
  const build = npm(['run', development ? 'build:mcp' : 'build'])
  if (build.error || build.status !== 0) {
    output.error(development ? 'MCP tools could not build. See the error above.' : 'Budget Terminal could not build. See the error above. If an MCP bundle remains locked, close Budget Terminal and disconnect its MCP connection in Codex or other MCP clients, then run this launcher again.')
    return 1
  }
  if (!development) {
    output.note('Verifying desktop and mobile files and assets...')
    try { verifyBuild() } catch (error) {
      output.error(error.message)
      return 1
    }
  }
  output.done(development ? 'MCP tools built' : 'Desktop build verified')

  if (setupOnly) {
    output.stage(5, 'Finish setup check')
    output.ready('SETUP COMPLETE')
    output.note('All checks passed. Run the launcher to open the desktop app.')
    log.log('')
    return 0
  }
  output.stage(5, mobile ? 'Open connected mobile window' : mobilePreview ? 'Open iPhone 17 preview' : development ? 'Open live development' : 'Open desktop app')
  output.ready('LAUNCH CHECKS PASSED')
  if (mobile) env.BUDGET_TERMINAL_OPEN_MOBILE = '1'
  if (detach && platform === 'win32' && !development && !sampleData) {
    return openDetached(env, output).catch(error => {
      output.error(`Budget Terminal could not start: ${error.message}`)
      return 1
    })
  }
  output.note('Keep this terminal open while using Budget Terminal.')
  output.note(mobilePreview ? 'F5 reloads the mobile UI. Relaunch after editing the source.'
    : development ? 'Live edits rebuild automatically. Close any existing app window first.' : 'F5 reloads the current page. Startup details are in Settings.')
  log.log('')
  let session
  let app
  try {
    if (sampleData) {
      session = require('./demo-session.cjs').createDemoSession(env)
      if (mobilePreview) session.env.BUDGET_TERMINAL_MOBILE_PREVIEW = '1'
      output.note('Demo edits are temporary. Each launch starts with the repository sample data.')
    }
    app = npm(['run', development ? 'dev' : 'preview', '--workspace', 'budget-terminal-desktop'], false, session?.env)
  } catch (error) {
    output.error(error.message)
    return 1
  } finally {
    try { session?.close() } catch { output.warn('The temporary demo profile could not be removed after exit.') }
  }
  if (app.error || app.status !== 0) {
    output.error('Budget Terminal stopped with an error. See the output above.')
    return app.status || 1
  }
  output.done('Session ended')
  return 0
}

if (require.main === module) {
  if (process.argv[2] === 'update') {
    if (process.argv.length === 3) void require('./update.cjs').runUpdate()
    else {
      console.error('Run the update command without launch options.')
      process.exitCode = 1
    }
  } else {
    const flags = new Set(process.argv.slice(2))
    Promise.resolve(launch({ development: flags.has('--dev'), demo: flags.has('--demo'), mobilePreview: flags.has('--mobile-preview'), mobile: flags.has('--mobile'), logs: flags.has('--logs'), setupOnly: flags.has('--setup'), detach: flags.has('--detach') }))
      .then(status => { process.exitCode = status })
  }
}

module.exports = { launch, platformName, createLauncherOutput }
