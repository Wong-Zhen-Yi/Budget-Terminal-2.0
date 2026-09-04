/**
 * The Heatmap page's data, ported from `EtfHeatmapWorker` (`workers/etf_heatmap.py`).
 *
 * Three steps, in order: the index ETF's holdings from the issuer's own file, GICS
 * sectors for whatever the file did not classify, and a year of daily closes for every
 * constituent, from which the seven interval returns and the per-interval summaries are
 * computed.
 *
 * Two hosts are not Yahoo — the issuer and Wikipedia — and both deliberately stay
 * outside `paced()` on the `services/fearGreed.ts` precedent. The closes are Yahoo and
 * do go through the gate, batched twenty at a time by `yahoo/spark.ts`.
 *
 * The reference's per-ticker recovery pass after a batch miss (`_fetch_quote_fallback`,
 * bounded by `_fallback_budget`) has no equivalent here and does not need one: it exists
 * because `yf.download` either answers for the whole batch or dies, so a single failure
 * blanked five hundred tiles. Spark's chunking already contains a failure to its own
 * twenty symbols, and those land in `missing` as no-data tiles.
 */

import type {
  EnvelopeError,
  HeatmapEtfKey,
  HeatmapHolding,
  HeatmapPayload,
} from '../shared/contract.js'
import { err } from '../shared/envelope.js'
import {
  buildIntervalSummaries,
  changesFromCloses,
  etfTicker,
  isUsableHoldingSymbol,
  normalizeSector,
  positiveWeight,
} from '../shared/heatmap.js'
import { cache } from './cache.js'
import { getEtfHoldings } from './etf/holdings.js'
import { getSp500SectorMap, resolveSector } from './etf/sectorMap.js'
import { fetchSparkCloses, yahooSymbol } from './yahoo/spark.js'

export const HEATMAP_SOURCE = 'etf heatmap'

/** `_P17_REFRESH_TTL_SECONDS = 120`, and `_QUOTE_CACHE_TTL_SECONDS` is the same 120. */
export const HEATMAP_TTL_MS = 120_000

export interface HeatmapFetchResult {
  payload: HeatmapPayload
  errors: EnvelopeError[]
}

export function emptyHeatmapPayload(etf: HeatmapEtfKey): HeatmapPayload {
  return {
    etf,
    ticker: etfTicker(etf),
    fundName: '',
    issuer: '',
    asOfDate: '',
    sourceUrl: '',
    holdings: [],
    holdingsLoaded: 0,
    quoteCoverage: 0,
    weightedDayMove: null,
    strongest: null,
    weakest: null,
    intervalSummaries: buildIntervalSummaries([]),
    fetchedAt: Date.now(),
  }
}

async function fetchHeatmap(etf: HeatmapEtfKey, force: boolean): Promise<HeatmapFetchResult> {
  const ticker = etfTicker(etf)
  const errors: EnvelopeError[] = []

  const source = await getEtfHoldings(ticker, force)

  // `fetch()`: drop the placeholder rows first, then anything without a positive weight.
  // Both filters run before the quote pull so no request is spent on a dead symbol.
  const sectorMap = await getSp500SectorMap()
  const seeds = source.holdings.flatMap((holding) => {
    const symbol = holding.symbol.trim().toUpperCase()
    if (!isUsableHoldingSymbol(symbol)) return []
    const weight = positiveWeight(holding.weight)
    if (weight === null) return []
    return [
      {
        symbol,
        name: holding.name,
        sector:
          resolveSector(symbol, normalizeSector(holding.sector), sectorMap) || 'Unclassified',
        weight,
      },
    ]
  })

  if (!seeds.length) {
    const payload = { ...emptyHeatmapPayload(etf), issuer: source.issuer, sourceUrl: source.sourceUrl }
    errors.push(
      err(
        source.sourceUrl || 'ETF holdings source',
        `No holdings were loaded for ${ticker}.`,
        'etf_holdings',
        ticker,
      ),
    )
    return { payload, errors }
  }

  // Yahoo spells a share class with a hyphen where an issuer file uses a dot, and two
  // issuer rows can map onto the same Yahoo symbol, so keep the mapping both ways.
  const byYahooSymbol = new Map<string, string[]>()
  for (const seed of seeds) {
    const key = yahooSymbol(seed.symbol)
    byYahooSymbol.set(key, [...(byYahooSymbol.get(key) ?? []), seed.symbol])
  }

  const { series, missing } = await fetchSparkCloses([...byYahooSymbol.keys()], '1y', force)
  const quotes = new Map<string, { price: number; changes: HeatmapHolding['changes'] }>()
  for (const [key, entry] of Object.entries(series)) {
    const changes = changesFromCloses(entry.dates, entry.closes)
    const price = entry.closes[entry.closes.length - 1]
    for (const symbol of byYahooSymbol.get(key) ?? []) quotes.set(symbol, { price, changes })
  }

  const holdings: HeatmapHolding[] = seeds.map((seed) => {
    const quote = quotes.get(seed.symbol)
    return {
      symbol: seed.symbol,
      name: seed.name,
      sector: seed.sector,
      weight: seed.weight,
      price: quote?.price ?? null,
      changes: quote?.changes ?? {},
    }
  })

  const intervalSummaries = buildIntervalSummaries(holdings)
  const live = intervalSummaries.live

  if (missing.length) {
    errors.push(
      err(
        'Yahoo Finance',
        `${missing.length} holding quote(s) were unavailable.`,
        'etf_heatmap_quotes',
        ticker,
      ),
    )
  }
  if (source.isPartial) {
    errors.push(
      err(
        source.issuer,
        `${source.issuer} returns a top-holdings list, not the full ${ticker} holdings list.`,
        'etf_holdings',
        ticker,
      ),
    )
  }

  return {
    payload: {
      etf,
      ticker,
      fundName: source.fundName,
      issuer: source.issuer,
      asOfDate: source.asOfDate,
      sourceUrl: source.sourceUrl,
      holdings,
      holdingsLoaded: holdings.length,
      quoteCoverage: live.quoteCoverage,
      weightedDayMove: live.weightedMove,
      strongest: live.strongest,
      weakest: live.weakest,
      intervalSummaries,
      fetchedAt: Date.now(),
    },
    errors,
  }
}

/**
 * One cached load per index.
 *
 * Keyed by ETF, so the three buttons hold three independent payloads the way
 * `_p17_results` does. The TTL is the reference's own 120 seconds; there is no refresh
 * timer here either — `init_page17` creates none, and Refresh and F5 are the only things
 * that repeat a load.
 */
export function getHeatmap(etf: HeatmapEtfKey, force = false): Promise<HeatmapFetchResult> {
  return cache
    .resolve(`heatmap:${etf}`, HEATMAP_TTL_MS, () => fetchHeatmap(etf, force), { force })
    .then((result) => result.value)
}
