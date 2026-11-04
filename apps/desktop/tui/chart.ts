import type { Candle } from '../electron/shared/contract.js'
import { safeText } from './model.js'

export interface ChartState {
  mode: 'candles' | 'line'
  bars: number
  cursor: number
  inspect: boolean
}

export function chartCandles(value: unknown): Candle[] {
  if (!Array.isArray(value)) return []
  const byTime = new Map<number, Candle>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const bar = item as Candle
    if (![bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) ||
      bar.time <= 0 || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)) continue
    byTime.set(bar.time, { ...bar, volume: Number.isFinite(bar.volume) && bar.volume >= 0 ? bar.volume : 0 })
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

/** Each screen column preserves the full OHLC range and sums its volume. */
export function bucketCandles(candles: Candle[], columns: number): Candle[] {
  const count = Math.max(1, Math.floor(columns))
  const result: Candle[] = []
  for (let column = 0; column < Math.min(count, candles.length); column++) {
    const start = Math.floor(column * candles.length / Math.min(count, candles.length))
    const end = Math.floor((column + 1) * candles.length / Math.min(count, candles.length))
    const part = candles.slice(start, end)
    result.push({ time: part.at(-1)!.time, open: part[0].open, close: part.at(-1)!.close,
      high: Math.max(...part.map(bar => bar.high)), low: Math.min(...part.map(bar => bar.low)),
      volume: part.reduce((sum, bar) => sum + bar.volume, 0) })
  }
  return result
}

function price(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(value) < 1 ? 6 : 2 })
}

export function barDate(time: number): string {
  const date = new Date(time * 1000)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace('T', ' ') : '--'
}

export function renderChart(candles: Candle[], width: number, height: number, state: ChartState): string[] {
  if (!candles.length) return ['No valid price candles returned.', 'Choose a different ticker or timeframe. Space opens chart actions.']
  if (width < 32 || height < 10) return ['Chart needs at least 32 columns and 10 rows.', 'Enlarge the terminal to see price, volume and OHLC details.']
  const cursor = Math.max(0, Math.min(candles.length - 1, state.cursor))
  const count = Math.min(candles.length, Math.max(10, state.bars))
  const end = Math.min(candles.length, Math.max(count, cursor + Math.ceil(count / 4)))
  const start = Math.max(0, end - count)
  const visible = candles.slice(start, end)
  const labels = Math.max(10, ...visible.flatMap(bar => [price(bar.low).length, price(bar.high).length]))
  const plotWidth = Math.max(4, width - labels - 3)
  const plotHeight = Math.max(3, height - 7)
  const bars = bucketCandles(visible, plotWidth)
  const low = Math.min(...bars.map(bar => state.mode === 'line' ? bar.close : bar.low))
  const high = Math.max(...bars.map(bar => state.mode === 'line' ? bar.close : bar.high))
  const padding = high === low ? Math.max(Math.abs(high) * 0.01, 0.01) : (high - low) * 0.05
  const min = low - padding
  const max = high + padding
  const row = (value: number) => Math.max(0, Math.min(plotHeight - 1, Math.round((max - value) / (max - min) * (plotHeight - 1))))
  const grid: string[][] = Array.from({ length: plotHeight }, (_, index) => Array.from({ length: plotWidth }, () => index % 4 === 0 ? '·' : ' '))
  const column = (index: number) => bars.length === 1 ? Math.floor(plotWidth / 2) : Math.round(index / (bars.length - 1) * (plotWidth - 1))
  const selectedBucket = Math.min(bars.length - 1, Math.floor((cursor - start) * bars.length / visible.length))
  const selectedColumn = column(selectedBucket)
  for (let index = 0; index < bars.length; index++) {
    const x = column(index)
    const bar = bars[index]
    if (state.mode === 'candles') {
      for (let y = row(bar.high); y <= row(bar.low); y++) grid[y][x] = '│'
      for (let y = Math.min(row(bar.open), row(bar.close)); y <= Math.max(row(bar.open), row(bar.close)); y++) grid[y][x] = bar.close >= bar.open ? '█' : '░'
    } else {
      if (index > 0) {
        const previous = row(bars[index - 1].close)
        const current = row(bar.close)
        const previousX = column(index - 1)
        const steps = Math.max(x - previousX, Math.abs(current - previous), 1)
        for (let step = 0; step <= steps; step++) grid[Math.round(previous + (current - previous) * step / steps)][Math.round(previousX + (x - previousX) * step / steps)] = current < previous ? '╱' : current > previous ? '╲' : '─'
      }
      grid[row(bar.close)][x] = '•'
    }
  }
  if (state.inspect) {
    for (let y = 0; y < plotHeight; y++) if (grid[y][selectedColumn] === ' ' || grid[y][selectedColumn] === '·') grid[y][selectedColumn] = '┊'
    grid[row(bars[selectedBucket].close)][selectedColumn] = '◆'
  }
  const selected = candles[cursor]
  const firstClose = visible[0].close
  const change = firstClose ? (visible.at(-1)!.close / firstClose - 1) * 100 : null
  const maximumVolume = Math.max(0, ...bars.map(bar => bar.volume))
  const volumeCells = Array.from({ length: plotWidth }, () => ' ')
  bars.forEach((bar, index) => { volumeCells[column(index)] = maximumVolume ? ' ▁▂▃▄▅▆▇█'[Math.round(bar.volume / maximumVolume * 8)] : ' ' })
  const volumes = volumeCells.join('')
  const axisWidth = Math.max(0, plotWidth - 20)
  return [
    `${state.mode === 'candles' ? 'CANDLES  █ up  ░ down' : 'CLOSE PRICE'}  ${visible.length}/${candles.length} bars  Window ${change === null ? '--' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}`,
    ...grid.map((cells, index) => `${price(max - index / (plotHeight - 1) * (max - min)).padStart(labels)} │${cells.join('')}`),
    `${' '.repeat(labels)} └${'─'.repeat(plotWidth)}`,
    `${' '.repeat(labels + 2)}${barDate(visible[0].time).slice(0, 10)}${' '.repeat(axisWidth)}${barDate(visible.at(-1)!.time).slice(0, 10)}`,
    `${'VOL'.padStart(labels)}  ${volumes}`,
    `${barDate(selected.time)} UTC  O ${price(selected.open)}  H ${price(selected.high)}  L ${price(selected.low)}  C ${price(selected.close)}`,
    `Volume ${selected.volume.toLocaleString('en-US')}  ${state.inspect ? 'INSPECT: Left/Right candle · Up/Down zoom · Esc exit' : 'Enter inspect · s symbol · t timeframe · c style · +/- zoom'}`,
  ].map(safeText)
}
