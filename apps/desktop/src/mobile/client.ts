import { isSafeExternalUrl } from '../../electron/services/urls'
import { createApi, type Subscribe } from '@shared/createApi'
import { CHANNELS, type DesktopApi } from '@shared/contract'
import { articleFilename } from '@shared/articles'
import { ok } from '@shared/envelope'

export const isMobileTerminal = () => document.documentElement.hasAttribute('data-terminal-mobile')

async function request(channel: string, args: unknown[]) {
  const response = await fetch(`/api/call/${channel}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-budget-terminal': 'mobile' },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(result?.message ?? 'Check your Tailscale connection and keep Budget Terminal open on the computer.')
  }
  return response
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
    startupPriority: async () => {},
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
