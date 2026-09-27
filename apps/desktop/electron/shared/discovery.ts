import type { Candle, DiscoverySnapshot } from './contract.js'

export const DISCOVERY_DEFAULT_SECONDS = 10
export const DISCOVERY_MIN_SECONDS = 5
export const DISCOVERY_MAX_SECONDS = 300

export function parseDiscoveryInterval(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isInteger(parsed) && parsed >= DISCOVERY_MIN_SECONDS && parsed <= DISCOVERY_MAX_SECONDS ? parsed : null
}

export interface DiscoveryAnalysis {
  performance: Record<string, number | null>
  technicals: Record<string, number | null>
  signals: string[]
}

function percent(value: number, base: number | null | undefined): number | null {
  return base === null || base === undefined || base === 0 ? null : (value / base - 1) * 100
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period
}

function ema(values: number[], period: number): number[] {
  if (values.length < period) return []
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  const result = [seed]
  const multiplier = 2 / (period + 1)
  for (const value of values.slice(period)) result.push(value * multiplier + result.at(-1)! * (1 - multiplier))
  return result
}

function rsi(closes: number[]): number | null {
  if (closes.length < 15) return null
  let gain = 0
  let loss = 0
  for (let index = 1; index <= 14; index += 1) {
    const move = closes[index] - closes[index - 1]
    gain += Math.max(move, 0)
    loss += Math.max(-move, 0)
  }
  gain /= 14
  loss /= 14
  for (let index = 15; index < closes.length; index += 1) {
    const move = closes[index] - closes[index - 1]
    gain = (gain * 13 + Math.max(move, 0)) / 14
    loss = (loss * 13 + Math.max(-move, 0)) / 14
  }
  if (loss === 0) return gain === 0 ? 50 : 100
  return 100 - 100 / (1 + gain / loss)
}

function atr(candles: Candle[]): number | null {
  if (candles.length < 15) return null
  const ranges = candles.slice(1).map((row, index) => Math.max(
    row.high - row.low,
    Math.abs(row.high - candles[index].close),
    Math.abs(row.low - candles[index].close),
  ))
  let average = ranges.slice(0, 14).reduce((sum, value) => sum + value, 0) / 14
  for (const value of ranges.slice(14)) average = (average * 13 + value) / 14
  return average
}

function closeAtOrBefore(candles: Candle[], targetMs: number): number | null {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (candles[index].time * 1000 <= targetMs) return candles[index].close
  }
  return null
}

export function analyzeDiscovery(snapshot: DiscoverySnapshot): DiscoveryAnalysis {
  const candles = snapshot.candles
  const closes = candles.map((row) => row.close)
  const price = snapshot.price
  const empty = { performance: {}, technicals: {}, signals: [] }
  if (!candles.length || price === null) return empty
  const now = candles.at(-1)!.time * 1000
  const monthsAgo = (months: number) => {
    const target = new Date(now)
    target.setUTCMonth(target.getUTCMonth() - months)
    return closeAtOrBefore(candles, target.getTime())
  }
  const yearsAgo = (years: number) => {
    const target = new Date(now)
    target.setUTCFullYear(target.getUTCFullYear() - years)
    return closeAtOrBefore(candles, target.getTime())
  }
  const yearStart = Date.UTC(new Date(now).getUTCFullYear(), 0, 1)
  const ytdBase = closeAtOrBefore(candles, yearStart - 1)
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  const sma200 = sma(closes, 200)
  const fast = ema(closes, 12)
  const slow = ema(closes, 26)
  const macdSeries = slow.map((value, index) => fast[index + 14] - value)
  const macd = macdSeries.at(-1) ?? null
  const macdSignal = ema(macdSeries, 9).at(-1) ?? null
  const trailing = candles.slice(-252)
  const high52 = snapshot.market.high52 ?? (trailing.length >= 200 ? Math.max(...trailing.map((row) => row.high)) : null)
  const low52 = snapshot.market.low52 ?? (trailing.length >= 200 ? Math.min(...trailing.map((row) => row.low)) : null)
  const position = high52 !== null && low52 !== null && high52 > low52
    ? (price - low52) / (high52 - low52) * 100 : null
  const avgVolume20 = candles.length >= 21
    ? candles.slice(-21, -1).reduce((sum, row) => sum + row.volume, 0) / 20 : null
  const relativeVolume = avgVolume20 && snapshot.market.volume !== null
    ? snapshot.market.volume / avgVolume20 : null
  const currentRsi = rsi(closes)
  const signals = [
    sma200 === null ? null : `PRICE ${price >= sma200 ? '>' : '<'} SMA200`,
    currentRsi === null ? null : `RSI ${currentRsi.toFixed(1)}`,
    macd === null || macdSignal === null ? null : `MACD ${macd >= macdSignal ? 'ABOVE' : 'BELOW'} SIGNAL`,
    relativeVolume === null ? null : `VOLUME ${relativeVolume.toFixed(2)}x AVG`,
    position === null ? null : `52W RANGE ${position.toFixed(0)}%`,
  ].filter((value): value is string => value !== null)
  return {
    performance: {
      '1D': percent(price, snapshot.previousClose),
      '5D': percent(price, candles.at(-6)?.close),
      '1M': percent(price, monthsAgo(1)),
      '3M': percent(price, monthsAgo(3)),
      '6M': percent(price, monthsAgo(6)),
      YTD: percent(price, ytdBase),
      '1Y': percent(price, yearsAgo(1)),
      '3Y': percent(price, yearsAgo(3)),
      '5Y': percent(price, yearsAgo(5)),
    },
    technicals: {
      rsi14: currentRsi,
      macd,
      macdSignal,
      sma20,
      sma50,
      sma200,
      vsSma200: sma200 === null ? null : percent(price, sma200),
      avgVolume20,
      relativeVolume,
      atr14: atr(candles),
      rangePosition: position,
      fromHigh: high52 === null ? null : percent(price, high52),
      fromLow: low52 === null ? null : percent(price, low52),
    },
    signals,
  }
}

export function pickDiscoverySymbol(symbols: readonly string[], recent: readonly string[], random = Math.random): string | null {
  if (!symbols.length) return null
  const excluded = new Set(recent.slice(0, Math.min(30, symbols.length - 1)))
  const candidates = symbols.filter((symbol) => !excluded.has(symbol))
  return candidates[Math.floor(random() * candidates.length)] ?? null
}
