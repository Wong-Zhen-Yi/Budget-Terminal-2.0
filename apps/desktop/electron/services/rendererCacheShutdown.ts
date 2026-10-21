import type { BrowserWindow, WebContents } from 'electron'
import { CHANNELS } from '../shared/contract.js'

const pending = new Map<WebContents, () => void>()

/** Called only by the trusted shell IPC handler, never by research Browser tabs. */
export function rendererCacheFlushed(contents: WebContents): void {
  pending.get(contents)?.()
}

/** Give IndexedDB a bounded chance to commit before Electron destroys the renderer. */
export function configureRendererCacheShutdown(window: BrowserWindow, timeoutMs = 3_000): void {
  const contents = window.webContents
  let drained = false
  let closing = false
  let timer: ReturnType<typeof setTimeout> | undefined
  window.on('close', event => {
    if (drained || window.webContents.isDestroyed()) return
    event.preventDefault()
    if (closing) return
    closing = true
    const finish = () => {
      clearTimeout(timer)
      pending.delete(contents)
      drained = true
      if (!window.isDestroyed()) window.close()
    }
    timer = setTimeout(finish, timeoutMs)
    pending.set(contents, finish)
    try {
      contents.send(CHANNELS.flushRendererCache)
    } catch {
      finish()
    }
  })
  window.once('closed', () => {
    clearTimeout(timer)
    pending.delete(contents)
  })
}
