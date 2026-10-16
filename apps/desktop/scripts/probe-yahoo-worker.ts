import assert from 'node:assert/strict'
import { createYahooWorkerClient } from '../electron/services/yahoo/workerClient.js'
import { isRateLimitError } from '../electron/services/yahoo/rateGate.js'
import { ApiUsageTracker } from '../electron/services/apiUsage.js'

// Exercise the production worker transport with deterministic CPU-heavy responses.
// No provider calls or user files are needed for the saturation regression.
const fixture = `export default class {
  calls = 0
  async quote(symbol, options = {}) {
    if (symbol === 'crash') process.exit(7)
    if (symbol === 'pending') return new Promise(() => {})
    if (symbol === 'rate-limit') throw Object.assign(new Error('Provider busy'), { response: { status: 429 } })
    if (options.busy) {
      Atomics.store(new Int32Array(options.started), 0, 1)
      const until = performance.now() + options.busy
      while (performance.now() < until) JSON.parse(JSON.stringify({ rows: Array(100).fill(symbol) }))
    }
    return { symbol, calls: ++this.calls, when: options.when }
  }
  async chart(symbol) { return { symbol, quotes: [{ date: new Date(1234), close: 10 }] } }
}`
const remote = createYahooWorkerClient(`data:text/javascript,${encodeURIComponent(fixture)}`)
const quote = remote.yahoo.quote as unknown as (symbol: string, options?: object) => Promise<{ symbol: string; calls: number; when?: Date }>
try {
  assert.equal((await quote('warm')).calls, 1)
  const usage = new ApiUsageTracker()
  const burst = await Promise.all(Array.from({ length: 220 }, (_, index) =>
    usage.track('yahoo', () => quote(`burst-${index}`))))
  assert(burst.every((result, index) => result.symbol === `burst-${index}`), 'Concurrent responses must reach their own callers')
  assert(usage.snapshot().providers[0].percent > 90, 'Exercise the same rolling pressure shown by the footer')
  const started = new SharedArrayBuffer(4)
  const busy = quote('busy', { busy: 400, started, when: new Date(5678) })
  while (!Atomics.load(new Int32Array(started), 0)) await new Promise(resolve => setTimeout(resolve, 5))
  const heartbeatAt = performance.now()
  await new Promise(resolve => setTimeout(resolve, 20))
  const heartbeatDelay = performance.now() - heartbeatAt
  assert(heartbeatDelay < 200, `Yahoo processing blocked main-thread heartbeat for ${heartbeatDelay.toFixed(0)}ms`)
  const result = await busy
  assert.equal(result.calls, 222, 'Requests must reuse one client/session')
  assert.equal(result.when?.getTime(), 5678, 'Date arguments/results must survive the transport')
  const chart = await remote.yahoo.chart('fixture', { period1: new Date(0) })
  assert.equal(chart.quotes[0].date.getTime(), 1234)
  await assert.rejects(quote('rate-limit'), isRateLimitError, '429 status must reach the shared rate gate')
  const outcomes = await Promise.allSettled([quote('pending'), quote('crash')])
  assert(outcomes.every(outcome => outcome.status === 'rejected'), 'Worker exit must settle every pending caller')
  assert.equal((await quote('restart')).calls, 1, 'A later request must restart a crashed worker')
  await assert.rejects(quote('uncloneable', { callback: () => {} }))
  assert.equal((await quote('after-clone-error')).symbol, 'after-clone-error')
  if (process.versions.electron) {
    const { BrowserWindow } = await import('electron')
    const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
    try {
      await window.loadURL('data:text/html,<button onclick="this.textContent=\'Clicked\'">Click</button>')
      const started = new SharedArrayBuffer(4)
      const busy = quote('electron-busy', { busy: 400, started })
      while (!Atomics.load(new Int32Array(started), 0)) await new Promise(resolve => setTimeout(resolve, 5))
      const inputAt = performance.now()
      const text = await window.webContents.executeJavaScript('document.querySelector("button").click(); document.querySelector("button").textContent')
      const inputDelay = performance.now() - inputAt
      assert.equal(text, 'Clicked')
      assert(inputDelay < 200, `Electron input round trip blocked for ${inputDelay.toFixed(0)}ms`)
      await busy
      console.log(`PASS: Electron button interaction completed in ${inputDelay.toFixed(0)}ms during Yahoo processing`)
    } finally { window.destroy() }
  }
  const pending = quote('pending')
  remote.close()
  await assert.rejects(pending, /closed/)
  await assert.rejects(quote('after-close'), /closed/)
  console.log(`PASS: 400ms Yahoo CPU burst kept main heartbeat at ${heartbeatDelay.toFixed(0)}ms; session reuse, Dates, 429, crash recovery, clone errors and shutdown`)
} finally {
  remote.close()
}
