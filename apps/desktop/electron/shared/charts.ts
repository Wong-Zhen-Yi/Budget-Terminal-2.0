import type {
  Candle,
  ChartsComparePayload,
  ChartsInterval,
  ChartsRange,
  ChartsRelationshipPayload,
  ChartsRelationshipPoint,
  ChartsRelationshipRange,
  ChartsRelationshipStats,
  ChartsRollingWindow,
  ChartsSeriesPoint,
  IndicatorPoint,
} from './contract.js'

export const CHARTS_RANGE_OPTIONS: Record<ChartsInterval, readonly ChartsRange[]> = {
  '1 Minute': ['1D', '5D'],
  '5 Minutes': ['1D', '5D', '1M'],
  '15 Minutes': ['1D', '5D', '1M'],
  '1 Hour': ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y'],
  '4 Hours': ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y'],
  '1 Day': ['5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'Max'],
  '1 Week': ['3M', '6M', 'YTD', '1Y', '5Y', 'Max'],
  '1 Month': ['1Y', '5Y', 'Max'],
}

export const CHARTS_DEFAULT_RANGE: Record<ChartsInterval, ChartsRange> = {
  '1 Minute': '5D',
  '5 Minutes': '1M',
  '15 Minutes': '1M',
  '1 Hour': '1Y',
  '4 Hours': '1Y',
  '1 Day': '5Y',
  '1 Week': '5Y',
  '1 Month': '5Y',
}

export interface SupportResistance {
  support: number | null
  resistance: number | null
}

export interface FibonacciLevel {
  ratio: number
  label: string
  price: number
}

export interface FibonacciModel {
  direction: 'up' | 'down'
  start: { time: number; price: number }
  end: { time: number; price: number }
  levels: FibonacciLevel[]
}

export interface CompareModel {
  symbols: string[]
  normalized: Record<string, Array<{ time: number; value: number }>>
  intervalChanges: Record<string, Array<{ time: number; value: number }>>
  correlations: Array<Array<number | null>>
  observations: number[][]
}

const FIB_LEVELS: Array<[number, string]> = [
  [0, '0%'],
  [0.236, '23.6%'],
  [0.382, '38.2%'],
  [0.5, '50%'],
  [0.618, '61.8%'],
  [0.786, '78.6%'],
  [1, '100%'],
]

export function normalizeSymbol(value: unknown, fallback = ''): string {
  const symbol = String(value ?? '').trim().toUpperCase()
  return symbol || fallback
}

export function normalizeSymbols(values: unknown): string[] {
  const result: string[] = []
  for (const value of Array.isArray(values) ? values : []) {
    const symbol = normalizeSymbol(value)
    if (symbol && !result.includes(symbol)) result.push(symbol)
  }
  return result
}

export function rangeForInterval(interval: ChartsInterval, requested: unknown): ChartsRange {
  const candidate = String(requested ?? '') as ChartsRange
  return CHARTS_RANGE_OPTIONS[interval].includes(candidate)
    ? candidate
    : CHARTS_DEFAULT_RANGE[interval]
}

/** Synthetic 4-hour candles are consecutive same-session hourly rows, not UTC bins. */
export function aggregateFourHourCandles(candles: Candle[]): Candle[] {
  const days = new Map<string, Candle[]>()
  for (const candle of [...candles].sort((left, right) => left.time - right.time)) {
    const key = new Date(candle.time * 1000).toISOString().slice(0, 10)
    const group = days.get(key) ?? []
    group.push(candle)
    days.set(key, group)
  }
  const result: Candle[] = []
  for (const group of days.values()) {
    for (let start = 0; start < group.length; start += 4) {
      const chunk = group.slice(start, start + 4)
      if (!chunk.length) continue
      result.push({
        time: chunk[chunk.length - 1].time,
        open: chunk[0].open,
        high: Math.max(...chunk.map((row) => row.high)),
        low: Math.min(...chunk.map((row) => row.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((sum, row) => sum + row.volume, 0),
      })
    }
  }
  return result
}

export function calculateMfi(candles: Candle[], period = 14): IndicatorPoint[] {
  if (!candles.length) return []
  const typical = candles.map((row) => (row.high + row.low + row.close) / 3)
  const positive = new Array(candles.length).fill(0)
  const negative = new Array(candles.length).fill(0)
  for (let index = 1; index < candles.length; index += 1) {
    const flow = typical[index] * candles[index].volume
    if (typical[index] > typical[index - 1]) positive[index] = flow
    else if (typical[index] < typical[index - 1]) negative[index] = flow
  }
  const points: IndicatorPoint[] = []
  for (let index = period - 1; index < candles.length; index += 1) {
    const start = index - period + 1
    const pos = positive.slice(start, index + 1).reduce((sum, value) => sum + value, 0)
    const neg = negative.slice(start, index + 1).reduce((sum, value) => sum + value, 0)
    const value = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)
    if (Number.isFinite(value)) points.push({ time: candles[index].time, value })
  }
  return points
}

function pivotClusters(values: Array<{ price: number; index: number }>, tolerancePct = 0.006) {
  const clusters: Array<Array<{ price: number; index: number }>> = []
  for (const item of values.sort((left, right) => left.price - right.price)) {
    const cluster = clusters.find((entries) => {
      const mean = entries.reduce((sum, entry) => sum + entry.price, 0) / entries.length
      return Math.abs(item.price - mean) <= Math.max(Math.abs(mean), 1) * tolerancePct
    })
    if (cluster) cluster.push(item)
    else clusters.push([item])
  }
  return clusters.map((entries) => ({
    price: entries.reduce((sum, item) => sum + item.price, 0) / entries.length,
    touches: entries.length,
    latest: Math.max(...entries.map((item) => item.index)),
  }))
}

export function calculateSupportResistance(candles: Candle[]): SupportResistance {
  const rows = candles.filter((row) => [row.low, row.high, row.close].every(Number.isFinite))
  if (!rows.length) return { support: null, resistance: null }
  const close = rows[rows.length - 1].close
  const lows: Array<{ price: number; index: number }> = []
  const highs: Array<{ price: number; index: number }> = []
  const radius = 3
  for (let index = radius; index < rows.length - radius; index += 1) {
    const window = rows.slice(index - radius, index + radius + 1)
    if (rows[index].low <= Math.min(...window.map((row) => row.low))) lows.push({ price: rows[index].low, index })
    if (rows[index].high >= Math.max(...window.map((row) => row.high))) highs.push({ price: rows[index].high, index })
  }
  const score = (entry: { price: number; touches: number; latest: number }) => {
    const recency = (entry.latest + 1) / rows.length
    const proximity = 1 / (1 + Math.abs(entry.price - close) / Math.max(Math.abs(close), 1))
    return entry.touches * 4 + recency * 2 + proximity
  }
  const supportCandidates = pivotClusters(lows).filter((entry) => entry.price <= close).sort((a, b) => score(b) - score(a))
  const resistanceCandidates = pivotClusters(highs).filter((entry) => entry.price >= close).sort((a, b) => score(b) - score(a))
  const support = supportCandidates[0]?.price ?? Math.min(...rows.map((row) => row.low))
  const resistance = resistanceCandidates[0]?.price ?? Math.max(...rows.map((row) => row.high))
  return Math.abs(resistance - support) <= Math.max(Math.abs(resistance), Math.abs(support), 1) * 0.0001
    ? { support, resistance: null }
    : { support, resistance }
}

export function calculateFibonacci(
  candles: Candle[],
  lookback = 120,
  manual?: { start: { time: number; price: number }; end: { time: number; price: number } } | null,
): FibonacciModel | null {
  if (manual) {
    if (!Number.isFinite(manual.start.price) || !Number.isFinite(manual.end.price) || manual.start.price === manual.end.price) return null
    return fibonacciFromAnchors(manual.start, manual.end)
  }
  const rows = candles.slice(-Math.max(20, Math.min(500, Math.trunc(lookback))))
  if (rows.length < 2) return null
  const low = rows.reduce((best, row) => row.low < best.low ? row : best)
  const high = rows.reduce((best, row) => row.high > best.high ? row : best)
  if (low.low === high.high) return null
  return low.time <= high.time
    ? fibonacciFromAnchors({ time: low.time, price: low.low }, { time: high.time, price: high.high })
    : fibonacciFromAnchors({ time: high.time, price: high.high }, { time: low.time, price: low.low })
}

function fibonacciFromAnchors(start: { time: number; price: number }, end: { time: number; price: number }): FibonacciModel {
  const direction = end.price > start.price ? 'up' : 'down'
  const distance = Math.abs(end.price - start.price)
  return {
    direction,
    start,
    end,
    levels: FIB_LEVELS.map(([ratio, label]) => ({
      ratio,
      label,
      price: direction === 'up' ? end.price - distance * ratio : end.price + distance * ratio,
    })),
  }
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
  let numerator = 0
  let leftSum = 0
  let rightSum = 0
  for (let index = 0; index < left.length; index += 1) {
    const x = left[index] - leftMean
    const y = right[index] - rightMean
    numerator += x * y
    leftSum += x * x
    rightSum += y * y
  }
  const denominator = Math.sqrt(leftSum * rightSum)
  return denominator > 0 ? Math.max(-1, Math.min(1, numerator / denominator)) : null
}

export function buildCompareModel(payload: ChartsComparePayload, minObservations = 10): CompareModel {
  const normalized: CompareModel['normalized'] = {}
  const intervalChanges: CompareModel['intervalChanges'] = {}
  const returns = new Map<string, Map<number, number>>()
  for (const symbol of payload.symbols) {
    const source = (payload.series[symbol] ?? []).filter((point) => Number.isFinite(point.close) && point.close > 0)
    if (!source.length) continue
    const base = source[0].close
    normalized[symbol] = source.map((point) => ({ time: point.time, value: (point.close / base - 1) * 100 }))
    intervalChanges[symbol] = []
    const map = new Map<number, number>()
    for (let index = 1; index < source.length; index += 1) {
      const previous = source[index - 1].close
      if (!previous) continue
      const value = (source[index].close / previous - 1) * 100
      intervalChanges[symbol].push({ time: source[index].time, value })
      map.set(source[index].time, value)
    }
    returns.set(symbol, map)
  }
  const symbols = payload.symbols.filter((symbol) => normalized[symbol]?.length)
  const correlations: Array<Array<number | null>> = []
  const observations: number[][] = []
  for (const left of symbols) {
    const row: Array<number | null> = []
    const counts: number[] = []
    for (const right of symbols) {
      const leftValues: number[] = []
      const rightValues: number[] = []
      for (const [time, value] of returns.get(left) ?? []) {
        const other = returns.get(right)?.get(time)
        if (other === undefined) continue
        leftValues.push(value)
        rightValues.push(other)
      }
      counts.push(leftValues.length)
      row.push(leftValues.length >= minObservations ? correlation(leftValues, rightValues) : null)
    }
    correlations.push(row)
    observations.push(counts)
  }
  return { symbols, normalized, intervalChanges, correlations, observations }
}

function rangeWindow(range: ChartsRelationshipRange): string {
  return range.toLowerCase()
}

export function validateRelationshipSymbols(values: unknown): [string, string] {
  const symbols = normalizeSymbols(values)
  if (symbols.length !== 2) throw new Error('Enter exactly two ticker symbols.')
  if (symbols[0] === symbols[1]) throw new Error('Choose two different ticker symbols.')
  return [symbols[0], symbols[1]]
}

export function buildRelationshipPayload(
  symbols: [string, string],
  leftSeries: ChartsSeriesPoint[],
  rightSeries: ChartsSeriesPoint[],
  range: ChartsRelationshipRange,
  rollingWindow: ChartsRollingWindow,
): ChartsRelationshipPayload {
  const right = new Map(rightSeries.map((point) => [point.time, point.close]))
  const aligned = leftSeries
    .filter((point) => point.close > 0 && Number.isFinite(point.close) && (right.get(point.time) ?? 0) > 0)
    .map((point) => ({ time: point.time, left: point.close, right: right.get(point.time)! }))
    .sort((a, b) => a.time - b.time)
  if (!aligned.length) throw new Error('The selected tickers have no overlapping adjusted price history.')
  const leftBase = aligned[0].left
  const rightBase = aligned[0].right
  const leftReturns: number[] = []
  const rightReturns: number[] = []
  const points: ChartsRelationshipPoint[] = aligned.map((row, index) => {
    const leftReturn = index ? (row.left / aligned[index - 1].left - 1) * 100 : null
    const rightReturn = index ? (row.right / aligned[index - 1].right - 1) * 100 : null
    if (leftReturn !== null && rightReturn !== null) {
      leftReturns.push(leftReturn)
      rightReturns.push(rightReturn)
    }
    const sample = Math.min(rollingWindow, leftReturns.length)
    const rolling = sample >= 5
      ? correlation(leftReturns.slice(-sample), rightReturns.slice(-sample))
      : null
    return {
      time: row.time,
      date: new Date(row.time * 1000).toISOString().slice(0, 10),
      leftClose: row.left,
      rightClose: row.right,
      leftIndexed: row.left / leftBase * 100,
      rightIndexed: row.right / rightBase * 100,
      ratio: row.left / row.right,
      leftReturnPct: leftReturn,
      rightReturnPct: rightReturn,
      rollingCorrelation: rolling,
      rollingSample: rolling === null ? 0 : sample,
    }
  })
  const { stats, regressionLine } = regression(leftReturns, rightReturns)
  const latestRolling = [...points].reverse().find((point) => point.rollingCorrelation !== null)
  return {
    symbols,
    range,
    rollingWindow,
    points,
    regressionLine,
    stats: {
      ...stats,
      latestRatio: points.at(-1)?.ratio ?? null,
      latestCorrelation: latestRolling?.rollingCorrelation ?? null,
      latestCorrelationSample: latestRolling?.rollingSample ?? 0,
    },
    missing: [],
  }
}

function regression(left: number[], right: number[]): {
  stats: Omit<ChartsRelationshipStats, 'latestRatio' | 'latestCorrelation' | 'latestCorrelationSample'>
  regressionLine: Array<{ x: number; y: number }>
} {
  const observations = Math.min(left.length, right.length)
  const empty = {
    beta: null,
    alphaDailyPct: null,
    r: null,
    rSquared: null,
    stdErrorPct: null,
    observations,
  }
  if (observations < 5) return { stats: empty, regressionLine: [] }
  const x = right.slice(0, observations)
  const y = left.slice(0, observations)
  const xMean = x.reduce((sum, value) => sum + value, 0) / observations
  const yMean = y.reduce((sum, value) => sum + value, 0) / observations
  const denominator = x.reduce((sum, value) => sum + (value - xMean) ** 2, 0)
  if (!denominator) return { stats: empty, regressionLine: [] }
  const beta = x.reduce((sum, value, index) => sum + (value - xMean) * (y[index] - yMean), 0) / denominator
  const alphaDailyPct = yMean - beta * xMean
  const r = correlation(x, y)
  if (r === null) return { stats: empty, regressionLine: [] }
  const residual = y.reduce((sum, value, index) => sum + (value - (alphaDailyPct + beta * x[index])) ** 2, 0)
  const stdErrorPct = observations > 2 ? Math.sqrt(residual / (observations - 2)) : null
  const xMin = Math.min(...x)
  const xMax = Math.max(...x)
  return {
    stats: { beta, alphaDailyPct, r, rSquared: r ** 2, stdErrorPct, observations },
    regressionLine: [
      { x: xMin, y: alphaDailyPct + beta * xMin },
      { x: xMax, y: alphaDailyPct + beta * xMax },
    ],
  }
}

/** Stable cache key suffix used by the service and the offline probe. */
export function relationshipRangeKey(range: ChartsRelationshipRange): string {
  return rangeWindow(range)
}
