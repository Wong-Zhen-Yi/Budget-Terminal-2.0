/**
 * Push a burst of symbols through the gate and confirm nothing gets rate limited, then
 * confirm the background lane yields to a foreground request.
 *
 *   npm run probe:rate
 */
import assert from 'node:assert/strict'

import { ApiUsageTracker, getApiUsageSnapshot } from '../electron/services/apiUsage.js'
import { isTransientDataError, retryTransientData } from '../electron/shared/dataRetry.js'
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
  // A slowed-down 1/s pace legitimately plateaus at 25% of the 240/min budget.
  // Counts must still roll forward and return to zero after activity stops.
  const yahooTracker = new ApiUsageTracker(undefined, () => now)
  for (let index = 0; index < 120; index += 1) {
    await yahooTracker.track('yahoo', async () => undefined)
    if (index >= 59) {
      const yahoo = yahooTracker.snapshot().providers[0]
      assert.equal(yahoo.requestCount, 60)
      assert.equal(yahoo.percent, 25)
    }
    now += 1_000
  }
  now += 60_000
  assert.equal(yahooTracker.snapshot().providers[0].percent, 0)
  const yahoo = getApiUsageSnapshot().providers.find(provider => provider.id === 'yahoo')!
  const gate = rateGate.stats()
  assert.equal(yahoo.queued, gate.waiting.foreground + gate.waiting.background)
  assert.equal(yahoo.backgroundRequestsPerSecond, gate.backgroundRate)
  console.log('API usage rolling-window, steady startup pace, idle decay and throttle checks passed')
}

async function main(): Promise<void> {
  probeQuoteSelection()
  await probeApiUsage()
  await probeParallelPacing()
  await probeTransientRetries()
  await probeBackgroundPacing()
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
  const settled = await runWithPriority('background', () =>
    Promise.allSettled(SYMBOLS.map((symbol) => getQuote(symbol, true))))
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
  const gate = new RateGate({ requestsPerSecond: 1_000, burst: 30, maxConcurrency: 2, backgroundRequestsPerSecond: 1_000 })
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
  const gate = new RateGate({ requestsPerSecond: 20, burst: 2, maxConcurrency: 4, backgroundRequestsPerSecond: 20 })
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

  const adaptive = new RateGate({ requestsPerSecond: 20, burst: 1, backgroundRequestsPerSecond: 20, cooldownSeconds: 0.15, recoveryStreak: 2 })
  await assert.rejects(adaptive.run(async () => { throw Object.assign(new Error('Too many requests'), { status: 429 }) }))
  assert.equal(adaptive.stats().rate, 10)
  assert.equal(adaptive.stats().backgroundRate, 10, '429 must also halve the background rate')
  assert(adaptive.stats().cooldownMs > 0)
  const failedAt = Date.now()
  await Promise.all(Array.from({ length: 2 }, () => adaptive.run(async () => {
    assert(Date.now() - failedAt >= 140, 'A queued request bypassed the 429 cooldown')
  }, 'background')))
  assert.equal(adaptive.stats().rate, 20)
  assert.equal(adaptive.stats().backgroundRate, 20, 'Clean responses must restore background pacing too')
  assert.equal(adaptive.stats().inFlight, 0)
  console.log('Parallel provider checks passed: shared pacing, concurrency ceiling, 429 cooldown and rate recovery.')
}

async function probeTransientRetries(): Promise<void> {
  for (const error of [new Error('HTTP 503'), new Error('HTTP 429'), new Error('fetch failed'),
    Object.assign(new Error('socket'), { code: 'ECONNRESET' }),
    Object.assign(new Error('request failed'), { cause: { code: 'EAI_AGAIN' } }),
    Object.assign(new Error('Yahoo worker exited (7)'), { code: 'ETIMEDOUT' })]) {
    assert(isTransientDataError(error), String(error))
  }
  for (const error of [new Error('HTTP 404'), new Error('Invalid symbol'), new Error('Sign in required'),
    new Error('Background page load timed out'), Object.assign(new Error('HTTP 503'), { status: 401 }),
    Object.assign(new Error('request aborted'), { name: 'AbortError' })]) {
    assert(!isTransientDataError(error), String(error))
  }
  const delays: number[] = []
  const attempts: number[] = []
  let calls = 0
  const options = { random: () => 0, sleep: async (ms: number) => { delays.push(ms) },
    onRetry: (_error: unknown, attempt: number) => { attempts.push(attempt) } }
  assert.equal(await retryTransientData(async () => {
    if (++calls < 3) throw new Error('HTTP 503')
    return 'recovered'
  }, options), 'recovered')
  assert.equal(calls, 3)
  assert.deepEqual(delays, [1_000, 2_000])
  assert.deepEqual(attempts, [2, 3])
  calls = 0
  await assert.rejects(retryTransientData(async () => { calls++; throw new Error('HTTP 503') }, options), /503/)
  assert.equal(calls, 3, 'Persistent outages must have a bounded retry budget')
  calls = 0
  await assert.rejects(retryTransientData(async () => { calls++; throw new Error('HTTP 404') }, options), /404/)
  assert.equal(calls, 1, 'Permanent failures must not consume retries')
  calls = 0
  let cancelled = false
  await assert.rejects(retryTransientData(async () => { calls++; throw new Error('fetch failed') }, {
    isCancelled: () => cancelled, sleep: async () => { cancelled = true },
  }), /cancelled/)
  assert.equal(calls, 1, 'Unmount must suppress a queued recovery attempt')

  // Exercise the actual paced() wrapper: every retry must rejoin the same lane/rank,
  // not bypass the gate or retain a slot during exponential backoff.
  const originalRun = rateGate.run
  const ranks: Array<[string | undefined, number | undefined]> = []
  rateGate.run = async (task, priority, rank) => {
    ranks.push([priority, rank])
    return task()
  }
  calls = 0
  try {
    assert.equal(await runWithPriority('background', () => paced(async () => {
      if (++calls === 1) throw Object.assign(new Error('Provider busy'), { status: 503 })
      return 'ready'
    }), 7), 'ready')
    assert.deepEqual(ranks, [['background', 7], ['background', 7]])
  } finally { rateGate.run = originalRun }
  console.log('Retry checks passed: transient classification, bounded backoff, permanent failures, cancellation and every Yahoo attempt rejoining its original gate lane.')
}

/** Startup has no burst, keeps a separate concurrency cap and never delays foreground tokens. */
async function probeBackgroundPacing(): Promise<void> {
  const gate = new RateGate()
  assert.equal(gate.stats().backgroundRate, 3)
  const starts: number[] = []
  const baselineStarts: number[] = []
  const baseline = new RateGate({ backgroundRequestsPerSecond: 1, backgroundMaxConcurrency: 2 })
  const request = () => gate.run(async () => { starts.push(Date.now()) }, 'background')
  await Promise.all([
    ...Array.from({ length: 9 }, request),
    ...Array.from({ length: 9 }, () => baseline.run(async () => { baselineStarts.push(Date.now()) }, 'background')),
  ])
  const duration = starts[8] - starts[0]
  const baselineDuration = baselineStarts[8] - baselineStarts[0]
  assert(duration < baselineDuration * 0.6, 'Faster startup must drain a cold queue materially faster than the old 1/s cap')
  for (let index = 1; index < starts.length; index++) {
    assert(starts[index] - starts[index - 1] >= 323, 'Default startup requests must remain spaced at 3/s without bursts')
  }
  // Idle time may refill one background token, never the six-token foreground burst.
  await new Promise((resolve) => setTimeout(resolve, 1_100))
  await Promise.all([request(), request()])
  assert(starts[10] - starts[9] >= 323, 'Idle startup work must not accumulate burst tokens')
  console.log(`Cold queue benchmark: 9 requests in ${duration}ms vs ${baselineDuration}ms at the old startup pace`)

  const limited = new RateGate({ requestsPerSecond: 1_000, burst: 20, backgroundRequestsPerSecond: 1_000 })
  let active = 0
  let peak = 0
  let release!: () => void
  let occupied!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const full = new Promise<void>(resolve => { occupied = resolve })
  const background = Array.from({ length: 8 }, () => limited.run(async () => {
    active += 1
    peak = Math.max(peak, active)
    if (active === 3) occupied()
    await hold
    active -= 1
  }, 'background'))
  await full
  try {
    await limited.run(async () => {
      assert.equal(active, 3, 'Foreground must run while all three background slots are occupied')
    })
  } finally { release() }
  await Promise.all(background)
  assert.equal(peak, 3, 'Startup must use at most three in-flight Yahoo requests')

  const responsive = new RateGate({ requestsPerSecond: 20, burst: 1, backgroundRequestsPerSecond: 2 })
  await responsive.run(async () => undefined, 'background')
  const waitingBackground = responsive.run(async () => undefined, 'background')
  const foregroundAt = Date.now()
  await responsive.run(async () => undefined)
  assert(Date.now() - foregroundAt < 300, 'Foreground inherited the slower background wake timer')
  await waitingBackground

  const serial = new RateGate({ maxConcurrency: 1 })
  await serial.run(async () => undefined, 'background')
  assert.equal(serial.stats().inFlight, 0, 'A one-slot gate must not deadlock background work')
  console.log('Startup pacing checks passed: 3/s without bursts, three background slots, faster cold queue, idle refill, foreground responsiveness and one-slot gates.')
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
  const gate = new RateGate({ requestsPerSecond: 4, burst: 6, maxConcurrency: 4, backgroundRequestsPerSecond: 4 })
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
