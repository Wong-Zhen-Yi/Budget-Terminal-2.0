import type { Envelope, MaintenanceResult } from '@shared/contract'
import { CHANNELS } from '@shared/contract'
import { createApi } from '@shared/createApi'
import { ok } from '@shared/envelope'

async function request<T>(channel: string, ...args: unknown[]): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/__budget_api/${encodeURIComponent(channel)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Budget-Terminal': 'browser' },
      body: JSON.stringify(args),
    })
  } catch {
    throw new Error('Cannot reach Budget Terminal. Start the local server with npm run dev:web.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

function download(name: string, contents: string): string {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name.replace(/[\\/]/g, '_')
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return link.download
}

function pickBackup(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.style.display = 'none'
    const finish = (file: File | null) => { input.remove(); resolve(file) }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    document.body.append(input)
    input.click()
  })
}

export function createBrowserApi() {
  const listeners = new Set<() => void>()
  let events: EventSource | null = null
  const api = createApi(request, (_channel, listener) => {
    listeners.add(listener)
    if (!events) {
      events = new EventSource('/__budget_api/events')
      events.onmessage = () => { for (const notify of listeners) notify() }
    }
    return () => {
      listeners.delete(listener)
      if (!listeners.size) { events?.close(); events = null }
    }
  })
  api.openExternal = async (url) => {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      window.open(parsed.href, '_blank', 'noopener,noreferrer')
    }
  }
  api.saveText = async (name, contents) => download(name, contents)
  api.writeClipboard = (contents) => navigator.clipboard.writeText(contents)
  api.windowControl = async () => {}
  api.maintenance = async (action) => {
    if (action === 'exportUserData') {
      const payload = await request<{ result: Envelope<MaintenanceResult>; contents: string | null }>(
        CHANNELS.maintenance, { action },
      )
      if (payload.contents !== null) {
        payload.result.data.path = download(
          `budget-terminal-backup-${new Date().toISOString().slice(0, 10)}.json`, payload.contents,
        )
        payload.result.data.message = 'Backup downloaded.'
      }
      return payload.result
    }
    if (action === 'importUserData') {
      const file = await pickBackup()
      if (!file) return ok({ action, performed: false, message: 'Import cancelled.', path: '' }, 'settings store')
      if (file.size > 5 * 1024 * 1024) throw new Error('Backup must be smaller than 5 MB.')
      return request(CHANNELS.maintenance, { action, contents: await file.text() })
    }
    return request(CHANNELS.maintenance, { action })
  }
  return api
}
