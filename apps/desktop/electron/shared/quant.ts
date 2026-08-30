import type {
  QuantPairDetail,
  QuantPairFilter,
  QuantPairPoint,
  QuantPairRow,
  QuantPageSettings,
  QuantScanPayload,
  QuantScreenFilter,
  QuantScreenRow,
} from './contract.js'

export interface QuantBar {
  date: string
  close: number
  volume: number | null
}

export interface QuantCandidate {
  ticker: string
  name: string
  exchange: string
  marketCap: number
  medianDollarVolume: number
}

export const QUANT_SCREEN_FILTERS: ReadonlyArray<{ label: string; value: QuantScreenFilter }> = [
  { label: 'All ranked', value: 'all' },
  { label: 'Top quartile', value: 'top_quartile' },
  { label: 'Positive 6M momentum', value: 'momentum' },
  { label: 'Oversold (RSI < 35)', value: 'oversold' },
  { label: 'Overbought (RSI > 65)', value: 'overbought' },
  { label: 'Low volatility', value: 'low_volatility' },
]

export const QUANT_PAIR_FILTERS: ReadonlyArray<{ label: string; value: QuantPairFilter }> = [
  { label: 'All pairs', value: 'all' },
  { label: 'Stationary (5% or better)', value: 'stationary' },
  { label: 'Spread stretched (|Z| > 2)', value: 'stretched' },
  { label: 'Fast reversion (half-life < 20d)', value: 'fast' },
]

export const DEFAULT_QUANT_PAGE_SETTINGS: QuantPageSettings = {
  activeTab: 'screener',
  screenFilter: 'all',
  pairFilter: 'all',
  search: '',
  pairLeft: '',
  pairRight: '',
}

export const DICKEY_FULLER_CRITICAL_VALUES = { '1%': -3.43, '5%': -2.86, '10%': -2.57 } as const
export const MIN_PAIR_OBSERVATIONS = 60

const TRADING_DAYS = 252
const MOMENTUM_WINDOWS = [
  ['momentum1m', 21],
  ['momentum3m', 63],
  ['momentum6m', 126],
  ['momentum12m', 252],
] as const

function finite(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sampleStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null
  const average = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
  return variance > 0 && Number.isFinite(variance) ? Math.sqrt(variance) : variance === 0 ? 0 : null
}

function cleanBars(input: QuantBar[]): QuantBar[] {
  const byDate = new Map<string, QuantBar>()
  for (const bar of input) {
    const close = finite(bar.close)
    const volume = finite(bar.volume)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || close === null || close <= 0) continue
    byDate.set(bar.date, { date: bar.date, close, volume })
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

export interface OlsResult {
  beta: number
  alpha: number
  residuals: number[]
  observations: number
  standardError: number | null
  tStatistic: number | null
}

/** Closed-form `y = alpha + beta*x`, matching the Qt-free PySide6 service. */
export function ordinaryLeastSquares(yValues: number[], xValues: number[]): OlsResult | null {
  const pairs = yValues.flatMap((y, index) => {
    const x = xValues[index]
    return Number.isFinite(y) && Number.isFinite(x) ? [[y, x] as const] : []
  })
  if (pairs.length < 3) return null
  const xs = pairs.map((pair) => pair[1])
  const ys = pairs.map((pair) => pair[0])
  const xMean = mean(xs)
  const yMean = mean(ys)
  const denominator = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0)
  if (!Number.isFinite(denominator) || denominator <= 0) return null
  const beta = xs.reduce((sum, x, index) => sum + (x - xMean) * (ys[index] - yMean), 0) / denominator
  const alpha = yMean - beta * xMean
  if (!Number.isFinite(beta) || !Number.isFinite(alpha)) return null
  const residuals = ys.map((y, index) => y - (alpha + beta * xs[index]))
  const residualSumSquares = residuals.reduce((sum, value) => sum + value ** 2, 0)
  let standardError: number | null = null
  let tStatistic: number | null = null
  if (residualSumSquares > 0) {
    const candidate = Math.sqrt((residualSumSquares / (pairs.length - 2)) / denominator)
    if (Number.isFinite(candidate) && candidate > 0) {
      standardError = candidate
      tStatistic = beta / candidate
    }
  }
  return { beta, alpha, residuals, observations: pairs.length, standardError, tStatistic }
}

export function hurstExponent(values: number[], maxLag = 20): number | null {
  if (values.length < maxLag * 3) return null
  const logLags: number[] = []
  const logDispersion: number[] = []
  for (let lag = 2; lag <= maxLag; lag += 1) {
    const differences = values.slice(lag).map((value, index) => value - values[index])
    if (differences.length < 8) continue
    const dispersion = sampleStandardDeviation(differences)
    if (dispersion === null || dispersion <= 0) continue
    logLags.push(Math.log(lag))
    logDispersion.push(Math.log(dispersion))
  }
  if (logLags.length < 4) return null
  return ordinaryLeastSquares(logDispersion, logLags)?.beta ?? null
}

export function meanReversionStats(spread: number[]): {
  halfLife: number | null
  dickeyFuller: number | null
  stationaryAt: string
  observations: number
  decay: number | null
} {
  if (spread.length < MIN_PAIR_OBSERVATIONS) {
    return { halfLife: null, dickeyFuller: null, stationaryAt: '', observations: spread.length, decay: null }
  }
  const fit = ordinaryLeastSquares(
    spread.slice(1).map((value, index) => value - spread[index]),
    spread.slice(0, -1),
  )
  if (!fit) return { halfLife: null, dickeyFuller: null, stationaryAt: '', observations: spread.length, decay: null }
  const halfLife = fit.beta < 0 ? -Math.log(2) / fit.beta : null
  const statistic = fit.tStatistic
  let stationaryAt = ''
  if (statistic !== null) {
    for (const label of ['1%', '5%', '10%'] as const) {
      if (statistic <= DICKEY_FULLER_CRITICAL_VALUES[label]) {
        stationaryAt = label
        break
      }
    }
  }
  return {
    halfLife: halfLife !== null && Number.isFinite(halfLife) && halfLife > 0 ? halfLife : null,
    dickeyFuller: statistic,
    stationaryAt,
    observations: fit.observations,
    decay: fit.beta,
  }
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null
  const leftMean = mean(left)
  const rightMean = mean(right)
  const numerator = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0)
  const leftScale = Math.sqrt(left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0))
  const rightScale = Math.sqrt(right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0))
  const result = numerator / (leftScale * rightScale)
  return Number.isFinite(result) ? result : null
}

interface PairSpread {
  dates: string[]
  left: number[]
  right: number[]
  spread: number[]
  spreadZ: Array<number | null>
  hedgeRatio: number | null
  intercept: number | null
  latestZ: number | null
  correlation: number | null
  observations: number
}

export function buildPairSpread(leftInput: QuantBar[], rightInput: QuantBar[], zWindow = 60): PairSpread {
  const leftMap = new Map(cleanBars(leftInput).map((bar) => [bar.date, bar.close]))
  const rightMap = new Map(cleanBars(rightInput).map((bar) => [bar.date, bar.close]))
  const dates = [...leftMap.keys()].filter((date) => rightMap.has(date)).sort()
  const left = dates.map((date) => leftMap.get(date)!)
  const right = dates.map((date) => rightMap.get(date)!)
  const empty = {
    dates,
    left,
    right,
    spread: [] as number[],
    spreadZ: [] as Array<number | null>,
    hedgeRatio: null,
    intercept: null,
    latestZ: null,
    correlation: null,
    observations: dates.length,
  }
  if (dates.length < MIN_PAIR_OBSERVATIONS) return empty
  const fit = ordinaryLeastSquares(left, right)
  if (!fit) return empty
  const window = Math.max(2, Math.trunc(zWindow))
  const spreadZ = fit.residuals.map((_value, index) => {
    if (index + 1 < window) return null
    const sample = fit.residuals.slice(index + 1 - window, index + 1)
    const deviation = sampleStandardDeviation(sample)
    return deviation && deviation > 0 ? (fit.residuals[index] - mean(sample)) / deviation : null
  })
  const leftReturns = left.slice(1).map((value, index) => value / left[index] - 1)
  const rightReturns = right.slice(1).map((value, index) => value / right[index] - 1)
  return {
    dates,
    left,
    right,
    spread: fit.residuals,
    spreadZ,
    hedgeRatio: fit.beta,
    intercept: fit.alpha,
    latestZ: [...spreadZ].reverse().find((value): value is number => value !== null) ?? null,
    correlation: leftReturns.length >= 5 ? correlation(leftReturns, rightReturns) : null,
    observations: dates.length,
  }
}

export function scorePair(stats: {
  correlation: number | null
  halfLife: number | null
  dickeyFuller: number | null
  hurst: number | null
}): number | null {
  if (stats.correlation === null || stats.halfLife === null) return null
  let score = 40 * Math.min(Math.abs(stats.correlation), 1)
  if (stats.halfLife >= 1 && stats.halfLife <= 120) {
    score += 25 * Math.exp(-Math.abs(Math.log(stats.halfLife / 10)))
  }
  if (stats.dickeyFuller !== null) score += 25 * Math.max(0, Math.min(1, (-stats.dickeyFuller - 1.5) / 2))
  if (stats.hurst !== null) score += 10 * Math.max(0, Math.min(1, (0.5 - stats.hurst) / 0.3))
  return Math.round(score * 100) / 100
}

function wilderRsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null
  let averageGain = 0
  let averageLoss = 0
  let ready = false
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1]
    const gain = Math.max(delta, 0)
    const loss = Math.max(-delta, 0)
    if (!ready) {
      averageGain += gain
      averageLoss += loss
      if (index === period) {
        averageGain /= period
        averageLoss /= period
        ready = true
      }
    } else {
      averageGain = (averageGain * (period - 1) + gain) / period
      averageLoss = (averageLoss * (period - 1) + loss) / period
    }
  }
  if (!ready || averageLoss <= 0) return null
  return Math.max(0, Math.min(100, 100 - 100 / (1 + averageGain / averageLoss)))
}

export function screenMetrics(input: QuantBar[]): Omit<QuantScreenRow, 'ticker' | 'name' | 'exchange' | 'marketCap' | 'composite' | 'rank'> {
  const bars = cleanBars(input)
  const closes = bars.map((bar) => bar.close)
  const latest = closes.at(-1) ?? null
  const momentum: Record<string, number | null> = {}
  for (const [key, window] of MOMENTUM_WINDOWS) {
    momentum[key] = latest !== null && closes.length > window
      ? (latest / closes[closes.length - window - 1] - 1) * 100
      : null
  }
  const returns = closes.slice(1).map((value, index) => value / closes[index] - 1)
  const returnDeviation = returns.length >= 20 ? sampleStandardDeviation(returns) : null
  let peak = Number.NEGATIVE_INFINITY
  let maxDrawdownPct: number | null = null
  for (const close of closes) {
    peak = Math.max(peak, close)
    const drawdown = (close / peak - 1) * 100
    maxDrawdownPct = maxDrawdownPct === null ? drawdown : Math.min(maxDrawdownPct, drawdown)
  }
  const recent = closes.slice(-50)
  const recentDeviation = recent.length >= 50 ? sampleStandardDeviation(recent) : null
  const dollarVolumes = bars.flatMap((bar) => bar.volume !== null && bar.volume > 0 ? [bar.close * bar.volume] : []).slice(-20)
  dollarVolumes.sort((left, right) => left - right)
  const middle = Math.floor(dollarVolumes.length / 2)
  const medianDollarVolume = !dollarVolumes.length
    ? null
    : dollarVolumes.length % 2
      ? dollarVolumes[middle]
      : (dollarVolumes[middle - 1] + dollarVolumes[middle]) / 2
  return {
    lastPrice: latest,
    medianDollarVolume,
    momentum1m: momentum.momentum1m,
    momentum3m: momentum.momentum3m,
    momentum6m: momentum.momentum6m,
    momentum12m: momentum.momentum12m,
    volatilityPct: returnDeviation && returnDeviation > 0 ? returnDeviation * Math.sqrt(TRADING_DAYS) * 100 : null,
    sharpe: returnDeviation && returnDeviation > 0 ? mean(returns) / returnDeviation * Math.sqrt(TRADING_DAYS) : null,
    maxDrawdownPct,
    zScore: latest !== null && recentDeviation && recentDeviation > 0 ? (latest - mean(recent)) / recentDeviation : null,
    rsi: wilderRsi(closes),
    observations: closes.length,
  }
}

function percentileRanks(values: Array<number | null>): Array<number | null> {
  const available = values.flatMap((value, index) => value === null ? [] : [{ value, index }])
  available.sort((left, right) => left.value - right.value)
  const output: Array<number | null> = values.map(() => null)
  let cursor = 0
  while (cursor < available.length) {
    let end = cursor + 1
    while (end < available.length && available[end].value === available[cursor].value) end += 1
    const averageRank = ((cursor + 1) + end) / 2
    for (let index = cursor; index < end; index += 1) output[available[index].index] = averageRank / available.length * 100
    cursor = end
  }
  return output
}

export function rankScreenRows(rows: QuantScreenRow[]): QuantScreenRow[] {
  if (!rows.length) return []
  const momentumRanks = ['momentum3m', 'momentum6m', 'momentum12m'].map((key) =>
    percentileRanks(rows.map((row) => row[key as keyof QuantScreenRow] as number | null)),
  )
  const sharpeRanks = percentileRanks(rows.map((row) => row.sharpe))
  const volatilityRanks = percentileRanks(rows.map((row) => row.volatilityPct === null ? null : -row.volatilityPct))
  return rows.map((row, index) => {
    const momentum = momentumRanks.flatMap((ranks) => ranks[index] === null ? [] : [ranks[index]!])
    const parts: Array<[number, number]> = []
    if (momentum.length) parts.push([mean(momentum), 0.5])
    if (sharpeRanks[index] !== null) parts.push([sharpeRanks[index]!, 0.3])
    if (volatilityRanks[index] !== null) parts.push([volatilityRanks[index]!, 0.2])
    const weight = parts.reduce((sum, part) => sum + part[1], 0)
    const composite = weight ? Math.round(parts.reduce((sum, part) => sum + part[0] * part[1], 0) / weight * 100) / 100 : null
    return { ...row, composite }
  }).sort((left, right) => (right.composite ?? -1) - (left.composite ?? -1) || left.ticker.localeCompare(right.ticker))
    .map((row, index) => ({ ...row, rank: index + 1 }))
}

export function discoverPairs(
  histories: Record<string, QuantBar[]>,
  options: { prescreenLimit?: number; resultLimit?: number } = {},
): QuantPairRow[] {
  const tickers = Object.keys(histories).filter((ticker) => cleanBars(histories[ticker]).length >= MIN_PAIR_OBSERVATIONS)
  const prescreened: Array<{ left: string; right: string; correlation: number }> = []
  for (let leftIndex = 0; leftIndex < tickers.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tickers.length; rightIndex += 1) {
      const spread = buildPairSpread(histories[tickers[leftIndex]], histories[tickers[rightIndex]])
      if (spread.correlation !== null) prescreened.push({ left: tickers[leftIndex], right: tickers[rightIndex], correlation: spread.correlation })
    }
  }
  prescreened.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation) || a.left.localeCompare(b.left) || a.right.localeCompare(b.right))
  const rows = prescreened.slice(0, options.prescreenLimit ?? 150).flatMap(({ left, right }) => {
    const spread = buildPairSpread(histories[left], histories[right])
    if (!spread.spread.length) return []
    const reversion = meanReversionStats(spread.spread)
    const hurst = hurstExponent(spread.spread)
    const score = scorePair({ correlation: spread.correlation, halfLife: reversion.halfLife, dickeyFuller: reversion.dickeyFuller, hurst })
    if (score === null) return []
    return [{
      left,
      right,
      correlation: spread.correlation,
      hedgeRatio: spread.hedgeRatio,
      spreadZ: spread.latestZ,
      halfLife: reversion.halfLife,
      hurst,
      dickeyFuller: reversion.dickeyFuller,
      stationaryAt: reversion.stationaryAt,
      score,
      rank: 0,
      observations: spread.observations,
    }]
  })
  return rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.left.localeCompare(b.left) || a.right.localeCompare(b.right))
    .slice(0, options.resultLimit ?? 40)
    .map((row, index) => ({ ...row, rank: index + 1 }))
}

export function buildPairDetail(left: string, right: string, leftBars: QuantBar[], rightBars: QuantBar[]): QuantPairDetail {
  const spread = buildPairSpread(leftBars, rightBars)
  if (!spread.spread.length) throw new Error('The selected tickers have too little overlapping history to model.')
  const reversion = meanReversionStats(spread.spread)
  const hurst = hurstExponent(spread.spread)
  const score = scorePair({ correlation: spread.correlation, halfLife: reversion.halfLife, dickeyFuller: reversion.dickeyFuller, hurst })
  const leftBase = spread.left[0]
  const rightBase = spread.right[0]
  const leftReturns = spread.left.slice(1).map((value, index) => value / spread.left[index] - 1)
  const rightReturns = spread.right.slice(1).map((value, index) => value / spread.right[index] - 1)
  const points: QuantPairPoint[] = spread.dates.map((date, index) => ({
    date,
    spreadZ: spread.spreadZ[index],
    leftIndexed: spread.left[index] / leftBase * 100,
    rightIndexed: spread.right[index] / rightBase * 100,
    rollingCorrelation: index >= 120 ? correlation(leftReturns.slice(index - 120, index), rightReturns.slice(index - 120, index)) : null,
  }))
  return {
    left,
    right,
    hedgeRatio: spread.hedgeRatio,
    intercept: spread.intercept,
    latestZ: spread.latestZ,
    correlation: spread.correlation,
    halfLife: reversion.halfLife,
    dickeyFuller: reversion.dickeyFuller,
    stationaryAt: reversion.stationaryAt,
    hurst,
    score,
    observations: spread.observations,
    points,
  }
}

export function normalizeQuantPageSettings(value: unknown): QuantPageSettings {
  const input = value && typeof value === 'object' ? value as Partial<QuantPageSettings> : {}
  const screenFilters = new Set(QUANT_SCREEN_FILTERS.map((entry) => entry.value))
  const pairFilters = new Set(QUANT_PAIR_FILTERS.map((entry) => entry.value))
  const symbol = (item: unknown) => String(item ?? '').trim().toUpperCase().slice(0, 12)
  return {
    activeTab: input.activeTab === 'pairs' ? 'pairs' : 'screener',
    screenFilter: (screenFilters.has(String(input.screenFilter) as QuantScreenFilter) ? input.screenFilter : 'all') as QuantScreenFilter,
    pairFilter: (pairFilters.has(String(input.pairFilter) as QuantPairFilter) ? input.pairFilter : 'all') as QuantPairFilter,
    search: symbol(input.search),
    pairLeft: symbol(input.pairLeft),
    pairRight: symbol(input.pairRight),
  }
}

export function filterScreenRows(rows: QuantScreenRow[], filter: QuantScreenFilter, search = ''): QuantScreenRow[] {
  let filtered = rows
  if (filter === 'top_quartile') filtered = rows.filter((row) => (row.composite ?? 0) >= 75)
  else if (filter === 'momentum') filtered = rows.filter((row) => (row.momentum6m ?? 0) > 0)
  else if (filter === 'oversold') filtered = rows.filter((row) => row.rsi !== null && row.rsi < 35)
  else if (filter === 'overbought') filtered = rows.filter((row) => row.rsi !== null && row.rsi > 65)
  else if (filter === 'low_volatility') {
    const values = rows.flatMap((row) => row.volatilityPct === null ? [] : [row.volatilityPct]).sort((a, b) => a - b)
    const median = values[Math.floor(values.length / 2)]
    if (median !== undefined) filtered = rows.filter((row) => row.volatilityPct !== null && row.volatilityPct <= median)
  }
  const needle = search.trim().toUpperCase()
  return needle ? filtered.filter((row) => row.ticker.includes(needle)) : [...filtered]
}

export function filterPairRows(rows: QuantPairRow[], filter: QuantPairFilter): QuantPairRow[] {
  if (filter === 'stationary') return rows.filter((row) => row.stationaryAt === '1%' || row.stationaryAt === '5%')
  if (filter === 'stretched') return rows.filter((row) => row.spreadZ !== null && Math.abs(row.spreadZ) >= 2)
  if (filter === 'fast') return rows.filter((row) => row.halfLife !== null && row.halfLife < 20)
  return [...rows]
}

export function describeDickeyFuller(statistic: number | null, stationaryAt: string): string {
  if (statistic === null) return 'Dickey-Fuller (constant, no lags): not enough history.'
  const verdict = stationaryAt ? `stationary at the ${stationaryAt} level` : 'not stationary at the 10% level'
  return `Dickey-Fuller (constant, no lags) = ${statistic.toFixed(2)}; ${verdict}. Critical values: 1% -3.43, 5% -2.86, 10% -2.57.`
}

const percent = (value: number | null) => value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
const plain = (value: number | null, digits = 1) => value === null ? '—' : value.toFixed(digits)
const price = (value: number | null) => value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const halfLife = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}d`
const cell = (value: unknown) => String(value ?? '—').replaceAll('|', '/').replaceAll('\n', ' ').trim() || '—'
const row = (values: unknown[]) => `| ${values.map(cell).join(' | ')} |`

export function buildQuantExport(
  payload: QuantScanPayload | null,
  options: {
    screenRows: QuantScreenRow[]
    pairRows: QuantPairRow[]
    screenFilterLabel: string
    pairFilterLabel: string
    search: string
    pairDetail: QuantPairDetail | null
    generatedAt?: Date
  },
): string {
  const stamp = options.generatedAt ?? new Date()
  const lines = ['# Quant Screener & Pairs Export', `Generated: ${stamp.toISOString().slice(0, 19)}`]
  if (!payload?.rows.length) return [...lines, '', 'No scan has been run yet — there is nothing to analyse.'].join('\n')
  lines.push(
    `Source: ${payload.source}`,
    `Scan completed: ${payload.completedAt}`,
    `Universe size: ${payload.universeSize} · ranked ${payload.rows.length} · pairs ${payload.pairs.length}`,
    `Data errors: ${Object.keys(payload.errors).length}`,
    '',
    'Universe: US common stocks · price >= $5 · market cap >= $2B · 20-session median dollar volume >= $20M.',
    'Composite is a cross-sectional percentile: 50% momentum (3/6/12M), 30% Sharpe, 20% low volatility.',
    'Decision support only — not investment advice.',
    '',
    '## Screener',
    `Filter: ${options.screenFilterLabel}${options.search ? ` · ticker search: ${options.search.toUpperCase()}` : ''} · ${options.screenRows.length} of ${payload.rows.length} rows shown`,
    '',
    '| Rank | Ticker | Price | 1M % | 3M % | 6M % | 12M % | Vol % | Sharpe | Max DD % | Z-Score | RSI | Composite |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  )
  for (const item of options.screenRows) lines.push(row([item.rank, item.ticker, price(item.lastPrice), percent(item.momentum1m), percent(item.momentum3m), percent(item.momentum6m), percent(item.momentum12m), plain(item.volatilityPct), plain(item.sharpe, 2), percent(item.maxDrawdownPct), plain(item.zScore, 2), plain(item.rsi), plain(item.composite)]))
  if (!options.screenRows.length) lines.push('_No screener rows match the active filter._')
  lines.push(
    '',
    '## Pairs',
    'Spreads are fitted by OLS on price levels and tested for mean reversion. Many pairs are tested at once, so roughly 1 in 20 clears the 5% Dickey-Fuller threshold by chance — treat a stationary verdict as a shortlist, not a conclusion.',
    `Filter: ${options.pairFilterLabel} · ${options.pairRows.length} of ${payload.pairs.length} rows shown`,
    '',
    '| Rank | Long | Short | Corr | Hedge | Spread Z | Half-life | Hurst | DF stat | Stationary | Score |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  )
  for (const item of options.pairRows) lines.push(row([item.rank, item.left, item.right, plain(item.correlation, 2), plain(item.hedgeRatio, 3), plain(item.spreadZ, 2), halfLife(item.halfLife), plain(item.hurst, 2), plain(item.dickeyFuller, 2), item.stationaryAt || 'no', plain(item.score)]))
  if (!options.pairRows.length) lines.push('_No pairs match the active filter._')
  if (options.pairDetail) {
    const detail = options.pairDetail
    lines.push('', '## Inspected pair', '', `Pair: long ${detail.left} / short ${detail.right}`, `Hedge ratio: ${plain(detail.hedgeRatio, 3)} shares of ${detail.right} per share of ${detail.left}`, `Correlation of daily returns: ${plain(detail.correlation, 2)}`, `Spread Z-score: ${plain(detail.latestZ, 2)}`, `Half-life of mean reversion: ${halfLife(detail.halfLife)}`, `Hurst exponent: ${plain(detail.hurst, 2)}`, describeDickeyFuller(detail.dickeyFuller, detail.stationaryAt), `Overlapping sessions: ${detail.observations}`)
  }
  if (Object.keys(payload.errors).length) {
    lines.push('', '## Tickers with incomplete history', '')
    for (const [ticker, message] of Object.entries(payload.errors).sort()) lines.push(`- ${ticker}: ${message || 'no detail'}`)
  }
  return lines.join('\n')
}
