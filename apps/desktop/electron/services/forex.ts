import type { Envelope, NewsArticle, Quote } from '../shared/contract.js'
import type { ForexRequest, ForexPairRequest, ForexHistoryRequest, ForexQuotesPayload, ForexHistoryPayload, ForexNewsPayload } from '../shared/forex.js'
import { FOREX_PAIRS, FOREX_DAYS, FOREX_MARKET_MS, FOREX_NEWS_MS, forexPair, selectForexNews, usableForexQuote } from '../shared/forex.js'
import { describeError, failed, ok } from '../shared/envelope.js'
import { cache } from './cache.js'
import { getQuote } from './yahoo/quotes.js'
import { periodStart } from './yahoo/client.js'
import { fetchHeadlineFeed } from './yahoo/newsPage.js'
import { getYahooSeries } from './yahoo/series.js'
import { sourceSnapshot, withSourceEnvelope } from './sourceHealth.js'

const SOURCE = 'Yahoo Finance'

/** Cache each source independently, retaining its actual collection time on failure. */
export async function forexLane<T>(key: string, ttl: number, force: boolean, empty: T, loader: () => Promise<T>): Promise<Envelope<T>> {
  return withSourceEnvelope(async () => {
  try {
    const result = await cache.resolveWithStaleFallback(key, ttl, loader, { force })
    const freshness = result.stale ? 'stale' : result.fromCache ? 'cached' : 'fresh'
    const reason = result.stale ? 'Refresh failed; showing previously collected data.' : undefined
    return {
      data: result.value,
      meta: { source: SOURCE, freshness, fetchedAt: Date.now() - result.ageSeconds * 1000, cacheAgeSeconds: result.ageSeconds, failureReason: reason },
      errors: reason ? [{ source: SOURCE, operation: key, reason }] : [],
    }
  } catch (error) { return failed(empty, describeError(error), SOURCE) }
  })
}

export async function getForexQuotes(request: ForexRequest = {}): Promise<Envelope<ForexQuotesPayload>> {
  return withSourceEnvelope(async () => {
  const lanes = await Promise.all(FOREX_PAIRS.map(async (pair) => {
    const result = await forexLane<Quote | null>(`forex:quote:${pair.id}`, FOREX_MARKET_MS, Boolean(request.force), null, async () => {
      const quote = await getQuote(pair.symbol, Boolean(request.force))
      if (!usableForexQuote(quote)) throw new Error(`No usable ${pair.id} quote.`)
      return quote
    })
    return { pair, result }
  }))
  const envelope = ok<ForexQuotesPayload>({ rows: lanes.map(({ pair, result }) => ({ pair: pair.id, quote: result.data, freshness: result.meta.freshness, fetchedAt: result.meta.fetchedAt })) }, SOURCE)
  envelope.errors = lanes.flatMap(({ pair, result }) => result.errors.map((error) => ({ ...error, symbol: pair.id })))
  envelope.meta.fetchedAt = Math.min(...lanes.map(({ result }) => result.meta.fetchedAt))
  envelope.meta.freshness = lanes.every(({ result }) => result.meta.freshness === 'failed') ? 'failed'
    : envelope.errors.length ? 'partial' : lanes.every(({ result }) => result.meta.freshness === 'cached') ? 'cached' : 'fresh'
  return envelope
  })
}

export async function getForexHistory(request: ForexHistoryRequest): Promise<Envelope<ForexHistoryPayload>> {
  const empty: ForexHistoryPayload = { pair: request.pair, range: request.range, points: [] }
  return forexLane(`forex:history:${request.pair}:${request.range}`, FOREX_MARKET_MS, Boolean(request.force), empty, async () => {
    const pair = forexPair(request.pair)
    if (!Object.hasOwn(FOREX_DAYS, request.range)) throw new Error('Unsupported forex range.')
    const result = await getYahooSeries({
      symbol: pair.symbol,
      start: periodStart(FOREX_DAYS[request.range]),
      interval: request.range === '1W' ? '1h' : '1d',
      force: Boolean(request.force),
    })
    const points = [...new Map(result.rows.flatMap((row) => {
      const time = row.time * 1000
      return Number.isFinite(time) && typeof row.close === 'number' && Number.isFinite(row.close) && row.close > 0
        ? [[time, { time, value: row.close }] as const] : []
    })).values()].sort((a, b) => a.time - b.time)
    if (!points.length) throw new Error(`No history available for ${pair.id}.`)
    return { ...empty, points }
  })
}

export async function getForexNews(request: ForexPairRequest): Promise<Envelope<ForexNewsPayload>> {
  return withSourceEnvelope(async () => {
  let pair
  try { pair = forexPair(request.pair) } catch (error) { return failed({ pair: request.pair, articles: [] }, describeError(error), SOURCE) }
  const key = `forex:news:${pair.id}`
  const cached = request.force ? null : await cache.get<Envelope<ForexNewsPayload>>(key)
  if (cached) return { ...cached.value, meta: { ...cached.value.meta, freshness: 'cached', cacheAgeSeconds: (Date.now() - cached.value.meta.fetchedAt) / 1000 } }
  // Currency feeds augment the cross's own feed without replacing relevance filtering.
  const symbols = [...new Set([pair.symbol, ...pair.id.split('/').map((currency) => ({ EUR: 'EURUSD=X', USD: 'DX-Y.NYB', GBP: 'GBPUSD=X', JPY: 'JPY=X', CHF: 'CHF=X', AUD: 'AUDUSD=X', CAD: 'CAD=X', NZD: 'NZDUSD=X', SGD: 'SGD=X' })[currency]!).filter(Boolean)])]
  const lanes = await Promise.all(symbols.map((symbol) => forexLane<NewsArticle[]>(`forex:news-feed:${symbol}`, FOREX_NEWS_MS, Boolean(request.force), [], () => fetchHeadlineFeed(symbol, 30))))
  const envelope = ok<ForexNewsPayload>({ pair: pair.id, articles: selectForexNews(pair.id, lanes.flatMap((lane) => lane.data)) }, SOURCE)
  envelope.errors = lanes.flatMap((lane) => lane.errors)
  envelope.meta.fetchedAt = Math.min(...lanes.map((lane) => lane.meta.fetchedAt))
  envelope.meta.freshness = lanes.every((lane) => lane.meta.freshness === 'failed') ? 'failed' : envelope.errors.length ? 'partial' : lanes.every((lane) => lane.meta.freshness === 'cached') ? 'cached' : 'fresh'
  // A pair assembled from cached currency feeds must not extend those feeds' lifetime.
  if (!envelope.errors.length) await cache.set(key, envelope, Math.max(0, FOREX_NEWS_MS - (Date.now() - envelope.meta.fetchedAt)), sourceSnapshot())
  return envelope
  })
}
