import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import type { Envelope } from '../shared/contract.js'
import { isTrustedRendererUrl } from '../shared/ipcSecurity.js'
import { TABS } from '../shared/contract.js'
import { diagnosticLog as log, faultCode, diagnosticDirectory, readDiagnosticLogs } from './diagnosticLog.js'
import { rateGate } from './yahoo/rateGate.js'

/** No raw console arguments, provider responses, browser content, or exception messages are persisted. */
export function startDiagnostics(): void {
  log.write('info', 'app', 'session-start', { version: app.getVersion(), electron: process.versions.electron,
    node: process.versions.node, platform: process.platform, arch: process.arch })
  process.on('uncaughtExceptionMonitor', error => log.write('error', 'main', 'uncaught-exception', { code: faultCode(error) }))
  // Do not install an uncaughtException handler or suppress Node's fatal error behavior.
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      log.write(level, 'main', 'console', { code: faultCode(args.map(value => value instanceof Error ? value.message : typeof value === 'string' ? value : '').join(' ')) })
      original(...args)
    }
  }
  app.on('child-process-gone', (_event, details) => log.write(details.reason === 'clean-exit' ? 'info' : 'error', 'process', 'child-exit', {
    type: details.type, reason: details.reason, exitCode: details.exitCode,
  }))
  const timer = setInterval(() => {
    const memory = process.memoryUsage()
    log.write('debug', 'performance', 'main-memory', { rssMiB: Math.round(memory.rss / 1048576), heapMiB: Math.round(memory.heapUsed / 1048576),
      dropped: log.status().dropped, storageAvailable: !log.status().failure })
    if (log.status().failure) process.stderr.write(`${log.status().failure}\n`)
    const gate = rateGate.stats()
    log.write(gate.cooldownMs > 0 ? 'warn' : 'debug', 'provider', 'yahoo-queue', {
      foregroundQueued: gate.waiting.foreground, backgroundQueued: gate.waiting.background,
      inFlight: gate.inFlight, cooldownMs: Math.round(gate.cooldownMs), requestsPerSecond: gate.rate,
    })
  }, 60_000)
  timer.unref()
  let expected = Date.now() + 5000
  const lagTimer = setInterval(() => {
    const lagMs = Math.max(0, Date.now() - expected)
    expected = Date.now() + 5000
    if (lagMs > 2000) log.write('warn', 'performance', 'main-event-loop-delay', { lagMs })
  }, 5000)
  lagTimer.unref()
  app.once('will-quit', () => { clearInterval(timer); clearInterval(lagTimer); log.write('info', 'app', 'shutdown-complete') })
}

export function observeDiagnosticWindow(window: BrowserWindow, rendererUrl: string): void {
  const contents = window.webContents
  const pageStates = new Map<string, string>()
  let lastReport = 0
  contents.on('did-finish-load', () => { pageStates.clear(); log.write('info', 'renderer', 'loaded') })
  contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame) log.write('error', 'renderer', 'load-failed', { errorCode })
  })
  contents.on('render-process-gone', (_event, details) => log.write('error', 'renderer', 'process-gone', { reason: details.reason, exitCode: details.exitCode }))
  contents.on('unresponsive', () => log.write('error', 'renderer', 'unresponsive'))
  contents.on('responsive', () => log.write('info', 'renderer', 'responsive'))
  contents.on('console-message', event => {
    if (event.level === 'error' || event.level === 'warning') log.write(event.level === 'error' ? 'error' : 'warn', 'renderer', 'console', { code: faultCode(event.message), line: event.lineNumber })
  })
  contents.on('preload-error', () => log.write('error', 'renderer', 'preload-failed'))
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key.toLowerCase() === 'l' && input.control && input.shift) {
      event.preventDefault()
      contents.send('diagnostics:open')
    }
  })
  const documentUrl = (url: string) => {
    try { return url.startsWith('file:') ? pathToFileURL(fileURLToPath(url)).href : url }
    catch { return '' }
  }
  const trusted = (event: Electron.IpcMainInvokeEvent) => event.sender === contents && event.senderFrame === contents.mainFrame && isTrustedRendererUrl(documentUrl(event.senderFrame.url), documentUrl(rendererUrl))
  const envelope = <T>(data: T, failureReason?: string): Envelope<T> => ({ data,
    meta: { source: 'Local diagnostic logs', freshness: failureReason ? 'failed' : 'fresh', fetchedAt: Date.now(), ...(failureReason ? { failureReason } : {}) }, errors: [] })
  ipcMain.handle('diagnostics:initial', event => trusted(event) && process.env.BUDGET_TERMINAL_OPEN_DIAGNOSTICS === '1')
  ipcMain.handle('diagnostics:read', event => {
    if (!trusted(event)) throw new Error('Untrusted diagnostics request')
    try { return envelope(readDiagnosticLogs(diagnosticDirectory())) }
    catch { return envelope({ entries: [], files: 0, bytes: 0 }, 'Cannot read log storage. Check folder permissions.') }
  })
  ipcMain.handle('diagnostics:action', async (event, action: unknown) => {
    if (!trusted(event)) throw new Error('Untrusted diagnostics request')
    if (action === 'folder') {
      try {
        const error = await shell.openPath(diagnosticDirectory())
        return envelope({ message: error ? 'Log folder is unavailable.' : 'Log folder opened.' }, error ? 'Log folder is unavailable.' : undefined)
      } catch { return envelope({ message: 'Log folder is unavailable.' }, 'Log folder is unavailable.') }
    }
    if (action !== 'export') throw new Error('Unknown diagnostics action')
    const { canceled, filePath } = await dialog.showSaveDialog(window, { title: 'Export diagnostic snapshot',
      defaultPath: `BudgetTerminal-diagnostics-${new Date().toISOString().slice(0, 10)}.jsonl`,
      filters: [{ name: 'Diagnostic JSON Lines', extensions: ['jsonl'] }] })
    if (canceled || !filePath) return envelope({ message: 'Export cancelled.' })
    try {
      const { entries } = readDiagnosticLogs(diagnosticDirectory())
      await writeFile(filePath, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n', { mode: 0o600 })
      return envelope({ message: `Exported ${entries.length} records from the retained snapshot.` })
    } catch { return envelope({ message: 'Export failed. Check disk space and file permissions.' }, 'Export failed.') }
  })
  const listener = (event: Electron.IpcMainInvokeEvent, request: unknown) => {
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame || !request || typeof request !== 'object') return
    const input = request as { kind?: unknown; pages?: unknown; line?: unknown; column?: unknown }
    if (input.kind === 'error' || input.kind === 'unhandled-rejection') {
      const position: Record<string, number> = {}
      for (const key of ['line', 'column'] as const) {
        const value = input[key]
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 100_000_000) position[key] = value
      }
      log.write('error', 'renderer', input.kind, position)
    } else if (input.kind === 'pages' && Array.isArray(input.pages)) {
      if (Date.now() - lastReport < 500) return
      lastReport = Date.now()
      for (const candidate of input.pages.slice(0, TABS.length)) {
        if (!candidate || typeof candidate !== 'object') continue
        const { page, state } = candidate as { page?: unknown; state?: unknown }
        if (typeof page !== 'string' || !TABS.some(tab => tab.id === page) || typeof state !== 'string' ||
          !['loading', 'ready', 'degraded', 'failed', 'idle'].includes(state) || pageStates.get(page) === state) continue
        pageStates.set(page, state)
        log.write(state === 'failed' ? 'error' : state === 'degraded' ? 'warn' : 'info', 'startup', 'page-state', { page, state })
      }
    }
  }
  ipcMain.handle('diagnostics:report', listener)
  contents.once('destroyed', () => {
    for (const channel of ['diagnostics:report', 'diagnostics:initial', 'diagnostics:read', 'diagnostics:action']) ipcMain.removeHandler(channel)
  })
}
