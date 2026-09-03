import type { Quote } from '../../shared/contract.js'
import { cache, TTL } from '../cache.js'
import { paced, periodStart, yahoo } from './client.js'

/**
 * Quotes come from a 5-day daily chart and the last two closes, matching
 * `_download_batch_data` + `price_payload` in the PySide6 app. `quote()` is one cheap
 * call but is the endpoint that breaks first when Yahoo rotates its crumb handling,
 * so it is the fallback rather than the primary.
 */
async function fetchQuote(symbol: string): Promise<Quote> {
  const result = await paced(() =>
    yahoo.chart(symbol, {
      period1: periodStart(7),
      interval: '1d',
      includePrePost: true,
    }),
  )
  // Yahoo repeats the current session as an extra live row on top of the bar that
  // already covers it. Left in, `closes[-1]` and `closes[-2]` are both today and the
  // day's change collapses to the intraday delta — the same hazard `fetchCloses` in
  // `history.ts` and `dropSyntheticQuoteBar` in `chart.ts` each guard against.
  const closes: number[] = []
  let previousDate = ''
  for (const row of result.quotes) {
    const close = row.close
    if (typeof close !== 'number' || !Number.isFinite(close)) continue
    const date = row.date.toISOString().slice(0, 10)
    if (date === previousDate) {
      closes[closes.length - 1] = close
      continue
    }
    previousDate = date
    closes.push(close)
  }

  if (closes.length >= 2) {
    const price = closes[closes.length - 1]
    const previous = closes[closes.length - 2]
    const absChange = price - previous
    return {
      symbol,
      price,
      change: previous ? (absChange / previous) * 100 : 0,
      absChange,
    }
  }

  // Thin or halted symbols can return a single bar; the meta block still carries a price.
  const metaPrice = result.meta?.regularMarketPrice
  const metaPrevious = result.meta?.chartPreviousClose ?? result.meta?.previousClose
  if (typeof metaPrice === 'number' && Number.isFinite(metaPrice)) {
    const previous = typeof metaPrevious === 'number' ? metaPrevious : metaPrice
    const absChange = metaPrice - previous
    return {
      symbol,
      price: metaPrice,
      change: previous ? (absChange / previous) * 100 : 0,
      absChange,
    }
  }
  return fetchQuoteFallback(symbol)
}

async function fetchQuoteFallback(symbol: string): Promise<Quote> {
  const quote = await paced(() => yahoo.quote(symbol))
  const price = quote?.regularMarketPrice
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new Error(`No quote data returned for ${symbol}.`)
  }
  const absChange = quote.regularMarketChange ?? 0
  return {
    symbol,
    price,
    change: quote.regularMarketChangePercent ?? 0,
    absChange,
  }
}

/** One quote, cached for `TTL.quotes` and coalesced across concurrent callers. */
export async function getQuote(symbol: string, force = false): Promise<Quote> {
  const result = await cache.resolve(
    `quote:${symbol}`,
    TTL.quotes,
    () => fetchQuote(symbol),
    { force },
  )
  return result.value
}

export interface QuoteBatch {
  quotes: Record<string, Quote>
  missing: string[]
  errors: Array<{ symbol: string; reason: string }>
}

/** Fetch many symbols concurrently; the rate gate decides how many actually run at once. */
export async function getQuotes(symbols: string[], force = false): Promise<QuoteBatch> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
  const settled = await Promise.allSettled(unique.map((symbol) => getQuote(symbol, force)))

  const quotes: Record<string, Quote> = {}
  const missing: string[] = []
  const errors: Array<{ symbol: string; reason: string }> = []
  settled.forEach((outcome, index) => {
    const symbol = unique[index]
    if (outcome.status === 'fulfilled') {
      quotes[symbol] = outcome.value
    } else {
      missing.push(symbol)
      errors.push({
        symbol,
        reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      })
    }
  })
  return { quotes, missing, errors }
}
