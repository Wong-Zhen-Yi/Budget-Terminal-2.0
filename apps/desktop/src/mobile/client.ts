import { isSafeExternalUrl } from '../../electron/services/urls'
import { createApi, type Subscribe } from '@shared/createApi'
import { CHANNELS, type DesktopApi } from '@shared/contract'
import { articleFilename } from '@shared/articles'
import { ok } from '@shared/envelope'

export const isMobileTerminal = () => document.documentElement.hasAttribute('data-terminal-mobile')

// Plain-HTTP origins (the local mobile window and the direct Tailscale link) share a
// small per-host browser connection pool. Keep connections free for live events and
// user actions during startup preloading.
const maxBackgroundRequests = 3
// The page on screen may use extra connections, so its preload never waits behind
// slow requests for unseen pages. One connection always stays free.
const maxPreferredRequests = 5
let backgroundRequests = 0
let preferredOrder: number | null = null
let waiterSequence = 0
const waitingRequests: Array<{ order: number; sequence: number; start: () => void }> = []

function canStart(order: number) {
  return backgroundRequests < (order === preferredOrder ? maxPreferredRequests : maxBackgroundRequests)
}

/** Start the open page's queued reads first, then lower startup ranks in arrival order. */
function startWaitingRequests() {
  while (waitingRequests.length) {
    const preferred = waitingRequests.findIndex(waiter => waiter.order === preferredOrder)
    const index = preferred >= 0 ? preferred : waitingRequests.reduce((best, waiter, i) => {
      const current = waitingRequests[best]
      return waiter.order < current.order || (waiter.order === current.order && waiter.sequence < current.sequence) ? i : best
    }, 0)
    if (!canStart(waitingRequests[index].order)) return
    const [waiter] = waitingRequests.splice(index, 1)
    backgroundRequests++
    waiter.start()
  }
}

function preferBackgroundOrder(order: number | null) {
  preferredOrder = order !== null && Number.isSafeInteger(order) && order >= 0 ? order : null
  startWaitingRequests()
}

async function sendRequest(channel: string, args: unknown[]) {
  let response = await fetch(`/api/call/${channel}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-budget-terminal': 'mobile', prefer: 'respond-async' },
    body: JSON.stringify(args),
  })
  // Release the browser connection while the computer waits on providers. This
  // also works on the direct HTTP link, where Safari has few connections per host.
  if (response.status === 202) {
    const { id } = await response.json() as { id: string }
    do {
      await new Promise(resolve => setTimeout(resolve, 1000))
      response = await fetch(`/api/results/${id}`, { headers: { 'x-budget-terminal': 'mobile' } })
      if (response.status === 202) await response.text()
    } while (response.status === 202)
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(result?.message ?? 'Keep Budget Terminal open on the computer and reopen the mobile page.')
  }
  return response
}

async function request(channel: string, args: unknown[]) {
  const [input] = args
  if (location.protocol !== 'http:' || !input || typeof input !== 'object' || !('background' in input) || input.background !== true) {
    return sendRequest(channel, args)
  }
  const value = 'backgroundOrder' in input ? input.backgroundOrder : undefined
  const order = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER
  await new Promise<void>(start => {
    waitingRequests.push({ order, sequence: waiterSequence++, start })
    startWaitingRequests()
  })
  try {
    return await sendRequest(channel, args)
  } finally {
    backgroundRequests--
    startWaitingRequests()
  }
}

export async function mobileTelegramProfile(): Promise<string> {
  return (await request('mobile:telegram', [])).json()
}

export async function downloadMobileBackup() {
  const response = await request('mobile:backup', [])
  return saveFile('budget-terminal-backup.json', await response.blob())
}

function saveFile(filename: string, contents: Blob) {
  const url = URL.createObjectURL(contents)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.split(/[/\\]/).at(-1) || 'budget-terminal.txt'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return link.download
}

export async function copyMobileText(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text)
  const previous = document.activeElement
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'
  document.body.append(field)
  try {
    field.focus()
    field.select()
    if (!document.execCommand('copy')) throw new Error('Copy is unavailable in this browser.')
  } finally {
    field.remove()
    if (previous instanceof HTMLElement) previous.focus()
  }
}

export function createMobileApi(): DesktopApi {
  const events = new Map<string, Set<(payload: unknown) => void>>()
  let stream: EventSource | undefined
  let disconnected = false
  const subscribe: Subscribe = (channel, listener) => {
    // Every mobile tab shares one connection for quote updates and desktop edits.
    stream ??= new EventSource('/api/events')
    stream.onmessage = (message) => {
      const { channel, payload } = JSON.parse(message.data) as { channel: string; payload: unknown }
      for (const update of events.get(channel) ?? []) update(payload)
    }
    stream.onerror = () => { disconnected = true }
    stream.onopen = () => {
      if (!disconnected) return
      disconnected = false
      for (const update of events.get(CHANNELS.savedDataChanged) ?? []) {
        update({ domains: ['portfolio', 'articles', 'cards', 'personalFinance', 'settings'] })
      }
    }
    const listeners = events.get(channel) ?? new Set()
    const update = (payload: unknown) => listener(payload as Parameters<typeof listener>[0])
    listeners.add(update)
    events.set(channel, listeners)
    return () => { listeners.delete(update) }
  }
  const api = createApi(async (channel, ...args) => (await request(channel, args)).json(), subscribe, 'linux')
  return {
    ...api,
    diagnosticsInitial: async () => false,
    reportDiagnostics: () => {},
    setEquityQuoteVisibility: async () => {},
    // The desktop rate gate still orders provider work; this orders the browser's connections.
    startupPriority: async order => preferBackgroundOrder(order),
    onCacheFlush: () => () => {},
    onScreenshotRequested: () => () => {},
    onOpenDiagnostics: () => () => {},
    onNotificationClicked: () => () => {},
    onPortfolioChanged: () => () => {},
    openExternal: async url => { if (isSafeExternalUrl(url)) window.open(url, '_blank', 'noopener,noreferrer') },
    saveText: async (filename, contents) => saveFile(filename, new Blob([contents], { type: 'text/plain;charset=utf-8' })),
    writeClipboard: copyMobileText,
    exportArticlesPdf: async ({ articles, all }) => {
      const response = await request(CHANNELS.exportArticlesPdf, [{ all, articles }])
      const path = saveFile(all ? 'budget-terminal-articles.zip' : articleFilename(articles[0].title), await response.blob())
      return ok({ cancelled: false, paths: [path], failures: [] }, 'article PDF export')
    },
  }
}
