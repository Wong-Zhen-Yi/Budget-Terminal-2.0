/**
 * Interval returns and market-session status for the Global page.
 *
 * Ported from `calculate_interval_performance` and `format_global_market_timing` in the
 * PySide6 `services/global_markets.py`. Both live here rather than in the service
 * because the renderer needs them too: the interval buttons re-derive a return without
 * refetching, and the session line has to be recomputed every minute against the
 * Settings clock timezone.
 */

import type { GlobalInterval, IntervalPerformance, MarketTiming } from './contract.js'
import { GLOBAL_INTERVALS } from './contract.js'

/** A daily close series, ascending, already stripped of non-finite values. */
export interface DatedSeries {
  /** `YYYY-MM-DD`, ascending. Lexicographic order is chronological order. */
  dates: string[]
  values: number[]
}

function unavailable(
  interval: GlobalInterval,
  reason: string,
  extra: Partial<IntervalPerformance> = {},
): IntervalPerformance {
  return {
    available: false,
    interval,
    startDate: '',
    endDate: '',
    startClose: null,
    endClose: null,
    changePct: null,
    reason,
    ...extra,
  }
}

/**
 * Shift a `YYYY-MM-DD` date by whole years, clamping the day into the target month the
 * way `pd.DateOffset(years=n)` does — 29 February minus one year is 28 February, not
 * 1 March.
 */
function shiftYears(date: string, years: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const target = year - years
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(target, month, 0)).getUTCDate()
  const clamped = Math.min(day, lastDay)
  return `${String(target).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`
}

function shiftDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10)
}

/**
 * The date an interval reaches back to, from `_interval_target`.
 *
 * Calendar arithmetic, not a day count: yfinance reads a one-year lookback as the same
 * date a year earlier, and approximating that with 365 days moves the start bar — which
 * changes the return.
 */
export function intervalTarget(endDate: string, interval: GlobalInterval): string {
  switch (interval) {
    case '1D':
      return shiftDays(endDate, 1)
    case '5D':
      return shiftDays(endDate, 5)
    case '30D':
      return shiftDays(endDate, 30)
    case '1Y':
      return shiftYears(endDate, 1)
    case '5Y':
      return shiftYears(endDate, 5)
    case 'YTD':
      return `${endDate.slice(0, 4)}-01-01`
    default:
      return shiftDays(endDate, 1)
  }
}

/**
 * One interval's return, measured from the nearest usable trading close.
 *
 * YTD takes the *first* close at or after 1 January; every other window takes the *last*
 * close at or before the target date. The refusals carry the reference's own wording, so
 * probe output can be diffed against the PySide6 app line for line.
 */
export function calculateIntervalPerformance(
  series: DatedSeries,
  interval: GlobalInterval,
): IntervalPerformance {
  const label: GlobalInterval = GLOBAL_INTERVALS.includes(interval) ? interval : '1D'
  if (series.values.length < 2) return unavailable(label, 'Not enough price history.')

  const endDate = series.dates[series.dates.length - 1]
  const endClose = series.values[series.values.length - 1]
  const target = intervalTarget(endDate, label)

  let startIndex = -1
  if (label === 'YTD') {
    startIndex = series.dates.findIndex((date) => date >= target)
  } else {
    for (let index = series.dates.length - 1; index >= 0; index -= 1) {
      if (series.dates[index] <= target) {
        startIndex = index
        break
      }
    }
  }
  if (startIndex < 0) return unavailable(label, 'No start close in range.', { endDate, endClose })

  const startDate = series.dates[startIndex]
  if (startDate === endDate) {
    return unavailable(label, 'No earlier start close.', { endDate, endClose })
  }

  const startClose = series.values[startIndex]
  if (startClose <= 0 || !Number.isFinite(startClose) || !Number.isFinite(endClose)) {
    return unavailable(label, 'Invalid close values.', { endDate, endClose })
  }

  return {
    available: true,
    interval: label,
    startDate,
    endDate,
    startClose,
    endClose,
    changePct: (endClose / startClose - 1) * 100,
    reason: '',
  }
}

/** Every interval at once, which is what one row carries. */
export function calculateAllIntervals(
  series: DatedSeries,
): Record<GlobalInterval, IntervalPerformance> {
  const out = {} as Record<GlobalInterval, IntervalPerformance>
  for (const interval of GLOBAL_INTERVALS) {
    out[interval] = calculateIntervalPerformance(series, interval)
  }
  return out
}

/* ------------------------------------------------------------ market status */

export type MarketState = 'open' | 'closed' | 'unknown'

/** What the map callout and the table's two status columns print. */
export interface MarketStatus {
  state: MarketState
  market: string
  session: string
  exchangeTimezone: string
  clockTimezone: string
}

function dayKey(epochSeconds: number, zone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochSeconds * 1000))
}

/**
 * `_format_market_time`: bare clock time for today, `Aug 21, 04:00 PM` for any other
 * day. `hourCycle` rather than `hour12: false` because en-US renders midnight as 24:00
 * with the latter — the same trap `clockTime` in `src/lib/format.ts` documents.
 */
function formatMarketTime(
  epochSeconds: number,
  nowSeconds: number,
  zone: string,
  use12h: boolean,
): string {
  const at = new Date(epochSeconds * 1000)
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    ...(use12h ? { hour12: true } : { hourCycle: 'h23' as const }),
  }).format(at)
  if (dayKey(epochSeconds, zone) === dayKey(nowSeconds, zone)) return clock
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    month: 'short',
    day: '2-digit',
  }).format(at)
  return `${day}, ${clock}`
}

function zoneAbbreviation(epochSeconds: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'short',
  }).formatToParts(new Date(epochSeconds * 1000))
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? zone
}

function usable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Yahoo's trading-period metadata as a display-ready session status, in the clock
 * timezone Settings picked. A market with no usable timing still gets a status — it
 * reads "Timing unavailable" rather than dropping the row.
 */
export function formatMarketTiming(
  timing: MarketTiming | undefined,
  zone: string,
  { now = Date.now() / 1000, use12h = false }: { now?: number; use12h?: boolean } = {},
): MarketStatus {
  const base: MarketStatus = {
    state: 'unknown',
    market: 'Unknown',
    session: 'Timing unavailable',
    exchangeTimezone: timing?.exchangeTimezone?.trim() || '--',
    clockTimezone: zoneAbbreviation(now, zone),
  }
  if (!timing) return base

  const start = timing.regularStart
  const end = timing.regularEnd
  if (usable(start) && usable(end)) {
    if (start <= now && now < end) {
      return {
        ...base,
        state: 'open',
        market: 'Open',
        session: `Open until ${formatMarketTime(end, now, zone, use12h)}`,
      }
    }
    return {
      ...base,
      state: 'closed',
      market: 'Closed',
      session:
        now < start
          ? `Closed, opens ${formatMarketTime(start, now, zone, use12h)}`
          : `Closed since ${formatMarketTime(end, now, zone, use12h)}`,
    }
  }

  const lastTick = timing.lastTickTime ?? timing.regularMarketTime
  if (usable(lastTick)) {
    return {
      ...base,
      session: `Unknown, last tick ${formatMarketTime(lastTick, now, zone, use12h)}`,
    }
  }
  return base
}
