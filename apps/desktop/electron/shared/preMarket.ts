import type {
  DxyTrend,
  FuturesDirection,
  MacroRange,
  MacroSeries,
  VixRegime,
} from './contract.js'

/**
 * Every Pre-Market rule that is arithmetic or wording rather than data access, ported
 * from `workers/pre_market.py` and the render half of `mixins/pre_market.py`.
 *
 * It lives in `shared/` because three callers have to agree on it: the service that
 * builds the payload, the page that prints it, and `probe-pre-market.ts` that diffs it
 * against the PySide6 app. The interpretation sentences in particular are the sort of
 * thing that drifts the moment two copies exist.
 */

/** `direction` in `_fetch_futures`: a +/-0.05% deadband, so a flat tape reads Flat. */
export function futuresDirection(changePct: number): FuturesDirection {
  if (changePct > 0.05) return 'Up'
  if (changePct < -0.05) return 'Down'
  return 'Flat'
}

/**
 * `_fetch_dxy`'s 5d trend. The slope is `close[-1] - close[-5]` in index points over
 * four sessions, not a percentage, and the +/-0.1 deadband is in those same points.
 */
export function dxyTrend(closes: number[]): DxyTrend {
  if (closes.length < 5) return '--'
  const slope = closes[closes.length - 1] - closes[closes.length - 5]
  if (slope > 0.1) return 'Strengthening'
  if (slope < -0.1) return 'Weakening'
  return 'Flat'
}

/** The DXY panel's note. Flat and `--` deliberately print nothing, as the reference does. */
export function dxyNote(trend: DxyTrend): string {
  if (trend === 'Strengthening') return 'Rising dollar — headwind for equities & commodities'
  if (trend === 'Weakening') return 'Falling dollar — tailwind for equities & commodities'
  return ''
}

/**
 * The 10Y panel's note. An ordered chain, first match wins: the day's move outranks the
 * level against the 20-day average, and unlike DXY there is never an empty result.
 */
export function tnxNote(changeBps: number, vsAvg: number): string {
  if (changeBps > 5) return 'Yields rising sharply — watch rate-sensitive sectors'
  if (changeBps < -5) return 'Yields falling — bond rally, growth stocks may benefit'
  if (vsAvg > 0.1) {
    return 'Yield remains above its 20-day average — financial conditions are still firm'
  }
  if (vsAvg < -0.1) {
    return 'Yield sits below its 20-day average — rates pressure is relatively lighter'
  }
  return 'Yield is broadly stable versus the recent 20-day average'
}

export function vixRegime(level: number): VixRegime {
  if (level < 15) return 'Low Vol'
  if (level < 20) return 'Normal'
  if (level < 30) return 'Elevated'
  return 'High Vol'
}

/** The four Fear & Greed cutpoints, shared by `_fg_rating` and `_fg_score_color`. */
export const FEAR_GREED_BANDS: ReadonlyArray<{ from: number; to: number; label: string; color: string }> = [
  { from: 0, to: 25, label: 'Extreme Fear', color: '#ea2962' },
  { from: 25, to: 45, label: 'Fear', color: '#f0824a' },
  { from: 45, to: 55, label: 'Neutral', color: '#f5c543' },
  { from: 55, to: 75, label: 'Greed', color: '#56b568' },
  { from: 75, to: 100, label: 'Extreme Greed', color: '#16a34a' },
]

/**
 * `_fg_rating`. Only the four history rows use this; the current reading prints CNN's
 * own `rating` string instead, which can disagree at a boundary.
 */
export function fgRating(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return '--'
  const band = FEAR_GREED_BANDS.find((entry) => score < entry.to)
  return band ? band.label : 'Extreme Greed'
}

/** `_fg_score_color`, the CNN dial palette. Also colours the history badges. */
export function fgColor(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return '#888888'
  const band = FEAR_GREED_BANDS.find((entry) => score < entry.to)
  return band ? band.color : '#16a34a'
}

/**
 * `closes.rolling(window).mean()`, nulls where pandas leaves NaN.
 *
 * The nulls are the point: the MA line has to start at bar 124 while staying aligned to
 * the closes underneath it, so the gap cannot be closed by dropping the leading points.
 */
export function rollingMean(values: number[], window: number): Array<number | null> {
  const out: Array<number | null> = []
  let sum = 0
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index]
    if (index >= window) sum -= values[index - window]
    out.push(index >= window - 1 ? sum / window : null)
  }
  return out
}

/**
 * Slice a two-year series down to a range button's window.
 *
 * Calendar arithmetic, for the same reason `windowStart` in `yahoo/history.ts` uses it:
 * approximating a year as 365 days shifts the first bar and moves the left edge of the
 * chart by a session. Ranges are cut client-side so switching one never refetches.
 */
export function sliceRange(series: MacroSeries, range: MacroRange): MacroSeries {
  const now = new Date()
  const start = new Date(
    Date.UTC(
      now.getUTCFullYear() - (range === '1Y' ? 1 : range === '2Y' ? 2 : 0),
      now.getUTCMonth() - (range === '1M' ? 1 : range === '6M' ? 6 : 0),
      now.getUTCDate(),
    ),
  )
  const cutoff = start.toISOString().slice(0, 10)
  const from = series.dates.findIndex((date) => date >= cutoff)
  if (from <= 0) return series
  return { dates: series.dates.slice(from), values: series.values.slice(from) }
}

/**
 * CNN's `timestamp`, rendered as the reference's `%b %d at %I:%M:%S %p ET`.
 *
 * The field is normally ISO-8601, but CNN has also returned epoch milliseconds, which
 * Python's `fromisoformat` cannot parse — there the reference silently falls through to
 * printing the raw value. Both forms are handled here rather than reproducing that.
 */
export function fearGreedTimestamp(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return ''
  const date =
    typeof raw === 'number'
      ? new Date(raw)
      : /^\d+$/.test(String(raw))
        ? new Date(Number(raw))
        : new Date(String(raw))
  if (Number.isNaN(date.getTime())) return String(raw)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).formatToParts(date)
  const at = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${at('month')} ${at('day')} at ${at('hour')}:${at('minute')}:${at('second')} ${at('dayPeriod')} ET`
}
