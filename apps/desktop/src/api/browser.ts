import { createApi, type Invoke, type Subscribe } from '@shared/createApi'
import { CHANNELS } from '@shared/contract'
import type { DesktopApi, SavedDataChanged } from '@shared/contract'

export const isBrowser = typeof window !== 'undefined' && !Boolean(window.api)
export type BrowserConnection = 'connecting' | 'connected' | 'disconnected'
let connection: BrowserConnection = 'connecting'
let csrf = ''
let events: EventSource | undefined
const changes = new EventTarget()
const subscribers = new Map<string, Set<(payload?: unknown) => void>>()

export function browserConnection() { return connection }
export function onBrowserConnection(listener: () => void) {
  changes.addEventListener('connection', listener)
  return () => changes.removeEventListener('connection', listener)
}
function setConnection(next: BrowserConnection) {
  connection = next
  changes.dispatchEvent(new Event('connection'))
}
function emit(channel: string, payload?: unknown) {
  subscribers.get(channel)?.forEach((listener) => listener(payload))
}
export function clearBrowserState() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('budget-terminal:') || ['stock-discovery-settings', 'ipo-page', 'etf-page'].includes(key)) localStorage.removeItem(key)
    }
  } catch { /* Storage can be unavailable in private browsing. */ }
}
function expireSession() {
  events?.close()
  clearBrowserState()
  // Reload removes cached private data and returns to the pairing screen.
  window.location.reload()
}

export async function browserSession(): Promise<{ authenticated: boolean; csrf?: string }> {
  const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error('Could not reach Budget Terminal. Keep the PC awake and connected to Tailscale.')
  return response.json()
}

export async function pairBrowser(code: string) {
  const response = await fetch('/api/pair', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Budget-Terminal': 'browser' },
    body: JSON.stringify({ code: code.trim() }),
  })
  const session = await response.json() as { authenticated: boolean; csrf?: string; error?: string }
  if (!response.ok || !session.authenticated || !session.csrf) throw new Error(session.error || 'Pairing failed. Check the code displayed in desktop Settings.')
  return session
}

export interface BrowserAccessRequest {
  state: 'pending' | 'approved' | 'denied' | 'expired'
  id?: string
  expiresAt?: number
  authenticated?: boolean
  csrf?: string
}

export async function browserAccessRequest(create = false): Promise<BrowserAccessRequest> {
  const response = await fetch('/api/access-request', {
    method: create ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    ...(create ? { headers: { 'Content-Type': 'application/json', 'X-Budget-Terminal': 'browser' }, body: '{}' } : {}),
  })
  const result = await response.json() as BrowserAccessRequest & { error?: string }
  if (!response.ok) throw new Error(result.error || 'Could not request access. Check the connection to your PC.')
  return result
}

export async function logoutBrowser() {
  const response = await fetch('/api/logout', {
    method: 'POST', credentials: 'same-origin', headers: { 'X-Budget-CSRF': csrf },
  })
  if (!response.ok && response.status !== 401) throw new Error('Logout could not reach the host. Reconnect and try again, or revoke this session on the desktop.')
  expireSession()
}

const invoke: Invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  let response: Response
  try {
    response = await fetch('/api/invoke', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Budget-CSRF': csrf },
      body: JSON.stringify({ channel, args }),
    })
  } catch {
    setConnection('disconnected')
    throw new Error('Connection lost. Keep Budget Terminal running on the PC and reconnect Tailscale.')
  }
  if (response.status === 401) { expireSession(); throw new Error('Session ended. Pair this browser again.') }
  const result: unknown = await response.json()
  if (!response.ok) throw new Error((result as { error?: string })?.error || `Request failed (${response.status}).`)
  return result as T
}

const subscribe: Subscribe = <Payload>(channel: string, listener: (payload?: Payload) => void) => {
  const listeners = subscribers.get(channel) ?? new Set()
  const receive = listener as (payload?: unknown) => void
  listeners.add(receive)
  subscribers.set(channel, listeners)
  return () => { listeners.delete(receive) }
}

export function installBrowserApi(token: string): DesktopApi {
  csrf = token
  const api = createApi(invoke, subscribe, 'linux')
  api.onScreenshotRequested = () => () => {}
  api.screenshotReady = async () => { throw new Error('Screenshots are available on the desktop.') }
  api.windowControl = async () => { throw new Error('Window controls are available on the desktop.') }
  api.maintenance = async () => { throw new Error('Use desktop Settings for backups and data maintenance.') }
  api.openExternal = async (value) => {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only web links can be opened.')
    window.open(url.href, '_blank', 'noopener,noreferrer')
  }
  api.writeClipboard = async (contents) => { await navigator.clipboard.writeText(contents) }
  api.saveText = async (suggestedName, contents) => {
    const name = suggestedName.replace(/[\\/]/g, '_')
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return name
  }
  window.api = api
  document.documentElement.classList.add('browser-mode')
  return api
}

export function connectBrowserEvents() {
  events?.close()
  events = new EventSource('/api/events')
  const refreshLocal = () => {
    emit(CHANNELS.savedDataChanged, { domains: ['articles', 'portfolio', 'cards', 'personalFinance', 'settings'] } satisfies SavedDataChanged)
    window.dispatchEvent(new Event('budget-browser-resume'))
  }
  events.onopen = () => { setConnection('connected'); refreshLocal() }
  events.onerror = () => {
    setConnection('disconnected')
    void browserSession().then((session) => { if (!session.authenticated) expireSession() }).catch(() => {})
  }
  events.addEventListener('saved-data-changed', (event) => {
    try { emit(CHANNELS.savedDataChanged, JSON.parse((event as MessageEvent).data)) } catch { refreshLocal() }
  })
  events.addEventListener('portfolio-changed', () => emit(CHANNELS.portfolioChanged))
  events.addEventListener('session-expired', expireSession)
  const resume = () => {
    if (document.visibilityState !== 'visible') return
    void browserSession().then((session) => {
      if (!session.authenticated) expireSession()
      else refreshLocal()
    }).catch(() => setConnection('disconnected'))
  }
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('online', resume)
  return () => {
    events?.close()
    document.removeEventListener('visibilitychange', resume)
    window.removeEventListener('online', resume)
  }
}
