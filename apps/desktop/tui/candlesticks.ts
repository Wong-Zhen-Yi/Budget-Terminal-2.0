import type { Candle } from '../electron/shared/contract.js'

export function validCandles(candles: Candle[]): Candle[] {
  // Never invent OHLC values or bridge gaps with synthetic candles.
  const unique = new Map<number, Candle>()
  for (const candle of candles) {
    if (![candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
      || candle.time < 0 || candle.time > 8_640_000_000_000 || candle.low > Math.min(candle.open, candle.close)
      || candle.high < Math.max(candle.open, candle.close) || candle.high < candle.low) continue
    unique.set(candle.time, candle)
  }
  return [...unique.values()].sort((a, b) => a.time - b.time)
}

/** One true OHLC bar per column pair; widths never merge or average candles. */
export function candlesticks(candles: Candle[], width: number, height: number, limit = 40, obscure = false): string[] {
  width = Math.max(0, Math.floor(width))
  height = Math.max(0, Math.floor(height))
  if (!width || !height) return []
  const fit = (line: string) => line.slice(0, width)
  if (width < 24 || height < 5) return [fit('Enlarge terminal for chart.')]
  const bars = validCandles(candles).slice(-Math.max(1, Math.min(Math.floor((width - 13) / 2), limit)))
  if (!bars.length) return ['No OHLC candles available.']
  const low = Math.min(...bars.map(bar => bar.low))
  const high = Math.max(...bars.map(bar => bar.high))
  const padding = high === low ? Math.max(Math.abs(high) * 0.01, 0.01) : (high - low) * 0.05
  const min = low - padding
  const max = high + padding
  const rows = height - 2
  const y = (value: number) => Math.max(0, Math.min(rows - 1, Math.round((max - value) / (max - min) * (rows - 1))))
  const grid = Array.from({ length: rows }, () => Array<string>(bars.length * 2).fill(' '))
  bars.forEach((bar, index) => {
    const x = index * 2
    for (let row = y(bar.high); row <= y(bar.low); row++) grid[row][x] = '│'
    const top = y(Math.max(bar.open, bar.close))
    const bottom = y(Math.min(bar.open, bar.close))
    const glyph = bar.close > bar.open ? '█' : bar.close < bar.open ? '▓' : '━'
    for (let row = top; row <= bottom; row++) grid[row][x] = glyph
  })
  const lines = grid.map((row, index) => {
    const price = max - index / (rows - 1) * (max - min)
    const label = obscure ? '****' : price.toFixed(2)
    return fit(`${label.slice(0, 11).padStart(11)} │${row.join('')}`)
  })
  const date = (time: number) => new Date(time * 1000).toISOString().slice(0, 10)
  lines.push(fit(` ${date(bars[0].time)} - ${date(bars.at(-1)!.time)} UTC`))
  lines.push(fit(` █ up  ▓ down  ━ flat | ${bars.length} bars`))
  return lines
}

// Only our own glyphs introduce ANSI; untrusted data is cleaned before this step.
export const candleColors = (line: string) => line.replace(/[█▓━]/g, glyph =>
  `${glyph === '█' ? '\x1b[38;2;38;194;129m' : glyph === '▓' ? '\x1b[38;2;240;85;78m' : '\x1b[38;2;214;178;94m'}${glyph}\x1b[38;2;213;222;233m`)
