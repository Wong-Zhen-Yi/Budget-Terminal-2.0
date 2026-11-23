import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { LOCAL_MOBILE_HEADER } from './mobileHttp.js'
import { isSafeExternalUrl } from './urls.js'

const viewport = { width: 402, height: 874 }
const deviceScaleFactor = 3

export async function openMobileWindow(origin: string, token: string, parent?: BrowserWindow) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  // Leave space for native window decorations on shorter displays.
  const scale = Math.min(1, (width - 32) / viewport.width, (height - 64) / viewport.height)
  const window = new BrowserWindow({
    width: Math.ceil(viewport.width * scale),
    height: Math.ceil(viewport.height * scale),
    useContentSize: true,
    parent,
    title: parent ? 'Budget Terminal Mobile' : 'Budget Terminal iPhone 17 Preview',
    icon: join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'budget-terminal-icon.ico' : 'budget-terminal-icon.png'),
    backgroundColor: '#080b12',
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: { partition: 'mobile-preview', contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.removeMenu()
  window.on('page-title-updated', event => event.preventDefault())

  const { webContents: contents } = window
  const { session } = contents
  session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'))
  session.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write')
  // Supply the credential only for this window's own navigation and same-origin requests.
  session.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    const requestHeaders = details.requestHeaders
    const trustedInitiator = details.initiatorOrigin === origin || (details.resourceType === 'mainFrame' && !details.initiatorOrigin)
    if (trustedInitiator && details.webContentsId === contents.id && new URL(details.url).origin === origin) {
      requestHeaders[LOCAL_MOBILE_HEADER] = token
    }
    callback({ requestHeaders })
  })
  window.once('closed', () => session.webRequest.onBeforeSendHeaders(null))
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', event => event.preventDefault())
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))) {
      event.preventDefault()
      contents.reload()
    }
  })
  try {
    // Start the renderer before sending emulation commands, then navigate with the metrics already set.
    await window.loadURL('about:blank')
    contents.debugger.attach()
    await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      ...viewport, screenWidth: viewport.width, screenHeight: viewport.height,
      mobile: true, scale, deviceScaleFactor,
    })
    await contents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await window.loadURL(origin)
    window.show()
    return window
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
}
