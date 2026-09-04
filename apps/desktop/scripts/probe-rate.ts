/**
 * Push a burst of symbols through the gate and confirm nothing gets rate limited, then
 * confirm the background lane yields to a foreground request.
 *
 *   npm run probe:rate
 */
import assert from 'node:assert/strict'

import { getQuote, quoteFromChart } from '../electron/services/yahoo/quotes.js'
import { RateGate, isRateLimitError, rateGate } from '../electron/services/yahoo/rateGate.js'

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

async function main(): Promise<void> {
  probeQuoteSelection()
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
