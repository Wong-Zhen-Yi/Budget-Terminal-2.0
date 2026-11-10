import type { Candle, ChartPayload, ChartsHistoryPayload, IndicatorPoint } from '@shared/contract'
import { rsi, sma, toPoints } from '../../electron/services/indicators'

type Payload = ChartPayload | ChartsHistoryPayload
interface Averages { gain: number; loss: number }
interface State { before?: Averages; last?: Averages }
const states = new WeakMap<Candle[], State>()

function seed(candles: Candle[]): State {
  let gain = 0
  let loss = 0
  let before: Averages | undefined
  let last: Averages | undefined
  for (let index = 1; index < candles.length; index++) {
    const delta = candles[index].close - candles[index - 1].close
    if (index <= 14) {
      gain += Math.max(0, delta)
      loss += Math.max(0, -delta)
      if (index === 14) { gain /= 14; loss /= 14 }
    } else {
      gain = (gain * 13 + Math.max(0, delta)) / 14
      loss = (loss * 13 + Math.max(0, -delta)) / 14
    }
    if (index >= 14) {
      before = last
      last = { gain, loss }
    }
  }
  return { before, last }
}

function tail(points: IndicatorPoint[], time: number, value: number | undefined): IndicatorPoint[] {
  if (value === undefined || !Number.isFinite(value)) return points
  const point = { time, value }
  return points.at(-1)?.time === time ? [...points.slice(0, -1), point] : [...points, point]
}

/** Wilder state is anchored before the live bar, so repeated replacements never compound it. */
export function liveIndicators(previous: Payload, candles: Candle[]): Payload['indicators'] {
  const state = states.get(previous.candles)
  const replacing = candles.length === previous.candles.length && candles.at(-1)?.time === previous.candles.at(-1)?.time
  const appending = candles.length === previous.candles.length + 1 && candles.at(-2) === previous.candles.at(-1)
  const base = replacing ? state?.before : appending ? state?.last : undefined
  let indicators: Payload['indicators']
  if (!base) {
    // Initial load, short histories and retention-window shifts need an exact reseed.
    const closes = candles.map(row => row.close)
    const values = rsi(closes, 14)
    indicators = { ...previous.indicators, rsi: toPoints(candles, values), rsiMa: toPoints(candles, sma(values, 14)) }
    if (previous.interval === '1d' && candles.length >= 200) indicators.ma200 = toPoints(candles, sma(closes, 200))
    if (previous.interval === '1d' && candles.length >= 50 && 'ma50' in indicators) indicators.ma50 = toPoints(candles, sma(closes, 50))
    states.set(candles, seed(candles))
    return indicators
  }
  const last = candles.at(-1)!
  const delta = last.close - candles.at(-2)!.close
  const averages = { gain: (base.gain * 13 + Math.max(0, delta)) / 14, loss: (base.loss * 13 + Math.max(0, -delta)) / 14 }
  const value = averages.loss === 0 ? averages.gain === 0 ? 50 : 100 : 100 - 100 / (1 + averages.gain / averages.loss)
  const rsiPoints = tail(previous.indicators.rsi, last.time, value)
  const window = rsiPoints.slice(-14)
  indicators = { ...previous.indicators, rsi: rsiPoints,
    rsiMa: tail(previous.indicators.rsiMa, last.time, window.length === 14 ? window.reduce((sum, point) => sum + point.value, 0) / 14 : undefined) }
  const average = (period: number) => candles.slice(-period).reduce((sum, candle) => sum + candle.close, 0) / period
  if (previous.interval === '1d' && candles.length >= 200) indicators.ma200 = tail(previous.indicators.ma200, last.time, average(200))
  if (previous.interval === '1d' && candles.length >= 50 && 'ma50' in indicators) indicators.ma50 = tail(indicators.ma50 as IndicatorPoint[], last.time, average(50))
  states.set(candles, { before: base, last: averages })
  return indicators
}

/** React Query can replace array identities while structurally sharing unchanged bars. */
export function retainLiveIndicatorState(proposed: Candle[], stored: Candle[]): void {
  const state = states.get(proposed)
  if (state) states.set(stored, state)
}
