/**
 * Portfolio analytics, ported from `workers/market_metrics.py` in the PySide6 app.
 *
 * Everything here is pure so the probe scripts and the renderer can both use it and
 * the numbers cannot drift from the reference implementation.
 */

/** Trading days per year, matching `_ANNUALIZATION_DAYS`. */
export const ANNUALIZATION_DAYS = 252

export interface RiskMetrics {
  beta: number | null
  alpha: number | null
  volatility: number | null
  maxDrawdown: number | null
  sharpe: number | null
  sortino: number | null
  cagr: number | null
  tailRisk: number | null
  skewness: number | null
}

export function emptyRiskMetrics(): RiskMetrics {
  return {
    beta: null,
    alpha: null,
    volatility: null,
    maxDrawdown: null,
    sharpe: null,
    sortino: null,
    cagr: null,
    tailRisk: null,
    skewness: null,
  }
}

/* ------------------------------------------------------------ basic series */

export function pctChange(values: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < values.length; i += 1) {
    const previous = values[i - 1]
    if (previous === 0) continue
    out.push(values[i] / previous - 1)
  }
  return out
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

/** Sample standard deviation (ddof=1), which is what pandas `.std()` defaults to. */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

export function variance(values: number[]): number {
  return stdDev(values) ** 2
}

export function covariance(left: number[], right: number[]): number {
  const count = Math.min(left.length, right.length)
  if (count < 2) return 0
  const leftMean = mean(left.slice(0, count))
  const rightMean = mean(right.slice(0, count))
  let total = 0
  for (let i = 0; i < count; i += 1) {
    total += (left[i] - leftMean) * (right[i] - rightMean)
  }
  return total / (count - 1)
}

/** Fisher-Pearson skew with the sample bias correction, matching pandas `.skew()`. */
export function skew(values: number[]): number | null {
  const count = values.length
  if (count < 3) return null
  const average = mean(values)
  const deviation = stdDev(values)
  if (deviation === 0) return 0
  const cubed = values.reduce((sum, value) => sum + ((value - average) / deviation) ** 3, 0)
  const result = (count / ((count - 1) * (count - 2))) * cubed
  return Number.isFinite(result) ? result : 0
}

export function quantile(values: number[], fraction: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  // Linear interpolation between order statistics, as pandas does by default.
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

/** Exponential moving average with `adjust=False`, matching pandas `.ewm()`. */
export function ema(values: number[], span: number): number[] {
  if (!values.length) return []
  const alpha = 2 / (span + 1)
  const out = [values[0]]
  for (let i = 1; i < values.length; i += 1) {
    out.push(values[i] * alpha + out[i - 1] * (1 - alpha))
  }
  return out
}

/* --------------------------------------------------------------- portfolio */

export interface PortfolioSeries {
  /** Dates in `YYYY-MM-DD`, ascending. */
  dates: string[]
  /** Total portfolio value on each date, cash included. */
  values: number[]
}

/**
 * Combine per-ticker close series into one portfolio value series.
 *
 * Only dates every included ticker has are used — the reference intersects the indexes
 * before summing, so one thinly traded name shortens the window rather than injecting
 * gaps into the total.
 */
export function buildPortfolioSeries(
  positions: Array<{ ticker: string; shares: number }>,
  closes: Record<string, { dates: string[]; values: number[] }>,
  cashAmount = 0,
): { series: PortfolioSeries; included: string[]; excluded: string[] } {
  const included: string[] = []
  const excluded: string[] = []
  const usable: Array<{ ticker: string; shares: number; byDate: Map<string, number> }> = []

  for (const position of positions) {
    const history = closes[position.ticker]
    if (!history || history.dates.length < 2) {
      excluded.push(position.ticker)
      continue
    }
    included.push(position.ticker)
    usable.push({
      ...position,
      byDate: new Map(history.dates.map((date, index) => [date, history.values[index]])),
    })
  }

  if (!usable.length) {
    if (cashAmount > 0) {
      return { series: { dates: [], values: [] }, included: ['CASH'], excluded }
    }
    return { series: { dates: [], values: [] }, included, excluded }
  }

  let common = new Set(usable[0].byDate.keys())
  for (const entry of usable.slice(1)) {
    common = new Set([...common].filter((date) => entry.byDate.has(date)))
  }
  const dates = [...common].sort()

  const values = dates.map((date) =>
    usable.reduce((total, entry) => total + (entry.byDate.get(date) ?? 0) * entry.shares, 0),
  )
  const withCash = cashAmount > 0 ? values.map((value) => value + cashAmount) : values

  return {
    series: { dates, values: withCash },
    included: cashAmount > 0 ? [...included, 'CASH'] : included,
    excluded,
  }
}

/** Percent return of the series against its first value — the momentum line. */
export function toReturnSeries(series: PortfolioSeries): number[] {
  const start = series.values[0]
  if (!start) return series.values.map(() => 0)
  return series.values.map((value) => (value / start - 1) * 100)
}

/* ------------------------------------------------------------ risk metrics */

export function computeRiskMetrics(
  series: PortfolioSeries,
  benchmark?: { dates: string[]; values: number[] } | null,
): { metrics: RiskMetrics; note: string } {
  const metrics = emptyRiskMetrics()
  if (series.values.length < 2) return { metrics, note: '' }

  const returns = pctChange(series.values)
  if (returns.length >= 2) {
    const averageReturn = mean(returns)
    const deviation = stdDev(returns)
    if (deviation > 0) {
      metrics.volatility = deviation * Math.sqrt(ANNUALIZATION_DAYS) * 100
      metrics.sharpe = (averageReturn / deviation) * Math.sqrt(ANNUALIZATION_DAYS)
    } else {
      metrics.volatility = 0
    }

    // Downside deviation clips gains to zero rather than dropping them, so quiet days
    // still count in the denominator. That is what the reference does.
    const downside = returns.map((value) => Math.min(value, 0))
    const downsideDeviation = Math.sqrt(mean(downside.map((value) => value ** 2)))
    if (downsideDeviation > 0) {
      metrics.sortino = (averageReturn / downsideDeviation) * Math.sqrt(ANNUALIZATION_DAYS)
    }

    metrics.skewness = skew(returns)

    const cutoff = quantile(returns, 0.05)
    const tail = returns.filter((value) => value <= cutoff)
    if (tail.length) metrics.tailRisk = mean(tail) * 100
  }

  let peak = -Infinity
  let worst = 0
  for (const value of series.values) {
    peak = Math.max(peak, value)
    if (peak > 0) worst = Math.min(worst, value / peak - 1)
  }
  metrics.maxDrawdown = worst * 100

  const startValue = series.values[0]
  const endValue = series.values[series.values.length - 1]
  const startTime = Date.parse(series.dates[0])
  const endTime = Date.parse(series.dates[series.dates.length - 1])
  let elapsedYears = (endTime - startTime) / (365.25 * 24 * 60 * 60 * 1000)
  if (elapsedYears <= 0) elapsedYears = (series.values.length - 1) / ANNUALIZATION_DAYS
  if (elapsedYears > 0 && startValue > 0 && endValue > 0) {
    metrics.cagr = ((endValue / startValue) ** (1 / elapsedYears) - 1) * 100
  }

  if (!benchmark || benchmark.dates.length < 2) {
    return { metrics, note: 'Benchmark unavailable; alpha and beta omitted.' }
  }

  // Align on shared dates before differencing, so a holiday in one series does not
  // shift the other's returns by a day.
  const benchmarkByDate = new Map(benchmark.dates.map((date, index) => [date, benchmark.values[index]]))
  const sharedDates = series.dates.filter((date) => benchmarkByDate.has(date))
  if (sharedDates.length < 3) {
    return { metrics, note: 'Benchmark did not overlap enough with portfolio history.' }
  }
  const seriesByDate = new Map(series.dates.map((date, index) => [date, series.values[index]]))
  const portfolioReturns = pctChange(sharedDates.map((date) => seriesByDate.get(date)!))
  const benchmarkReturns = pctChange(sharedDates.map((date) => benchmarkByDate.get(date)!))

  const benchmarkVariance = variance(benchmarkReturns)
  if (benchmarkVariance <= 0) {
    return { metrics, note: 'Benchmark had zero variance; alpha and beta omitted.' }
  }
  const beta = covariance(portfolioReturns, benchmarkReturns) / benchmarkVariance
  metrics.beta = beta
  metrics.alpha =
    (mean(portfolioReturns) - beta * mean(benchmarkReturns)) * ANNUALIZATION_DAYS * 100
  return { metrics, note: '' }
}

/* -------------------------------------------------------------- exposure */

export interface TopPosition {
  ticker: string
  value: number
  weightPct: number
}

export interface ExposureMetrics {
  holdingsCount: number
  valuedHoldingsCount: number
  unvaluedHoldingsCount: number
  coveragePct: number | null
  investedValue: number
  largestPositionTicker: string | null
  largestPositionValue: number | null
  topPositionWeight: number | null
  top3Weight: number | null
  top5Weight: number | null
  concentrationScore: number | null
  effectiveHoldings: number | null
  topPositions: TopPosition[]
}

export function computeExposure(
  holdingsCount: number,
  currentValues: Record<string, number>,
): ExposureMetrics {
  const priced = Object.entries(currentValues).filter(([, value]) => value > 0)
  const valuedHoldingsCount = priced.length
  const totalValue = priced.reduce((sum, [, value]) => sum + value, 0)

  const empty: ExposureMetrics = {
    holdingsCount,
    valuedHoldingsCount,
    unvaluedHoldingsCount: Math.max(holdingsCount - valuedHoldingsCount, 0),
    coveragePct: holdingsCount > 0 ? (valuedHoldingsCount / holdingsCount) * 100 : null,
    investedValue: 0,
    largestPositionTicker: null,
    largestPositionValue: null,
    topPositionWeight: null,
    top3Weight: null,
    top5Weight: null,
    concentrationScore: null,
    effectiveHoldings: null,
    topPositions: [],
  }
  if (totalValue <= 0) return empty

  const sorted = [...priced].sort((a, b) => b[1] - a[1])
  const weights = sorted.map(([, value]) => value / totalValue)
  // Herfindahl-Hirschman index; its reciprocal is the effective holding count.
  const concentrationScore = weights.reduce((sum, weight) => sum + weight * weight, 0)
  const sumOfFirst = (count: number) =>
    weights.slice(0, count).reduce((sum, weight) => sum + weight, 0) * 100

  return {
    ...empty,
    investedValue: totalValue,
    largestPositionTicker: sorted[0][0],
    largestPositionValue: sorted[0][1],
    topPositionWeight: weights[0] * 100,
    top3Weight: sumOfFirst(3),
    top5Weight: sumOfFirst(5),
    concentrationScore,
    effectiveHoldings: concentrationScore > 0 ? 1 / concentrationScore : null,
    topPositions: sorted.slice(0, 5).map(([ticker, value], index) => ({
      ticker,
      value,
      weightPct: weights[index] * 100,
    })),
  }
}

/* --------------------------------------------------------------- heatmap */

/** Σ(weight × change) / Σ(weight) across the tiles on screen. */
export function weightedMove(
  rows: Array<{ weight: number | null; changePct: number | null }>,
): number | null {
  let numerator = 0
  let denominator = 0
  for (const row of rows) {
    if (typeof row.weight !== 'number' || typeof row.changePct !== 'number') continue
    numerator += row.weight * row.changePct
    denominator += row.weight
  }
  return denominator > 0 ? numerator / denominator : null
}

/* --------------------------------------------------------------- options */

export const OPTION_STRATEGIES = ['Calls', 'Puts', 'Covered Call', 'Cash Secured Put'] as const
export const OPTION_STATUSES = ['Open', 'Closed', 'Expired', 'Assigned', 'Exercised'] as const

export type OptionStrategy = (typeof OPTION_STRATEGIES)[number]

/** Selling a call or put inverts the P&L and prices return against collateral. */
export function isSellerStrategy(strategy: string): boolean {
  return strategy === 'Covered Call' || strategy === 'Cash Secured Put'
}

export interface OptionMetrics {
  pnl: number
  returnPct: number
  annualPct: number
  daysToExpiry: number
}

export function computeOptionMetrics(position: {
  strategy: string
  contracts: number
  premium: number
  currentPrice: number
  strike: number
  expiry: string
  openDate: string
}): OptionMetrics {
  const seller = isSellerStrategy(position.strategy)
  const { premium, currentPrice, contracts, strike } = position

  const pnl = (seller ? premium - currentPrice : currentPrice - premium) * contracts * 100

  let returnPct = 0
  if (seller) {
    // The seller's return is the premium taken against the collateral put up.
    const capital = strike > 0 ? strike * contracts * 100 : 0
    returnPct = capital > 0 ? ((premium * contracts * 100) / capital) * 100 : 0
  } else {
    returnPct = premium > 0 ? ((currentPrice - premium) / premium) * 100 : 0
  }

  const today = new Date()
  const expiryTime = position.expiry ? Date.parse(position.expiry) : NaN
  const daysToExpiry = Number.isFinite(expiryTime)
    ? Math.max(0, Math.round((expiryTime - today.getTime()) / 86_400_000))
    : 0

  // Annualise over the life of the trade at the time it was opened, not what is left.
  let daysAtOpen = daysToExpiry
  const openTime = position.openDate ? Date.parse(position.openDate) : NaN
  if (Number.isFinite(openTime) && Number.isFinite(expiryTime)) {
    daysAtOpen = Math.max(1, Math.round((expiryTime - openTime) / 86_400_000))
  }
  const annualPct = returnPct * (365 / Math.max(1, daysAtOpen))

  return { pnl, returnPct, annualPct, daysToExpiry }
}
