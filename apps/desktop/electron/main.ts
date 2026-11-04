import { app, BrowserWindow, dialog, Menu, screen, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { acquireDataSession } from './services/dataSession.js'
import { loadRenderer } from './services/rendererStartup.js'
import { isTrustedRendererUrl } from './shared/ipcSecurity.js'
import { isSafeExternalUrl } from './services/urls.js'
import { configureBrowserWindow } from './services/browser.js'
import { configureYouTubePlayer } from './services/youtubePlayer.js'
import { isYouTubeEmbedUrl } from './shared/youtubePlayer.js'
import { desktopWindowSize } from './shared/windowSize.js'
import { configureRendererCacheShutdown } from './services/rendererCacheShutdown.js'
import { assertDesktopCertificateSecurity } from './shared/certificateSecurity.js'
import { startDiagnostics, observeDiagnosticWindow } from './services/diagnosticHost.js'
import { diagnosticLog, faultCode } from './services/diagnosticLog.js'

startDiagnostics()

const dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged
let terminalBackend = process.argv.includes('--tui-backend')
// Windows GUI executables cannot reliably inherit stdin. Watch the owning Node
// process instead, including when its terminal is closed or crashes.
if (terminalBackend) {
  const parent = Number(process.argv.find(value => value.startsWith('--tui-parent='))?.split('=')[1])
  if (Number.isInteger(parent) && parent > 0) {
    const monitor = setInterval(() => {
      if (!terminalBackend) { clearInterval(monitor); return }
      try { process.kill(parent, 0) } catch { clearInterval(monitor); app.quit() }
    }, 1000)
    monitor.unref()
  }
}

if (process.platform === 'darwin') app.setName('Budget Terminal')
// Isolate Electron's instance lock and browser profile with explicit data overrides.
if (process.env.BUDGET_TERMINAL_DATA_DIR) {
  const profile = join(process.env.BUDGET_TERMINAL_DATA_DIR, 'electron-profile')
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
}
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()

let disposeIpc: (() => void) | null = null
let releaseDataSession: (() => void) | null = null
let closeCache: (() => Promise<void>) | null = null
let closeQuantWorker: (() => void) | null = null
let closeYahooWorker: (() => void) | null = null
let closeDefeatBetaDecoder: (() => void) | null = null
let backupPending: (() => boolean) | null = null
let flushBackup: (() => Promise<void>) | null = null
let stopMcp: (() => Promise<void>) | null = null
let flushAgents: (() => Promise<void>) | null = null
let flushNotifications: (() => Promise<void>) | null = null
const rendererUrl = isDev && process.env.ELECTRON_RENDERER_URL
  ? process.env.ELECTRON_RENDERER_URL
  : pathToFileURL(join(dirname, '../renderer/index.html')).href

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const size = desktopWindowSize(screen.getPrimaryDisplay().workAreaSize)
  const window = new BrowserWindow({
    ...size,
    show: false,
    backgroundColor: '#080b12',
    title: 'Budget Terminal',
    icon: join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'budget-terminal-icon.ico' : 'budget-terminal-icon.png'),
    // macOS owns the traffic lights and native fullscreen; other platforms keep the
    // existing custom title bar and window controls.
    frame: isMac,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, fullscreenable: true } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  configureBrowserWindow(window)
  observeDiagnosticWindow(window)
  configureYouTubePlayer(window)
  configureRendererCacheShutdown(window)

  // Paint once, rather than showing an empty frame and then the UI.
  window.once('ready-to-show', () => { if (!terminalBackend) window.show() })

  // Nothing in this app should ever navigate the shell or spawn a window; news links
  // go to the system browser through the explicit IPC channel instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(isTrustedRendererUrl(contents.getURL(), rendererUrl) && (
      permission === 'clipboard-sanitized-write' || (permission === 'fullscreen' && isYouTubeEmbedUrl(details.requestingUrl))
    )))
  window.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    Boolean(contents && isTrustedRendererUrl(contents.getURL(), rendererUrl)) && (
      permission === 'clipboard-sanitized-write' || (permission === 'fullscreen' && isYouTubeEmbedUrl(details.requestingUrl ?? ''))
    ))

  // Missing files during a rebuild get a bounded retry and an actionable error.
  void loadRenderer(window, join(dirname, '../renderer/index.html'),
    isDev ? process.env.ELECTRON_RENDERER_URL : undefined).catch((error) => {
    if (window.isDestroyed()) return
    diagnosticLog.write('error', 'app', 'startup-failed', { stage: 'renderer-load', code: faultCode(error) })
    console.error('Budget Terminal interface failed to load:', error)
    dialog.showErrorBox('Budget Terminal could not load its interface', error instanceof Error ? error.message : String(error))
    app.quit()
  })
  return window
}

if (ownsInstance) {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--tui-backend')) return
    terminalBackend = false
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) {
      // macOS keeps the process alive after its window closes. Reuse that process;
      // on other platforms, restore hidden or minimized windows below.
      if (disposeIpc) createWindow()
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
}

if (ownsInstance) app.whenReady().then(async () => {
  let stage = 'certificate-security'
  try {
    assertDesktopCertificateSecurity(process.versions.electron, process.env, name => app.commandLine.hasSwitch(name))
    stage = 'platform-ui'
    if (process.platform === 'darwin') {
      app.dock?.setIcon(join(app.getAppPath(), 'resources/budget-terminal-icon.png'))
    }
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [{ role: 'togglefullscreen', accelerator: 'Control+Command+F' }],
        },
        { role: 'windowMenu' },
      ]))
    }
    stage = 'data-session'
    releaseDataSession = acquireDataSession(app.getAppPath())
    stage = 'notifications'
    const notifications = await import('./services/notificationsHost.js')
    notifications.configureDesktopNotifications()
    flushNotifications = notifications.closeNotifications
    void notifications.notificationCenter.initialize().catch(error => {
      diagnosticLog.write('warn', 'app', 'startup-stage-failed', { stage: 'notifications', code: faultCode(error) })
      console.warn('Notifications startup failed:', error)
    })
    stage = 'automatic-backup'
    const backup = await import('./services/automaticBackup.js')
    backup.configureAutomaticBackup(app.getPath('downloads'))
    backupPending = backup.automaticBackupPending
    flushBackup = backup.flushAutomaticBackup
    // Create a baseline only when absent; keep the last backup if local data has gone missing.
    await backup.initializeAutomaticBackup().catch((error) => {
      diagnosticLog.write('warn', 'app', 'startup-stage-failed', { stage: 'automatic-backup', code: faultCode(error) })
      console.warn('Automatic backup failed:', error)
    })
    // Resolve paths and take ownership before a service opens its persistent cache.
    stage = 'services'
    const { registerIpcHandlers } = await import('./ipc/handlers.js')
    const { cache } = await import('./services/cache.js')
    closeYahooWorker = (await import('./services/yahoo/client.js')).closeYahooWorker
    closeDefeatBetaDecoder = (await import('./services/defeatbeta/decoder.js')).closeDefeatBetaDecoder
    closeCache = () => cache.close()
    closeQuantWorker = (await import('./services/quantWorker.js')).closeQuantWorker
    stage = 'ipc-registration'
    disposeIpc = registerIpcHandlers((event) => {
      const frame = event.senderFrame
      return Boolean(frame && frame === event.sender.mainFrame &&
        BrowserWindow.fromWebContents(event.sender) && isTrustedRendererUrl(frame.url, rendererUrl))
    })
    stage = 'mcp-host'
    const { startMcpHost } = await import('./mcp/host.js')
    stopMcp = await startMcpHost()
    stage = 'agents'
    const agents = await import('./services/agentsHost.js')
    const { startAgents } = agents
    flushAgents = agents.flushAgents
    // Connect the signed-in Codex runtime without delaying the window or starting inference.
    void startAgents().catch(error => {
      diagnosticLog.write('warn', 'app', 'startup-stage-failed', { stage: 'agents', code: faultCode(error) })
      console.warn('Codex startup connection failed:', error)
    })
    stage = 'window-create'
    createWindow()
  } catch (error) {
    diagnosticLog.write('error', 'app', 'startup-failed', { stage, code: faultCode(error) })
    if (!terminalBackend) dialog.showErrorBox('Budget Terminal could not start', error instanceof Error ? error.message : String(error))
    app.quit()
    return
  }

  app.on('activate', () => {
    terminalBackend = false
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let finishingQuit = false
let drainedQuit = false
app.on('before-quit', (event) => {
  diagnosticLog.write('info', 'app', 'shutdown-requested')
  if (drainedQuit || (!stopMcp && !flushAgents && !flushNotifications && !closeCache && !backupPending?.())) return
  event.preventDefault()
  if (finishingQuit) return
  finishingQuit = true
  void (async () => {
    try {
      await Promise.all([stopMcp?.(), flushAgents?.()])
      await flushNotifications?.()
      await flushBackup?.()
    } finally {
      await closeCache?.()
    }
  })().catch((error) => console.warn('Shutdown flush failed:', error)).finally(() => {
    drainedQuit = true
    app.quit()
  })
})

app.on('will-quit', () => {
  disposeIpc?.()
  disposeIpc = null
  void closeCache?.()
  closeQuantWorker?.()
  closeYahooWorker?.()
  closeDefeatBetaDecoder?.()
})

// Hold ownership until the process exits, including any final in-flight store writes.
process.once('exit', () => releaseDataSession?.())
