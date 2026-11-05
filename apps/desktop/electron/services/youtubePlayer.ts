import { BrowserWindow, screen, WebContentsView, type Session } from 'electron'
import { z } from 'zod'
import { CHANNELS, type Envelope } from '../shared/contract.js'
import { failed, ok } from '../shared/envelope.js'
import { isYouTubeEmbedUrl, youtubeEmbedUrl, YOUTUBE_PLAYER_IDENTITY, type YouTubePlayerViewport } from '../shared/youtubePlayer.js'

const HEADER_HEIGHT = 32
const players = new WeakMap<BrowserWindow, Player>()
const pipWindows = new WeakSet<BrowserWindow>()
const identifiedContents = new Set<number>()
const playerContents = new Set<number>()
const configuredSessions = new WeakSet<Session>()
const colorSchema = z.string().regex(/^#[a-fA-F0-9]{6}$/)
const viewportSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().max(1000),
  floating: z.boolean(), visible: z.boolean(),
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().min(0).max(20000), height: z.number().finite().min(0).max(20000),
  colors: z.object({ bg: colorSchema, raised: colorSchema, hover: colorSchema, text: colorSchema, accent: colorSchema }).strict(),
}).strict().nullable()

interface Player {
  update: (viewport: YouTubePlayerViewport | null) => void
}

const htmlUrl = (html: string) => 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)

function identify(contents: Electron.WebContents) {
  identifiedContents.add(contents.id)
  contents.once('destroyed', () => { identifiedContents.delete(contents.id); playerContents.delete(contents.id) })
  const profile = contents.session
  if (configuredSessions.has(profile)) return
  configuredSessions.add(profile)
  profile.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    if (details.webContentsId !== undefined && identifiedContents.has(details.webContentsId) && details.resourceType === 'subFrame' && isYouTubeEmbedUrl(details.url)) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'referer') delete headers[key]
      }
      // Send only the public app identity, including from the detached player.
      headers.Referer = YOUTUBE_PLAYER_IDENTITY
    }
    callback({ requestHeaders: headers })
  })
}

export const isYouTubePlayerContents = (id: number) => playerContents.has(id)
export const isYouTubePipWindow = (window: BrowserWindow) => pipWindows.has(window)

export function configureYouTubePlayer(window: BrowserWindow): void {
  if (players.has(window)) return
  identify(window.webContents)
  let view: WebContentsView | null = null
  let host: BrowserWindow | null = null
  let pip: BrowserWindow | null = null
  let viewport: YouTubePlayerViewport | null = null
  let videoId = ''
  let pipBounds: Electron.Rectangle | undefined

  const detach = () => {
    if (view && host && !host.isDestroyed()) host.contentView.removeChildView(view)
    host = null
  }
  const closePip = () => {
    const previous = pip
    pip = null
    if (previous && !previous.isDestroyed()) {
      pipBounds = previous.getBounds()
      if (host === previous) detach()
      previous.destroy()
    }
  }
  const stop = () => {
    detach()
    closePip()
    if (view && !view.webContents.isDestroyed()) view.webContents.close()
    view = null
    videoId = ''
    viewport = null
  }
  const sendAction = (action: 'return' | 'close', id = videoId) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(CHANNELS.youtubePlayerAction, { action, videoId: id })
  }
  const layout = () => {
    if (!view || !viewport || !host || host.isDestroyed()) return
    if (host === pip) {
      const [width, height] = host.getContentSize()
      view.setBounds({ x: 0, y: HEADER_HEIGHT, width, height: Math.max(0, height - HEADER_HEIGHT) })
    } else {
      const zoom = window.webContents.getZoomFactor()
      const [width, height] = window.getContentSize()
      const x = Math.max(0, Math.min(width, Math.round(viewport.x * zoom)))
      const y = Math.max(0, Math.min(height, Math.round(viewport.y * zoom)))
      view.setBounds({ x, y, width: Math.max(0, Math.min(width - x, Math.round(viewport.width * zoom))), height: Math.max(0, Math.min(height - y, Math.round(viewport.height * zoom))) })
    }
    view.setVisible(viewport.visible && (host === pip || (viewport.width > 0 && viewport.height > 0)))
  }
  const createPip = () => {
    const area = screen.getDisplayMatching(window.getBounds()).workArea
    const width = Math.min(480, area.width)
    const height = Math.min(302, area.height)
    const bounds = pipBounds ?? { x: area.x + area.width - width - 24, y: area.y + area.height - height - 24, width, height }
    const popup = new BrowserWindow({
      ...bounds, minWidth: 260, minHeight: 180, show: false, frame: false,
      title: 'YouTube picture in picture', backgroundColor: viewport!.colors.bg,
      alwaysOnTop: true, skipTaskbar: true, resizable: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    pip = popup
    pipWindows.add(popup)
    popup.setMenu(null)
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    popup.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      if (url === 'budget-youtube://return') {
        popup.hide()
        view?.setVisible(false)
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
        sendAction('return')
      } else if (url === 'budget-youtube://close') popup.close()
    })
    popup.on('resize', layout)
    popup.on('closed', () => {
      if (pip !== popup) return
      pip = null
      const id = videoId
      stop()
      sendAction('close', id)
    })
    // This chrome has no script or preload, and cannot access the terminal API.
    const colors = viewport!.colors
    void popup.loadURL(htmlUrl(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
      :root{--color-bg:${colors.bg};--color-surface-raised:${colors.raised};--color-surface-hover:${colors.hover};--color-text:${colors.text};--color-accent:${colors.accent}}
      *{box-sizing:border-box}body{margin:0;background:var(--color-bg);color:var(--color-text);font:12px system-ui}header{height:32px;display:flex;align-items:center;gap:6px;padding:0 6px 0 10px;background:var(--color-surface-raised);-webkit-app-region:drag;user-select:none}span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}a{-webkit-app-region:no-drag;color:inherit;text-decoration:none;padding:5px 8px;border-radius:3px}a:hover{background:var(--color-surface-hover)}a:focus-visible{outline:2px solid var(--color-accent)}
      </style><header><span title="Drag to move picture in picture">${escapeHtml(viewport?.title ?? 'YouTube')}</span><a href="budget-youtube://return" aria-label="Return to video" title="Return to video">Return</a><a href="budget-youtube://close" aria-label="Close video player" title="Close video player">&#215;</a></header>`)).then(() => {
      if (pip === popup && viewport?.visible) popup.showInactive()
    }).catch(() => {
      if (pip === popup) popup.close()
    })
    return popup
  }
  const update = (next: YouTubePlayerViewport | null) => {
    if (!next) { stop(); return }
    viewport = next
    if (!view) {
      view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
      identify(view.webContents)
      playerContents.add(view.webContents.id)
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      view.webContents.on('will-navigate', event => event.preventDefault())
      view.webContents.on('will-attach-webview', event => event.preventDefault())
    }
    if (videoId !== next.videoId) {
      videoId = next.videoId
      // The iframe and its WebContents survive transfers between native windows.
      void view.webContents.loadURL(htmlUrl(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.youtube-nocookie.com"><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}</style><iframe src="${youtubeEmbedUrl(videoId)}" title="YouTube video" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`)).catch(() => undefined)
      if (pip) { detach(); closePip() }
    }
    const target = next.floating ? (pip ?? createPip()) : window
    if (host !== target) {
      detach()
      target.contentView.addChildView(view)
      host = target
    }
    if (!next.floating) closePip()
    layout()
    if (pip) {
      if (next.visible && !pip.webContents.isLoading()) pip.showInactive()
      else if (!next.visible) pip.hide()
    }
  }
  players.set(window, { update })
  window.on('resize', layout)
  // Reloading or closing the owning terminal must not leave orphaned audio/windows.
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) stop()
  })
  window.once('closed', () => {
    stop()
    players.delete(window)
  })
}

export function setYouTubePlayerViewport(window: BrowserWindow, input: unknown): Envelope<boolean> {
  const parsed = viewportSchema.safeParse(input)
  if (!parsed.success) return failed(false, 'Invalid YouTube player viewport', 'YouTube player')
  const player = players.get(window)
  if (!player || window.isDestroyed()) return failed(false, 'YouTube player window is unavailable', 'YouTube player')
  player.update(parsed.data)
  return ok(true, 'YouTube player')
}
