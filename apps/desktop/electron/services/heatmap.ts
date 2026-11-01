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
import { cache, TTL } from './cache.js'
import { getIndexSectors } from './sectors.js'
import { getIssuerEtfHoldings } from './etf/holdings.js'
import { getSp500SectorMap, resolveSector } from './etf/sectorMap.js'
import { fetchSparkCloses, yahooSymbol, type SparkSeries } from './yahoo/spark.js'

export const HEATMAP_SOURCE = 'Issuer holdings + Yahoo Finance'
const PRICE_SOURCE = 'Yahoo Finance'

/** Keep page snapshots aligned with the 30-minute background refresh schedule. */
export const HEATMAP_TTL_MS = TTL.heatmap

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
  classifications: getIndexSectors,
}

export async function fetchHeatmap(etf: HeatmapEtfKey, force: boolean,
  deps: {
    holdings: typeof getIssuerEtfHoldings
    sectors: typeof getSp500SectorMap
    prices: typeof fetchSparkCloses
    classifications?: typeof getIndexSectors
  } = dependencies,
  onProgress?: (payload: HeatmapPayload) => void): Promise<HeatmapFetchResult> {
  const ticker = etfTicker(etf)
  const errors: EnvelopeError[] = []

  const source = await deps.holdings(ticker, force)

  // `fetch()`: drop the placeholder rows first, then anything without a positive weight.
  // Both filters run before the quote pull so no request is spent on a dead symbol.
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
          normalizeSector(holding.sector) || 'Unclassified',
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

  const quotes = new Map<string, { price: number; changes: HeatmapHolding['changes'] }>()
  const priceDates = new Map<string, string>()
  const snapshot = (): HeatmapPayload => {
    const holdings: HeatmapHolding[] = seeds.map(seed => ({
      ...seed, price: quotes.get(seed.symbol)?.price ?? null,
      changes: quotes.get(seed.symbol)?.changes ?? {},
    }))
    const intervalSummaries = buildIntervalSummaries(holdings)
    const live = intervalSummaries.live
    return {
      etf, ticker, fundName: source.fundName, issuer: source.issuer,
      asOfDate: source.asOfDate, sourceUrl: source.sourceUrl, priceSource: PRICE_SOURCE,
      priceAsOfDate: [...priceDates.values()].sort()[0] ?? '', holdings,
      holdingsLoaded: holdings.length, quoteCoverage: live.quoteCoverage,
      weightedDayMove: live.weightedMove, strongest: live.strongest, weakest: live.weakest,
      intervalSummaries, fetchedAt: Date.now(),
    }
  }
  // Draw the weighted holdings before classification and price requests finish.
  onProgress?.(snapshot())
  const sectorMap = await deps.sectors(force)
  for (const seed of seeds) seed.sector = resolveSector(seed.symbol, seed.sector === 'Unclassified' ? '' : seed.sector, sectorMap) || 'Unclassified'
  onProgress?.(snapshot())

  // Yahoo uses hyphens for share classes; preserve issuer tile symbols.
  const byPriceSymbol = new Map<string, string[]>()
  for (const seed of seeds) {
    const key = yahooSymbol(seed.symbol)
    byPriceSymbol.set(key, [...(byPriceSymbol.get(key) ?? []), seed.symbol])
  }

  const applySeries = (series: Record<string, SparkSeries>) => {
    for (const [key, entry] of Object.entries(series)) {
      const price = entry.closes.at(-1)
      if (!byPriceSymbol.has(key) || price === undefined || !Number.isFinite(price) || price <= 0) continue
      const changes = changesFromCloses(entry.dates, entry.closes)
      const latestDate = entry.dates.at(-1)
      if (latestDate) priceDates.set(key, latestDate)
      for (const symbol of byPriceSymbol.get(key) ?? []) quotes.set(symbol, { price, changes })
    }
    onProgress?.(snapshot())
  }
  const unresolved = seeds.filter(seed => seed.sector === 'Unclassified').map(seed => seed.symbol)
  const [{ series }, classifications] = await Promise.all([
    deps.prices([...byPriceSymbol.keys()], '1y', force, applySeries),
    deps.classifications && unresolved.length ? deps.classifications(unresolved) : Promise.resolve({} as Record<string, string>),
  ])
  for (const seed of seeds) if (classifications[seed.symbol]) seed.sector = classifications[seed.symbol]
  applySeries(series)
  const payload = snapshot()
  const { holdings, priceAsOfDate } = payload
  const missing = seeds.filter(seed => !quotes.has(seed.symbol)).map(seed => seed.symbol)

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
  const unclassified = holdings.filter(holding => holding.sector === 'Unclassified')
  if (unclassified.length) {
    errors.push(err('Sector classification', `${unclassified.length} holding(s) remain Unclassified: ${unclassified.map(holding => holding.symbol).join(', ')}.`, 'etf_heatmap_sectors', ticker))
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
    payload,
    errors,
  }
}

// Transient previews never enter the completed snapshot cache or startup readiness.
const progress = new Map<HeatmapEtfKey, HeatmapPayload>()

export function getHeatmapProgress(etf: HeatmapEtfKey): HeatmapPayload | null {
  return progress.get(etf) ?? null
}

/** One cached load per index, with local previews while its provider work is pending. */
export function getHeatmap(etf: HeatmapEtfKey, force = false): Promise<HeatmapFetchResult> {
  return cache
    .resolveWithStaleFallback(`heatmap:yahoo-v2:${etf}`, HEATMAP_TTL_MS, async () => {
      try {
        return await fetchHeatmap(etf, force, dependencies, payload => progress.set(etf, payload))
      } finally {
        progress.delete(etf)
      }
    }, { force })
    .then((result) => result.value)
}
