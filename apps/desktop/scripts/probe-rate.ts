/**
 * Push a burst of symbols through the gate and confirm nothing gets rate limited.
 *
 *   npm run probe:rate
 */
import { getQuote } from '../electron/services/yahoo/quotes.js'
import { isRateLimitError, rateGate } from '../electron/services/yahoo/rateGate.js'

const SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'V',
  'UNH', 'XOM', 'WMT', 'MA', 'PG', 'JNJ', 'HD', 'COST', 'ORCL', 'BAC',
]

async function main(): Promise<void> {
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
  process.exit(rateLimited.length ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
