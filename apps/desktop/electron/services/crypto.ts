import type {
  CryptoFearGreed,
  CryptoGlobalMarket,
  CryptoHeatmapPayload,
  CryptoHeatmapTile,
  CryptoPayload,
  CryptoQuote,
  CryptoStage,
  CryptoStageStatus,
  EnvelopeError,
  NewsArticle,
  HyperliquidPayload,
} from '../shared/contract.js'
import {
  COINGECKO_IDS,
  CRYPTO_HEATMAP_LIMIT,
  CRYPTO_NEWS_CANDIDATE_LIMIT,
  CRYPTO_NEWS_FEEDS,
  CRYPTO_NEWS_FOCUS_TICKERS,
  CRYPTO_NEWS_LIMIT,
  CRYPTO_TICKERS,
  PROXY_TICKERS,
  fearGreedStamp,
  firstNumber,
  localIsoSeconds,
  rankSortValue,
} from '../shared/crypto.js'
import { describeError, err } from '../shared/envelope.js'
import { dedupeArticles, normalizeTickerUniverse } from '../shared/news.js'
import { cache, TTL } from './cache.js'
import { loadFeed } from './news/feeds.js'
import { paced, periodStart, yahoo } from './yahoo/client.js'
import { trackApiRequest } from './apiUsage.js'
import { hyperliquidClient } from './hyperliquid.js'
import { equityMarket } from '../shared/equityMarkets.js'
import { getQuote } from './yahoo/quotes.js'
import { observeSource } from './sourceHealth.js'
import { hyperliquidEquities } from './hyperliquidEquities.js'
import { markCryptoPerpetuals } from '../shared/hyperliquid.js'

/**
 * The Crypto page's data, ported from `CryptoMarketWorker` (`workers/crypto.py`).
 *
 * Independent stages load the heatmap, quotes, global/Fear & Greed strip, news, and
 * Hyperliquid perpetuals concurrently. The progress map keeps feed failures visible
 * while the healthy panels remain usable, including during startup preloading.
 *
 * **CoinGecko and alternative.me deliberately stay outside `paced()`**, on the
 * `services/fearGreed.ts` precedent: the rate gate models Yahoo's 429 behaviour and
 * halves its own budget on one, so letting a CoinGecko hiccup throttle the dashboard
 * would be strictly worse than letting the Crypto page fail alone. Yahoo metadata
 * and fallback quotes still go through the shared gate.
 */

export const CRYPTO_SOURCE = 'crypto market'
export const COINGECKO_SOURCE = 'CoinGecko'
export const CRYPTO_FEAR_GREED_SOURCE = 'Alternative.me'
const YAHOO_SOURCE = 'Yahoo Finance'

const MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets'
const GLOBAL_URL = 'https://api.coingecko.com/api/v3/global'
const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=1'

/** The reference's own agent string, `'BudgetTerminal/1.0 crypto-page'`. */
const HEADERS = {
  'User-Agent': 'BudgetTerminal/1.0 crypto-page',
  Accept: 'application/json, text/plain, */*',
}

/** `timeout=12` on every one of the worker's `requests.get` calls. */
const TIMEOUT_MS = 12_000

interface CoinGeckoRow {
  id?: unknown
  symbol?: unknown
  name?: unknown
  current_price?: unknown
  price_change_percentage_24h?: unknown
  price_change_percentage_24h_in_currency?: unknown
  market_cap?: unknown
  market_cap_rank?: unknown
  total_volume?: unknown
}

interface YahooCryptoRow {
  symbol?: string
  shortName?: string
  longName?: string
  regularMarketPrice?: number
  regularMarketChangePercent?: number
  marketCap?: number
  regularMarketVolume?: number
  volume24Hr?: number
}

async function getJson(url: string): Promise<unknown> {
  const providerId = url.startsWith('https://api.coingecko.com/')
    ? 'coingecko'
    : 'alternative'
  return trackApiRequest(providerId, async () => {
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
}

/* ------------------------------------------------------------------ stage 1 */

function marketsUrl(params: Record<string, string>): string {
  const query = new URLSearchParams({
    vs_currency: 'usd',
    order: 'market_cap_desc',
    page: '1',
    sparkline: 'false',
    price_change_percentage: '24h',
    ...params,
  })
  return `${MARKETS_URL}?${query.toString()}`
}

/** `_fetch_top_crypto_heatmap`: the 30 largest coins by market cap. */
async function fetchCoinGeckoTiles(): Promise<CryptoHeatmapTile[]> {
  const body = await getJson(marketsUrl({ per_page: String(CRYPTO_HEATMAP_LIMIT) }))
  const rows = Array.isArray(body) ? (body as CoinGeckoRow[]) : []

  const tiles: CryptoHeatmapTile[] = []
  rows.slice(0, CRYPTO_HEATMAP_LIMIT).forEach((row, index) => {
    if (!row || typeof row !== 'object') return
    const symbol = String(row.symbol ?? '').trim().toUpperCase()
    if (!symbol || firstNumber(row.current_price) === null) return
    const name = String(row.name ?? '').trim()
    const rank = firstNumber(row.market_cap_rank, index + 1)
    tiles.push({
      rank: rank === null ? index + 1 : Math.trunc(rank),
      symbol,
      name: name || symbol,
      price: firstNumber(row.current_price),
      changePct: firstNumber(
        row.price_change_percentage_24h_in_currency,
        row.price_change_percentage_24h,
      ),
      marketCap: firstNumber(row.market_cap),
      volume: firstNumber(row.total_volume),
      source: COINGECKO_SOURCE,
    })
  })
  return tiles
}

/** Yahoo's market-cap-ranked USD screen keeps the full heatmap available if CoinGecko fails. */
export async function fetchTopTiles(): Promise<CryptoHeatmapTile[]> {
  let primary: CryptoHeatmapTile[] = []
  let primaryError = 'Incomplete CoinGecko heatmap'
  try {
    primary = await fetchCoinGeckoTiles()
    if (primary.length === CRYPTO_HEATMAP_LIMIT) return primary
  } catch (error) {
    primaryError = describeError(error)
  }
  try {
    // This saved crypto screen is not in yahoo-finance2's predefined screen enum.
    const body = await paced(() => yahoo._fetch(
      'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved',
      { scrIds: 'all_cryptocurrencies_us', count: String(CRYPTO_HEATMAP_LIMIT), formatted: 'false' },
      {}, 'json', false,
    )) as { finance?: { result?: Array<{ quotes?: YahooCryptoRow[] }> } }
    const rows = body.finance?.result?.[0]?.quotes ?? []
    const tiles = rows.filter(row => row.symbol?.endsWith('-USD') && firstNumber(row.regularMarketPrice) !== null)
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, CRYPTO_HEATMAP_LIMIT)
      .map((row, index): CryptoHeatmapTile => ({
        rank: index + 1,
        symbol: row.symbol!.replace(/-USD$/, ''),
        name: (row.longName || row.shortName || row.symbol!).replace(/ USD$/, ''),
        price: firstNumber(row.regularMarketPrice),
        changePct: firstNumber(row.regularMarketChangePercent),
        marketCap: firstNumber(row.marketCap),
        volume: firstNumber(row.volume24Hr, row.regularMarketVolume),
        source: YAHOO_SOURCE,
      }))
    if (tiles.length > primary.length) return tiles
    if (!primary.length) throw new Error('Yahoo returned no usable crypto rows')
  } catch (error) {
    if (!primary.length) throw new Error(`${primaryError}; Yahoo fallback: ${describeError(error)}`)
  }
  return primary
}

/** `_build_heatmap_payload`: normalise, cap at 30 and attach coverage. */
function buildHeatmapPayload(tiles: CryptoHeatmapTile[], updatedAt: string): CryptoHeatmapPayload {
  const normalized = tiles.slice(0, CRYPTO_HEATMAP_LIMIT).map((tile, index) => ({
    rank: tile.rank || index + 1,
    symbol: String(tile.symbol ?? '').trim().toUpperCase(),
    name: String(tile.name || tile.symbol || '').trim(),
    price: firstNumber(tile.price),
    changePct: firstNumber(tile.changePct),
    marketCap: firstNumber(tile.marketCap),
    volume: firstNumber(tile.volume),
    source: tile.source || COINGECKO_SOURCE,
  }))
  return {
    tiles: normalized,
    coverage: { loaded: normalized.length, total: CRYPTO_HEATMAP_LIMIT },
    updatedAt,
  }
}

/**
 * `_build_heatmap_from_quotes`: the five-tile stand-in when the Top 30 call failed but
 * the quote stage came back. Ranked 1-5 by the tuple's own order, not by market cap.
 */
function buildHeatmapFromQuotes(quotes: Record<string, CryptoQuote>): CryptoHeatmapTile[] {
  const tiles: CryptoHeatmapTile[] = []
  CRYPTO_TICKERS.forEach((entry, index) => {
    const quote = quotes[entry.label]
    if (!quote || quote.price === null) return
    tiles.push({
      rank: index + 1,
      symbol: entry.label,
      name: entry.name,
      price: firstNumber(quote.price),
      changePct: firstNumber(quote.changePct),
      marketCap: firstNumber(quote.marketCap),
      volume: firstNumber(quote.volume),
      source: quote.source || YAHOO_SOURCE,
    })
  })
  return tiles
}

/* ------------------------------------------------------------------ stage 2 */

interface RawQuote {
  volumeSource?: string
  marketCapSource?: string
  metadataAsOf?: number
  price: number | null
  changePct: number | null
  volume: number | null
  marketCap: number | null
  source: string
}

const EMPTY_QUOTE: RawQuote = {
  price: null,
  changePct: null,
  volume: null,
  marketCap: null,
  source: YAHOO_SOURCE,
}

/** `_fetch_coingecko_quotes`: the five named coins in one call, keyed back to the label. */
async function fetchCoinGeckoQuotes(): Promise<Record<string, RawQuote>> {
  const ids = Object.values(COINGECKO_IDS)
  const body = await getJson(marketsUrl({ ids: ids.join(','), per_page: String(ids.length) }))
  const rows = Array.isArray(body) ? (body as CoinGeckoRow[]) : []
  const byId = new Map(rows.map((row) => [String(row?.id ?? ''), row]))

  const quotes: Record<string, RawQuote> = {}
  for (const [label, id] of Object.entries(COINGECKO_IDS)) {
    const row = byId.get(id)
    if (!row) continue
    quotes[label] = {
      price: firstNumber(row.current_price),
      changePct: firstNumber(
        row.price_change_percentage_24h_in_currency,
        row.price_change_percentage_24h,
      ),
      volume: firstNumber(row.total_volume),
      marketCap: firstNumber(row.market_cap),
      source: COINGECKO_SOURCE,
    }
  }
  return quotes
}

/** Stock metadata has its own cache; a fresh perpetual mark never refreshes it. */
export async function fetchMappedProxyQuote(symbol: string, force = false): Promise<RawQuote> {
  const [quote, metadata] = await Promise.allSettled([
    getQuote(symbol, force),
    cache.resolveWithStaleFallback(`crypto:proxy-metadata:v1:${symbol}`, 15 * 60_000, async () => {
      const summary = await paced(() => yahoo.quoteSummary(symbol, { modules: ['price', 'summaryDetail'] }))
      const marketCap = firstNumber(summary?.price?.marketCap, summary?.summaryDetail?.marketCap, summary?.summaryDetail?.totalAssets)
      const volume = firstNumber(summary?.price?.regularMarketVolume)
      if (marketCap === null && volume === null) throw new Error(`No Yahoo metadata for ${symbol}.`)
      return { marketCap, volume, asOf: Date.now() }
    }, { force }),
  ])
  if (metadata.status === 'rejected') observeSource({ fetchedAt: Date.now(), stale: false, fromCache: false,
    failures: [`${symbol}: Yahoo stock volume/market cap unavailable. ${describeError(metadata.reason)}`] })
  if (quote.status === 'rejected') observeSource({ fetchedAt: Date.now(), stale: false, fromCache: false,
    failures: [`${symbol}: Price unavailable. ${describeError(quote.reason)}`] })
  const snapshot = metadata.status === 'fulfilled' ? metadata.value.value : undefined
  return { price: quote.status === 'fulfilled' ? quote.value.price : null,
    changePct: quote.status === 'fulfilled' ? quote.value.change : null,
    source: quote.status === 'fulfilled' ? quote.value.source ?? YAHOO_SOURCE : YAHOO_SOURCE,
    marketCap: snapshot?.marketCap ?? null, volume: snapshot?.volume ?? null,
    volumeSource: 'Yahoo Finance stock volume (shares)', marketCapSource: YAHOO_SOURCE, metadataAsOf: snapshot?.asOf }
}

/** Unmapped ETFs and last-resort crypto fallbacks retain Yahoo price/metadata. */
async function fetchYahooQuote(symbol: string, force = false): Promise<RawQuote> {
  if (equityMarket(symbol)) return fetchMappedProxyQuote(symbol, force)
  const result: RawQuote = { ...EMPTY_QUOTE }
  try {
    const chart = await paced(() =>
      yahoo.chart(symbol, { period1: periodStart(7), interval: '1d' }),
    )
    const closes = chart.quotes
      .map((row) => row.close)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    if (closes.length >= 1) result.price = closes[closes.length - 1]
    if (closes.length >= 2 && closes[closes.length - 2] !== 0) {
      const previous = closes[closes.length - 2]
      result.changePct = ((closes[closes.length - 1] - previous) / previous) * 100
    }
    const volumes = chart.quotes
      .map((row) => row.volume)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    if (volumes.length >= 1) result.volume = volumes[volumes.length - 1]
  } catch {
    /* `logger.info` in the reference; the row stays null and the cell reads `--`. */
  }

  try {
    const summary = await paced(() =>
      yahoo.quoteSummary(symbol, { modules: ['price', 'summaryDetail'] }),
    )
    result.price = firstNumber(result.price, summary?.price?.regularMarketPrice)
    result.marketCap = firstNumber(
      summary?.price?.marketCap,
      summary?.summaryDetail?.marketCap,
      summary?.summaryDetail?.totalAssets,
    )
  } catch {
    /* Market cap simply stays null. */
  }
  return result
}

/**
 * CoinGecko spot quotes stay primary; missing spot prices prefer labelled perps.
 * Stock metadata and volume remain separate from mapped perpetual prices.
 */
async function fetchQuotes(force: boolean, perpetuals: Promise<HyperliquidPayload | null>): Promise<Record<string, CryptoQuote>> {
  const live = await fetchCoinGeckoQuotes().catch(() => ({}) as Record<string, RawQuote>)

  const symbols = [...CRYPTO_TICKERS, ...PROXY_TICKERS]
  const fallbacks = await Promise.all(symbols.map(async (entry): Promise<RawQuote> => {
    const preferred = live[entry.label]
    // A CoinGecko outage must not fan out into two Yahoo requests per coin.
    // Venue volume is labelled; perpetuals never supply a global market cap.
    if (entry.symbol.endsWith('-USD') && preferred?.price == null) {
      const market = (await perpetuals)?.markets.find(row => row.symbol === entry.label)
      if (market) return { price: market.markPrice, changePct: market.changePct, volume: market.volume24hUsd,
        marketCap: preferred?.marketCap ?? null, source: 'Hyperliquid crypto perp',
        volumeSource: 'Hyperliquid perpetual 24h volume (USD)', marketCapSource: preferred?.source }
    }
    return preferred && [preferred.price, preferred.changePct, preferred.volume, preferred.marketCap].every(value => value !== null)
      ? Promise.resolve(preferred)
      : fetchYahooQuote(entry.symbol, force)
  }))

  const rows: Record<string, CryptoQuote> = {}
  symbols.forEach((entry, index) => {
    const fallback = fallbacks[index]
    const preferred = live[entry.label]
    rows[entry.label] = {
      label: entry.label,
      symbol: entry.symbol,
      name: entry.name,
      price: firstNumber(preferred?.price, fallback.price),
      changePct: fallback.source === 'Hyperliquid crypto perp' ? fallback.changePct : firstNumber(preferred?.changePct, fallback.changePct),
      volume: firstNumber(preferred?.volume, fallback.volume),
      marketCap: firstNumber(preferred?.marketCap, fallback.marketCap),
      source: preferred?.price != null ? preferred.source : fallback.source || YAHOO_SOURCE,
      volumeSource: preferred?.volume != null ? preferred.source : fallback.volumeSource,
      marketCapSource: preferred?.marketCap != null ? preferred.source : fallback.marketCapSource,
      metadataAsOf: fallback.metadataAsOf,
    }
  })
  return rows
}

/* ------------------------------------------------------------------ stage 3 */

/** `_fetch_global_market`. */
async function fetchGlobalMarket(): Promise<CryptoGlobalMarket> {
  const body = (await getJson(GLOBAL_URL)) as { data?: Record<string, unknown> }
  const data = body?.data ?? {}
  const totalCap = data.total_market_cap as Record<string, unknown> | undefined
  const totalVolume = data.total_volume as Record<string, unknown> | undefined
  const percentages = data.market_cap_percentage as Record<string, unknown> | undefined
  return {
    marketCap: firstNumber(totalCap?.usd),
    volume24h: firstNumber(totalVolume?.usd),
    changePct: firstNumber(data.market_cap_change_percentage_24h_usd),
    btcDominance: firstNumber(percentages?.btc),
  }
}

/**
 * `_fetch_crypto_fear_greed`. This is alternative.me's crypto index and has nothing to do
 * with the CNN equity index the Pre-Market page reads — different scale, different source,
 * different cadence, and the two panels routinely disagree.
 */
async function fetchCryptoFearGreed(): Promise<CryptoFearGreed> {
  const body = (await getJson(FEAR_GREED_URL)) as { data?: Array<Record<string, unknown>> }
  const latest = body?.data?.[0] ?? {}
  return {
    value: firstNumber(latest.value),
    classification: String(latest.value_classification ?? '') || '--',
    timestamp: fearGreedStamp(latest.timestamp),
    source: CRYPTO_FEAR_GREED_SOURCE,
  }
}

/* ------------------------------------------------------------------ stage 4 */

/**
 * `_fetch_news` -> `fetch_keyless_crypto_news`: the four crypto-native RSS feeds, merged,
 * deduped and ranked by score then recency, capped at ten.
 *
 * This reuses the News page's own feed loader, so the crypto feeds get the same browser
 * user-agent retry, the same HTML-interstitial guard and the same 24h-capped stale
 * fallback. Like the News page's Market lane, and for the same reason, it stays outside
 * `paced()`.
 */
async function fetchCryptoNews(force: boolean): Promise<{ articles: NewsArticle[]; errors: EnvelopeError[] }> {
  const universe = normalizeTickerUniverse(CRYPTO_NEWS_FOCUS_TICKERS)
  const outcomes = await Promise.all(
    CRYPTO_NEWS_FEEDS.map((feed) => loadFeed(feed, universe, force)),
  )

  const merged: NewsArticle[] = []
  const errors: EnvelopeError[] = []
  for (const outcome of outcomes) {
    merged.push(...outcome.articles)
    if (outcome.status !== 'fresh') {
      errors.push(err(outcome.feed.source, outcome.reason, 'cryptoNews', 'Crypto News Feed'))
    }
  }

  const ranked = dedupeArticles(merged)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.publishedAt - a.publishedAt)
    .slice(0, CRYPTO_NEWS_CANDIDATE_LIMIT)

  return { articles: ranked.slice(0, CRYPTO_NEWS_LIMIT), errors }
}

/* -------------------------------------------------------------- the payload */

export interface CryptoFetchResult {
  payload: CryptoPayload
  errors: EnvelopeError[]
}

/** The block labels the page's `warningOf` looks each stage's failure up by. */
const STAGE_LABELS: Record<CryptoStage, string> = {
  heatmap: 'Top 30 Cryptocurrencies',
  quotes: 'Watchlist / Movers',
  market: 'Market Status',
  news: 'Crypto News Feed',
  hyperliquid: 'Hyperliquid Perpetuals',
}

async function fetchCrypto(force: boolean): Promise<CryptoFetchResult> {
  const fetchedAt = localIsoSeconds()
  const progress: Record<CryptoStage, CryptoStageStatus> = {
    heatmap: 'unavailable',
    quotes: 'unavailable',
    market: 'unavailable',
    news: 'unavailable',
    hyperliquid: 'unavailable',
  }
  const errors: EnvelopeError[] = []

  const stageError = (stage: CryptoStage, reason: string) => {
    errors.push(err(CRYPTO_SOURCE, reason, 'crypto', STAGE_LABELS[stage]))
  }

  const perpetuals = hyperliquidClient.getMarkets().catch((error) => {
    stageError('hyperliquid', describeError(error))
    return null
  })
  const [tiles, quotes, market, news, hyperliquid] = await Promise.all([
    fetchTopTiles().catch((error) => {
      stageError('heatmap', describeError(error))
      return [] as CryptoHeatmapTile[]
    }),
    fetchQuotes(force, perpetuals).catch((error) => {
      stageError('quotes', describeError(error))
      return {} as Record<string, CryptoQuote>
    }),
    // Keep independent failures visible while preserving the healthy metric.
    Promise.all([
      fetchGlobalMarket().catch((error) => {
        stageError('market', `CoinGecko global: ${describeError(error)}`)
        return null
      }),
      fetchCryptoFearGreed().catch((error) => {
        stageError('market', `Fear & Greed: ${describeError(error)}`)
        return null
      }),
    ]),
    fetchCryptoNews(force).catch((error) => {
      stageError('news', describeError(error))
      return { articles: [] as NewsArticle[], errors: [] as EnvelopeError[] }
    }),
    perpetuals,
  ])

  let heatmap = buildHeatmapPayload(tiles, fetchedAt)
  const missingQuotes = [...CRYPTO_TICKERS, ...PROXY_TICKERS].filter(entry => quotes[entry.label]?.price == null)
  if (!missingQuotes.length) progress.quotes = 'loaded'
  else stageError('quotes', `Quotes unavailable: ${missingQuotes.map(entry => entry.label).join(', ')}`)

  // Last resort: display available watchlist coins, but retain incomplete coverage.
  if (!heatmap.tiles.length) {
    const fallback = buildHeatmapPayload(buildHeatmapFromQuotes(quotes), fetchedAt)
    if (fallback.tiles.length) {
      heatmap = fallback
    }
  }
  if (heatmap.tiles.length === CRYPTO_HEATMAP_LIMIT) progress.heatmap = 'loaded'
  else stageError('heatmap', `Only ${heatmap.tiles.length}/${CRYPTO_HEATMAP_LIMIT} cryptocurrencies available.`)

  const [globalMarket, fearGreed] = market
  if (globalMarket?.marketCap != null && globalMarket.volume24h != null && fearGreed?.value != null) progress.market = 'loaded'
  else stageError('market', 'Global market or Fear & Greed data is incomplete.')

  if (news.articles.length) progress.news = 'loaded'
  else if (!errors.some((entry) => entry.symbol === STAGE_LABELS.news)) {
    stageError('news', 'No crypto news feed articles returned.')
  }
  errors.push(...news.errors)
  if (hyperliquid) progress.hyperliquid = 'loaded'

  return {
    payload: {
      fetchedAt,
      heatmap,
      quotes,
      global: globalMarket,
      fearGreed,
      news: news.articles,
      hyperliquid,
      progress,
    },
    errors,
  }
}

/**
 * One cached load of the whole page.
 *
 * Automatic refreshes and tab revisits respect the one-minute cache to conserve
 * provider requests. Manual Refresh bypasses it with force.
 */
export function getCrypto(force = false): Promise<CryptoFetchResult> {
  return cache
    .resolve('crypto:page:shared-hyperliquid-v2', TTL.crypto, () => fetchCrypto(force), { force })
    .then((result) => {
      const live = hyperliquidEquities.getCryptoMarkets()
      return live ? { ...result.value, payload: markCryptoPerpetuals(result.value.payload, live) } : result.value
    })
}

/** Ranking helper the probe asserts against; the page renders `heatmap.tiles` in order. */
export function sortTilesByRank(tiles: CryptoHeatmapTile[]): CryptoHeatmapTile[] {
  return [...tiles].sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank))
}
