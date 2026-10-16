import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { acquireDataSession } from './services/dataSession.js'
import { isTrustedRendererUrl } from './shared/ipcSecurity.js'
import { isSafeExternalUrl } from './services/urls.js'

const dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged

if (process.platform === 'darwin') app.setName('Budget Terminal')
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()

let disposeIpc: (() => void) | null = null
let releaseDataSession: (() => void) | null = null
let closeCache: (() => void) | null = null
let closeYahooWorker: (() => void) | null = null
let closeDefeatBetaDecoder: (() => void) | null = null
let backupPending: (() => boolean) | null = null
let flushBackup: (() => Promise<void>) | null = null
let stopMcp: (() => Promise<void>) | null = null
let stopWeb: (() => Promise<void>) | null = null
const rendererUrl = isDev && process.env.ELECTRON_RENDERER_URL
  ? process.env.ELECTRON_RENDERER_URL
  : pathToFileURL(join(dirname, '../renderer/index.html')).href

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: '#080b12',
    title: 'Budget Terminal',
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

  // Paint once, rather than showing an empty frame and then the UI.
  window.once('ready-to-show', () => window.show())

  // Nothing in this app should ever navigate the shell or spawn a window; news links
  // go to the system browser through the explicit IPC channel instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write' && isTrustedRendererUrl(contents.getURL(), rendererUrl)))
  window.webContents.session.setPermissionCheckHandler((contents, permission) =>
    permission === 'clipboard-sanitized-write' && Boolean(contents && isTrustedRendererUrl(contents.getURL(), rendererUrl)))

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(dirname, '../renderer/index.html'))
  }
  return window
}

if (ownsInstance) {
  app.on('second-instance', () => {
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
  try {
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
    releaseDataSession = acquireDataSession(app.getAppPath())
    const backup = await import('./services/automaticBackup.js')
    backup.configureAutomaticBackup(app.getPath('downloads'))
    backupPending = backup.automaticBackupPending
    flushBackup = backup.flushAutomaticBackup
    // Create a baseline only when absent; keep the last backup if local data has gone missing.
    await backup.initializeAutomaticBackup().catch((error) => console.warn('Automatic backup failed:', error))
    // Resolve paths and take ownership before a service opens its persistent cache.
    const { registerIpcHandlers } = await import('./ipc/handlers.js')
    const { cache } = await import('./services/cache.js')
    closeYahooWorker = (await import('./services/yahoo/client.js')).closeYahooWorker
    closeDefeatBetaDecoder = (await import('./services/defeatbeta/decoder.js')).closeDefeatBetaDecoder
    closeCache = () => cache.close()
    const web = await import('./web/host.js')
    await web.initializeWebAccess(join(dirname, '../renderer'), join(process.env.APPDATA!, 'BudgetTerminalElectron'))
    stopWeb = web.stopWebAccess
    disposeIpc = registerIpcHandlers((event) => {
      const frame = event.senderFrame
      return Boolean(frame && frame === event.sender.mainFrame &&
        BrowserWindow.fromWebContents(event.sender) && isTrustedRendererUrl(frame.url, rendererUrl))
    })
    const { startMcpHost } = await import('./mcp/host.js')
    stopMcp = await startMcpHost()
    createWindow()
  } catch (error) {
    dialog.showErrorBox('Budget Terminal could not start', error instanceof Error ? error.message : String(error))
    app.quit()
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let finishingQuit = false
let drainedQuit = false
app.on('before-quit', (event) => {
  if (drainedQuit || (!stopMcp && !stopWeb && !backupPending?.())) return
  event.preventDefault()
  if (finishingQuit) return
  finishingQuit = true
  void (async () => {
    await Promise.all([stopMcp?.(), stopWeb?.()])
    await flushBackup?.()
  })().catch((error) => console.warn('Shutdown flush failed:', error)).finally(() => {
    drainedQuit = true
    app.quit()
  })
})

app.on('will-quit', () => {
  disposeIpc?.()
  disposeIpc = null
  closeCache?.()
  closeYahooWorker?.()
  closeDefeatBetaDecoder?.()
})

// Hold ownership until the process exits, including any final in-flight store writes.
process.once('exit', () => releaseDataSession?.())
