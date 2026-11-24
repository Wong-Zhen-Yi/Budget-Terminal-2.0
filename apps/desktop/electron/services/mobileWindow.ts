import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { LOCAL_MOBILE_HEADER } from './mobileHttp.js'
import { isSafeExternalUrl } from './urls.js'
import { DEFAULT_MOBILE_VIEWPORT, MOBILE_VIEWPORTS, type MobileViewportId } from '../shared/mobileAccess.js'

export async function openMobileWindow(origin: string, token: string, viewport: MobileViewportId = DEFAULT_MOBILE_VIEWPORT, parent?: BrowserWindow) {
  const { width: viewportWidth, height: viewportHeight, deviceScaleFactor } = MOBILE_VIEWPORTS[viewport]
  const area = (parent ? screen.getDisplayMatching(parent.getBounds()) : screen.getPrimaryDisplay()).workArea
  // Leave space for native window decorations on shorter displays.
  const scale = Math.min(1, (area.width - 32) / viewportWidth, (area.height - 64) / viewportHeight)
  const window = new BrowserWindow({
    width: Math.ceil(viewportWidth * scale),
    height: Math.ceil(viewportHeight * scale),
    useContentSize: true,
    parent,
    title: parent ? 'Budget Terminal Mobile' : 'Budget Terminal Mobile Preview',
    icon: join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'budget-terminal-icon.ico' : 'budget-terminal-icon.png'),
    backgroundColor: '#080b12',
    show: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: { partition: 'mobile-preview', contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const bounds = window.getBounds()
  window.setPosition(area.x + Math.floor((area.width - bounds.width) / 2), area.y + Math.floor((area.height - bounds.height) / 2))
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
      width: viewportWidth, height: viewportHeight, screenWidth: viewportWidth, screenHeight: viewportHeight,
      mobile: true, scale, deviceScaleFactor,
    })
    await contents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    // The preset is a starting size. Resizing changes the CSS viewport, so breakpoints
    // behave like a real phone instead of stretching a fixed device canvas.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let resizing = Promise.resolve()
    window.on('resize', () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizing = resizing.then(async () => {
          if (window.isDestroyed() || !contents.debugger.isAttached()) return
          const [width, height] = window.getContentSize().map(size => Math.max(1, Math.round(size / scale)))
          await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
            width, height, screenWidth: width, screenHeight: height, mobile: true, scale, deviceScaleFactor,
          })
        }).catch(() => { /* Closing the window can cancel an in-flight emulation update. */ })
      }, 50)
    })
    window.once('closed', () => clearTimeout(resizeTimer))
    await window.loadURL(origin)
    window.show()
    return window
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
}
