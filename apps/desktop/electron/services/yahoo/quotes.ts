import type { Quote } from '../../shared/contract.js'
import { cache, TTL, type CachedResult } from '../cache.js'
import { paced, periodStart, requestPriority, yahoo } from './client.js'
import { isRateLimitError, type Priority } from './rateGate.js'
import { exchangeDateStamper } from '../../shared/exchangeDates.js'
import { captureSources, observeSource } from '../sourceHealth.js'
import { equityMarket } from '../../shared/equityMarkets.js'
import { hyperliquidEquities } from '../hyperliquidEquities.js'
import { regularMarketRefreshAt } from '../../shared/marketRefresh.js'
import { isCryptoQuoteSymbol, resolveCryptoQuote } from '../cryptoQuotes.js'
import { finnhubQuotes } from '../finnhubQuotes.js'

interface QuoteChartResult {
  quotes: Array<{ date: Date; close: number | null }>
  meta?: {
    regularMarketPrice?: number
    regularMarketTime?: Date
    chartPreviousClose?: number
    previousClose?: number
    currency?: string
    instrumentType?: string
    exchangeTimezoneName?: string
    currentTradingPeriod?: { regular?: { start?: Date | number; end?: Date | number } }
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Build a current quote from Yahoo's chart response without mistaking an older bar for it. */
export function quoteFromChart(symbol: string, result: QuoteChartResult): Quote | null {
  // Session dates belong to the exchange, not UTC: forex bars open at 23:00 UTC during
  // British Summer Time, which would otherwise date today's bar as yesterday's.
  const stamp = exchangeDateStamper(result.meta?.exchangeTimezoneName)
  const closes: Array<{ date: string; value: number }> = []
  for (const row of result.quotes) {
    if (!finite(row.close)) continue
    const close = { date: stamp(row.date), value: row.close }
    if (closes.at(-1)?.date === close.date) {
      closes[closes.length - 1] = close
    } else {
      closes.push(close)
    }
  }

  const metaPrice = result.meta?.regularMarketPrice
  if (finite(metaPrice)) {
    const marketTime = result.meta?.regularMarketTime
    const marketDate = marketTime instanceof Date && Number.isFinite(marketTime.getTime()) ? stamp(marketTime) : undefined
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
      source: 'Yahoo Finance',
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
    source: 'Yahoo Finance',
  }
}

/** Yahoo chart supplies both the current price and previous completed close. */
async function fetchQuoteChart(symbol: string): Promise<QuoteChartResult> {
  return paced(() => yahoo.chart(symbol, {
    period1: periodStart(7), interval: '1d', includePrePost: true,
  }))
}

/* --------------------------------------------------------- batched quote loads */

/**
 * Yahoo's v7 spark endpoint returns the same chart `meta` (price, trade time, previous
 * close, exchange timezone, trading period) and daily closes as `chart()`, for up to
 * twenty symbols per request. Pages request quotes as a fan-out (ten Forex pairs, the
 * Dashboard's macro row plus holdings, the Oil complex), so the per-symbol misses that
 * arrive together are collected briefly and sent as one paced request instead of one
 * request each. A symbol the batch does not return falls back to its own chart call, and
 * a failed batch falls back the same way unless Yahoo is rate-limiting, where twenty
 * extra requests would only deepen the cooldown.
 */
const QUOTE_BATCH_URL = 'https://query1.finance.yahoo.com/v7/finance/spark'
export const QUOTE_BATCH_SIZE = 20
/** Long enough for a fan-out's cache misses to arrive, short against the rate gate. */
const QUOTE_BATCH_WINDOW_MS = 15

interface QuoteWaiter {
  resolve: (value: QuoteChartResult) => void
  reject: (error: unknown) => void
}

export interface SparkQuoteEntry {
  symbol?: string
  response?: Array<{
    meta?: Record<string, unknown>
    timestamp?: Array<number | null>
    indicators?: { quote?: Array<{ close?: Array<number | null> }> }
  }>
}

function epochDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : undefined
}

/** Decode one spark entry into the `chart()` shape `quoteFromChart` already reads. */
export function quoteChartFromSpark(entry: SparkQuoteEntry): QuoteChartResult | null {
  const response = entry.response?.[0]
  const raw = response?.meta
  if (!response || !raw || typeof raw !== 'object') return null
  const stamps = response.timestamp ?? []
  const closes = response.indicators?.quote?.[0]?.close ?? []
  const quotes = stamps.flatMap((stamp, index) => {
    const date = epochDate(stamp)
    const close = closes[index]
    return date ? [{ date, close: finite(close) ? close : null }] : []
  })
  const regular = (raw.currentTradingPeriod as { regular?: { start?: unknown; end?: unknown } } | undefined)?.regular
  const meta: NonNullable<QuoteChartResult['meta']> = {
    regularMarketPrice: finite(raw.regularMarketPrice) ? raw.regularMarketPrice : undefined,
    regularMarketTime: epochDate(raw.regularMarketTime),
    chartPreviousClose: finite(raw.chartPreviousClose) ? raw.chartPreviousClose : undefined,
    previousClose: finite(raw.previousClose) ? raw.previousClose : undefined,
    currency: typeof raw.currency === 'string' ? raw.currency : undefined,
    instrumentType: typeof raw.instrumentType === 'string' ? raw.instrumentType : undefined,
    exchangeTimezoneName: typeof raw.exchangeTimezoneName === 'string' ? raw.exchangeTimezoneName : undefined,
    ...(regular ? { currentTradingPeriod: { regular: { start: epochDate(regular.start), end: epochDate(regular.end) } } } : {}),
  }
  if (!quotes.length && !finite(meta.regularMarketPrice)) return null
  return { quotes, meta }
}

async function fetchQuoteBatch(symbols: string[]): Promise<Map<string, QuoteChartResult>> {
  const body = await paced(() => yahoo._fetch(
    QUOTE_BATCH_URL,
    { symbols: symbols.join(','), range: '5d', interval: '1d', lang: 'en-US', region: 'US', corsDomain: 'finance.yahoo.com' },
    {},
    'json',
    false,
  )) as { spark?: { result?: SparkQuoteEntry[] | null; error?: { description?: string } | null } }
  if (body?.spark?.error) throw new Error(body.spark.error.description ?? 'Yahoo rejected the quote batch.')
  const results = new Map<string, QuoteChartResult>()
  for (const entry of body?.spark?.result ?? []) {
    const symbol = entry?.symbol?.trim().toUpperCase()
    const chart = symbol ? quoteChartFromSpark(entry) : null
    if (symbol && chart) results.set(symbol, chart)
  }
  return results
}

type QuoteBatchLoader = (symbols: string[]) => Promise<Map<string, QuoteChartResult>>
type QuoteChartLoader = (symbol: string) => Promise<QuoteChartResult>

async function flushQuoteBatch(waiting: Map<string, QuoteWaiter[]>, batchLoader: QuoteBatchLoader,
  singleLoader: QuoteChartLoader): Promise<void> {
  const symbols = [...waiting.keys()]
  const settle = (symbol: string, outcome: Promise<QuoteChartResult>) => {
    const waiters = waiting.get(symbol) ?? []
    outcome.then(value => waiters.forEach(waiter => waiter.resolve(value)),
      error => waiters.forEach(waiter => waiter.reject(error)))
  }
  // A lone symbol gains nothing from the batch endpoint; keep the established chart call.
  if (symbols.length === 1) {
    settle(symbols[0], singleLoader(symbols[0]))
    return
  }
  const chunks: string[][] = []
  for (let index = 0; index < symbols.length; index += QUOTE_BATCH_SIZE) chunks.push(symbols.slice(index, index + QUOTE_BATCH_SIZE))
  await Promise.all(chunks.map(async chunk => {
    let results: Map<string, QuoteChartResult>
    try {
      results = await batchLoader(chunk)
    } catch (error) {
      if (isRateLimitError(error)) {
        for (const symbol of chunk) settle(symbol, Promise.reject(error))
        return
      }
      results = new Map()
    }
    for (const symbol of chunk) {
      const hit = results.get(symbol)
      settle(symbol, hit ? Promise.resolve(hit) : singleLoader(symbol))
    }
  }))
}

/**
 * Join the current fan-out's quote batch. Foreground and background requests batch
 * separately so a page the user opened never waits in the startup warm-up's lane.
 */
export function createQuoteBatcher(batchLoader: QuoteBatchLoader = fetchQuoteBatch,
  singleLoader: QuoteChartLoader = fetchQuoteChart, windowMs = QUOTE_BATCH_WINDOW_MS): QuoteChartLoader {
  const pending: Record<Priority, Map<string, QuoteWaiter[]> | null> = { foreground: null, background: null }
  return (symbol) => new Promise<QuoteChartResult>((resolve, reject) => {
    const priority = requestPriority()
    let batch = pending[priority]
    if (!batch) {
      const created = new Map<string, QuoteWaiter[]>()
      batch = created
      pending[priority] = created
      // The timer callback inherits this caller's priority context, so the batch is
      // paced in the same lane as every request that joined it.
      setTimeout(() => {
        if (pending[priority] === created) pending[priority] = null
        void flushQuoteBatch(created, batchLoader, singleLoader)
      }, windowMs)
    }
    const waiters = batch.get(symbol) ?? []
    waiters.push({ resolve, reject })
    batch.set(symbol, waiters)
  })
}

const loadQuoteChart = createQuoteBatcher()

/** Cache the regular-session quote until its next useful check, preserving its trade time. */
export async function resolveYahooQuote(symbol: string, force = false, store = cache, loader: QuoteChartLoader = loadQuoteChart): Promise<CachedResult<Quote> & { stale: boolean }> {
  const result = await store.resolveWithStaleFallback(
    `quote:yahoo-session-v1:${symbol}`,
    (value: { quote: Quote; meta: QuoteChartResult['meta'] }) => {
      const now = Date.now()
      return regularMarketRefreshAt(value.meta, TTL.quotes, now) - now
    },
    async () => {
      const response = await loader(symbol)
      const quote = quoteFromChart(symbol, response)
      if (!quote) throw new Error(`No chart quote returned for ${symbol}.`)
      observeSource({ fetchedAt: Date.now(), asOf: quote.asOf, stale: false, fromCache: false, failures: [] })
      return { quote, meta: response.meta }
    },
    { force },
  )
  return { ...result, value: result.value.quote }
}

/** One quote, session-aware caching and coalescing across concurrent callers. */
export async function getQuote(symbol: string, force = false): Promise<Quote> {
  return (await resolveQuote(symbol, force)).value
}

/** Upgrade a usable stock quote without inheriting failures from an unused overlay. */
export async function getPreferredQuoteOverlay(symbol: string, force = false): Promise<Quote | undefined> {
  symbol = symbol.trim().toUpperCase()
  const result = await captureSources(async () => {
    if (await finnhubQuotes.configured(symbol)) {
      const quote = await finnhubQuotes.resolve(symbol, force)
      return quote && !quote.stale ? quote.value : undefined
    }
    if (equityMarket(symbol)) return hyperliquidEquities.getQuote(symbol, force)
  }).catch(() => undefined)
  if (!result?.value || result.snapshot?.stale || result.value.fallbackReason) return undefined
  if (result.snapshot) observeSource(result.snapshot)
  return result.value
}

async function resolveQuote(symbol: string, force = false): Promise<CachedResult<Quote> & { stale: boolean }> {
  symbol = symbol.trim().toUpperCase()
  if (isCryptoQuoteSymbol(symbol)) return resolveCryptoQuote(symbol)
  let finnhubFailure: string | undefined
  try {
    const quote = await finnhubQuotes.resolve(symbol, force)
    if (quote) return quote
  } catch (error) { finnhubFailure = error instanceof Error ? error.message : 'Finnhub quote unavailable.' }
  const result = await resolveExistingQuote(symbol, force, await finnhubQuotes.configured(symbol))
  if (!finnhubFailure) return result
  const reason = `${finnhubFailure} Using ${result.value.source ?? 'existing market data provider'}.`
  observeSource({ fetchedAt: Date.now(), stale: result.stale, fromCache: result.fromCache, failures: [reason] })
  return { ...result, value: { ...result.value, fallbackReason: [reason, result.value.fallbackReason].filter(Boolean).join(' ') } }
}

async function resolveExistingQuote(symbol: string, force: boolean, stockOnly = false): Promise<CachedResult<Quote> & { stale: boolean }> {
  if (stockOnly) return resolveYahooQuote(symbol, force)
  if (equityMarket(symbol)) {
    try {
      const quote = await hyperliquidEquities.getQuote(symbol, force)
      return { value: quote, fromCache: false, stale: false, ageSeconds: Math.max(0, (Date.now() - quote.asOf!) / 1000) }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const fallback = await resolveYahooQuote(symbol, force)
      observeSource({ fetchedAt: Date.now(), stale: false, fromCache: fallback.fromCache,
        failures: [`${symbol}: Hyperliquid unavailable; using Yahoo stock quote. ${reason}`], sources: ['Yahoo stock quote fallback'] })
      return { ...fallback, value: { ...fallback.value, source: 'Yahoo Finance (Hyperliquid fallback)', fallbackReason: reason } }
    }
  }
  return resolveYahooQuote(symbol, force)
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
export async function getQuotes(symbols: string[], force = false, onProgress?: (quotes: Record<string, Quote>) => void): Promise<QuoteBatch> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
  const preview: Record<string, Quote> = {}
  const settled = await Promise.allSettled(unique.map(async symbol => {
    const result = await resolveQuote(symbol, force)
    preview[symbol] = result.value
    onProgress?.({ ...preview })
    return result
  }))

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
      if (outcome.value.value.fallbackReason) errors.push({ symbol,
        reason: outcome.value.value.fallbackReason })
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
