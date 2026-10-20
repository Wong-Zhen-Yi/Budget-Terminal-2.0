import { app, BrowserWindow, WebContentsView, nativeImage, session, type NativeImage, type Session, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Envelope } from '../shared/contract.js'
import { failed, ok } from '../shared/envelope.js'
import { browserRequestSchema } from '../shared/browser.js'
import { browserSearchUrl } from '../shared/browserSearch.js'
import { assertPrivateBrowserStorage } from './browserStorage.js'
import type { BrowserControl, BrowserPageContent, BrowserRequest, BrowserResult, BrowserState, BrowserViewport } from '../shared/browser.js'
import { publicNewsUrl, isPublicAddress } from './news/publicNetwork.js'
import { isIP } from 'node:net'

const SOURCE = 'Browser · Chromium'
const MAX_TABS = 8
const viewportSchema = z.object({ visible: z.boolean(), x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite() }).strict()
const accessSchema = z.object({ action: z.literal('agentAccess'), enabled: z.boolean() }).strict()
interface Tab { id: string; view: WebContentsView; error: string }
let owner: BrowserWindow | null = null
let profile: Session | null = null
let tabs: Tab[] = []
let activeTabId = ''
let agentEnabled = false
let activity = 'Ready for research'
let viewport: BrowserViewport = { visible: false, x: 0, y: 0, width: 0, height: 0 }
let initialized: Promise<void> | null = null
let queue: Promise<unknown> = Promise.resolve()
let generation = 0

export function browserUrl(value: string): string {
  const trimmed = value.trim()
  const url = publicNewsUrl(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if ((!hostname.includes('.') && !isIP(hostname.replace(/^\[|\]$/g, ''))) || /(^|\.)(localhost|local|internal|home|lan|test|invalid)$/.test(hostname)) {
    throw new Error('Browser only opens public HTTP(S) websites.')
  }
  return url.href
}

async function publicRequest(url: string) {
  const target = new URL(browserUrl(url))
  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) return
  const addresses = await profile!.resolveHost(hostname)
  if (!addresses.endpoints.length || addresses.endpoints.some(endpoint => !isPublicAddress(endpoint.address))) {
    throw new Error('Browser cannot access private network addresses.')
  }
}

function configureProfile() {
  if (profile) return profile
  // Validate before creating the persistent session; do not write login data to a checkout.
  assertPrivateBrowserStorage(app.getPath('sessionData'), app.getAppPath())
  const persistent = session.fromPartition('persist:budget-terminal-research', { cache: true })
  const storage = persistent.getStoragePath()
  if (!storage) throw new Error('Browser requires a private local profile directory.')
  assertPrivateBrowserStorage(storage, app.getAppPath())
  profile = persistent
  profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  profile.setPermissionCheckHandler(() => false)
  profile.setDevicePermissionHandler(() => false)
  profile.on('will-download', event => {
    event.preventDefault()
    activity = 'Download blocked. Open the source in your system browser to download files.'
  })
  // Check every resource and redirect, not only the URL typed into the address bar.
  profile.webRequest.onBeforeRequest((details, callback) => {
    if (details.url === 'about:blank') { callback({}); return }
    if (details.url.startsWith('data:') || details.url.startsWith('blob:')) {
      callback({ cancel: details.resourceType === 'mainFrame' || details.resourceType === 'subFrame' })
      return
    }
    let finished = false
    const finish = (cancel: boolean) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      callback({ cancel })
    }
    const timer = setTimeout(() => finish(true), 8000)
    void publicRequest(details.url).then(() => finish(false), () => finish(true))
  })
  return profile
}

export function configureBrowserWindow(window: BrowserWindow) {
  if (owner === window) return
  owner = window
  agentEnabled = true
  activity = 'Ready for research · agent access on'
  window.on('resize', layout)
  window.once('closed', () => {
    generation++
    agentEnabled = false
    for (const tab of tabs) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    tabs = []
    activeTabId = ''
    initialized = null
    viewport.visible = false
    owner = null
  })
}

function layout() {
  if (!owner || owner.isDestroyed()) return
  const bounds = owner.getContentBounds()
  const zoom = owner.webContents.getZoomFactor()
  const x = Math.max(0, Math.min(Math.round(viewport.x * zoom), bounds.width))
  const y = Math.max(0, Math.min(Math.round(viewport.y * zoom), bounds.height))
  const width = Math.max(0, Math.min(Math.round(viewport.width * zoom), bounds.width - x))
  const height = Math.max(0, Math.min(Math.round(viewport.height * zoom), bounds.height - y))
  for (const tab of tabs) {
    const visible = viewport.visible && tab.id === activeTabId && width > 0 && height > 0
    tab.view.setVisible(visible)
    if (visible) tab.view.setBounds({ x, y, width, height })
  }
}

export function setBrowserViewport(value: unknown) {
  viewport = viewportSchema.parse(value)
  layout()
}

function snapshot(): BrowserState {
  return {
    tabs: tabs.map(tab => {
      const contents = tab.view.webContents
      return { id: tab.id, title: contents.getURL() === 'about:blank' ? 'New tab' : contents.getTitle() || 'New tab', url: contents.getURL(), loading: contents.isLoading(),
        canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(), error: tab.error }
    }), activeTabId, agentEnabled, activity,
  }
}

function newTab(): Tab {
  if (!owner || owner.isDestroyed()) throw new Error('Browser requires an open Budget Terminal window.')
  if (tabs.length >= MAX_TABS) throw new Error(`Close a tab first. Browser supports up to ${MAX_TABS} tabs.`)
  const view = new WebContentsView({ webPreferences: { session: configureProfile(), nodeIntegration: false, contextIsolation: true,
    sandbox: true, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false, safeDialogs: true,
    disableDialogs: true, webviewTag: false } })
  view.setBackgroundColor('#101722')
  view.setVisible(false)
  owner.contentView.addChildView(view)
  const tab: Tab = { id: randomUUID(), view, error: '' }
  tabs.push(tab)
  activeTabId = tab.id
  const contents = view.webContents
  contents.setWindowOpenHandler(({ url }) => {
    // Convert normal target=_blank links into shared tabs, never privileged windows.
    try {
      const target = browserUrl(url)
      const created = newTab()
      void navigate(created, target).catch(error => { created.error = String(error) })
    } catch (error) { activity = String(error) }
    return { action: 'deny' }
  })
  const guard = (event: Electron.Event, url: string) => {
    try { browserUrl(url) } catch { event.preventDefault(); tab.error = 'Blocked non-public or unsupported navigation.' }
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.on('will-attach-webview', event => event.preventDefault())
  contents.on('did-start-loading', () => { tab.error = '' })
  contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3) tab.error = `Could not load this page: ${description} (${code}).`
  })
  contents.on('render-process-gone', (_event, details) => { tab.error = `Browser renderer stopped: ${details.reason}. Reload this tab.` })
  layout()
  return tab
}

async function captureWebsite(contents: WebContents): Promise<NativeImage> {
  const throttled = contents.getBackgroundThrottling()
  contents.setBackgroundThrottling(false)
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      } catch (error) {
        // A newly shown/resized native view may not yet have a compositor surface.
        if (attempt === 3 || contents.isDestroyed()) throw new Error(`Browser capture unavailable. Keep Browser visible and retry. ${String(error)}`)
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)))
      }
    }
    throw new Error('Browser capture unavailable.')
  } finally { if (!contents.isDestroyed()) contents.setBackgroundThrottling(throttled) }
}

/** Shell capturePage does not include native child views. Composite their pixels explicitly. */
export async function compositeBrowserScreenshot(window: BrowserWindow, shell: NativeImage): Promise<NativeImage> {
  if (window !== owner || !viewport.visible) return shell
  const tab = tabs.find(tab => tab.id === activeTabId)
  if (!tab || !tab.view.getVisible()) return shell
  const contents = tab.view.webContents
  if (!/^https?:/.test(contents.getURL())) return shell
  const website = await captureWebsite(contents)
  if (window !== owner || !viewport.visible || activeTabId !== tab.id || !tab.view.getVisible()) return shell
  if (website.isEmpty()) throw new Error('Browser screenshot was empty. Show the Browser page and retry.')
  const bounds = tab.view.getBounds()
  const size = shell.getSize()
  const sourceSize = website.getSize()
  const width = Math.min(sourceSize.width, bounds.width, size.width - bounds.x)
  const height = Math.min(sourceSize.height, bounds.height, size.height - bounds.y)
  if (width <= 0 || height <= 0) return shell
  const bitmap = shell.toBitmap({ scaleFactor: 1 })
  const source = website.toBitmap({ scaleFactor: 1 })
  for (let row = 0; row < height; row++) {
    const start = row * sourceSize.width * 4
    source.copy(bitmap, ((bounds.y + row) * size.width + bounds.x) * 4, start, start + width * 4)
  }
  return nativeImage.createFromBitmap(bitmap, { width: size.width, height: size.height, scaleFactor: 1 })
}

async function initialize() {
  initialized ??= (async () => {
    const tab = tabs[0] ?? newTab()
    if (!tab.view.webContents.getURL()) await tab.view.webContents.loadURL('about:blank')
  })().catch(error => { initialized = null; throw error })
  await initialized
}

export async function browserStatus(): Promise<Envelope<BrowserState>> {
  try { await initialize(); return ok(snapshot(), SOURCE) }
  catch (error) { return failed(snapshot(), String(error), SOURCE) }
}

async function navigate(tab: Tab, url: string) {
  tab.error = ''
  const contents = tab.view.webContents
  const timer = setTimeout(() => { tab.error = 'Page load timed out. Try Reload or a different source.'; contents.stop() }, 25_000)
  try { await contents.loadURL(browserUrl(url)) }
  finally { clearTimeout(timer) }
  if (tab.error) throw new Error(tab.error)
}

async function read(tab: Tab): Promise<BrowserPageContent> {
  const contents = tab.view.webContents
  if (contents.isLoadingMainFrame()) await new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); resolve() }
    const timer = setTimeout(() => {
      contents.removeListener('did-stop-loading', finish)
      reject(new Error('This page is still loading. Read it again after loading completes.'))
    }, 8000)
    contents.once('did-stop-loading', finish)
  })
  if (tab.error) throw new Error(tab.error)
  if (!/^https?:/.test(contents.getURL())) throw new Error('Open a public website before reading.')
  // Fixed, isolated-world extraction only. No caller-supplied JavaScript or selectors.
  const data = await contents.executeJavaScriptInIsolatedWorld(999, [{ code: `(() => {
    const text = (document.body?.innerText || '').slice(0, 60001)
    const links = [...document.querySelectorAll('a[href]')].filter(a => a.getClientRects().length && /^https?:/.test(a.href)).slice(0, 200).map(a => ({ text: (a.innerText || a.getAttribute('aria-label') || a.href).slice(0, 200), url: a.href.slice(0, 4096) }))
    return { url: location.href, title: document.title.slice(0, 500), text: text.slice(0, 60000), truncated: text.length > 60000, links }
  })()` }]) as Omit<BrowserPageContent, 'readAt'>
  return { ...data, readAt: Date.now() }
}

async function execute(request: BrowserRequest, agent: boolean, token: number): Promise<Envelope<BrowserResult>> {
  try {
    await initialize()
    if (agent && (!agentEnabled || token !== generation)) throw new Error('Agent browser access is off or this action was stopped. Ask the user to enable Agent access on Browser.')
    activity = `${agent ? 'Agent' : 'You'} · ${request.action}`
    let tab = tabs.find(tab => tab.id === ('tabId' in request ? request.tabId : undefined) || (!('tabId' in request && request.tabId) && tab.id === activeTabId))
    if (request.action === 'open') {
      // Validate before allocating a tab.
      if (request.url) browserUrl(request.url)
      tab = newTab()
      if (request.url) await navigate(tab, request.url)
      else await tab.view.webContents.loadURL('about:blank')
    } else {
      if (!tab) throw new Error('Browser tab not found. Read browser status for current tab IDs.')
      const contents = tab.view.webContents
      switch (request.action) {
        case 'navigate': await navigate(tab, request.url); break
        case 'search': await navigate(tab, browserSearchUrl(request.query)); break
        case 'select': activeTabId = tab.id; layout(); break
        case 'close': {
          if (agent && tabs.length === 1) throw new Error('Keep at least one shared tab open.')
          owner!.contentView.removeChildView(tab.view)
          contents.close()
          tabs = tabs.filter(item => item !== tab)
          if (activeTabId === tab.id) activeTabId = tabs.at(-1)?.id ?? ''
          if (!tabs.length) { const blank = newTab(); await blank.view.webContents.loadURL('about:blank') }
          layout()
          break
        }
        case 'back': if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); break
        case 'forward': if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward(); break
        case 'reload': contents.reload(); break
        case 'stop': contents.stop(); break
        case 'read': {
          const page = await read(tab)
          if (agent && (!agentEnabled || token !== generation)) throw new Error('Browser action was stopped.')
          return ok({ state: snapshot(), page }, SOURCE)
        }
        case 'follow': {
          const page = await read(tab)
          if (agent && (!agentEnabled || token !== generation)) throw new Error('Browser action was stopped.')
          if (!page.links.some(link => link.url === request.url)) throw new Error('Follow only links returned by a fresh read of this page.')
          await navigate(tab, request.url)
          break
        }
        case 'scroll': await contents.executeJavaScriptInIsolatedWorld(999, [{ code: `window.scrollBy(0, ${request.direction === 'down' ? '1' : '-1'} * innerHeight * 0.8)` }]); break
        case 'screenshot': {
          if (!viewport.visible || activeTabId !== tab.id) throw new Error('Show this tab on the Browser page before capturing it. Obscured or hidden browser pages cannot be captured.')
          const image = await captureWebsite(contents)
          if (!viewport.visible || activeTabId !== tab.id || (agent && (!agentEnabled || token !== generation))) throw new Error('Browser capture was hidden or stopped.')
          if (image.isEmpty()) throw new Error('Chromium returned an empty screenshot. Show the Browser page and retry.')
          return ok({ state: snapshot(), screenshot: { base64: image.resize({ width: Math.min(image.getSize().width, 1600) }).toPNG().toString('base64'), mimeType: 'image/png', url: contents.getURL() } }, SOURCE)
        }
      }
    }
    if (agent && (!agentEnabled || token !== generation)) throw new Error('Browser action was stopped.')
    return ok({ state: snapshot() }, SOURCE)
  } catch (error) { return failed({ state: snapshot() }, error instanceof Error ? error.message : String(error), SOURCE) }
}

export async function browserResearch(value: unknown): Promise<Envelope<BrowserResult>> {
  const parsed = browserRequestSchema.safeParse(value)
  if (!parsed.success) return failed({ state: snapshot() }, 'Invalid Browser request.', SOURCE)
  const token = generation
  const next = queue.then(() => execute(parsed.data, true, token))
  queue = next.catch(() => {})
  return next
}

export async function browserControl(value: BrowserControl): Promise<Envelope<BrowserResult>> {
  if (value?.action === 'agentAccess') {
    const parsed = accessSchema.parse(value)
    agentEnabled = parsed.enabled
    generation++
    if (!agentEnabled) for (const tab of tabs) tab.view.webContents.stop()
    activity = agentEnabled ? 'Agent access enabled · manual research only' : 'Agent access off · queued agent actions cancelled'
    return ok({ state: snapshot() }, SOURCE)
  }
  const parsed = browserRequestSchema.parse(value)
  // Stop must interrupt a current navigation, never sit behind it in the queue.
  if (parsed.action === 'stop') {
    generation++
    agentEnabled = false
    for (const tab of tabs) tab.view.webContents.stop()
    activity = 'Stopped · agent access off'
    return ok({ state: snapshot() }, SOURCE)
  }
  const next = queue.then(() => execute(parsed, false, generation))
  queue = next.catch(() => {})
  return next
}
