import type { Candle, ChartsRange } from '@shared/contract'

/** Keep the entire usable history, not a latest-N sample. Never synthesize OHLC. */
export function agentHistoryCandles(candles: Candle[]): Candle[] {
  return [...new Map(candles.filter(candle => Number.isInteger(candle.time)
    && Math.abs(candle.time) <= 8.64e12
    && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    && candle.low <= Math.min(candle.open, candle.close)
    && candle.high >= Math.max(candle.open, candle.close))
    .map(candle => [candle.time, candle])).values()].sort((a, b) => a.time - b.time)
}

/** Range shortcuts are views over the full loaded history, anchored to its latest bar. */
export function agentHistoryStart(candles: Candle[], range: ChartsRange): number {
  if (!candles.length || range === 'Max') return 0
  const last = new Date(candles.at(-1)!.time * 1000)
  const date = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()))
  if (range === 'YTD') date.setUTCMonth(0, 1)
  else if (range === '1D' || range === '5D') date.setUTCDate(date.getUTCDate() - (range === '5D' ? 4 : 0))
  else {
    const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '5Y': 60 }[range]
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() - months)
    const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(day, daysInMonth))
  }
  const index = candles.findIndex(candle => candle.time >= date.getTime() / 1000)
  return index < 0 ? candles.length - 1 : index
}
