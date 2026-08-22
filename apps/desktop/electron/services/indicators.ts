import type { Candle, IndicatorPoint } from '../shared/contract.js'

/**
 * Technical indicators, ported from `services/technical_analysis.py` and
 * `services/chart_data.py` in the PySide6 app so the two apps agree to the decimal.
 */

/**
 * Wilder-smoothed RSI. The first value uses a simple mean of the opening `period`
 * changes, then each later value carries the previous average forward — a plain
 * rolling mean gives visibly different numbers and is the usual porting mistake.
 */
export function rsi(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null)
  if (values.length <= period) return out

  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1]
    if (delta >= 0) gainSum += delta
    else lossSum -= delta
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  out[period] = rsiFromAverages(avgGain, avgLoss)

  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1]
    const gain = delta > 0 ? delta : 0
    const loss = delta < 0 ? -delta : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = rsiFromAverages(avgGain, avgLoss)
  }
  return out
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** Simple moving average over a series that may have leading nulls. */
export function sma(values: Array<number | null>, period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null)
  let sum = 0
  let count = 0
  const window: number[] = []
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value === null || !Number.isFinite(value)) {
      // A gap resets the window: averaging across it would smear stale values forward.
      window.length = 0
      sum = 0
      count = 0
      continue
    }
    window.push(value)
    sum += value
    count += 1
    if (count > period) {
      sum -= window.shift() as number
      count -= 1
    }
    if (count === period) out[i] = sum / period
  }
  return out
}

/** Pair a computed series with its candle timestamps, dropping the empty leading run. */
export function toPoints(candles: Candle[], series: Array<number | null>): IndicatorPoint[] {
  const points: IndicatorPoint[] = []
  for (let i = 0; i < candles.length && i < series.length; i += 1) {
    const value = series[i]
    if (value === null || !Number.isFinite(value)) continue
    points.push({ time: candles[i].time, value })
  }
  return points
}

/**
 * Project a daily MA200 onto whatever bars are on screen, carrying each daily value
 * forward until the next one — the backward `merge_asof` in `fetch_daily_ma200_payload`.
 * A 200-bar rolling mean of 5-minute candles is a different, wrong line.
 */
export function alignBackward(
  targetTimes: number[],
  source: IndicatorPoint[],
  granularity: 'exact' | 'day' = 'exact',
): IndicatorPoint[] {
  if (!source.length || !targetTimes.length) return []
  // Weekly and monthly bars are stamped at the period's opening bell while daily bars
  // are stamped at their own, so an exact comparison lands a day early. Comparing whole
  // days is what the PySide6 app effectively does, since pandas strips the time part.
  const key = granularity === 'day'
    ? (time: number) => Math.floor(time / 86400)
    : (time: number) => time

  const aligned: IndicatorPoint[] = []
  let cursor = 0
  let current: number | null = null
  for (const time of targetTimes) {
    while (cursor < source.length && key(source[cursor].time) <= key(time)) {
      current = source[cursor].value
      cursor += 1
    }
    if (current !== null) aligned.push({ time, value: current })
  }
  return aligned
}
