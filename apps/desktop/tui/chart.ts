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

function fit(text: string, width: number): string {
  const chars = Array.from(safeText(text))
  return chars.length > width ? chars.slice(0, width - 1).join('') + '…' : chars.join('')
}

function compactVolume(value: number): string {
  for (const [unit, size] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (value >= size) return `${(value / size).toFixed(1)}${unit}`
  }
  return String(Math.round(value))
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
  const volumeHeight = height >= 20 ? 3 : height >= 14 ? 2 : 1
  const plotHeight = height - volumeHeight - 6
  const low = Math.min(...visible.map(bar => state.mode === 'line' ? bar.close : bar.low))
  const high = Math.max(...visible.map(bar => state.mode === 'line' ? bar.close : bar.high))
  const padding = high === low ? Math.max(Math.abs(high) * 0.01, 0.01) : (high - low) * 0.05
  const targetTicks = Math.max(2, Math.min(5, Math.floor(plotHeight / 3)))
  const roughStep = (high - low + padding * 2) / targetTicks
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const step = [1, 2, 2.5, 5, 10].find(value => value * magnitude >= roughStep)! * magnitude
  const min = Math.floor((low - padding) / step) * step
  const max = Math.ceil((high + padding) / step) * step
  const labels = Math.min(Math.floor(width / 4), Math.max(7, price(min).length, price(max).length))
  const rightLabels = labels + 1
  const plotWidth = width - labels - rightLabels - 3
  // A blank column between candles keeps bodies and wicks distinct. Dense
  // windows aggregate OHLC and volume together, without discarding extremes.
  const bars = bucketCandles(visible, state.mode === 'candles' ? Math.floor((plotWidth - 1) / 2) : plotWidth)
  const row = (value: number) => Math.max(0, Math.min(plotHeight - 1, Math.round((max - value) / (max - min) * (plotHeight - 1))))
  const ticks = new Map<number, string>()
  for (let index = 0; index <= Math.round((max - min) / step); index++) {
    const value = max - index * step
    const y = row(value)
    if (![...ticks.keys()].some(existing => Math.abs(existing - y) < 2)) ticks.set(y, price(value))
  }
  const grid: string[][] = Array.from({ length: plotHeight }, (_, y) => Array.from({ length: plotWidth }, (_, x) => ticks.has(y) && x % 3 === 0 ? '·' : ' '))
  const column = (index: number) => bars.length === 1 ? Math.floor(plotWidth / 2) : 1 + Math.round(index / (bars.length - 1) * (plotWidth - 3))
  // Match the actual bucket boundaries (which need not have equal sizes).
  const selectedBucket = Math.max(0, Math.min(bars.length - 1, Math.ceil((cursor - start + 1) * bars.length / visible.length) - 1))
  const selectedColumn = column(selectedBucket)
  const selected = state.inspect ? candles[cursor] : visible.at(-1)!
  const markerPrice = selected.close
  const markerRow = row(markerPrice)
  for (let x = 0; x < plotWidth; x++) grid[markerRow][x] = x % 2 === 0 ? '┄' : ' '

  // Braille cells offer two horizontal and four vertical samples per terminal
  // cell, keeping line charts smooth even in a short terminal window.
  const dots = Array.from({ length: plotHeight }, () => Array<number>(plotWidth).fill(0))
  const dot = (x: number, y: number) => {
    const masks = [[1, 2, 4, 64], [8, 16, 32, 128]]
    dots[Math.floor(y / 4)][Math.floor(x / 2)] |= masks[x % 2][y % 4]
  }
  const subRow = (value: number) => Math.max(0, Math.min(plotHeight * 4 - 1, Math.round((max - value) / (max - min) * (plotHeight * 4 - 1))))
  for (let index = 0; index < bars.length; index++) {
    const x = column(index)
    const bar = bars[index]
    if (state.mode === 'candles') {
      for (let y = row(bar.high); y <= row(bar.low); y++) grid[y][x] = '│'
      for (let y = Math.min(row(bar.open), row(bar.close)); y <= Math.max(row(bar.open), row(bar.close)); y++) grid[y][x] = bar.open === bar.close ? '─' : bar.close > bar.open ? '█' : '░'
    } else {
      const previous = subRow(bars[Math.max(0, index - 1)].close)
      const current = subRow(bar.close)
      const previousX = column(Math.max(0, index - 1)) * 2
      const steps = Math.max(x * 2 - previousX, Math.abs(current - previous), 1)
      for (let point = 0; point <= steps; point++) dot(Math.round(previousX + (x * 2 - previousX) * point / steps), Math.round(previous + (current - previous) * point / steps))
    }
  }
  if (state.mode === 'line') {
    dots.forEach((cells, y) => cells.forEach((mask, x) => { if (mask) grid[y][x] = String.fromCharCode(0x2800 + mask) }))
  }
  if (state.inspect) {
    for (let y = 0; y < plotHeight; y++) if ([' ', '·', '┄'].includes(grid[y][selectedColumn])) grid[y][selectedColumn] = '┊'
    grid[markerRow][selectedColumn] = '◆'
  }
  const firstClose = visible[0].close
  const change = firstClose ? (visible.at(-1)!.close / firstClose - 1) * 100 : null
  const maximumVolume = Math.max(0, ...bars.map(bar => bar.volume))
  const volumes = Array.from({ length: volumeHeight }, () => Array<string>(plotWidth).fill(' '))
  bars.forEach((bar, index) => {
    const units = maximumVolume && bar.volume ? Math.max(1, Math.round(bar.volume / maximumVolume * volumeHeight * 8)) : 0
    for (let y = 0; y < volumeHeight; y++) volumes[y][column(index)] = ' ▁▂▃▄▅▆▇█'[Math.max(0, Math.min(8, units - (volumeHeight - 1 - y) * 8))]
  })
  const dates = Array<string>(plotWidth).fill(' ')
  const intraday = barDate(visible[0].time).slice(0, 10) === barDate(visible.at(-1)!.time).slice(0, 10)
  const dateTicks = visible.length === 1 ? 1 : Math.max(2, Math.min(5, Math.floor(plotWidth / (intraday ? 12 : 18))))
  for (let index = 0; index < dateTicks; index++) {
    const fraction = dateTicks === 1 ? 0.5 : index / (dateTicks - 1)
    const bar = visible[Math.round(fraction * (visible.length - 1))]
    const label = intraday ? barDate(bar.time).slice(11) : barDate(bar.time).slice(plotWidth < 23 ? 5 : 0, 10)
    const x = Math.round(fraction * (plotWidth - label.length))
    Array.from(label).forEach((char, offset) => { dates[x + offset] = char })
  }
  const aggregation = bars.length < visible.length ? ` · ${bars.length} ${width >= 80 ? 'OHLC groups' : 'groups'}` : ''
  const changeText = change === null ? '--' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
  const details = `O ${price(selected.open)}  H ${price(selected.high)}  L ${price(selected.low)}  C ${price(selected.close)}`
  return [
    `${state.mode === 'candles' ? 'CANDLES' : width >= 80 ? 'CLOSE PRICE' : 'LINE'}  ${visible.length}/${candles.length} bars${width >= 80 ? `  Window ${changeText}` : ''}${aggregation}`,
    state.mode === 'candles' ? '█ up  ░ down  ─ unchanged   │ wick     ┄ close' : 'Close price · ┄ close',
    ...grid.map((cells, y) => `${fit(ticks.get(y) || '', labels).padStart(labels)} ${ticks.has(y) ? '┤' : '│'}${cells.join('')}${y === markerRow ? ` ◂${fit(price(markerPrice), rightLabels - 1)}` : ''}`),
    ...volumes.map((cells, y) => `${(y === 0 ? 'VOL' : y === volumeHeight - 1 ? '0' : '').padStart(labels)} │${cells.join('')}${y === 0 ? ` ${compactVolume(maximumVolume)}` : ''}`),
    `${' '.repeat(labels)} └${'─'.repeat(plotWidth)}`,
    `${' '.repeat(labels + 2)}${dates.join('')}`,
    `${state.inspect ? 'INSPECT' : 'CANDLE'} ${barDate(selected.time)} UTC  ${width >= 95 ? details + '  ' : ''}Vol ${compactVolume(selected.volume)}`,
    width >= 95 ? (state.inspect ? '←/→ candle · ↑/↓ zoom · Home/End first/latest · Esc exit' : 'Enter inspect · +/- zoom · c style · s symbol · t timeframe') : details,
  ].map(line => fit(line, width))
}
