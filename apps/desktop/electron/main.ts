import { app, BrowserWindow, dialog, Menu, screen, shell } from 'electron'
import { createMemoryScaleReader, MEMORY_SAMPLE_MS, SERVICE_MEMORY_BUDGET } from './shared/memoryPolicy.js'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { acquireDataSession } from './services/dataSession.js'
import { loadRenderer } from './services/rendererStartup.js'
import { isTrustedRendererUrl } from './shared/ipcSecurity.js'
import { isSafeExternalUrl } from './services/urls.js'
import { configureBrowserWindow } from './services/browser.js'
import { assertPrivateBrowserStorage } from './services/browserStorage.js'
import { configureYouTubePlayer, isYouTubePlayerContents } from './services/youtubePlayer.js'
import { isYouTubeEmbedUrl } from './shared/youtubePlayer.js'
import { desktopWindowBounds, restoreWindowBounds, useGamingFullscreen } from './shared/windowSize.js'
import { readWindowState, trackWindowState } from './services/windowState.js'
import { chartWindowHash, normalizeChartSymbol } from './shared/chartWindow.js'
import { configureRendererCacheShutdown } from './services/rendererCacheShutdown.js'
import { assertDesktopCertificateSecurity } from './shared/certificateSecurity.js'
import { startDiagnostics, observeDiagnosticWindow } from './services/diagnosticHost.js'
import { diagnosticLog, faultCode } from './services/diagnosticLog.js'
import { startMobileAccess, startLocalMobileAccess, stopMobileAccess } from './services/mobileHost.js'
import { openMobileWindow } from './services/mobileWindow.js'
import { DEFAULT_MOBILE_VIEWPORT, type MobileViewportId } from './shared/mobileAccess.js'

// Windows can retain shader-cache file locks across launches. Keep GPU rendering
// enabled, but avoid Chromium's optional disk caches before it starts the GPU.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
  // Graphite opens its persistent cache independently of the shader-cache switch.
  const disabledFeatures = app.commandLine.getSwitchValue('disable-features').split(',').filter(Boolean)
  app.commandLine.appendSwitch('disable-features', [...new Set([
    ...disabledFeatures, 'GpuPersistentCache', 'SkiaGraphiteUsePersistentCache',
  ])].join(','))
}

const dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged
const demoDirectory = process.env.BUDGET_TERMINAL_DEMO_DIR
const mobilePreview = Boolean(demoDirectory) && process.env.BUDGET_TERMINAL_MOBILE_PREVIEW === '1'
const windowTitle = demoDirectory ? 'Budget Terminal Demo' : 'Budget Terminal'
if (process.platform === 'darwin') app.setName('Budget Terminal')
if (demoDirectory) {
  const roaming = join(demoDirectory, 'roaming')
  if (process.env.APPDATA !== roaming || process.env.LOCALAPPDATA !== join(demoDirectory, 'local') ||
      process.env.BUDGET_TERMINAL_DATA_DIR !== join(roaming, 'BudgetTerminalElectron') ||
      process.env.CODEX_HOME !== join(demoDirectory, 'codex')) {
    throw new Error('Demo profile is incomplete. Start it from the Budget Terminal demo launcher.')
  }
  assertPrivateBrowserStorage(demoDirectory, app.getAppPath())
  // A demo export must default to the test folder, including during automatic backups.
  app.setPath('downloads', join(demoDirectory, 'downloads'))
}
startDiagnostics()
// Isolate Electron's instance lock and browser profile with explicit data overrides.
if (process.env.BUDGET_TERMINAL_DATA_DIR) {
  const profile = join(process.env.BUDGET_TERMINAL_DATA_DIR, 'electron-profile')
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
}
const localMobileAvailable = process.platform === 'win32' && !demoDirectory
let openMobileOnStartup = localMobileAvailable && process.env.BUDGET_TERMINAL_OPEN_MOBILE === '1'
const ownsInstance = app.requestSingleInstanceLock({ openDiagnostics: process.env.BUDGET_TERMINAL_OPEN_DIAGNOSTICS === '1', openMobile: openMobileOnStartup })
if (!ownsInstance) app.quit()

let disposeIpc: (() => void) | null = null
let mainWindow: BrowserWindow | null = null
let mainWindowReady = false
let mobileWindow: { window: BrowserWindow; viewport: MobileViewportId } | null = null
let openingMobile = Promise.resolve()
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
let closeCloudSync: (() => Promise<void>) | null = null
const rendererUrl = isDev && process.env.ELECTRON_RENDERER_URL
  ? process.env.ELECTRON_RENDERER_URL
  : pathToFileURL(join(dirname, '../renderer/index.html')).href

/** Longest the main window waits, after its first paint, for the opening page to render. */
const FIRST_RENDER_FALLBACK_MS = 12_000

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  // Gaming sessions are always fullscreen; elsewhere reopen where the window was left.
  const gaming = useGamingFullscreen(process.platform, process.env)
  const saved = gaming ? undefined : readWindowState()
  const size = restoreWindowBounds(screen.getAllDisplays().map(display => display.workArea), screen.getPrimaryDisplay().workArea, saved)
  const window = new BrowserWindow({
    ...size,
    show: false,
    backgroundColor: '#080b12',
    title: windowTitle,
    icon: join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'budget-terminal-icon.ico' : 'budget-terminal-icon.png'),
    // macOS owns the traffic lights and native fullscreen; other platforms keep the
    // existing custom title bar and window controls.
    frame: isMac,
    fullscreenable: true,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  if (demoDirectory) window.on('page-title-updated', event => event.preventDefault())
  mainWindow = window
  if (!gaming) trackWindowState(window)
  window.once('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
      mainWindowReady = false
    }
    const child = mobileWindow?.window
    if (child && !child.isDestroyed()) child.destroy()
    // Pop-out charts belong to this window's session.
    for (const chart of chartWindows) if (!chart.isDestroyed()) chart.destroy()
  })

  configureBrowserWindow(window)
  observeDiagnosticWindow(window, rendererUrl)
  configureYouTubePlayer(window)
  configureRendererCacheShutdown(window)

  // Show the window once the opening page has painted its content, rather than an
  // empty frame that fills in afterwards. The renderer reports that page; a bounded
  // fallback still opens the window if the interface never reports.
  let painted = false
  let pageRendered = false
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  const reveal = () => {
    clearTimeout(revealTimer)
    if (mainWindowReady || window.isDestroyed()) return
    if (gaming) window.setFullScreen(true)
    else if (saved?.maximized) window.maximize()
    mainWindowReady = true
    window.show()
    if (openMobileOnStartup) {
      openMobileOnStartup = false
      showConnectedMobile(window)
    }
  }
  window.webContents.ipc.handle('shell:first-render', (event) => {
    const frame = event.senderFrame
    if (!frame || frame !== window.webContents.mainFrame || !isTrustedRendererUrl(frame.url, rendererUrl)) return
    pageRendered = true
    if (painted) reveal()
  })
  window.once('ready-to-show', () => {
    painted = true
    if (pageRendered) reveal()
    else revealTimer = setTimeout(reveal, FIRST_RENDER_FALLBACK_MS)
  })
  window.once('closed', () => clearTimeout(revealTimer))

  // Docking, rotating or changing desktop scaling must not strand the window.
  // Let the compositor own maximized/fullscreen bounds, especially in Gamescope.
  const fitDisplay = () => {
    if (window.isDestroyed()) return
    const display = screen.getDisplayMatching(window.getBounds())
    const fitted = desktopWindowBounds(display.workArea, window.getNormalBounds())
    window.setMinimumSize(fitted.minWidth, fitted.minHeight)
    if (!window.isMaximized() && !window.isFullScreen()) {
      window.setBounds({ x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height })
    }
  }
  screen.on('display-metrics-changed', fitDisplay)
  screen.on('display-removed', fitDisplay)
  window.on('unmaximize', fitDisplay)
  window.on('leave-full-screen', fitDisplay)
  window.once('closed', () => {
    screen.removeListener('display-metrics-changed', fitDisplay)
    screen.removeListener('display-removed', fitDisplay)
  })

  // Nothing in this app should ever navigate the shell or spawn a window; news links
  // go to the system browser through the explicit IPC channel instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback((permission === 'clipboard-sanitized-write' && isTrustedRendererUrl(contents.getURL(), rendererUrl)) || (
      permission === 'fullscreen' && isYouTubeEmbedUrl(details.requestingUrl) &&
      (isTrustedRendererUrl(contents.getURL(), rendererUrl) || isYouTubePlayerContents(contents.id))
    )))
  window.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    Boolean(contents && ((permission === 'clipboard-sanitized-write' && isTrustedRendererUrl(contents.getURL(), rendererUrl)) || (
      permission === 'fullscreen' && isYouTubeEmbedUrl(details.requestingUrl ?? '') &&
      (isTrustedRendererUrl(contents.getURL(), rendererUrl) || isYouTubePlayerContents(contents.id))
    ))))

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

const chartWindows = new Set<BrowserWindow>()
const MAX_CHART_WINDOWS = 8

/**
 * A pop-out chart: the same trusted shell document opened with `#chart=<symbol>`, so it
 * passes the IPC sender check (which ignores the hash) and renders only the chart workspace.
 */
async function openChartWindow(parent: BrowserWindow, request: unknown): Promise<void> {
  const symbol = normalizeChartSymbol(request)
  if (!symbol) throw new Error('Choose a valid ticker to chart.')
  if (chartWindows.size >= MAX_CHART_WINDOWS) throw new Error(`Close a chart window first (limit ${MAX_CHART_WINDOWS}).`)
  const area = screen.getDisplayMatching(parent.getBounds()).workArea
  const width = Math.min(1180, area.width)
  const height = Math.min(760, area.height)
  // Cascade new windows so several pop-outs never stack exactly on top of each other.
  const offset = (chartWindows.size % 6) * 28
  const window = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(640, area.width),
    minHeight: Math.min(420, area.height),
    x: area.x + Math.max(0, Math.min(Math.floor((area.width - width) / 2) + offset, area.width - width)),
    y: area.y + Math.max(0, Math.min(Math.floor((area.height - height) / 2) + offset, area.height - height)),
    show: false,
    backgroundColor: '#080b12',
    title: `${symbol} · Budget Terminal Chart`,
    icon: join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'budget-terminal-icon.ico' : 'budget-terminal-icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.removeMenu()
  chartWindows.add(window)
  window.once('closed', () => chartWindows.delete(window))
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  try {
    await loadRenderer(window, join(dirname, '../renderer/index.html'),
      isDev ? process.env.ELECTRON_RENDERER_URL : undefined, { hash: chartWindowHash(symbol) })
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
}

function showConnectedMobile(parent: BrowserWindow) {
  void launchConnectedMobile(parent, DEFAULT_MOBILE_VIEWPORT).catch(() => {
    if (!parent.isDestroyed() && !finishingQuit) {
      dialog.showErrorBox('Budget Terminal could not open the iPhone viewport', 'Run btd mobile to rebuild and reopen it. If the viewport still does not open, check Application logs in Settings.')
    }
  })
}

function launchConnectedMobile(parent: BrowserWindow, viewport: MobileViewportId) {
  const launch = openingMobile.then(async () => {
    if (!localMobileAvailable || parent !== mainWindow || parent.isDestroyed() || finishingQuit) {
      throw new Error('The connected mobile window requires the regular Windows desktop session.')
    }
    if (parent.isMinimized()) parent.restore()
    if (mobileWindow?.viewport === viewport) {
      const { window } = mobileWindow
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      return
    }
    mobileWindow?.window.destroy()
    try {
      const [{ createMobileRoutes }, { telegramProfile }] = await Promise.all([import('./services/mobileRoutes.js'), import('./services/agentsHost.js')])
      const connection = await startLocalMobileAccess(createMobileRoutes(telegramProfile))
      try {
        if (parent.isDestroyed() || finishingQuit) throw new Error('Budget Terminal is closing.')
        const window = await openMobileWindow(connection.origin, connection.token, viewport, parent)
        mobileWindow = { window, viewport }
        window.once('closed', () => {
          mobileWindow = null
          void connection.close()
        })
      } catch (error) {
        await connection.close()
        throw error
      }
    } catch (error) {
      if (!parent.isDestroyed() && !finishingQuit) {
        diagnosticLog.write('error', 'app', 'startup-failed', { stage: 'local-mobile', code: faultCode(error) })
      }
      throw new Error('Could not open the mobile window. Rebuild Budget Terminal and try again.')
    }
  })
  openingMobile = launch.catch(() => undefined)
  return launch
}

if (ownsInstance && !mobilePreview) {
  app.on('second-instance', (_event, _argv, _directory, additionalData) => {
    const request = additionalData as { openDiagnostics?: boolean; openMobile?: boolean } | undefined
    if (request?.openMobile === true && localMobileAvailable) {
      if (mainWindow && mainWindowReady) showConnectedMobile(mainWindow)
      else openMobileOnStartup = true
      return
    }
    if (request?.openDiagnostics) process.env.BUDGET_TERMINAL_OPEN_DIAGNOSTICS = '1'
    const window = mainWindow
    if (!window) {
      // macOS keeps the process alive after its window closes. Reuse that process;
      // on other platforms, restore hidden or minimized windows below.
      if (disposeIpc) createWindow()
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    if (request?.openDiagnostics) window.webContents.send('diagnostics:open')
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
    releaseDataSession = acquireDataSession(demoDirectory ? undefined : app.getAppPath())
    stage = 'notifications'
    const notifications = await import('./services/notificationsHost.js')
    if (!demoDirectory) notifications.configureDesktopNotifications()
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
    stage = 'cloud-sync'
    const sync = await import('./services/cloudSyncHost.js')
    closeCloudSync = sync.closeCloudSync
    await sync.startCloudSync()
    // Resolve paths and take ownership before a service opens its persistent cache.
    stage = 'services'
    const { registerIpcHandlers } = await import('./ipc/handlers.js')
    const { cache } = await import('./services/cache.js')
    closeYahooWorker = (await import('./services/yahoo/client.js')).closeYahooWorker
    closeDefeatBetaDecoder = (await import('./services/defeatbeta/decoder.js')).closeDefeatBetaDecoder
    const readMemoryScale = createMemoryScaleReader(() => process.getSystemMemoryInfo(), process.platform)
    const updateCacheBudget = () => {
      const scale = readMemoryScale()
      cache.configureMemoryLimits(SERVICE_MEMORY_BUDGET.bytes * scale, Math.floor(SERVICE_MEMORY_BUDGET.entries * scale))
    }
    updateCacheBudget()
    const cacheBudgetTimer = setInterval(updateCacheBudget, MEMORY_SAMPLE_MS)
    cacheBudgetTimer.unref()
    closeCache = () => {
      clearInterval(cacheBudgetTimer)
      return cache.close()
    }
    closeQuantWorker = (await import('./services/quantWorker.js')).closeQuantWorker
    stage = 'ipc-registration'
    disposeIpc = registerIpcHandlers((event) => {
      const frame = event.senderFrame
      return Boolean(frame && frame === event.sender.mainFrame &&
        BrowserWindow.fromWebContents(event.sender) && isTrustedRendererUrl(frame.url, rendererUrl))
    }, launchConnectedMobile, openChartWindow)
    if (mobilePreview) {
      stage = 'mobile-preview'
      const { createMobileRoutes } = await import('./services/mobileRoutes.js')
      const { origin, token } = await startLocalMobileAccess(createMobileRoutes(async () => ''))
      mainWindow = await openMobileWindow(origin, token)
      mainWindow.once('closed', () => { mainWindow = null })
      return
    }
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
    // Warm the routes so the Settings shortcut can open the viewport promptly.
    if (localMobileAvailable) void import('./services/mobileRoutes.js').catch(() => {})
    stage = 'window-create'
    createWindow()
    void startMobileAccess()
  } catch (error) {
    diagnosticLog.write('error', 'app', 'startup-failed', { stage, code: faultCode(error) })
    dialog.showErrorBox('Budget Terminal could not start', error instanceof Error ? error.message : String(error))
    app.quit()
    return
  }

  app.on('activate', () => {
    if (!mainWindow) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (mobilePreview || process.platform !== 'darwin') app.quit()
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
      await Promise.all([stopMcp?.(), flushAgents?.(), stopMobileAccess()])
      await flushNotifications?.()
      await closeCloudSync?.()
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
