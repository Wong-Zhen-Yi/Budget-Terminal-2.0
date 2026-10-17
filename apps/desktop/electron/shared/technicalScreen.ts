import { buildMarketHolidays } from './calendar.js'

export const TECHNICAL_PRESETS = [
  { id: 'aboveSma200', label: 'Above 200-day SMA', estimated: false },
  { id: 'goldenCross', label: 'Golden cross today', estimated: false },
  { id: 'rsiBreakout', label: 'Projected RSI breakout', estimated: true },
  { id: 'macdBreakout', label: 'Projected MACD breakout', estimated: true },
] as const

export type TechnicalPreset = (typeof TECHNICAL_PRESETS)[number]['id']

export interface TechnicalBar {
  /** Yahoo chart timestamp in epoch seconds. */
  time: number
  close: number
}

export interface TechnicalMetrics {
  barDate: string
  close: number
  sma50: number
  sma200: number
  previousSma50: number
  previousSma200: number
  rsi: number
  projectedRsi: number
  macd: number
  macdSignal: number
  macdGap: number
  projectedMacdGap: number
  matches: Record<TechnicalPreset, boolean>
}

const nyDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})
const nyTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function completedTechnicalBars(bars: TechnicalBar[], now = Date.now()): TechnicalBar[] {
  const today = nyDate.format(now)
  const [hour, minute] = nyTime.format(now).split(':').map(Number)
  const beforeClose = hour * 60 + minute < 16 * 60 + 15
  return bars
    .filter((bar) => Number.isFinite(bar.time) && Number.isFinite(bar.close) && bar.close > 0)
    .filter((bar) => nyDate.format(bar.time * 1000) !== today || !beforeClose)
    .sort((left, right) => left.time - right.time)
}

/** Only a verified recent listing makes short history an expected exclusion. */
export function recentTechnicalListing(bars: TechnicalBar[], firstTradeDate: unknown, now = Date.now()): string | null {
  const listed = firstTradeDate instanceof Date ? firstTradeDate.getTime()
    : typeof firstTradeDate === 'number' ? (firstTradeDate < 1e12 ? firstTradeDate * 1000 : firstTradeDate)
    : typeof firstTradeDate === 'string' ? Date.parse(firstTradeDate) : NaN
  const completed = completedTechnicalBars(bars, now)
  if (!Number.isFinite(listed) || listed > now || now - listed > 400 * 86_400_000 || completed.length >= 201
    || !completed.length || now - completed.at(-1)!.time * 1000 > 10 * 86_400_000) return null
  const firstDay = Date.parse(`${nyDate.format(listed)}T00:00:00Z`)
  const lastDay = Date.parse(`${nyDate.format(completed.at(-1)!.time * 1000)}T00:00:00Z`)
  const holidays = new Set([new Date(firstDay).getUTCFullYear(), new Date(lastDay).getUTCFullYear()]
    .flatMap(year => buildMarketHolidays(year)).filter(day => day.detail === 'Closed all day').map(day => day.date))
  let sessions = 0
  for (let day = firstDay; day <= lastDay; day += 86_400_000) {
    const date = new Date(day)
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !holidays.has(date.toISOString().slice(0, 10))) sessions += 1
  }
  if (sessions >= 201) return null
  return `Listed ${new Date(listed).toISOString().slice(0, 10)}; ${completed.length} of 201 required completed daily bars available.`
}

function average(values: number[], period: number, end: number): number {
  let sum = 0
  for (let index = end - period + 1; index <= end; index += 1) sum += values[index]
  return sum / period
}

function ema(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(Number.NaN)
  let current = average(values, period, period - 1)
  result[period - 1] = current
  const weight = 2 / (period + 1)
  for (let index = period; index < values.length; index += 1) {
    current = values[index] * weight + current * (1 - weight)
    result[index] = current
  }
  return result
}

function rsi(values: number[]): number[] {
  const result = new Array<number>(values.length).fill(Number.NaN)
  let gain = 0
  let loss = 0
  for (let index = 1; index <= 14; index += 1) {
    const change = values[index] - values[index - 1]
    gain += Math.max(change, 0)
    loss += Math.max(-change, 0)
  }
  gain /= 14
  loss /= 14
  const read = () => loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss)
  result[14] = read()
  for (let index = 15; index < values.length; index += 1) {
    const change = values[index] - values[index - 1]
    gain = (gain * 13 + Math.max(change, 0)) / 14
    loss = (loss * 13 + Math.max(-change, 0)) / 14
    result[index] = read()
  }
  return result
}

/** Returns null when there is too little history or the latest completed bar is stale. */
export function evaluateTechnicalBars(bars: TechnicalBar[], now = Date.now()): TechnicalMetrics | null {
  const completed = completedTechnicalBars(bars, now)
  if (completed.length < 201) return null
  const last = completed.at(-1)!
  if (now - last.time * 1000 > 10 * 86_400_000) return null
  const closes = completed.map((bar) => bar.close)
  const end = closes.length - 1
  const sma50 = average(closes, 50, end)
  const sma200 = average(closes, 200, end)
  const previousSma50 = average(closes, 50, end - 1)
  const previousSma200 = average(closes, 200, end - 1)
  const rsiSeries = rsi(closes)
  const fast = ema(closes, 12)
  const slow = ema(closes, 26)
  const macdValues = slow.slice(25).map((value, index) => fast[index + 25] - value)
  const signalValues = ema(macdValues, 9)
  const macd = macdValues.at(-1)!
  const macdSignal = signalValues.at(-1)!
  const previousGap = macdValues.at(-2)! - signalValues.at(-2)!
  const macdGap = macd - macdSignal
  const currentRsi = rsiSeries[end]
  const projectedRsi = Math.max(0, Math.min(100, currentRsi + (currentRsi - rsiSeries[end - 1])))
  const projectedMacdGap = macdGap + (macdGap - previousGap)
  return {
    barDate: nyDate.format(last.time * 1000), close: last.close,
    sma50, sma200, previousSma50, previousSma200,
    rsi: currentRsi, projectedRsi, macd, macdSignal, macdGap, projectedMacdGap,
    matches: {
      aboveSma200: last.close > sma200,
      goldenCross: previousSma50 <= previousSma200 && sma50 > sma200,
      rsiBreakout: currentRsi < 50 && projectedRsi > 50,
      macdBreakout: macdGap < 0 && projectedMacdGap > 0,
    },
  }
}
