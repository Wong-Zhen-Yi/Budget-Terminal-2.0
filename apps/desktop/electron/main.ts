import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { acquireDataSession } from './services/dataSession.js'
import { isTrustedRendererUrl } from './shared/ipcSecurity.js'
import { isSafeExternalUrl } from './services/urls.js'

const dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged

let disposeIpc: (() => void) | null = null
let releaseDataSession: (() => void) | null = null
let closeCache: (() => void) | null = null
const rendererUrl = isDev && process.env.ELECTRON_RENDERER_URL
  ? process.env.ELECTRON_RENDERER_URL
  : pathToFileURL(join(dirname, '../renderer/index.html')).href

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: '#080b12',
    title: 'Budget Terminal',
    // Frameless: the tab strip is the title bar, with its own drag region and controls.
    frame: false,
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

app.whenReady().then(async () => {
  try {
    releaseDataSession = acquireDataSession()
    // Resolve paths and take ownership before a service opens its persistent cache.
    const { registerIpcHandlers } = await import('./ipc/handlers.js')
    const { cache } = await import('./services/cache.js')
    closeCache = () => cache.close()
    disposeIpc = registerIpcHandlers((event) => {
      const frame = event.senderFrame
      return Boolean(frame && frame === event.sender.mainFrame &&
        BrowserWindow.fromWebContents(event.sender) && isTrustedRendererUrl(frame.url, rendererUrl))
    })
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

app.on('will-quit', () => {
  disposeIpc?.()
  disposeIpc = null
  closeCache?.()
})

// Hold ownership until the process exits, including any final in-flight store writes.
process.once('exit', () => releaseDataSession?.())
