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

/* -------------------------------------------------- market-cap replay (Replay) */

/**
 * The Replay animation: the selected interval's estimated market caps played back over
 * five seconds. Ported from `_p20_replay_market_cap_animation` and the two helpers it
 * leans on, `_p20_interval_market_cap_history` and `_p20_align_market_cap_history`.
 *
 * Only the market cap moves. Dollar volume is a single number per row, not a series, so
 * every dot keeps its x for the whole playback and slides vertically.
 */

/** `_P20_MARKET_CAP_ANIMATION_DURATION_MS`. */
export const REPLAY_DURATION_MS = 5000

/**
 * `_P20_MARKET_CAP_TRAILING_POINTS`. These three intervals take a bar count; YTD, 1Y and
 * 3Y slice by calendar date instead — the same split `advMetrics` makes, for the same
 * reason.
 */
const REPLAY_TRAILING_POINTS: Partial<Record<TradingVolumeInterval, number>> = {
  '1d': 2,
  '5d': 6,
  '30d': 31,
}

const DAY_MS = 86_400_000

function stampToMs(stamp: string): number {
  return Date.parse(`${stamp}T00:00:00Z`)
}

function msToStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Whole days between two `YYYY-MM-DD` stamps, as `(right - left).days` does. */
function daysBetween(left: string, right: string): number {
  return Math.round((stampToMs(right) - stampToMs(left)) / DAY_MS)
}

/** `_p20_interval_market_cap_history`: the slice of history the active interval covers. */
export function intervalMarketCapHistory(
  history: MarketCapPoint[],
  interval: TradingVolumeInterval,
): MarketCapPoint[] {
  if (!history.length) return []

  const trailing = REPLAY_TRAILING_POINTS[interval]
  if (trailing !== undefined) return history.slice(-trailing)

  const end = history[history.length - 1].date
  if (interval === 'ytd') {
    const year = end.slice(0, 4)
    return history.filter((point) => point.date.slice(0, 4) === year)
  }
  if (interval === '1y') {
    const start = msToStamp(stampToMs(end) - 365 * DAY_MS)
    return history.filter((point) => point.date >= start)
  }
  // 3Y, as a calendar offset rather than 1095 days.
  const endDate = new Date(stampToMs(end))
  const start = msToStamp(
    Date.UTC(endDate.getUTCFullYear() - 3, endDate.getUTCMonth(), endDate.getUTCDate()),
  )
  return history.filter((point) => point.date >= start)
}

/**
 * `_p20_align_market_cap_history`: resample one ticker onto the shared playback dates.
 *
 * The interpolation is **log-linear** — a market cap that doubles reads as a straight
 * climb on the log axis the plot draws, which is the whole point of animating in that
 * space. Outside the ticker's own range the value clamps rather than extrapolating, and
 * the final frame is forced to the live market cap so playback lands where the static
 * plot already is.
 */
export function alignMarketCapHistory(
  history: MarketCapPoint[],
  timeline: string[],
  currentMarketCap: number,
): number[] {
  if (history.length < 2) return timeline.map(() => currentMarketCap)

  const first = history[0]
  const last = history[history.length - 1]
  const aligned: number[] = []
  let rightIndex = 1

  for (const target of timeline) {
    if (target <= first.date) {
      aligned.push(first.value)
      continue
    }
    if (target >= last.date) {
      aligned.push(last.value)
      continue
    }
    while (rightIndex < history.length && history[rightIndex].date < target) rightIndex += 1
    const left = history[rightIndex - 1]
    const right = history[rightIndex]
    const span = Math.max(daysBetween(left.date, right.date), 1)
    const fraction = Math.min(Math.max(daysBetween(left.date, target) / span, 0), 1)
    const logValue =
      Math.log10(left.value) + (Math.log10(right.value) - Math.log10(left.value)) * fraction
    aligned.push(10 ** logValue)
  }

  if (aligned.length) aligned[aligned.length - 1] = currentMarketCap
  return aligned
}

export interface ReplayPlan {
  /** The shared timeline: every date any plottable row has an observation on. */
  dates: string[]
  /** Market cap per ticker, one value per timeline date. */
  series: Record<string, number[]>
  /** Each ticker's cap at the interval's start, what the tooltip measures change from. */
  baselines: Record<string, number>
  /** Tickers whose slice had fewer than two points; their tooltip says so. */
  insufficient: string[]
  /** log10 and already padded. The y range is pinned for the whole playback. */
  yMin: number
  yMax: number
}

/**
 * Everything the animation needs, computed once when Replay is pressed.
 *
 * Returns `null` when there is nothing to play — no plottable rows, or a timeline of
 * fewer than two dates. That same `null` is what disables the button, so the check and
 * the enablement rule cannot drift apart the way the reference's separate
 * `_p20_update_market_cap_replay_state` can.
 */
export function buildReplayPlan(
  rows: TradingVolumeRow[],
  interval: TradingVolumeInterval,
): ReplayPlan | null {
  const metric = TRADING_VOLUME_METRICS[interval]
  const candidates: Array<{ ticker: string; marketCap: number; history: MarketCapPoint[] }> = []
  const timeline = new Set<string>()

  for (const row of rows) {
    const volume = metricValue(row, metric.volumeField)
    // Only rows the dot plot actually draws can be animated.
    if (!isLoggable(volume) || !isLoggable(row.marketCap)) continue

    const history = intervalMarketCapHistory(row.marketCapHistory ?? [], interval)
    if (history.length >= 2) for (const point of history) timeline.add(point.date)
    candidates.push({ ticker: row.ticker, marketCap: row.marketCap, history })
  }

  const dates = [...timeline].sort()
  if (!candidates.length || dates.length < 2) return null

  const series: Record<string, number[]> = {}
  const baselines: Record<string, number> = {}
  const insufficient: string[] = []
  let low = Infinity
  let high = -Infinity

  for (const candidate of candidates) {
    const aligned = alignMarketCapHistory(candidate.history, dates, candidate.marketCap)
    series[candidate.ticker] = aligned
    // A row with too little history sits still at its current cap rather than dropping
    // out, so the plot keeps the same dots throughout.
    if (candidate.history.length >= 2) {
      baselines[candidate.ticker] = candidate.history[0].value
    } else {
      baselines[candidate.ticker] = candidate.marketCap
      insufficient.push(candidate.ticker)
    }
    for (const value of aligned) {
      if (!isLoggable(value)) continue
      if (value < low) low = value
      if (value > high) high = value
    }
  }

  if (!Number.isFinite(low) || !Number.isFinite(high)) return null

  const minY = Math.log10(low)
  const maxY = Math.log10(high)
  const padding = Math.max((maxY - minY) * 0.12, 0.08)
  return { dates, series, baselines, insufficient, yMin: minY - padding, yMax: maxY + padding }
}

export interface ReplayFrame {
  /** The date the caption shows, picked by rounding rather than flooring. */
  date: string
  caps: Record<string, number>
}

/** `_p20_apply_market_cap_animation_frame`: one frame's market cap for every ticker. */
export function replayFrame(plan: ReplayPlan, progress: number): ReplayFrame {
  const lastIndex = plan.dates.length - 1
  const position = Math.min(Math.max(progress, 0), 1) * lastIndex
  const leftIndex = Math.min(Math.floor(position), lastIndex)
  const rightIndex = Math.min(leftIndex + 1, lastIndex)
  const fraction = position - leftIndex

  const caps: Record<string, number> = {}
  for (const [ticker, values] of Object.entries(plan.series)) {
    const left = values[leftIndex]
    const right = values[rightIndex]
    // Interpolated in log space, the same as the alignment above.
    caps[ticker] = 10 ** (Math.log10(left) + (Math.log10(right) - Math.log10(left)) * fraction)
  }

  return { date: plan.dates[Math.min(Math.round(position), lastIndex)], caps }
}
