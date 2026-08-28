/**
 * The Heatmap page's pure layer, ported from `mixins/spy_heatmap_presenters.py` and the
 * maths half of `workers/etf_heatmap.py`.
 *
 * Everything here is shared by the main process and the renderer: the interval-return
 * arithmetic the worker runs over each holding's closes, the summary and detail builders
 * the page prints, and the formatters. No Electron, no React, no network.
 */

import type {
  HeatmapEtfKey,
  HeatmapHolding,
  HeatmapHoldingSummary,
  HeatmapInterval,
  HeatmapIntervalSummary,
  HeatmapPayload,
} from './contract.js'
import { HEATMAP_INTERVALS } from './contract.js'

/**
 * `_P17_ETFS`: the internal key, the button label naming the *index*, and the ETF ticker
 * actually fetched. The two are kept apart on purpose — the status line names the ticker
 * so it is always clear whose holdings are on screen.
 */
export const HEATMAP_ETFS: ReadonlyArray<{
  key: HeatmapEtfKey
  label: string
  ticker: string
}> = [
  { key: 'SPY', label: 'S&P 500', ticker: 'SPY' },
  { key: 'NDX', label: 'Nasdaq 100', ticker: 'QQQ' },
  { key: 'DJI', label: 'Dow 30', ticker: 'DIA' },
]

export const HEATMAP_INTERVAL_KEYS: ReadonlyArray<HeatmapInterval> = HEATMAP_INTERVALS.map(
  (entry) => entry.key,
)

export const UNCLASSIFIED = 'Unclassified'

/** `_p17_normalize_etf_symbol`: accepts the key, the fetch ticker or the label. */
export function normalizeEtfKey(value: unknown): HeatmapEtfKey {
  const text = String(value ?? '').trim().toUpperCase()
  const match = HEATMAP_ETFS.find(
    (entry) => entry.key === text || entry.ticker === text || entry.label.toUpperCase() === text,
  )
  return match?.key ?? 'SPY'
}

export function etfLabel(key: HeatmapEtfKey): string {
  return HEATMAP_ETFS.find((entry) => entry.key === key)?.label ?? 'S&P 500'
}

export function etfTicker(key: HeatmapEtfKey): string {
  return HEATMAP_ETFS.find((entry) => entry.key === key)?.ticker ?? 'SPY'
}

export function intervalLabel(key: HeatmapInterval): string {
  return HEATMAP_INTERVALS.find((entry) => entry.key === key)?.label ?? 'Live'
}

/* ------------------------------------------------------------- formatting */

/** `format_heatmap_pct`. */
export function formatHeatmapPct(value: unknown, signed = false): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const sign = signed && value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

/** `format_heatmap_weight_pct`: weights are stored as fractions, printed as percent. */
export function formatHeatmapWeightPct(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${(value * 100).toFixed(2)}%`
}

export function formatHeatmapPrice(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/* -------------------------------------------------- interval return maths */

const DAY_MS = 24 * 60 * 60 * 1000

function parseStamp(date: string): number {
  return Date.parse(`${date}T00:00:00Z`)
}

/**
 * `pd.DateOffset(months=n)` semantics, which are not JavaScript's.
 *
 * JavaScript rolls 31 March minus one month forward into March; pandas clamps to the
 * last day of the target month instead. A window that silently starts a few days late
 * changes the base bar, and with it the whole 1M/3M/1Y column.
 */
function shiftMonths(stamp: number, months: number): number {
  const source = new Date(stamp)
  const year = source.getUTCFullYear()
  const month = source.getUTCMonth() - months
  const day = source.getUTCDate()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Date.UTC(year, month, Math.min(day, lastDay))
}

/** The base close at or before `target`, falling back to the first bar. `_return_since`. */
function baseAtOrBefore(stamps: number[], values: number[], target: number): number {
  let base = values[0]
  for (let index = 0; index < stamps.length; index += 1) {
    if (stamps[index] > target) break
    base = values[index]
  }
  return base
}

function returnFromBase(latest: number, base: number): number {
  return base ? ((latest - base) / base) * 100 : 0
}

export type HeatmapChanges = Partial<Record<HeatmapInterval, number>>

/**
 * `_changes_from_close`: the seven interval returns off one ascending daily close series.
 *
 * `live` and `1d` are the same number — the last bar against the one before it — because
 * the reference computes them from the same pair. A single-bar series reports 0.00% for
 * both rather than dropping the tile, and any window whose result is not finite is left
 * out of the map entirely, which is what makes the map a per-interval coverage signal.
 */
export function changesFromCloses(dates: string[], values: number[]): HeatmapChanges {
  const changes: HeatmapChanges = {}
  if (!dates.length || dates.length !== values.length) return changes

  const stamps = dates.map(parseStamp)
  const latest = values[values.length - 1]
  const latestStamp = stamps[stamps.length - 1]
  if (!Number.isFinite(latest) || !Number.isFinite(latestStamp)) return changes

  if (values.length >= 2) {
    const previous = values[values.length - 2]
    if (Number.isFinite(previous) && previous > 0) {
      const dayChange = ((latest - previous) / previous) * 100
      changes.live = dayChange
      changes['1d'] = dayChange
    }
  } else {
    changes.live = 0
    changes['1d'] = 0
  }

  changes['1w'] = returnFromBase(latest, baseAtOrBefore(stamps, values, latestStamp - 7 * DAY_MS))
  changes['1m'] = returnFromBase(latest, baseAtOrBefore(stamps, values, shiftMonths(latestStamp, 1)))
  changes['3m'] = returnFromBase(latest, baseAtOrBefore(stamps, values, shiftMonths(latestStamp, 3)))
  changes['1y'] = returnFromBase(latest, baseAtOrBefore(stamps, values, shiftMonths(latestStamp, 12)))

  // YTD's base is the last close *before* January 1st, not the first close of the year.
  const yearStart = Date.UTC(new Date(latestStamp).getUTCFullYear(), 0, 1)
  let beforeYear: number | null = null
  for (let index = 0; index < stamps.length; index += 1) {
    if (stamps[index] >= yearStart) break
    beforeYear = values[index]
  }
  changes.ytd = returnFromBase(latest, beforeYear ?? values[0])

  for (const key of HEATMAP_INTERVAL_KEYS) {
    const value = changes[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) delete changes[key]
  }
  return changes
}

/* ------------------------------------------------------- holdings hygiene */

/**
 * `_is_usable_symbol`: reject the non-tradeable rows an issuer file carries beside real
 * tickers — SSGA's `-` cash line and the Bloomberg-style placeholders (`2602335D`) for
 * unlisted positions. A placeholder that reaches Yahoo comes back empty and paints a
 * permanently dead tile, so every character has to fit a ticker's shape.
 */
export function isUsableHoldingSymbol(value: unknown): boolean {
  const text = String(value ?? '').trim().toUpperCase()
  if (!text || !/^[A-Z]/.test(text)) return false
  return /^[A-Z.-]+$/.test(text)
}

/** `_normalize_sector`: an issuer's placeholder dash is not a sector. */
export function normalizeSector(value: unknown): string {
  const text = String(value ?? '').trim()
  if (['', '-', '--', 'n/a', 'na', 'none', 'null'].includes(text.toLowerCase())) return ''
  return text
}

export function positiveWeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value
}

/* --------------------------------------------------------------- summaries */

export function holdingChange(
  holding: Pick<HeatmapHolding, 'changes'> | null | undefined,
  interval: HeatmapInterval,
): number | null {
  const value = holding?.changes?.[interval]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** `_weighted_move`: weight-weighted mean over the holdings that have both numbers. */
export function weightedMove(
  holdings: ReadonlyArray<Pick<HeatmapHolding, 'weight' | 'changes'>>,
  interval: HeatmapInterval,
): number | null {
  let numerator = 0
  let denominator = 0
  for (const holding of holdings) {
    const change = holdingChange(holding, interval)
    const weight = positiveWeight(holding.weight)
    if (change === null || weight === null) continue
    numerator += weight * change
    denominator += weight
  }
  return denominator > 0 ? numerator / denominator : null
}

/** `_interval_summary`: coverage, weighted move and the two extremes for one interval. */
export function intervalSummary(
  holdings: ReadonlyArray<HeatmapHolding>,
  interval: HeatmapInterval,
): HeatmapIntervalSummary {
  const quoted = holdings.filter((holding) => holdingChange(holding, interval) !== null)
  let strongest: HeatmapHoldingSummary | null = null
  let weakest: HeatmapHoldingSummary | null = null
  for (const holding of quoted) {
    const change = holdingChange(holding, interval) as number
    if (!strongest || change > strongest.changePct) {
      strongest = { symbol: holding.symbol, changePct: change }
    }
    if (!weakest || change < weakest.changePct) {
      weakest = { symbol: holding.symbol, changePct: change }
    }
  }
  return {
    quoteCoverage: quoted.length,
    weightedMove: weightedMove(holdings, interval),
    strongest,
    weakest,
  }
}

export function buildIntervalSummaries(
  holdings: ReadonlyArray<HeatmapHolding>,
): Record<HeatmapInterval, HeatmapIntervalSummary> {
  const out = {} as Record<HeatmapInterval, HeatmapIntervalSummary>
  for (const key of HEATMAP_INTERVAL_KEYS) out[key] = intervalSummary(holdings, key)
  return out
}

/* -------------------------------------------------------------- presenters */

export interface HeatmapRow {
  symbol: string
  name: string
  sector: string
  weight: number
  price: number | null
  changePct: number | null
  interval: HeatmapInterval
  intervalLabel: string
  changeLabel: string
  etf: HeatmapEtfKey
  etfLabel: string
}

/** `build_spy_heatmap_rows`: the row contract the heatmap component consumes. */
export function buildHeatmapRows(
  payload: HeatmapPayload | null | undefined,
  etf: HeatmapEtfKey,
  interval: HeatmapInterval,
): HeatmapRow[] {
  const label = intervalLabel(interval)
  const fund = etfLabel(etf)
  return (payload?.holdings ?? []).map((holding) => ({
    symbol: holding.symbol,
    name: holding.name,
    sector: normalizeSector(holding.sector) || UNCLASSIFIED,
    weight: holding.weight,
    price: holding.price,
    changePct: holdingChange(holding, interval),
    interval,
    intervalLabel: label,
    changeLabel: `${label} Change`,
    etf,
    etfLabel: fund,
  }))
}

/** `weighted_change_from_heatmap_rows`: the same mean, recomputed off what is displayed. */
export function weightedChangeFromRows(rows: ReadonlyArray<HeatmapRow>): number | null {
  let numerator = 0
  let denominator = 0
  for (const row of rows) {
    if (typeof row.weight !== 'number' || typeof row.changePct !== 'number') continue
    numerator += row.weight * row.changePct
    denominator += row.weight
  }
  return denominator > 0 ? numerator / denominator : null
}

/**
 * `select_heatmap_row`: keep the selected symbol across an interval change, but drop a
 * selection that belonged to a different ETF, and fall back to the largest holding.
 */
export function selectHeatmapRow(
  rows: ReadonlyArray<HeatmapRow>,
  selected: HeatmapRow | null,
  etf: HeatmapEtfKey,
): HeatmapRow | null {
  const prior = selected && selected.etf === etf ? selected : null
  const match = prior ? rows.find((row) => row.symbol === prior.symbol) : undefined
  return match ?? rows[0] ?? null
}

export interface HeatmapSummaryView {
  holdingsLoaded: number
  quoteCoverage: number
  weightedMove: number | null
  strongest: HeatmapHoldingSummary | null
  weakest: HeatmapHoldingSummary | null
}

/** `build_heatmap_summary`, reading the interval's own block with a `live` fallback. */
export function buildHeatmapSummary(
  payload: HeatmapPayload | null | undefined,
  interval: HeatmapInterval,
): HeatmapSummaryView {
  if (!payload) {
    return { holdingsLoaded: 0, quoteCoverage: 0, weightedMove: null, strongest: null, weakest: null }
  }
  const summary = payload.intervalSummaries?.[interval] ?? payload.intervalSummaries?.live ?? null
  return {
    holdingsLoaded: payload.holdingsLoaded,
    quoteCoverage: summary?.quoteCoverage ?? payload.quoteCoverage,
    weightedMove: summary?.weightedMove ?? payload.weightedDayMove,
    strongest: summary?.strongest ?? payload.strongest,
    weakest: summary?.weakest ?? payload.weakest,
  }
}

/** `build_holding_summary`: `AAPL +1.24%`, or a dash when there is no usable change. */
export function formatHoldingSummary(holding: HeatmapHoldingSummary | null): string {
  if (!holding?.symbol || !Number.isFinite(holding.changePct)) return '--'
  return `${holding.symbol} ${formatHeatmapPct(holding.changePct, true)}`
}

export interface HeatmapDetail {
  symbol: string
  name: string
  sector: string
  weight: string
  price: string
  changeLabel: string
  changeText: string
  changePct: number | null
}

/** `build_heatmap_detail`: the strip under the map. */
export function buildHeatmapDetail(row: HeatmapRow | null, interval: HeatmapInterval): HeatmapDetail {
  if (!row) {
    return {
      symbol: 'Select a holding',
      name: '--',
      sector: 'Sector: --',
      weight: 'Weight: --',
      price: 'Price: --',
      changeLabel: 'Change',
      changeText: 'Change: --',
      changePct: null,
    }
  }
  const changeLabel = row.changeLabel || `${intervalLabel(interval)} Change`
  return {
    symbol: row.symbol || '--',
    name: row.name || '--',
    sector: `Sector: ${row.sector || UNCLASSIFIED}`,
    weight: `Weight: ${formatHeatmapWeightPct(row.weight)}`,
    price: `Price: ${formatHeatmapPrice(row.price)}`,
    changeLabel,
    changeText: `${changeLabel}: ${formatHeatmapPct(row.changePct, true)}`,
    changePct: typeof row.changePct === 'number' ? row.changePct : null,
  }
}

/* ------------------------------------------------------------------ colour */

/**
 * `_heat_color`: mix the neutral tile toward up or down, saturating at a 4% move.
 *
 * Four, not the five the Portfolio Heatmap's own ramp uses — matching the reference here
 * is what makes the same session read the same shade in both apps. A tile with no quote
 * is not coloured by this at all: it stays neutral and is outlined instead, so missing
 * data never reads as a genuine flat move.
 */
export function heatmapTileColor(
  changePct: number | null,
  palette: { neutral: string; up: string; down: string },
): string {
  if (typeof changePct !== 'number' || !Number.isFinite(changePct)) return palette.neutral
  const strength = Math.min(Math.abs(changePct) / 4, 1)
  return mixHex(palette.neutral, changePct >= 0 ? palette.up : palette.down, 0.35 + 0.65 * strength)
}

function channels(hex: string): [number, number, number] {
  const text = hex.replace('#', '')
  const full =
    text.length === 3
      ? text
          .split('')
          .map((char) => char + char)
          .join('')
      : text
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ]
}

/** `_mix_color`, truncating each channel exactly as Python's `int()` does. */
export function mixHex(left: string, right: string, amount: number): string {
  const mix = Math.max(0, Math.min(1, amount))
  const [lr, lg, lb] = channels(left)
  const [rr, rg, rb] = channels(right)
  const blend = (a: number, b: number) => Math.trunc(a + (b - a) * mix)
  return `rgb(${blend(lr, rr)}, ${blend(lg, rg)}, ${blend(lb, rb)})`
}
