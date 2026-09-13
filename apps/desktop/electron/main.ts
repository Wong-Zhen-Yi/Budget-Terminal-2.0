import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerIpcHandlers } from './ipc/handlers.js'
import { cache } from './services/cache.js'

const dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged

let disposeIpc: (() => void) | null = null

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
      preload: join(dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Paint once, rather than showing an empty frame and then the UI.
  window.once('ready-to-show', () => window.show())

  // Nothing in this app should ever navigate the shell or spawn a window; news links
  // go to the system browser through the explicit IPC channel instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(dirname, '../renderer/index.html'))
  }
  return window
}

app.whenReady().then(() => {
  disposeIpc = registerIpcHandlers()
  createWindow()

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
  cache.close()
})
