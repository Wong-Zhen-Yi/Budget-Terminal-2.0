import type { HeatmapInterval, MetricsLookback, ReturnTimeframe } from '../../shared/contract.js'
import { getYahooSeries, type YahooSeriesRow } from './series.js'

/**
 * Daily close history, shared by Dip Finder, the Heatmap, Momentum Tracker and
 * Portfolio Metrics.
 *
 * All four want the same series over different windows, so everything funnels through
 * one cache keyed by (symbol, start date). Prices are auto-adjusted: a split inside the
 * window would otherwise read as a 50% loss.
 */

export interface CloseSeries {
  /** `YYYY-MM-DD`, ascending. */
  dates: string[]
  values: number[]
}

const DAY = 24 * 60 * 60 * 1000

function startOfYear(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY)
}

/**
 * Calendar arithmetic, not a day count. yfinance reads `period='1y'` as the same date a
 * year earlier, and approximating that with 365 or 366 days shifts the window by a day
 * — which changes the first bar, and with it every windowed metric.
 */
function monthsAgo(months: number): Date {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()),
  )
}

function yearsAgo(years: number): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()))
}

/** Window starts, ported from `_get_return_timeframe_config` and `_p4_heatmap_interval_config`. */
export function windowStart(window: ReturnTimeframe | HeatmapInterval | MetricsLookback): Date {
  switch (window) {
    case '1d':
    case 'live':
      return daysAgo(5)
    case '1w':
      return daysAgo(7)
    case '1m':
    case '1mo':
      return monthsAgo(1)
    case '3m':
      return monthsAgo(3)
    case 'ytd':
      return startOfYear()
    case '1y':
      return yearsAgo(1)
    case '3y':
      return yearsAgo(3)
    case '5y':
      return yearsAgo(5)
    case 'max':
      return new Date(Date.UTC(1970, 0, 1))
    default:
      return monthsAgo(1)
  }
}

/**
 * The raw close pull, exported so callers whose window has no member in the timeframe
 * unions above (the Pre-Market page wants a flat two years) get the same adjusted-close
 * preference and repeated-trailing-date collapse instead of writing their own.
 */
function closeSeries(rows: YahooSeriesRow[]): CloseSeries {
  const dates: string[] = []
  const values: number[] = []
  let previousDate = ''
  for (const row of rows) {
    // Prefer the adjusted close so splits and dividends do not show up as returns.
    const close = typeof row.adjclose === 'number' ? row.adjclose : row.close
    if (typeof close !== 'number' || !Number.isFinite(close)) continue
    const date = new Date(row.time * 1000).toISOString().slice(0, 10)
    if (date === previousDate) {
      // Yahoo repeats the last session as a live row; keep the newer value.
      values[values.length - 1] = close
      continue
    }
    previousDate = date
    dates.push(date)
    values.push(close)
  }
  return { dates, values }
}

export async function fetchCloses(symbol: string, start: Date, force = false): Promise<CloseSeries> {
  const result = await getYahooSeries({ symbol, start, interval: '1d', force })
  const series = closeSeries(result.rows)
  if (series.dates.length < 2) throw new Error(`No history returned for ${symbol}.`)
  return series
}

export async function getCloses(
  symbol: string,
  window: ReturnTimeframe | HeatmapInterval | MetricsLookback,
  force = false,
): Promise<CloseSeries> {
  const start = windowStart(window)
  const result = await getYahooSeries({ symbol, start, interval: '1d', force })
  const series = closeSeries(result.rows)
  if (series.dates.length < 2) throw new Error(`No history returned for ${symbol}.`)
  return series
}

export interface CloseBatch {
  closes: Record<string, CloseSeries>
  missing: string[]
}

export async function getClosesBatch(
  symbols: string[],
  window: ReturnTimeframe | HeatmapInterval | MetricsLookback,
  force = false,
): Promise<CloseBatch> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
  const settled = await Promise.allSettled(
    unique.map((symbol) => getCloses(symbol, window, force)),
  )
  const closes: Record<string, CloseSeries> = {}
  const missing: string[] = []
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') closes[unique[index]] = outcome.value
    else missing.push(unique[index])
  })
  return { closes, missing }
}

/** First-to-last percent change, which is what the reference `fetch_return` computes. */
export function periodReturn(series: CloseSeries): number | null {
  if (series.values.length < 2) return null
  const first = series.values[0]
  const last = series.values[series.values.length - 1]
  if (!first) return null
  return ((last - first) / first) * 100
}

/* ----------------------------------------------------- closes with volume */

/**
 * Daily bars carrying volume, for the Trading Volumes page's ADV columns.
 *
 * Deliberately not folded into `fetchCloses`, which prefers `adjclose` and drops volume.
 * ADV is `close * volume` on the **unadjusted** close, matching the reference's
 * `yf.download(..., auto_adjust=False)` — feeding it adjusted closes would restate every
 * historical dollar volume by the split and dividend factors.
 */
export interface CloseVolumeSeries {
  /** `YYYY-MM-DD`, ascending. */
  dates: string[]
  closes: number[]
  volumes: number[]
  adjustedCloses?: number[]
}

function closeVolumeSeries(rows: YahooSeriesRow[]): CloseVolumeSeries {
  const dates: string[] = []
  const closes: number[] = []
  const volumes: number[] = []
  const adjustedCloses: number[] = []
  let previousDate = ''

  for (const row of rows) {
    const close = row.close
    const volume = row.volume
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue
    if (typeof volume !== 'number' || !Number.isFinite(volume)) continue
    const date = new Date(row.time * 1000).toISOString().slice(0, 10)
    if (date === previousDate) {
      // Yahoo repeats the last session as a live row; keep the newer value.
      closes[closes.length - 1] = close
      volumes[volumes.length - 1] = volume
      adjustedCloses[adjustedCloses.length - 1] = row.adjclose ?? NaN
      continue
    }
    previousDate = date
    dates.push(date)
    closes.push(close)
    volumes.push(volume)
    adjustedCloses.push(row.adjclose ?? NaN)
  }

  return { dates, closes, volumes, adjustedCloses }
}

export async function fetchCloseVolume(symbol: string, start: Date, force = false): Promise<CloseVolumeSeries> {
  const result = await getYahooSeries({ symbol, start, interval: '1d', force })
  const series = closeVolumeSeries(result.rows)
  if (!series.dates.length) throw new Error(`No history returned for ${symbol}.`)
  return series
}

export interface CloseVolumeBatch {
  series: Record<string, CloseVolumeSeries>
  missing: string[]
}

/**
 * One hundred symbols of three-year daily history, which is the Trading Volumes page's
 * whole cost. The reference gets it in a single bulk `yf.download`; there is no bulk
 * equivalent here, so these are 100 individual charts paced by the rate gate. A symbol
 * that fails only blanks its own ADV columns.
 */
export async function getCloseVolumeBatch(
  symbols: string[],
  start: Date,
  force = false,
): Promise<CloseVolumeBatch> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
  const settled = await Promise.allSettled(
    unique.map(async (symbol) => {
      const result = await getYahooSeries({ symbol, start, interval: '1d', force })
      const series = closeVolumeSeries(result.rows)
      if (!series.dates.length) throw new Error(`No history returned for ${symbol}.`)
      return series
    }),
  )

  const series: Record<string, CloseVolumeSeries> = {}
  const missing: string[] = []
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') series[unique[index]] = outcome.value
    else missing.push(unique[index])
  })
  return { series, missing }
}
