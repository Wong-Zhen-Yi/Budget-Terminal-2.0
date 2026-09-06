import type { Envelope, MarketCapPayload, MarketCapRow, MarketCapTier } from '../../shared/contract.js'
import { describeError, failed, meta } from '../../shared/envelope.js'
import { MARKET_CAP_LIMIT, MARKET_CAP_TTL, marketCapInTier, marketCapTier, marketCapRowFromQuote, rankMarketCapRows } from '../../shared/marketCap.js'
import { cache, type TtlCache } from '../cache.js'
import { equityMarketCapScreen, SCREEN_PAGE_SIZE, type EquityScreenPage } from './screener.js'

const SOURCE = 'Yahoo Finance'

export async function getMarketCap(options: {
  fetchPage?: (offset: number, size: number) => Promise<EquityScreenPage>
  tier?: MarketCapTier
  pageSize?: number
  limit?: number
} = {}): Promise<MarketCapPayload> {
  const tier = options.tier ?? 'all'
  marketCapTier(tier)
  const fetchPage = options.fetchPage ?? ((offset, size) => equityMarketCapScreen(offset, size, tier))
  const size = options.pageSize ?? SCREEN_PAGE_SIZE
  const limit = options.limit ?? MARKET_CAP_LIMIT
  const rows = new Map<string, MarketCapRow>()
  const seen = new Set<string>()
  let candidateCount = 0
  for (let offset = 0; offset < 25_000; offset += size) {
    const page = await fetchPage(offset, size)
    candidateCount = Math.max(candidateCount, page.total)
    if (!page.quotes.length) break
    const signature = JSON.stringify(page.quotes.map((quote) => quote.symbol).sort())
    if (seen.has(signature)) throw new Error('The screener repeated a page before the ranking was complete.')
    seen.add(signature)
    for (const quote of page.quotes) {
      const row = marketCapRowFromQuote(quote)
      if (!row || !marketCapInTier(row.marketCap, tier)) continue
      const old = rows.get(row.ticker)
      if (!old || row.marketCap > old.marketCap) rows.set(row.ticker, row)
    }
    if (rows.size >= limit || page.quotes.length < size || (page.total > 0 && offset + size >= page.total)) {
      return { rows: rankMarketCapRows(rows.values(), limit), source: SOURCE, asOf: new Date().toISOString(), candidateCount }
    }
  }
  if (seen.size >= Math.ceil(25_000 / size)) throw new Error('The screener exceeded the ranking page limit.')
  return { rows: rankMarketCapRows(rows.values(), limit), source: SOURCE, asOf: new Date().toISOString(), candidateCount }
}

export async function marketCapEnvelope(force = false, store: TtlCache = cache,
  loader?: () => Promise<MarketCapPayload>, tier: MarketCapTier = 'all'): Promise<Envelope<MarketCapPayload>> {
  try {
    marketCapTier(tier)
    const result = await store.resolveWithStaleFallback(`market-cap:us:100:${tier}`, MARKET_CAP_TTL, loader ?? (() => getMarketCap({ tier })), { force })
    const reason = result.stale ? 'Refresh failed; showing the last successful ranking.' : ''
    return {
      data: result.value,
      meta: meta(SOURCE, result.stale ? 'stale' : result.fromCache ? 'cached' : 'fresh', {
        fetchedAt: Date.parse(result.value.asOf), cacheAgeSeconds: result.ageSeconds,
        ...(reason ? { failureReason: reason } : {}),
      }),
      errors: reason ? [{ source: SOURCE, reason, operation: 'market cap' }] : [],
    }
  } catch (error) {
    return failed({ rows: [], source: SOURCE, asOf: '', candidateCount: 0 }, describeError(error), SOURCE)
  }
}
