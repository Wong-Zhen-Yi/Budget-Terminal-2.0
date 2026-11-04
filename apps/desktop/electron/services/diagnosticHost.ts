import { app, ipcMain, type BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { TABS } from '../shared/contract.js'
import { diagnosticLog as log, faultCode } from './diagnosticLog.js'
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

export function observeDiagnosticWindow(window: BrowserWindow): void {
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
      // Launch an independent process; it never takes the application's single-instance lock.
      void import('node:child_process').then(({ spawn }) => {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./logViewer.js', import.meta.url))], {
          detached: true, stdio: 'ignore', windowsHide: true,
          env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE')),
        })
        child.on('error', () => log.write('error', 'diagnostics', 'viewer-launch-failed'))
        child.unref()
      })
    }
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
  contents.once('destroyed', () => ipcMain.removeHandler('diagnostics:report'))
}
