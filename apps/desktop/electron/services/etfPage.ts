/**
 * Independent ETF snapshots: a daily non-Yahoo directory, daily issuer/public holdings,
 * and an explicitly requested basket comparison. No timers or universe quote sweeps.
 * Disk-backed caches, refresh cooldowns and persistent failure backoff protect providers.
 */

import type {
  EnvelopeError,
  EtfArbitragePayload,
  EtfAumPayload,
  EtfHoldingRow,
  EtfHoldingsPayload,
} from '../shared/contract.js'
import { err } from '../shared/envelope.js'
import { buildArbitrage, type EtfQuote } from '../shared/etf.js'
import { FRESHNESS } from '../shared/freshness.js'
import { changesFromCloses } from '../shared/heatmap.js'
import { getEtfHoldings } from './etf/holdings.js'
import { getEtfDirectory } from './etf/directory.js'
import { resolveEtfSnapshot } from './etf/snapshot.js'
import { fetchSparkCloses, yahooSymbol } from './yahoo/spark.js'

export const ETF_HOLDINGS_SOURCE = 'ETF issuer / public holdings'
export const ETF_ARBITRAGE_SOURCE = 'Yahoo Finance ETF basket quotes'
export const ETF_AUM_SOURCE = 'Stock Analysis ETF directory'

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
      fetchedAt: result.fetchedAt ?? Date.now(),
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
const ARBITRAGE_TTL_MS = FRESHNESS.etfArbitrage

async function fetchArbitrage(symbol: string): Promise<EtfArbitrageFetchResult> {
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

  // Reuse the shared constituent cache, including on manual refresh. A refresh must
  // not invalidate hundreds of still-fresh histories used by other pages.
  const { series, missing } = await fetchSparkCloses([...byYahooSymbol.keys()], '1y')
  const quotes = new Map<string, EtfQuote>()
  for (const [key, entry] of Object.entries(series)) {
    const quote: EtfQuote = {
      price: entry.closes[entry.closes.length - 1] ?? null,
      changes: changesFromCloses(entry.dates, entry.closes),
    }
    for (const original of byYahooSymbol.get(key) ?? []) quotes.set(original, quote)
  }

  const payload = buildArbitrage(symbol, holdings, quotes)
  if (!payload.quoteCoverage || payload.etfPrice === null) throw new Error('Yahoo basket quotes are unavailable. Last good analysis is retained; retry in five minutes.')
  const errors: EnvelopeError[] = []
  if (source.isPartial) errors.push(err(source.issuer, source.coverageNote, 'etf_arbitrage', symbol))
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
  return resolveEtfSnapshot(`etf-basket:v2:${symbol}`, ARBITRAGE_TTL_MS,
    () => fetchArbitrage(symbol), { force, minimumAgeMs: ARBITRAGE_TTL_MS })
}

/* ------------------------------------------------------------------- AUM */

/** Kept under the existing IPC name; discovery no longer sweeps Yahoo's screener. */
export function getEtfAum(force = false): Promise<EtfAumPayload> {
  return getEtfDirectory(force)
}
