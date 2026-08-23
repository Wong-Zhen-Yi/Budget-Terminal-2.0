import type { MarketCapPoint, TradingVolumeInterval, TradingVolumeRow } from './contract.js'

/**
 * The Trading Volumes maths, ported from `workers/overview.py` and the ranking and
 * filtering halves of `mixins/overview.py`.
 *
 * Pure by design: the service builds rows with it, the dot plot fits its trend line with
 * it, and the probe script prints from it, so the three cannot disagree about what a
 * "30D ADV" is.
 */

/* ------------------------------------------------------------------ metrics */

export interface TradingVolumeMetric {
  key: TradingVolumeInterval
  /** Button text. */
  label: string
  /** Dot-plot x-axis title, from `_P20_DOT_METRICS`. */
  axisLabel: string
  /** Table header, from `_P20_HEADERS`. */
  columnHeader: string
  volumeField: keyof TradingVolumeRow
  returnField: keyof TradingVolumeRow
}

/** `_P20_DOT_METRICS` and `_P20_DOT_RETURN_FIELDS`, merged. */
export const TRADING_VOLUME_METRICS: Record<TradingVolumeInterval, TradingVolumeMetric> = {
  '1d': {
    key: '1d',
    label: '1D',
    axisLabel: '1D ADV ($)',
    columnHeader: '1D ADV ($m)',
    volumeField: 'oneDayDollarVolume',
    returnField: 'oneDayPriceReturnPct',
  },
  '5d': {
    key: '5d',
    label: '5D',
    axisLabel: '5D ADV ($)',
    columnHeader: '5D ADV ($m)',
    volumeField: 'fiveDayAvgDollarVolume',
    returnField: 'fiveDayPriceReturnPct',
  },
  '30d': {
    key: '30d',
    label: '30D',
    axisLabel: '30D ADV ($)',
    columnHeader: '30D ADV ($m)',
    volumeField: 'thirtyDayAvgDollarVolume',
    returnField: 'thirtyDayPriceReturnPct',
  },
  ytd: {
    key: 'ytd',
    label: 'YTD',
    axisLabel: 'YTD ADV ($)',
    columnHeader: 'YTD ADV ($m)',
    volumeField: 'ytdAvgDollarVolume',
    returnField: 'ytdPriceReturnPct',
  },
  '1y': {
    key: '1y',
    label: '1Y',
    axisLabel: '1Y ADV ($)',
    columnHeader: '1Y ADV ($m)',
    volumeField: 'oneYearAvgDollarVolume',
    returnField: 'oneYearPriceReturnPct',
  },
  '3y': {
    key: '3y',
    label: '3Y',
    axisLabel: '3Y ADV ($)',
    columnHeader: '3Y ADV ($m)',
    volumeField: 'threeYearAvgDollarVolume',
    returnField: 'threeYearPriceReturnPct',
  },
}

/** The row cap the reference truncates to before pulling history. */
export const TRADING_VOLUME_LIMIT = 100

/** Read a nullable numeric field off a row without widening every call site to `any`. */
export function metricValue(row: TradingVolumeRow, field: keyof TradingVolumeRow): number | null {
  const value = row[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/* -------------------------------------------------------------------- input */

/** Daily bars behind every ADV figure. Unadjusted closes, matching `auto_adjust=False`. */
export interface CloseVolumeSeries {
  /** `YYYY-MM-DD`, ascending. */
  dates: string[]
  closes: number[]
  volumes: number[]
}

export interface AdvMetrics {
  fiveDay: number | null
  thirtyDay: number | null
  ytd: number | null
  oneYear: number | null
  threeYear: number | null
}

export interface PriceReturns {
  oneDay: number | null
  fiveDay: number | null
  thirtyDay: number | null
  ytd: number | null
  oneYear: number | null
  threeYear: number | null
}

/* ------------------------------------------------------------------ windows */

/** `pd.Timestamp(date.today()) - pd.DateOffset(years=n)`, as a `YYYY-MM-DD` stamp. */
export function yearsAgoStamp(years: number, now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()))
  return date.toISOString().slice(0, 10)
}

/** `today - timedelta(days=n)`, as a `YYYY-MM-DD` stamp. */
export function daysAgoStamp(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

/** `Jan 1` of the current year, as a `YYYY-MM-DD` stamp. */
export function startOfYearStamp(now = new Date()): string {
  return `${now.getUTCFullYear()}-01-01`
}

/** Mean of a slice; `null` when empty or when the result is not a usable dollar figure. */
function mean(values: number[]): number | null {
  if (!values.length) return null
  let total = 0
  for (const value of values) total += value
  const result = total / values.length
  // The reference drops a mean that is not finite or is <= 0 rather than printing a zero.
  return Number.isFinite(result) && result > 0 ? result : null
}

/** Values whose date stamp is on or after `start`. Dates ascend, so this is a tail. */
function fromDate(dates: string[], values: number[], start: string): number[] {
  const index = dates.findIndex((date) => date >= start)
  return index === -1 ? [] : values.slice(index)
}

/* ---------------------------------------------------------------------- ADV */

/**
 * `_dollar_volume_metrics`.
 *
 * Note the asymmetry, which is in the reference and is deliberate: 5D and 30D are
 * **trailing bar counts** (`.tail(5)`, `.tail(30)`), while YTD, 1Y and 3Y are
 * **calendar-date windows**. A 30-bar mean and a 30-calendar-day mean are different
 * numbers, and matching the reference means keeping both conventions.
 */
export function advMetrics(series: CloseVolumeSeries, now = new Date()): AdvMetrics {
  const dollar: number[] = []
  const dates: string[] = []
  for (let index = 0; index < series.closes.length; index += 1) {
    const close = series.closes[index]
    const volume = series.volumes[index]
    if (!Number.isFinite(close) || close <= 0) continue
    if (!Number.isFinite(volume)) continue
    dollar.push(close * volume)
    dates.push(series.dates[index])
  }
  if (!dollar.length) {
    return { fiveDay: null, thirtyDay: null, ytd: null, oneYear: null, threeYear: null }
  }

  return {
    fiveDay: mean(dollar.slice(-5)),
    thirtyDay: mean(dollar.slice(-30)),
    ytd: mean(fromDate(dates, dollar, startOfYearStamp(now))),
    oneYear: mean(fromDate(dates, dollar, daysAgoStamp(365, now))),
    threeYear: mean(fromDate(dates, dollar, yearsAgoStamp(3, now))),
  }
}

/* ------------------------------------------------------------------ returns */

/** `_trailing_price_return_pct`: last close against the close `bars` earlier. */
export function trailingReturnPct(closes: number[], bars: number): number | null {
  if (closes.length <= bars) return null
  const start = closes[closes.length - 1 - bars]
  const end = closes[closes.length - 1]
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end)) return null
  return (end / start - 1) * 100
}

/** `_window_price_return_pct`: first against last close of a calendar slice. */
export function windowReturnPct(closes: number[]): number | null {
  if (closes.length < 2) return null
  const start = closes[0]
  const end = closes[closes.length - 1]
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end)) return null
  return (end / start - 1) * 100
}

export function priceReturns(series: CloseVolumeSeries, now = new Date()): PriceReturns {
  const { closes, dates } = series
  const slice = (start: string) => fromDate(dates, closes, start)
  return {
    oneDay: trailingReturnPct(closes, 1),
    fiveDay: trailingReturnPct(closes, 5),
    thirtyDay: trailingReturnPct(closes, 30),
    ytd: windowReturnPct(slice(startOfYearStamp(now))),
    oneYear: windowReturnPct(slice(daysAgoStamp(365, now))),
    threeYear: windowReturnPct(slice(yearsAgoStamp(3, now))),
  }
}

/* -------------------------------------------------------- market cap history */

/**
 * `_market_cap_estimate_history`: today's market cap scaled by the close ratio.
 *
 * This is the "price-based" estimate the page's caption warns about — it assumes shares
 * outstanding never changed, so a buyback or a raise inside the window reads as price
 * movement instead.
 */
export function marketCapHistory(
  series: CloseVolumeSeries,
  currentMarketCap: number | null,
): MarketCapPoint[] {
  if (currentMarketCap === null || !Number.isFinite(currentMarketCap) || currentMarketCap <= 0) {
    return []
  }
  const latestClose = series.closes[series.closes.length - 1]
  if (!Number.isFinite(latestClose) || latestClose <= 0) return []

  const points: MarketCapPoint[] = []
  for (let index = 0; index < series.closes.length; index += 1) {
    const close = series.closes[index]
    if (!Number.isFinite(close) || close <= 0) continue
    points.push({ date: series.dates[index], value: (currentMarketCap * close) / latestClose })
  }
  return points
}

/* ------------------------------------------------------- ranking and filters */

export type TradingVolumeFilterMode = 'default' | 'exclude' | 'rowRange'

export interface TradingVolumeFilter {
  mode: TradingVolumeFilterMode
  excludeTop: number
  rowRangeStart: number
  rowRangeEnd: number
}

export const DEFAULT_TRADING_VOLUME_FILTER: TradingVolumeFilter = {
  mode: 'default',
  excludeTop: 0,
  rowRangeStart: 1,
  rowRangeEnd: TRADING_VOLUME_LIMIT,
}

/** A row carrying the rank it held before the filter sliced the list. */
export interface RankedTradingVolumeRow extends TradingVolumeRow {
  /** 1-based, from `_p20_rank`. Survives filtering, which is the point of the `#` column. */
  rank: number
}

/**
 * `_p20_ranked_trading_volume_rows`: order every row by the active metric, descending,
 * then stamp the rank. Switching interval re-ranks the table and the plot together.
 */
export function rankRows(
  rows: TradingVolumeRow[],
  interval: TradingVolumeInterval,
): RankedTradingVolumeRow[] {
  const field = TRADING_VOLUME_METRICS[interval].volumeField
  return [...rows]
    .sort((left, right) => {
      const a = metricValue(left, field)
      const b = metricValue(right, field)
      // Missing sinks, as `_P20_MISSING_SORT_VALUE` does.
      if (a === null && b === null) return 0
      if (a === null) return 1
      if (b === null) return -1
      return b - a
    })
    .map((row, index) => ({ ...row, rank: index + 1 }))
}

function clampRow(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(TRADING_VOLUME_LIMIT, Math.max(1, Math.trunc(value)))
}

/** Start and end of a row-range filter, clamped to 1..100 and swapped if inverted. */
function rowRangeBounds(filter: TradingVolumeFilter): [number, number] {
  const start = clampRow(filter.rowRangeStart)
  const end = clampRow(filter.rowRangeEnd)
  return start > end ? [end, start] : [start, end]
}

/** `_p20_visible_trading_volume_rows`. */
export function visibleRows(
  ranked: RankedTradingVolumeRow[],
  filter: TradingVolumeFilter,
): RankedTradingVolumeRow[] {
  if (filter.mode === 'exclude') {
    return ranked.slice(Math.max(0, Math.trunc(filter.excludeTop)))
  }
  if (filter.mode === 'rowRange') {
    const [start, end] = rowRangeBounds(filter)
    return ranked.slice(start - 1, end)
  }
  return ranked
}

/** `_p20_trading_volume_status_text`, without the source and timestamp suffix. */
export function filterStatusText(
  filter: TradingVolumeFilter,
  visible: number,
  total: number,
): string {
  if (filter.mode === 'exclude') {
    return `${visible} rows shown, ${Math.max(0, total - visible)} excluded`
  }
  if (filter.mode === 'rowRange') {
    const [start, end] = rowRangeBounds(filter)
    return `${visible} rows shown, rows ${start}-${end}`
  }
  return `${total} rows shown`
}

/* --------------------------------------------------------------- plot maths */

/** Both dot-plot axes are log10, so a value has to be positive to be plottable at all. */
export function isLoggable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export interface Fit {
  alpha: number
  beta: number
}

/**
 * `_p20_regression_line_data`: an ordinary least-squares fit.
 *
 * The dot plot calls this on **log10 values**, not raw dollars — the reference plots
 * `log10(x)`/`log10(y)` directly rather than using a log axis mode, and fits in that same
 * space. `null` when there is nothing to fit or every x is identical.
 */
export function leastSquares(points: Array<{ x: number; y: number }>): Fit | null {
  if (points.length < 2) return null
  let sumX = 0
  let sumY = 0
  for (const point of points) {
    sumX += point.x
    sumY += point.y
  }
  const meanX = sumX / points.length
  const meanY = sumY / points.length

  let covariance = 0
  let variance = 0
  for (const point of points) {
    const dx = point.x - meanX
    covariance += dx * (point.y - meanY)
    variance += dx * dx
  }
  if (variance === 0) return null

  const beta = covariance / variance
  return { alpha: meanY - beta * meanX, beta }
}
