import type { Quote } from '../../shared/contract.js'
import { cache, TTL } from '../cache.js'
import { paced, periodStart, yahoo } from './client.js'
import { observeSource } from '../sourceHealth.js'

interface QuoteChartResult {
  quotes: Array<{ date: Date; close: number | null }>
  meta?: {
    regularMarketPrice?: number
    regularMarketTime?: Date
    chartPreviousClose?: number
    previousClose?: number
    currency?: string
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Build a current quote from Yahoo's chart response without mistaking an older bar for it. */
export function quoteFromChart(symbol: string, result: QuoteChartResult): Quote | null {
  const closes: Array<{ date: string; value: number }> = []
  for (const row of result.quotes) {
    if (!finite(row.close)) continue
    const close = { date: row.date.toISOString().slice(0, 10), value: row.close }
    if (closes.at(-1)?.date === close.date) {
      closes[closes.length - 1] = close
    } else {
      closes.push(close)
    }
  }

  const metaPrice = result.meta?.regularMarketPrice
  if (finite(metaPrice)) {
    const marketDate = result.meta?.regularMarketTime?.toISOString().slice(0, 10)
    const latest = closes.at(-1)
    const previous = latest?.date === marketDate
      ? closes.at(-2)?.value
      : latest?.value
    const fallbackPrevious = result.meta?.chartPreviousClose ?? result.meta?.previousClose
    const previousClose = finite(previous)
      ? previous
      : finite(fallbackPrevious)
        ? fallbackPrevious
        : metaPrice
    const absChange = metaPrice - previousClose
    return {
      symbol,
      price: metaPrice,
      change: previousClose ? (absChange / previousClose) * 100 : 0,
      absChange,
      asOf: result.meta?.regularMarketTime?.getTime(),
      currency: result.meta?.currency,
    }
  }

  if (closes.length < 2) return null
  const price = closes[closes.length - 1].value
  const previous = closes[closes.length - 2].value
  const absChange = price - previous
  return {
    symbol,
    price,
    change: previous ? (absChange / previous) * 100 : 0,
    absChange,
    asOf: result.quotes.at(-1)?.date.getTime(),
    currency: result.meta?.currency,
  }
}

/** Yahoo chart supplies both the current price and previous completed close. */
async function fetchQuote(symbol: string): Promise<Quote> {
  const result = await paced(() => yahoo.chart(symbol, {
    period1: periodStart(7), interval: '1d', includePrePost: true,
  }))
  const quote = quoteFromChart(symbol, result)
  if (!quote) throw new Error(`No chart quote returned for ${symbol}.`)
  observeSource({ fetchedAt: Date.now(), asOf: quote.asOf, stale: false, fromCache: false, failures: [] })
  return quote
}

/** One quote, cached for `TTL.quotes` and coalesced across concurrent callers. */
export async function getQuote(symbol: string, force = false): Promise<Quote> {
  return (await resolveQuote(symbol, force)).value
}

function resolveQuote(symbol: string, force = false) {
  return cache.resolveWithStaleFallback(`quote:yahoo-only:${symbol}`, TTL.quotes, () => fetchQuote(symbol), { force })
}

export interface QuoteBatch {
  quotes: Record<string, Quote>
  missing: string[]
  errors: Array<{ symbol: string; reason: string }>
  fromCacheCount: number
  staleCount: number
  cacheAgeSeconds: number
}

/** Fetch many symbols concurrently; the rate gate decides how many actually run at once. */
export async function getQuotes(symbols: string[], force = false): Promise<QuoteBatch> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
  const settled = await Promise.allSettled(unique.map((symbol) => resolveQuote(symbol, force)))

  const quotes: Record<string, Quote> = {}
  const missing: string[] = []
  const errors: Array<{ symbol: string; reason: string }> = []
  let fromCacheCount = 0
  let staleCount = 0
  let cacheAgeSeconds = 0
  settled.forEach((outcome, index) => {
    const symbol = unique[index]
    if (outcome.status === 'fulfilled') {
      quotes[symbol] = outcome.value.value
      if (outcome.value.fromCache) fromCacheCount += 1
      if (outcome.value.stale) staleCount += 1
      cacheAgeSeconds = Math.max(cacheAgeSeconds, outcome.value.ageSeconds)
    } else {
      missing.push(symbol)
      errors.push({
        symbol,
        reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      })
    }
  })
  return { quotes, missing, errors, fromCacheCount, staleCount, cacheAgeSeconds }
}
