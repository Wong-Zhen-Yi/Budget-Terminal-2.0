/**
 * The Projections page's pure layer, shared by the main process, the renderer and the
 * probe.
 *
 * Ported from `mixins/charts_options_top_volume.py` (page28, labelled "Projections") in
 * the PySide6 app. Everything here is deterministic: the liquidity and quality weights,
 * the break-even scenario anchors for each side, the confidence-weighted combination of
 * them, the weekly interpolated path, the coverage aggregate and the Markdown export.
 * No Electron, no React.
 *
 * The option rows themselves are `OptionsRawRow`s from `optionsPage.ts` — the Options
 * page's expiration sweep is exactly the input this page needs, so the two share one
 * fetch path and one row shape.
 */

import type { ChartsInterval, ChartsRange } from './contract.js'
import type { OptionsExpirationBucket, OptionsRawRow } from './optionsPage.js'
import { formatExpiration } from './optionsPage.js'

/* --------------------------------------------------------------- constants */

/** `P28_PROXY_SOURCE_NOTE`, printed above the strip and at the top of the export. */
export const PROXY_SOURCE_NOTE =
  'Call and put paths are separate options-implied scenarios built from full-chain ' +
  'bid/ask midpoints, break-even prices; the combined path is their ' +
  'confidence-and-coverage-weighted center. All paths use liquidity quality, ' +
  'moneyness, and implied-volatility plausibility checks. They are not true forecasts: ' +
  'volume and open interest do not reveal whether trades were bought or sold, and ' +
  'activity can reflect spreads, covered calls, hedges, or closing trades.'

/** `P28_PROXY_MAX_SPREAD_PCT`: wider than this and the contract is thrown away. */
export const PROXY_MAX_SPREAD_PCT = 0.6
/** `P28_PROXY_MONEYNESS_SOFT_LIMIT`: where the moneyness downweight bottoms out. */
export const PROXY_MONEYNESS_SOFT_LIMIT = 0.35
export const PROXY_MIN_MONEYNESS_WEIGHT = 0.1
/** `P28_PROXY_IV_RANGE_MULTIPLIER`: candidates outside 1.5 expected moves are clamped. */
export const PROXY_IV_RANGE_MULTIPLIER = 1.5

export type ProjectionSide = 'calls' | 'puts' | 'combined'
export const PROJECTION_SIDES: readonly ProjectionSide[] = ['calls', 'puts', 'combined']

/** `P28_TYPE_FILTERS`: this page's tables offer calls or puts, never both. */
export type ProjectionsTypeFilter = 'calls' | 'puts'
export const PROJECTIONS_TYPE_FILTERS: ReadonlyArray<{
  key: ProjectionsTypeFilter
  label: string
}> = [
  { key: 'calls', label: 'Calls' },
  { key: 'puts', label: 'Puts' },
]

/**
 * `P28_TIMEFRAME_OPTIONS`, expressed as the Charts page's interval and range pair.
 *
 * The reference asks yfinance for `7d`/`60d`/`730d`/`5y` periods; `requestStart` in
 * `yahoo/chartsPage.ts` already clamps each interval to the longest window Yahoo will
 * answer (6d for 1m, 59d for 5m and 15m, 729d for 1h), so a range one step wider than
 * the reference's period resolves to the same bars rather than to a shorter chart.
 */
export const PROJECTIONS_TIMEFRAMES: ReadonlyArray<{
  label: ChartsInterval
  short: string
  range: ChartsRange
}> = [
  { label: '1 Minute', short: '1m', range: '1M' },
  { label: '5 Minutes', short: '5m', range: '3M' },
  { label: '15 Minutes', short: '15m', range: '3M' },
  { label: '1 Hour', short: '1h', range: '5Y' },
  { label: '4 Hours', short: '4h', range: '5Y' },
  { label: '1 Day', short: '1D', range: '5Y' },
  { label: '1 Week', short: '1W', range: '5Y' },
  { label: '1 Month', short: '1M', range: '5Y' },
]

export const DEFAULT_PROJECTIONS_TIMEFRAME: ChartsInterval = '1 Day'
export const DEFAULT_PROJECTIONS_SYMBOL = 'SPY'

export function projectionsRange(timeframe: ChartsInterval): ChartsRange {
  return PROJECTIONS_TIMEFRAMES.find((entry) => entry.label === timeframe)?.range ?? '5Y'
}

export function normalizeTypeFilter(value: unknown): ProjectionsTypeFilter {
  return String(value ?? '').trim().toLowerCase() === 'puts' ? 'puts' : 'calls'
}

/* ----------------------------------------------------------------- numbers */

/** `_p28_numeric_value`: a finite float, or null for anything else. */
export function numericValue(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * `_p28_effective_option_price`: the bid/ask midpoint, and its spread as a fraction of
 * that midpoint.
 *
 * A row with no two-sided quote has no usable price at all — the last trade is
 * deliberately not a fallback, because a stale print is exactly what the quality
 * filters exist to keep out of the anchor.
 */
export function effectiveOptionPrice(row: {
  bid?: unknown
  ask?: unknown
}): { mid: number; spreadPct: number | null } | null {
  const bid = numericValue(row.bid)
  const ask = numericValue(row.ask)
  if (bid === null || ask === null || bid <= 0 || ask <= 0 || ask < bid) return null
  const mid = (bid + ask) / 2
  return { mid, spreadPct: mid > 0 ? (ask - bid) / mid : null }
}

/** `_p28_spread_quality_weight`. */
export function spreadQualityWeight(spreadPct: number | null): {
  weight: number
  wide: boolean
} {
  if (spreadPct === null) return { weight: 0, wide: true }
  if (spreadPct > PROXY_MAX_SPREAD_PCT) return { weight: 0, wide: true }
  return { weight: Math.max(0.15, 1 - spreadPct / PROXY_MAX_SPREAD_PCT), wide: false }
}

/** `_p28_moneyness_quality_weight`: far strikes count, but lottery volume cannot lead. */
export function moneynessQualityWeight(strike: number, spot: number): number {
  if (spot <= 0) return 1
  const moneyness = Math.abs(strike - spot) / spot
  const scaled = Math.min(moneyness, PROXY_MONEYNESS_SOFT_LIMIT) / PROXY_MONEYNESS_SOFT_LIMIT
  return Math.max(PROXY_MIN_MONEYNESS_WEIGHT, 1 - scaled)
}

/** `_p28_liquidity_weight`: sqrt(volume) grown by open interest, then quality-scaled. */
export function liquidityWeight(input: {
  volume: number
  openInterest: number
  strike: number
  spot: number
  spreadPct: number | null
}): { weight: number; wide: boolean } {
  const spread = spreadQualityWeight(input.spreadPct)
  if (spread.wide || input.volume <= 0) return { weight: 0, wide: spread.wide }
  const moneyness = moneynessQualityWeight(input.strike, input.spot)
  const liquidity = Math.sqrt(input.volume) * (1 + Math.log1p(Math.max(input.openInterest, 0)))
  return { weight: liquidity * spread.weight * moneyness, wide: false }
}

/** `_p28_weighted_percentile`, sorted by value then weight exactly as Python's is. */
export function weightedPercentile(
  pairs: ReadonlyArray<readonly [number, number]>,
  percentile: number,
): number | null {
  const clean = pairs
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (!clean.length) return null
  const total = clean.reduce((sum, [, weight]) => sum + weight, 0)
  if (total <= 0) return null
  const threshold = Math.max(0, Math.min(1, percentile)) * total
  let running = 0
  for (const [value, weight] of clean) {
    running += weight
    if (running >= threshold) return value
  }
  return clean[clean.length - 1][0]
}

/** `_p28_weighted_average`; the reference keeps it beside the percentile, so this does. */
export function weightedAverage(pairs: ReadonlyArray<readonly [number, number]>): number | null {
  const total = pairs.reduce((sum, [, weight]) => (weight > 0 ? sum + weight : sum), 0)
  if (total <= 0) return null
  return pairs.reduce((sum, [value, weight]) => (weight > 0 ? sum + value * weight : sum), 0) / total
}

export type ConfidenceLabel = 'High' | 'Moderate' | 'Low'

/** The reference's two thresholds, used for every side and for the aggregate. */
export function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 0.7) return 'High'
  if (score >= 0.45) return 'Moderate'
  return 'Low'
}

/* --------------------------------------------------------------- summaries */

export interface ProjectionSummary {
  side: ProjectionSide
  expiration: string
  expirationDisplay: string
  daysOut: number
  spot: number
  projectedPrice: number
  projectedChange: number
  projectedChangePct: number
  confidenceScore: number
  confidenceLabel: ConfidenceLabel
  includedContractCount: number
  totalVolume: number
  totalOpenInterest: number
  totalPremium: number
  totalSignalWeight: number
  wideSpreadCount: number
  medianSpreadPct: number
  dispersionPct: number
  ivCoverage: number
  concentration: number
}

/**
 * `_p28_prepare_projection_records`: every quoted contract with a strike and traded
 * volume, ordered by volume then open interest.
 *
 * The order changes nothing downstream — the weighted median and the concentration are
 * both order-independent — but it is the order the reference feeds its summary, so the
 * probe can print the same head.
 */
export function projectionRecords(rows: readonly OptionsRawRow[]): OptionsRawRow[] {
  return rows
    .filter((row) => Number.isFinite(row.strike) && row.strike > 0 && row.volume > 0)
    .sort((a, b) => b.volume - a.volume || b.openInterest - a.openInterest)
}

/**
 * `_p28_projection_side_summary`: one side's break-even scenario anchor for one
 * expiration.
 *
 * Each contract contributes its break-even — strike plus the midpoint for a call,
 * strike minus it for a put — weighted by liquidity, spread quality and moneyness. A
 * candidate outside 1.5 expected moves (from that row's own implied volatility) is both
 * clamped into the band and quartered in weight rather than dropped, so a far-OTM
 * lottery strike can shift the anchor without being able to define it. The anchor is
 * the weighted *median*, not the mean, which is what keeps one enormous print from
 * carrying the whole expiration.
 */
export function projectionSideSummary(
  records: readonly OptionsRawRow[],
  options: {
    side: 'calls' | 'puts'
    expiry: string
    daysOut: number
    currentClose: number | null
  },
): ProjectionSummary | null {
  const spot = numericValue(options.currentClose)
  if (spot === null || spot <= 0) return null
  const side = options.side
  const wantedType = side === 'puts' ? 'Put' : 'Call'

  let totalVolume = 0
  let totalOpenInterest = 0
  let totalPremium = 0
  let wideSpreadCount = 0
  let quoteRows = 0
  let ivRows = 0
  const candidatePairs: Array<[number, number]> = []
  const spreads: number[] = []
  const weights: number[] = []

  for (const row of records) {
    if (row.type !== wantedType) continue
    const strike = numericValue(row.strike)
    const volume = numericValue(row.volume) ?? 0
    const priced = effectiveOptionPrice(row)
    const openInterest = numericValue(row.openInterest) ?? 0
    if (strike === null || volume <= 0 || priced === null || priced.mid <= 0) continue

    const liquidity = liquidityWeight({
      volume,
      openInterest,
      strike,
      spot,
      spreadPct: priced.spreadPct,
    })
    if (liquidity.wide) wideSpreadCount += 1
    let weight = liquidity.weight
    if (weight <= 0) continue

    quoteRows += 1
    let candidate = side === 'calls' ? strike + priced.mid : strike - priced.mid
    const iv = numericValue(row.impliedVolatility)
    if (iv !== null && iv > 0 && options.daysOut > 0) {
      ivRows += 1
      const expectedMove = spot * iv * Math.sqrt(Math.max(options.daysOut, 1) / 365)
      const bound = PROXY_IV_RANGE_MULTIPLIER * expectedMove
      const low = spot - bound
      const high = spot + bound
      if (candidate < low || candidate > high) {
        weight *= 0.25
        candidate = Math.min(Math.max(candidate, low), high)
      }
    }
    candidatePairs.push([candidate, weight])
    weights.push(weight)
    if (priced.spreadPct !== null) spreads.push(priced.spreadPct)
    totalVolume += volume
    totalOpenInterest += openInterest
    totalPremium += priced.mid * volume * 100
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  if (!candidatePairs.length || totalWeight <= 0) return null
  const projectedPrice = weightedPercentile(candidatePairs, 0.5)
  if (projectedPrice === null) return null

  const change = projectedPrice - spot
  const sortedSpreads = [...spreads].sort((a, b) => a - b)
  const medianSpread = sortedSpreads.length
    ? sortedSpreads[Math.floor(sortedSpreads.length / 2)]
    : PROXY_MAX_SPREAD_PCT
  const dispersion =
    weightedPercentile(
      candidatePairs.map(
        ([value, weight]) => [Math.abs(value - projectedPrice) / spot, weight] as const,
      ),
      0.5,
    ) ?? 0
  const ivCoverage = quoteRows ? ivRows / quoteRows : 0
  const concentration = weights.length ? Math.max(...weights) / totalWeight : 1
  const score = Math.max(
    0,
    Math.min(
      1,
      Math.min(quoteRows / 12, 1) * 0.25 +
        ivCoverage * 0.2 +
        Math.max(0, 1 - medianSpread / PROXY_MAX_SPREAD_PCT) * 0.2 +
        Math.max(0, 1 - Math.min(dispersion / 0.25, 1)) * 0.2 +
        Math.max(0, 1 - concentration) * 0.15,
    ),
  )

  return {
    side,
    expiration: options.expiry,
    expirationDisplay: formatExpiration(options.expiry) || options.expiry,
    daysOut: Math.trunc(options.daysOut || 0),
    spot,
    projectedPrice,
    projectedChange: change,
    projectedChangePct: (change / spot) * 100,
    confidenceScore: score,
    confidenceLabel: confidenceLabel(score),
    includedContractCount: quoteRows,
    totalVolume,
    totalOpenInterest,
    totalPremium,
    totalSignalWeight: totalWeight,
    wideSpreadCount,
    medianSpreadPct: medianSpread,
    dispersionPct: dispersion,
    ivCoverage,
    concentration,
  }
}

/**
 * `_p28_combined_projection_summary`: the two sides blended by confidence times the
 * square root of their contract counts.
 *
 * The combined confidence is the *minimum* of the two, not the blend — a center built
 * on one strong side and one weak one is only as trustworthy as the weak one. The
 * per-side quality fields have no combined meaning and stay at zero, which is what the
 * reference's missing keys already print as in its own export.
 */
export function combinedProjectionSummary(
  call: ProjectionSummary | null | undefined,
  put: ProjectionSummary | null | undefined,
): ProjectionSummary | null {
  if (!call || !put) return null
  const spot = numericValue(call.spot)
  if (spot === null || spot <= 0) return null
  const callContracts = Math.max(Math.trunc(call.includedContractCount || 0), 1)
  const putContracts = Math.max(Math.trunc(put.includedContractCount || 0), 1)
  const callWeight = Math.max(call.confidenceScore, 0.05) * Math.sqrt(callContracts)
  const putWeight = Math.max(put.confidenceScore, 0.05) * Math.sqrt(putContracts)
  const totalWeight = callWeight + putWeight
  if (totalWeight <= 0) return null
  const projectedPrice =
    (call.projectedPrice * callWeight + put.projectedPrice * putWeight) / totalWeight
  const change = projectedPrice - spot
  const score = Math.min(call.confidenceScore, put.confidenceScore)
  return {
    side: 'combined',
    expiration: call.expiration,
    expirationDisplay: call.expirationDisplay,
    daysOut: call.daysOut,
    spot,
    projectedPrice,
    projectedChange: change,
    projectedChangePct: (change / spot) * 100,
    confidenceScore: score,
    confidenceLabel: confidenceLabel(score),
    includedContractCount: callContracts + putContracts,
    totalVolume: 0,
    totalOpenInterest: 0,
    totalPremium: call.totalPremium + put.totalPremium,
    totalSignalWeight: totalWeight,
    wideSpreadCount: 0,
    medianSpreadPct: 0,
    dispersionPct: 0,
    ivCoverage: 0,
    concentration: 0,
  }
}

export interface ProjectionModel {
  /** Every fetched expiration, ascending — the order every panel and path follows. */
  bucketOrder: string[]
  calls: Record<string, ProjectionSummary>
  puts: Record<string, ProjectionSummary>
  combined: Record<string, ProjectionSummary>
}

export function emptyProjectionModel(): ProjectionModel {
  return { bucketOrder: [], calls: {}, puts: {}, combined: {} }
}

/** `_p28_build_projection_summaries` over every fetched expiration. */
export function buildProjectionSummaries(
  buckets: readonly OptionsExpirationBucket[],
  currentClose: number | null,
): ProjectionModel {
  const model = emptyProjectionModel()
  for (const bucket of buckets) {
    model.bucketOrder.push(bucket.expiry)
    const records = projectionRecords(bucket.rows)
    const call = projectionSideSummary(records, {
      side: 'calls',
      expiry: bucket.expiry,
      daysOut: bucket.daysOut,
      currentClose,
    })
    const put = projectionSideSummary(records, {
      side: 'puts',
      expiry: bucket.expiry,
      daysOut: bucket.daysOut,
      currentClose,
    })
    if (call) model.calls[bucket.expiry] = call
    if (put) model.puts[bucket.expiry] = put
    const combined = combinedProjectionSummary(call, put)
    if (combined) model.combined[bucket.expiry] = combined
  }
  return model
}

/** `_p28_projection_summaries_ordered`: one side in expiration order. */
export function orderedSummaries(
  model: ProjectionModel,
  side: ProjectionSide,
): ProjectionSummary[] {
  const source = model[side]
  return model.bucketOrder
    .map((expiry) => source[expiry])
    .filter((summary): summary is ProjectionSummary => Boolean(summary))
}

/** `_p28_projection_headlines`: the nearest valid anchor on each of the three paths. */
export function projectionHeadlines(model: ProjectionModel): {
  calls: ProjectionSummary | null
  puts: ProjectionSummary | null
  combined: ProjectionSummary | null
} {
  return {
    calls: orderedSummaries(model, 'calls')[0] ?? null,
    puts: orderedSummaries(model, 'puts')[0] ?? null,
    combined: orderedSummaries(model, 'combined')[0] ?? null,
  }
}

export interface ProjectionAggregate {
  confidenceScore: number
  confidenceLabel: ConfidenceLabel
  includedContractCount: number
  expirationCount: number
}

/**
 * `_p28_projection_aggregate`: the coverage tile.
 *
 * It reads the two real sides only — every combined anchor is derived from them, and
 * counting those again would double every contract on the page.
 */
export function projectionAggregate(model: ProjectionModel): ProjectionAggregate | null {
  const summaries = [...orderedSummaries(model, 'calls'), ...orderedSummaries(model, 'puts')]
  if (!summaries.length) return null
  const contracts = summaries.reduce(
    (sum, summary) => sum + Math.trunc(summary.includedContractCount || 0),
    0,
  )
  const expirations = new Set(summaries.map((summary) => summary.expiration)).size
  const weighted = summaries.reduce((sum, summary) => sum + summary.includedContractCount, 0)
  const score =
    summaries.reduce(
      (sum, summary) => sum + summary.confidenceScore * summary.includedContractCount,
      0,
    ) / Math.max(weighted, 1)
  return {
    confidenceScore: score,
    confidenceLabel: confidenceLabel(score),
    includedContractCount: contracts,
    expirationCount: expirations,
  }
}

/* ------------------------------------------------------------ weekly paths */

export interface ProjectionPoint {
  side: ProjectionSide
  /** `YYYY-MM-DD`. */
  date: string
  projectedPrice: number
  confidenceLabel: ConfidenceLabel
  confidenceScore: number
  leftAnchor: string
  rightAnchor: string
  /** True where the point lands exactly on an expiration's own anchor. */
  isExpirationAnchor: boolean
}

export type ProjectionPaths = Record<ProjectionSide, ProjectionPoint[]>

export function emptyProjectionPaths(): ProjectionPaths {
  return { calls: [], puts: [], combined: [] }
}

const DAY_MS = 24 * 60 * 60 * 1000

function parseIsoDate(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const parsed = Date.parse(`${text}T00:00:00Z`)
  return Number.isFinite(parsed) ? parsed : null
}

function isoFromMillis(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10)
}

/**
 * `_p28_build_weekly_projection_points`: a seven-calendar-day path through each side's
 * expiration anchors, starting at the latest chart close.
 *
 * The path is piecewise linear between anchors, and every anchor date is kept as its
 * own point, so an expiration always sits exactly on the line rather than near it.
 */
export function buildProjectionPaths(
  model: ProjectionModel,
  currentClose: number | null,
  asOfDate: string,
): ProjectionPaths {
  const spot = numericValue(currentClose)
  const asOf = parseIsoDate(asOfDate)
  const paths = emptyProjectionPaths()
  if (spot === null || asOf === null) return paths

  for (const side of PROJECTION_SIDES) {
    const anchors: Array<{ time: number; price: number; summary: ProjectionSummary | null }> = [
      { time: asOf, price: spot, summary: null },
    ]
    for (const summary of orderedSummaries(model, side)) {
      const time = parseIsoDate(summary.expiration)
      if (time === null || time <= asOf) continue
      anchors.push({ time, price: summary.projectedPrice, summary })
    }
    anchors.sort((a, b) => a.time - b.time)
    if (anchors.length < 2) continue

    const last = anchors[anchors.length - 1].time
    const times = new Set(anchors.map((anchor) => anchor.time))
    for (let cursor = asOf + 7 * DAY_MS; cursor <= last; cursor += 7 * DAY_MS) times.add(cursor)

    paths[side] = [...times]
      .sort((a, b) => a - b)
      .map((time) => {
        let left = anchors[0]
        let right = anchors[anchors.length - 1]
        for (let index = 1; index < anchors.length; index += 1) {
          if (time <= anchors[index].time) {
            left = anchors[index - 1]
            right = anchors[index]
            break
          }
        }
        const spanDays = Math.max(Math.round((right.time - left.time) / DAY_MS), 1)
        const ratio = Math.max(0, Math.min(1, Math.round((time - left.time) / DAY_MS) / spanDays))
        return {
          side,
          date: isoFromMillis(time),
          projectedPrice: left.price + (right.price - left.price) * ratio,
          confidenceLabel: right.summary?.confidenceLabel ?? 'Low',
          confidenceScore: right.summary?.confidenceScore ?? 0,
          leftAnchor: isoFromMillis(left.time),
          rightAnchor: isoFromMillis(right.time),
          isExpirationAnchor: anchors.some(
            (anchor) => anchor.time === time && anchor.summary !== null,
          ),
        }
      })
  }
  return paths
}

/* -------------------------------------------------------------- formatting */

/** `_p28_format_projection_price`. */
export function projectionPrice(value: number | null | undefined): string {
  const numeric = numericValue(value)
  if (numeric === null) return '--'
  return `$${numeric.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function percentAt(value: number, places: number): string {
  return `${(value * 100).toFixed(places)}%`
}

/** `_p28_projection_change_text`: the projection against the latest chart close. */
export function projectionChangeText(summary: ProjectionSummary | null | undefined): string {
  if (!summary) return 'No chart close'
  const change = numericValue(summary.projectedChange)
  const pct = numericValue(summary.projectedChangePct)
  if (change === null || pct === null) return 'No chart close'
  const sign = change >= 0 ? '+' : '-'
  return `${sign}${projectionPrice(Math.abs(change))} (${sign}${Math.abs(pct).toFixed(2)}%)`
}

/** The strip's meta line under each headline value. */
export function projectionMetaText(summary: ProjectionSummary): string {
  return [
    summary.expirationDisplay,
    projectionChangeText(summary),
    `${summary.confidenceLabel} confidence`,
    `Contracts ${summary.includedContractCount.toLocaleString('en-US')}`,
  ].join(' | ')
}

/** `_p28_update_section_projection_label`, the one line each expiration panel carries. */
export function sectionProjectionLabel(model: ProjectionModel, expiry: string): string {
  const call = model.calls[expiry]
  const put = model.puts[expiry]
  const combined = model.combined[expiry]
  if (!call && !put) return 'Options-volume projection unavailable'
  return (
    `Call ${call ? projectionPrice(call.projectedPrice) : '--'} ` +
    `(${call ? call.confidenceLabel : 'Unavailable'}) | ` +
    `Put ${put ? projectionPrice(put.projectedPrice) : '--'} ` +
    `(${put ? put.confidenceLabel : 'Unavailable'}) | ` +
    `Combined ${combined ? projectionPrice(combined.projectedPrice) : '--'}`
  )
}

/* ------------------------------------------------------------------ export */

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim()
}

function exportNumber(value: unknown, places: number): string {
  const numeric = numericValue(value)
  if (numeric === null) return ''
  return numeric.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

function headlineLine(label: string, summary: ProjectionSummary | null): string {
  if (!summary) return `- ${label}: Unavailable`
  const pieces = [
    `${summary.expirationDisplay} ${projectionPrice(summary.projectedPrice)}`,
    projectionChangeText(summary),
    `Confidence ${summary.confidenceLabel} (${percentAt(summary.confidenceScore, 0)})`,
    `Premium ${projectionPrice(summary.totalPremium)}`,
    `Contracts ${summary.includedContractCount.toLocaleString('en-US')}`,
  ]
  return `- ${label}: ${pieces.filter(Boolean).join(' | ')}`
}

export interface ProjectionsExportInput {
  ticker: string
  timeframe: ChartsInterval
  typeFilter: ProjectionsTypeFilter
  currentClose: number | null
  model: ProjectionModel
  /** The visible top-volume rows, in the order the panels print them. */
  buckets: Array<{ expiry: string; rows: OptionsRawRow[] }>
  exportedAt: string
}

/** `_p28_build_export`: the page's whole Markdown, headline block and all. */
export function buildProjectionsExport(input: ProjectionsExportInput): string {
  const ticker = input.ticker.trim().toUpperCase()
  const typeLabel =
    PROJECTIONS_TYPE_FILTERS.find((entry) => entry.key === input.typeFilter)?.label ?? 'Calls'
  const lines: string[] = [
    `# Projections Export - ${ticker || 'Unavailable'}`,
    '',
    `- Symbol: ${ticker || 'Unavailable'}`,
    `- Chart Timeframe: ${input.timeframe}`,
    `- Table Rows: ${typeLabel}`,
    '- Projection Period: All',
    `- Exported At: ${input.exportedAt}`,
    '',
    '## Options-Volume Projection',
    '',
    `- Methodology Note: ${PROXY_SOURCE_NOTE}`,
    `- Current Chart Close: ${
      numericValue(input.currentClose) === null
        ? 'Unavailable'
        : projectionPrice(input.currentClose)
    }`,
  ]

  const headlines = projectionHeadlines(input.model)
  lines.push(headlineLine('Nearest Call Projection', headlines.calls))
  lines.push(headlineLine('Nearest Put Projection', headlines.puts))
  lines.push(headlineLine('Nearest Combined Projection', headlines.combined))

  const aggregate = projectionAggregate(input.model)
  lines.push(
    aggregate
      ? `- Data Confidence: ${aggregate.confidenceLabel} (${percentAt(
          aggregate.confidenceScore,
          0,
        )}) | Expirations ${aggregate.expirationCount} | Contracts ${aggregate.includedContractCount.toLocaleString(
          'en-US',
        )}`
      : '- Data Confidence: Unavailable',
  )
  lines.push('')

  const hasSides =
    Object.keys(input.model.calls).length > 0 || Object.keys(input.model.puts).length > 0
  if (!hasSides) {
    lines.push('No options-volume projection was available from the loaded option-chain rows.', '')
  } else {
    lines.push(
      '| Side | Expiration | Projection | Vs Close | Confidence | Contracts | Total Premium | Median Spread | IV Coverage |',
      '| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |',
    )
    for (const side of PROJECTION_SIDES) {
      const title = side === 'calls' ? 'Calls' : side === 'puts' ? 'Puts' : 'Combined'
      for (const summary of orderedSummaries(input.model, side)) {
        lines.push(
          `| ${title} | ${escapeCell(summary.expirationDisplay)} | ` +
            `${projectionPrice(summary.projectedPrice)} | ${projectionChangeText(summary)} | ` +
            `${summary.confidenceLabel} (${percentAt(summary.confidenceScore, 0)}) | ` +
            `${summary.includedContractCount.toLocaleString('en-US')} | ` +
            `${projectionPrice(summary.totalPremium)} | ` +
            `${percentAt(summary.medianSpreadPct, 1)} | ${percentAt(summary.ivCoverage, 0)} |`,
        )
      }
    }
    lines.push('')
  }

  lines.push('## Data', '')
  for (const bucket of input.buckets) {
    const display = formatExpiration(bucket.expiry) || bucket.expiry
    lines.push(
      `### ${display}`,
      '',
      `- Selected expiration: ${bucket.expiry || 'Unavailable'}`,
      `- Rows exported: ${bucket.rows.length}`,
      '',
    )
    if (!bucket.rows.length) {
      lines.push('No top options volume records were available for this expiration.', '')
      continue
    }
    lines.push(
      '| Ticker | Type | Strike | Expiration | Last Price | Volume | Estimated Premium Dollars |',
      '| --- | --- | ---: | --- | ---: | ---: | ---: |',
    )
    for (const row of bucket.rows) {
      const lastPrice = numericValue(row.lastPrice) ?? 0
      const volume = numericValue(row.volume) ?? 0
      lines.push(
        `| ${escapeCell(row.ticker)} | ${escapeCell(row.type)} | ` +
          `${exportNumber(row.strike, 1)} | ${escapeCell(row.expiration || bucket.expiry)} | ` +
          `${exportNumber(row.lastPrice, 2)} | ${Math.trunc(volume).toLocaleString('en-US')} | ` +
          `${projectionPrice(lastPrice * volume * 100)} |`,
      )
    }
    lines.push('')
  }

  return `${lines.join('\n').replace(/\s+$/, '')}\n`
}
