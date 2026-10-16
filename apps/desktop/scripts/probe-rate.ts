/**
 * Push a burst of symbols through the gate and confirm nothing gets rate limited, then
 * confirm the background lane yields to a foreground request.
 *
 *   npm run probe:rate
 */
import assert from 'node:assert/strict'

import { ApiUsageTracker } from '../electron/services/apiUsage.js'
import { getQuote, quoteFromChart } from '../electron/services/yahoo/quotes.js'
import { RateGate, isRateLimitError, rateGate } from '../electron/services/yahoo/rateGate.js'
import { paced, runWithPriority } from '../electron/services/yahoo/client.js'
import './probe-yahoo-worker.js'

const SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'V',
  'UNH', 'XOM', 'WMT', 'MA', 'PG', 'JNJ', 'HD', 'COST', 'ORCL', 'BAC',
]

function probeQuoteSelection(): void {
  const previous = 324.96
  const current = 328.21
  const baseRows = [
    { date: new Date('2026-09-01T13:30:00Z'), close: 325.13 },
    { date: new Date('2026-09-02T13:30:00Z'), close: previous },
  ]
  const meta = {
    regularMarketPrice: current,
    regularMarketTime: new Date('2026-09-03T20:00:01Z'),
    // Yahoo can report a period-level chartPreviousClose here. The daily rows are the
    // authoritative source for the immediately preceding session when they exist.
    chartPreviousClose: 314.58,
  }

  const incomplete = quoteFromChart('AAPL', {
    quotes: [...baseRows, { date: new Date('2026-09-03T13:30:00Z'), close: null }],
    meta,
  })
  assert.equal(incomplete?.price, current)
  assert.equal(incomplete?.absChange, current - previous)

  const complete = quoteFromChart('AAPL', {
    quotes: [...baseRows, { date: new Date('2026-09-03T13:30:00Z'), close: current }],
    meta,
  })
  assert.equal(complete?.price, current)
  assert.equal(complete?.absChange, current - previous)

  const duplicated = quoteFromChart('AAPL', {
    quotes: [
      ...baseRows,
      { date: new Date('2026-09-03T13:30:00Z'), close: 327 },
      { date: new Date('2026-09-03T20:00:01Z'), close: current },
    ],
    meta,
  })
  assert.equal(duplicated?.absChange, current - previous)

  const historical = quoteFromChart('AAPL', { quotes: baseRows })
  assert.equal(historical?.price, previous)
  assert.equal(historical?.absChange, previous - 325.13)

  console.log('quote selection current-price checks passed')
}

async function probeApiUsage(): Promise<void> {
  let now = 100_000
  const tracker = new ApiUsageTracker({
    test: {
      label: 'Test API',
      softLimit: 10,
      windowMs: 60_000,
      fallbackCooldownMs: 2_000,
    },
  }, () => now)

  await Promise.all(Array.from({ length: 6 }, () => tracker.track('test', async () => undefined)))
  let provider = tracker.snapshot().providers[0]
  assert.equal(provider.requestCount, 6)
  assert.equal(provider.percent, 60)
  assert.equal(provider.throttled, false)

  now += 60_001
  provider = tracker.snapshot().providers[0]
  assert.equal(provider.requestCount, 0)
  assert.equal(provider.percent, 0)

  await assert.rejects(
    tracker.track('test', async () => { throw new Error('HTTP 429') }),
    /429/,
  )
  provider = tracker.snapshot().providers[0]
  assert.equal(provider.percent, 100)
  assert.equal(provider.throttled, true)
  assert.equal(provider.cooldownMs, 2_000)

  now += 2_001
  provider = tracker.snapshot().providers[0]
  assert.equal(provider.throttled, false)
  assert.equal(provider.percent, 10)
  console.log('API usage rolling-window and throttle checks passed')
}

async function main(): Promise<void> {
  probeQuoteSelection()
  await probeApiUsage()
  await probeParallelPacing()
  await probeStartupOrdering()
  if (process.argv.includes('--offline')) {
    assert.ok(await probeLanes())
    return
  }
  const started = Date.now()
  let peakInFlight = 0
  const sampler = setInterval(() => {
    peakInFlight = Math.max(peakInFlight, rateGate.stats().inFlight)
  }, 10)

  // Fired all at once on purpose: without the gate this is exactly the burst Yahoo 429s.
  const settled = await Promise.allSettled(SYMBOLS.map((symbol) => getQuote(symbol, true)))
  clearInterval(sampler)

  const failures = settled.filter((outcome) => outcome.status === 'rejected')
  const rateLimited = failures.filter(
    (outcome) => outcome.status === 'rejected' && isRateLimitError(outcome.reason),
  )
  const elapsed = (Date.now() - started) / 1000

  console.log(`symbols        ${SYMBOLS.length}`)
  console.log(`elapsed        ${elapsed.toFixed(1)}s (${(SYMBOLS.length / elapsed).toFixed(1)}/s)`)
  console.log(`succeeded      ${settled.length - failures.length}`)
  console.log(`failed         ${failures.length}`)
  console.log(`rate limited   ${rateLimited.length}`)
  console.log(`peak in flight ${peakInFlight}`)
  console.log(`gate           ${JSON.stringify(rateGate.stats())}`)

  for (const outcome of failures) {
    if (outcome.status === 'rejected') console.log(`  ! ${outcome.reason}`)
  }
  const lanes = await probeLanes()

  process.exit(rateLimited.length || !lanes ? 1 : 0)
}

async function probeStartupOrdering(): Promise<void> {
  const gate = new RateGate({ requestsPerSecond: 1_000, burst: 30, maxConcurrency: 2 })
  let release!: () => void
  // Occupy the background slot while later requests from multiple pages arrive.
  const blocker = gate.run(() => new Promise<void>((resolve) => { release = resolve }), 'background')
  await new Promise((resolve) => setTimeout(resolve, 0))
  const order: string[] = []
  const queue = (label: string, rank: number) => gate.run(async () => { order.push(label) }, 'background', rank)
  const requests = [queue('slow1', 20), queue('fast1', 2), queue('slow2', 20), queue('fast2', 2), queue('unknown', NaN)]
  await gate.run(async () => { order.push('foreground') }, 'foreground', 99)
  assert.deepEqual(order, ['foreground'], 'Foreground must keep its reserved slot')
  release()
  await Promise.all([blocker, ...requests])
  assert.deepEqual(order, ['foreground', 'unknown', 'fast1', 'fast2', 'slow1', 'slow2'])

  // Concurrent IPC fan-outs must keep separate ranks through awaits, including
  // later requests in the same page task. Outside a context, requests stay foreground.
  const originalRun = rateGate.run
  const contexts: Array<{ label: string; priority: string | undefined; rank: number | undefined }> = []
  rateGate.run = async (task, priority, rank) => {
    const value = await task()
    contexts.push({ label: String(value), priority, rank })
    return value
  }
  const call = (label: string) => paced(async () => label)
  try {
    await Promise.all([
      runWithPriority('background', async () => { await call('slow'); await call('slow-follow-up') }, 20),
      runWithPriority('background', async () => { await new Promise((resolve) => setTimeout(resolve, 0)); await call('fast') }, 2),
    ])
    await call('outside')
    assert.deepEqual(contexts, [
      { label: 'slow', priority: 'background', rank: 20 },
      { label: 'slow-follow-up', priority: 'background', rank: 20 },
      { label: 'fast', priority: 'background', rank: 2 },
      { label: 'outside', priority: 'foreground', rank: undefined },
    ])
  } finally {
    rateGate.run = originalRun
  }
  console.log('Adaptive provider checks passed: faster pages before queued heavy fan-outs, stable ordering, foreground priority and isolated async page ranks.')
}

/** Concurrent page fan-outs share one gate, including across priority lanes. */
async function probeParallelPacing(): Promise<void> {
  const gate = new RateGate({ requestsPerSecond: 20, burst: 2, maxConcurrency: 4 })
  const starts: number[] = []
  const started = Date.now()
  let inFlight = 0
  let peak = 0
  await Promise.all(Array.from({ length: 6 }, (_, page) => Promise.all(
    Array.from({ length: 3 }, (_, request) => gate.run(async () => {
      starts.push(Date.now() - started)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 120))
      inFlight -= 1
    }, request === 0 && page === 0 ? 'foreground' : 'background')),
  )))
  assert.equal(starts.length, 18)
  assert(peak <= 4, `Parallel pages exceeded concurrency: ${peak}`)
  assert(peak > 1, 'Provider requests did not overlap')
  for (const [index, elapsed] of starts.entries()) {
    assert(index + 1 <= 2 + Math.floor((elapsed + 2) * 20 / 1000), 'Parallel pages exceeded the shared token budget')
  }
  assert.equal(gate.stats().inFlight, 0)
  assert.deepEqual(gate.stats().waiting, { foreground: 0, background: 0 })

  const adaptive = new RateGate({ requestsPerSecond: 20, burst: 1, cooldownSeconds: 0.15, recoveryStreak: 2 })
  await assert.rejects(adaptive.run(async () => { throw Object.assign(new Error('Too many requests'), { status: 429 }) }))
  assert.equal(adaptive.stats().rate, 10)
  assert(adaptive.stats().cooldownMs > 0)
  const failedAt = Date.now()
  await Promise.all(Array.from({ length: 2 }, () => adaptive.run(async () => {
    assert(Date.now() - failedAt >= 140, 'A queued request bypassed the 429 cooldown')
  }, 'background')))
  assert.equal(adaptive.stats().rate, 20)
  assert.equal(adaptive.stats().inFlight, 0)
  console.log('Parallel provider checks passed: shared pacing, concurrency ceiling, 429 cooldown and rate recovery.')
}

/**
 * The warm-up's shape: one background task fans out into far more requests than the gate
 * will admit at once, and a foreground request arrives after it. The foreground one must
 * finish before the background batch drains, or a page opened mid-warm waits it out.
 *
 * The tasks are local timers, not Yahoo calls — this is about admission order, and
 * spending a hundred real requests to measure it would be its own rate-limit problem.
 */
async function probeLanes(): Promise<boolean> {
  const gate = new RateGate({ requestsPerSecond: 4, burst: 6, maxConcurrency: 4 })
  const work = () => new Promise<void>((resolve) => setTimeout(resolve, 20))

  const order: string[] = []
  const background = Array.from({ length: 60 }, (_, index) =>
    gate.run(work, 'background').then(() => order.push(`bg${index}`)),
  )
  // After the batch is queued, the way a user's tab switch lands mid-warm.
  await new Promise((resolve) => setTimeout(resolve, 50))
  const startedAt = Date.now()
  await gate.run(work, 'foreground')
  const waitedMs = Date.now() - startedAt
  const backgroundDone = order.length

  await Promise.all(background)
  const totalMs = Date.now() - startedAt

  // It cannot be instant — a background call already in flight is never cancelled — but it
  // must not be the whole batch either.
  const jumped = backgroundDone < 60
  console.log('')
  console.log(`lane wait      ${waitedMs}ms with ${backgroundDone}/60 background done`)
  console.log(`batch drain    ${totalMs}ms`)
  console.log(`foreground first ${jumped ? 'yes' : 'NO'}`)
  return jumped && waitedMs < totalMs / 2
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
