/**
 * The Heatmap page's data, ported from `EtfHeatmapWorker` (`workers/etf_heatmap.py`).
 *
 * Three steps, in order: the index ETF's holdings from the issuer's own file, GICS
 * sectors for whatever the file did not classify, and a year of daily closes for every
 * constituent, from which the seven interval returns and the per-interval summaries are
 * computed.
 *
 * Prices come exclusively from Yahoo's batched daily history endpoint. Holdings and
 * weights remain issuer-sourced; missing prices stay visible as no-data tiles.
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
import { getIssuerEtfHoldings } from './etf/holdings.js'
import { getSp500SectorMap, resolveSector } from './etf/sectorMap.js'
import { fetchSparkCloses, yahooSymbol } from './yahoo/spark.js'

export const HEATMAP_SOURCE = 'Issuer holdings + Yahoo Finance'
const PRICE_SOURCE = 'Yahoo Finance'

/** Recheck page snapshots after two minutes, matching the shared Yahoo history cache. */
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
    priceSource: PRICE_SOURCE,
    priceAsOfDate: '',
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

const dependencies = {
  holdings: getIssuerEtfHoldings,
  sectors: getSp500SectorMap,
  prices: fetchSparkCloses,
}

export async function fetchHeatmap(etf: HeatmapEtfKey, force: boolean,
  deps = dependencies): Promise<HeatmapFetchResult> {
  const ticker = etfTicker(etf)
  const errors: EnvelopeError[] = []

  const source = await deps.holdings(ticker, force)

  // `fetch()`: drop the placeholder rows first, then anything without a positive weight.
  // Both filters run before the quote pull so no request is spent on a dead symbol.
  const sectorMap = await deps.sectors()
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

  // Yahoo uses hyphens for share classes; preserve issuer tile symbols.
  const byPriceSymbol = new Map<string, string[]>()
  for (const seed of seeds) {
    const key = yahooSymbol(seed.symbol)
    byPriceSymbol.set(key, [...(byPriceSymbol.get(key) ?? []), seed.symbol])
  }

  const { series } = await deps.prices([...byPriceSymbol.keys()], '1y', force)
  const quotes = new Map<string, { price: number; changes: HeatmapHolding['changes'] }>()
  const priceDates: string[] = []
  for (const [key, entry] of Object.entries(series)) {
    const price = entry.closes.at(-1)
    if (!byPriceSymbol.has(key) || price === undefined || !Number.isFinite(price) || price <= 0) continue
    const changes = changesFromCloses(entry.dates, entry.closes)
    const latestDate = entry.dates.at(-1)
    if (latestDate) priceDates.push(latestDate)
    for (const symbol of byPriceSymbol.get(key) ?? []) quotes.set(symbol, { price, changes })
  }
  const priceAsOfDate = priceDates.sort()[0] ?? ''
  const missing = seeds.filter(seed => !quotes.has(seed.symbol)).map(seed => seed.symbol)

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
        PRICE_SOURCE,
        `${missing.length} holding(s) have no usable daily history for ${priceAsOfDate || 'the requested period'}: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ` and ${missing.length - 12} more` : ''}.`,
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
      priceSource: PRICE_SOURCE,
      priceAsOfDate,
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
    .resolveWithStaleFallback(`heatmap:yahoo-v1:${etf}`, HEATMAP_TTL_MS, () => fetchHeatmap(etf, force), { force })
    .then((result) => result.value)
}
