import { checkMcpCancellation, mcpExecution, mcpProgress } from '../services/mcpContext.js'
import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { CHANNELS, TABS, type Envelope, type EnvelopeError } from '../shared/contract.js'
import { describeError, failed, partial } from '../shared/envelope.js'
import { authorizeBrowserScreenshot, compositeBrowserScreenshot } from '../services/browser.js'
import type { PageScreenshot, ScreenshotCommand, ScreenshotPayload, ScreenshotReady, ScreenshotRequest } from '../shared/screenshot.js'

const SOURCE = 'Electron page capture'
const TIMEOUT_MS = 5_000
class ScreenshotTimeoutError extends Error {}

async function withTimeout<T>(work: Promise<T>, timeout = TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ScreenshotTimeoutError('Page capture timed out. Wait for the app to finish starting and retry.')), timeout)
    })])
  } finally { clearTimeout(timer) }
}

/** Serialize captures: two MCP clients must never switch the same renderer concurrently. */
export function createScreenshotService(getWindow: () => BrowserWindow | undefined) {
  let pending: Promise<unknown> = Promise.resolve()
  return (request: ScreenshotRequest): Promise<Envelope<ScreenshotPayload>> => {
    const context = mcpExecution.getStore()
    const work = pending.then(() => mcpExecution.run(context ?? {}, () => capture(request)))
    pending = work.catch(() => {})
    return work
  }

  async function capture(request: ScreenshotRequest): Promise<Envelope<ScreenshotPayload>> {
    checkMcpCancellation()
    const window = getWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      return failed({ screenshots: [] }, 'Open a Budget Terminal window to take screenshots.', SOURCE)
    }
    const page = request.page ?? 'current'
    const tabs = TABS.filter((tab) => tab.implemented)
    if (!['all', 'current'].includes(page) && !tabs.some((tab) => tab.id === page)) {
      return failed({ screenshots: [] }, `Unknown page "${page}". Available pages: ${tabs.map((tab) => tab.id).join(', ')}.`, SOURCE)
    }
    const contents = window.webContents
    const throttled = contents.getBackgroundThrottling()
    const screenshots: PageScreenshot[] = []
    const errors: EnvelopeError[] = []
    const deadline = Date.now() + 120_000
    let waiting: { id: string; resolve: (ready: ScreenshotReady) => void } | undefined
    ipcMain.handle(CHANNELS.screenshotReady, (event, ready: ScreenshotReady) => {
      // The random per-request id and owning webContents also reject stale replies.
      if (event.sender !== contents || event.senderFrame !== contents.mainFrame ||
        !ready || ready.id !== waiting?.id || typeof ready.pageId !== 'string' ||
        typeof ready.label !== 'string' || typeof ready.obscured !== 'boolean' ||
        typeof ready.startupLoading !== 'boolean' || typeof ready.status !== 'string') return
      waiting?.resolve(ready)
    })
    const prepare = async (page: string | null) => {
      const command: ScreenshotCommand = { id: randomUUID(), page }
      const ready = new Promise<ScreenshotReady>((resolve) => { waiting = { id: command.id, resolve } })
      contents.send(CHANNELS.screenshotRequested, command)
      const result = await withTimeout(ready)
      waiting = undefined
      if (result.error) throw new Error(result.error)
      if (page !== null && result.pageId !== page) throw new Error('The renderer displayed a different page than requested.')
      return result
    }
    try {
      // Render even when occluded/minimized; never show, restore or focus the window.
      contents.setBackgroundThrottling(false)
      for (const id of page === 'all' ? tabs.map((tab) => tab.id) : [page === 'current' ? null : page]) {
        checkMcpCancellation()
        mcpProgress(screenshots.length, page === 'all' ? tabs.length : 1)
        if (Date.now() >= deadline) {
          errors.push({ source: SOURCE, reason: 'The all-pages capture deadline was reached; some pages were not captured.', operation: 'screenshot' })
          break
        }
        try {
          const { id: _requestId, error: _error, ...ready } = await prepare(id)
          checkMcpCancellation()
          const permit = ready.pageId === 'browser' && !ready.obscured ? await authorizeBrowserScreenshot(window) : undefined
          checkMcpCancellation()
          const shell = await withTimeout(contents.capturePage(undefined, { stayHidden: true, stayAwake: true }))
          const image = ready.obscured ? shell : await withTimeout(compositeBrowserScreenshot(window, shell, permit), 65_000)
          if (image.isEmpty()) throw new Error('Electron returned an empty screenshot.')
          const { width, height } = image.getSize()
          screenshots.push({ ...ready, capturedAt: Date.now(), width, height, mimeType: 'image/png', base64: image.toPNG().toString('base64') })
        } catch (error) {
          errors.push({ source: SOURCE, reason: describeError(error), operation: 'screenshot', symbol: id ?? 'current' })
          if (contents.isDestroyed() || error instanceof ScreenshotTimeoutError) break
        }
      }
    } catch (error) {
      errors.push({ source: SOURCE, reason: describeError(error), operation: 'screenshot' })
    } finally {
      try {
        if (!contents.isDestroyed()) {
          try { await prepare(null) } catch (error) {
            errors.push({ source: SOURCE, reason: `Could not confirm page restoration: ${describeError(error)}`, operation: 'screenshot' })
            // Still send a reset if the restore acknowledgement was lost.
            if (!contents.isDestroyed()) contents.send(CHANNELS.screenshotRequested, { id: randomUUID(), page: null } satisfies ScreenshotCommand)
          }
          if (!contents.isDestroyed()) contents.setBackgroundThrottling(throttled)
        }
      } finally { ipcMain.removeHandler(CHANNELS.screenshotReady) }
    }
    checkMcpCancellation()
    mcpProgress(screenshots.length, page === 'all' ? tabs.length : 1)
    const result = partial({ screenshots }, errors, SOURCE)
    if (!screenshots.length) result.meta = { ...result.meta, freshness: 'failed', failureReason: errors.map((error) => error.reason).join(' · ') }
    return result
  }
}
