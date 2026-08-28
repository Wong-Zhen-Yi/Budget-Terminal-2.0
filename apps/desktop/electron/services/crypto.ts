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

/**
 * The Crypto page's data, ported from `CryptoMarketWorker` (`workers/crypto.py`).
 *
 * Four independent stages, exactly as the reference runs them — the Top 30 heatmap, the
 * eleven quotes, the global/Fear & Greed strip and the crypto-native news feed. Here they
 * run concurrently rather than in sequence: the reference emits a `partial` signal after
 * each stage so the Qt page fills in progressively, and an IPC request/response cannot,
 * so the payload carries a `progress` map instead and the page prints the same
 * "N/4 stages" line off it.
 *
 * **CoinGecko and alternative.me deliberately stay outside `paced()`**, on the
 * `services/fearGreed.ts` precedent: the rate gate models Yahoo's 429 behaviour and
 * halves its own budget on one, so letting a CoinGecko hiccup throttle the dashboard
 * would be strictly worse than letting the Crypto page fail alone. The six Yahoo proxy
 * quotes underneath are Yahoo, and they do go through the gate.
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

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
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
async function fetchTopTiles(): Promise<CryptoHeatmapTile[]> {
  const body = await getJson(marketsUrl({ per_page: String(CRYPTO_HEATMAP_LIMIT) }))
  const rows = Array.isArray(body) ? (body as CoinGeckoRow[]) : []

  const tiles: CryptoHeatmapTile[] = []
  rows.slice(0, CRYPTO_HEATMAP_LIMIT).forEach((row, index) => {
    if (!row || typeof row !== 'object') return
    const symbol = String(row.symbol ?? '').trim().toUpperCase()
    if (!symbol) return
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
    if (!quote) return
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

/**
 * `_fetch_quote`: five daily bars for price, the 24h move and volume, plus the summary
 * for market cap.
 *
 * The reference reads market cap off `fast_info`, which yfinance derives from shares
 * outstanding. `quoteSummary` is the equivalent here, and `totalAssets` is read as a
 * fallback so the proxy table's "AUM / Mkt Cap" column has a number for the three spot
 * ETFs rather than the dash the reference leaves there — the one deliberate departure in
 * this file.
 *
 * A failure is not thrown: the reference logs and returns an all-null row, which is what
 * makes one dead proxy ticker a dash in its cell instead of a dead stage.
 */
async function fetchYahooQuote(symbol: string): Promise<RawQuote> {
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
 * `_fetch_quotes`: the five coins prefer CoinGecko and fall back to Yahoo **field by
 * field** — a coin whose CoinGecko row carried no market cap still shows Yahoo's — then
 * the six equity proxies, which are Yahoo only.
 */
async function fetchQuotes(): Promise<Record<string, CryptoQuote>> {
  // The reference swallows a CoinGecko failure here and carries on with Yahoo alone.
  const live = await fetchCoinGeckoQuotes().catch(() => ({}) as Record<string, RawQuote>)

  const symbols = [...CRYPTO_TICKERS, ...PROXY_TICKERS]
  const fallbacks = await Promise.all(symbols.map((entry) => fetchYahooQuote(entry.symbol)))

  const rows: Record<string, CryptoQuote> = {}
  symbols.forEach((entry, index) => {
    const fallback = fallbacks[index]
    const preferred = live[entry.label]
    rows[entry.label] = {
      label: entry.label,
      symbol: entry.symbol,
      name: entry.name,
      price: firstNumber(preferred?.price, fallback.price),
      changePct: firstNumber(preferred?.changePct, fallback.changePct),
      volume: firstNumber(preferred?.volume, fallback.volume),
      marketCap: firstNumber(preferred?.marketCap, fallback.marketCap),
      source: preferred?.source || fallback.source || YAHOO_SOURCE,
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
}

async function fetchCrypto(force: boolean): Promise<CryptoFetchResult> {
  const fetchedAt = localIsoSeconds()
  const progress: Record<CryptoStage, CryptoStageStatus> = {
    heatmap: 'unavailable',
    quotes: 'unavailable',
    market: 'unavailable',
    news: 'unavailable',
  }
  const errors: EnvelopeError[] = []

  const stageError = (stage: CryptoStage, reason: string) => {
    errors.push(err(CRYPTO_SOURCE, reason, 'crypto', STAGE_LABELS[stage]))
  }

  const [tiles, quotes, market, news] = await Promise.all([
    fetchTopTiles().catch((error) => {
      stageError('heatmap', describeError(error))
      return [] as CryptoHeatmapTile[]
    }),
    fetchQuotes().catch((error) => {
      stageError('quotes', describeError(error))
      return {} as Record<string, CryptoQuote>
    }),
    // `market` is one stage across two calls, as `run()` has it: either one answering is
    // enough to call the stage loaded.
    Promise.all([
      fetchGlobalMarket().catch(() => null),
      fetchCryptoFearGreed().catch(() => null),
    ]),
    fetchCryptoNews(force).catch((error) => {
      stageError('news', describeError(error))
      return { articles: [] as NewsArticle[], errors: [] as EnvelopeError[] }
    }),
  ])

  let heatmap = buildHeatmapPayload(tiles, fetchedAt)
  if (heatmap.tiles.length) progress.heatmap = 'loaded'
  if (Object.keys(quotes).length) progress.quotes = 'loaded'

  // `run()`'s quote stage: a live quote set rescues a failed heatmap with five tiles.
  if (progress.heatmap !== 'loaded' && progress.quotes === 'loaded') {
    const fallback = buildHeatmapPayload(buildHeatmapFromQuotes(quotes), fetchedAt)
    if (fallback.tiles.length) {
      heatmap = fallback
      progress.heatmap = 'loaded'
    }
  }

  const [globalMarket, fearGreed] = market
  if (globalMarket || fearGreed) progress.market = 'loaded'
  else stageError('market', 'CoinGecko global and Fear & Greed both failed.')

  if (news.articles.length) progress.news = 'loaded'
  else if (!errors.some((entry) => entry.symbol === STAGE_LABELS.news)) {
    stageError('news', 'No crypto news feed articles returned.')
  }
  errors.push(...news.errors)

  return {
    payload: {
      fetchedAt,
      heatmap,
      quotes,
      global: globalMarket,
      fearGreed,
      news: news.articles,
      progress,
    },
    errors,
  }
}

/**
 * One cached load of the whole page.
 *
 * The reference has no refresh timer on this page either — `init_page19` fires once and
 * Refresh is the only thing that repeats it — so the TTL exists only to stop a tab
 * revisit from spending CoinGecko's rate budget again.
 */
export function getCrypto(force = false): Promise<CryptoFetchResult> {
  return cache
    .resolve('crypto:page', TTL.crypto, () => fetchCrypto(force), { force })
    .then((result) => result.value)
}

/** Ranking helper the probe asserts against; the page renders `heatmap.tiles` in order. */
export function sortTilesByRank(tiles: CryptoHeatmapTile[]): CryptoHeatmapTile[] {
  return [...tiles].sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank))
}
