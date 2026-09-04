/**
 * The ETF page's three loads, ported from `mixins/etf_analyser.py` (page13).
 *
 * The reference runs each of them on its own thread and posts the result back to the UI:
 * `_p13_load_etf` for the holdings, `_p13_request_arbitrage_refresh` for the basket
 * comparison and `_p13_fetch_aum_universe` for the left rail. All three are independent
 * here too — a failed AUM screen leaves the holdings on screen and vice versa, which is
 * what the page's two separate status lines already assume.
 *
 * Nothing on this page has a refresh timer. `init_page13` creates none: the only load it
 * fires on build is the AUM rail, and everything else is a button.
 */

import type {
  EnvelopeError,
  EtfArbitragePayload,
  EtfAumPayload,
  EtfHoldingRow,
  EtfHoldingsPayload,
} from '../shared/contract.js'
import { err } from '../shared/envelope.js'
import { AUM_PAGE_SIZE, buildArbitrage, type EtfQuote } from '../shared/etf.js'
import { changesFromCloses } from '../shared/heatmap.js'
import { cache } from './cache.js'
import { getEtfHoldings } from './etf/holdings.js'
import { etfAumScreen } from './yahoo/screener.js'
import { fetchSparkCloses, yahooSymbol } from './yahoo/spark.js'

export const ETF_HOLDINGS_SOURCE = 'etf holdings'
export const ETF_ARBITRAGE_SOURCE = 'etf arbitrage'
export const ETF_AUM_SOURCE = 'etf aum screener'

/* -------------------------------------------------------------- holdings */

/** What a failed load renders: the ticker that was asked for, and nothing else. */
export function emptyEtfHoldingsPayload(ticker: string): EtfHoldingsPayload {
  return {
    ticker,
    fundName: '',
    issuer: '',
    asOfDate: '',
    expenseRatio: '--',
    netAssets: '--',
    holdings: [],
    sectorBreakdown: [],
    sourceUrl: '',
    isPartial: false,
    coverageNote: '',
    fetchedAt: Date.now(),
  }
}

export function emptyEtfArbitragePayload(ticker: string): EtfArbitragePayload {
  return {
    ticker,
    generatedAt: Date.now(),
    etfPrice: null,
    etfMovePct: null,
    basketMovePct: null,
    gapPctPoints: null,
    gapBps: null,
    signal: '--',
    quoteCoverage: 0,
    totalHoldings: 0,
    quotedWeight: 0,
    loadedWeight: 0,
    rows: [],
  }
}

export interface EtfHoldingsFetchResult {
  payload: EtfHoldingsPayload
  errors: EnvelopeError[]
}

export async function getEtfHoldingsPage(
  ticker: string,
  force = false,
): Promise<EtfHoldingsFetchResult> {
  const symbol = ticker.trim().toUpperCase()
  const result = await getEtfHoldings(symbol, force)
  const errors: EnvelopeError[] = []
  if (result.isPartial) {
    errors.push(
      err(
        result.issuer,
        result.coverageNote ||
          `${result.issuer} returns a top-holdings list, not the full ${symbol} holdings list.`,
        'etf_holdings',
        symbol,
      ),
    )
  }
  return {
    payload: {
      ticker: result.ticker,
      fundName: result.fundName,
      issuer: result.issuer,
      asOfDate: result.asOfDate,
      expenseRatio: result.expenseRatio,
      netAssets: result.netAssets,
      holdings: result.holdings.map((holding) => ({
        symbol: holding.symbol,
        name: holding.name,
        weight: holding.weight,
        sector: holding.sector,
      })),
      sectorBreakdown: result.sectorBreakdown,
      sourceUrl: result.sourceUrl,
      isPartial: result.isPartial,
      coverageNote: result.coverageNote,
      fetchedAt: Date.now(),
    },
    errors,
  }
}

/* ------------------------------------------------------------- arbitrage */

/**
 * `EtfArbitrageDataService.fetch`, whose quote pull is `EtfHeatmapWorker._fetch_quotes`.
 *
 * The quotes come from `yahoo/spark.ts` — the same batched endpoint the Heatmap page
 * uses, twenty symbols per request — because a five-hundred-name basket one `chart()`
 * call at a time would cost five times what Trading Volumes does. The ETF itself is the
 * first symbol in the list, as the reference puts it, so its move and the basket's come
 * out of one batch and one moment.
 */
export interface EtfArbitrageFetchResult {
  payload: EtfArbitragePayload
  errors: EnvelopeError[]
}

/** `_QUOTE_CACHE_TTL_SECONDS`, shared with the Heatmap page's own quote window. */
const ARBITRAGE_TTL_MS = 120_000

async function fetchArbitrage(symbol: string, force: boolean): Promise<EtfArbitrageFetchResult> {
  // The holdings are already cached by ticker, so refreshing arbitrage does not re-fetch
  // the issuer file — exactly as the reference hands `_p13_last_result` to the service.
  const source = await getEtfHoldings(symbol)
  const holdings: EtfHoldingRow[] = source.holdings.map((holding) => ({
    symbol: holding.symbol,
    name: holding.name,
    weight: holding.weight,
    sector: holding.sector,
  }))

  const symbols = [symbol, ...holdings.map((holding) => holding.symbol.trim().toUpperCase())]
  const byYahooSymbol = new Map<string, string[]>()
  for (const entry of symbols) {
    if (!entry) continue
    const key = yahooSymbol(entry)
    byYahooSymbol.set(key, [...(byYahooSymbol.get(key) ?? []), entry])
  }

  const { series, missing } = await fetchSparkCloses([...byYahooSymbol.keys()], '1y', force)
  const quotes = new Map<string, EtfQuote>()
  for (const [key, entry] of Object.entries(series)) {
    const quote: EtfQuote = {
      price: entry.closes[entry.closes.length - 1] ?? null,
      changes: changesFromCloses(entry.dates, entry.closes),
    }
    for (const original of byYahooSymbol.get(key) ?? []) quotes.set(original, quote)
  }

  const payload = buildArbitrage(symbol, holdings, quotes)
  const errors: EnvelopeError[] = []
  if (missing.length) {
    errors.push(
      err('Yahoo Finance', `${missing.length} basket quote(s) were unavailable.`, 'etf_arbitrage', symbol),
    )
  }
  return { payload, errors }
}

export function getEtfArbitrage(ticker: string, force = false): Promise<EtfArbitrageFetchResult> {
  const symbol = ticker.trim().toUpperCase()
  if (!symbol) return Promise.reject(new Error('Load an ETF before refreshing arbitrage.'))
  return cache
    .resolve(`etf-arbitrage:${symbol}`, ARBITRAGE_TTL_MS, () => fetchArbitrage(symbol, force), { force })
    .then((result) => result.value)
}

/* ------------------------------------------------------------------- AUM */

/**
 * `_p13_fetch_aum_universe`: page the whole US ETF universe, ranked by net assets.
 *
 * The loop is the reference's, including its two independent stop conditions — Yahoo's
 * own `total` once the offset passes it, and a short page. `total` is only trusted when
 * it is positive: an absent count would otherwise end the sweep after the first page.
 *
 * There is no progress signal here, the same wall the Crypto, Economic and Roll ports
 * hit: an IPC request/response carries no intermediate frames, so the page's rail shows
 * a busy line instead of the reference's running `n/total loaded` counter.
 */
const AUM_TTL_MS = 6 * 60 * 60 * 1000

async function fetchAum(): Promise<EtfAumPayload> {
  const rows = new Map<string, number>()
  let total = 0
  let offset = 0

  for (;;) {
    const page = await etfAumScreen(offset, AUM_PAGE_SIZE)
    if (page.total > 0) total = page.total
    if (!page.quotes.length) break
    for (const quote of page.quotes) {
      const ticker = String(quote.symbol ?? '').trim().toUpperCase()
      const raw = quote.netAssets ?? quote.fundnetassets
      const assets = Number(raw)
      if (ticker && Number.isFinite(assets) && assets > 0) rows.set(ticker, assets)
    }
    offset += page.quotes.length
    if (total && offset >= total) break
    if (page.quotes.length < AUM_PAGE_SIZE) break
  }

  const totalCount = Math.max(0, total || rows.size)
  return {
    rows: [...rows]
      .map(([ticker, netAssets]) => ({ ticker, netAssets }))
      .sort((a, b) => b.netAssets - a.netAssets),
    totalCount,
    missingCount: Math.max(0, totalCount - rows.size),
    fetchedAt: Date.now(),
  }
}

export function getEtfAum(force = false): Promise<EtfAumPayload> {
  return cache
    .resolveWithStaleFallback('etf-aum', AUM_TTL_MS, fetchAum, { force })
    .then((result) => result.value)
}
