import type {
  BacktestPageSettings,
  BacktestPayload,
  BacktestPriceSeries,
  BacktestRange,
  BacktestRow,
} from './contract.js'

export const BACKTEST_START_VALUE = 10_000

export const DEFAULT_BACKTEST_PAGE_SETTINGS: BacktestPageSettings = {
  rows: [{ symbol: 'SPY', weight: 100 }],
  compareSymbol: 'SPY',
  interval: '1D',
  range: 'Max',
  splitterSizes: [2, 5],
}

function finite(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** Persisted rows keep zero weights editable; a calculation only accepts positive rows. */
export function normalizeBacktestPageSettings(value: unknown): BacktestPageSettings {
  const input = value && typeof value === 'object' ? value as Partial<BacktestPageSettings> : {}
  const seen = new Set<string>()
  const rows = (Array.isArray(input.rows) ? input.rows : DEFAULT_BACKTEST_PAGE_SETTINGS.rows)
    .flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const symbol = String((row as Partial<BacktestRow>).symbol ?? '').trim().toUpperCase()
      if (!symbol || seen.has(symbol)) return []
      seen.add(symbol)
      return [{ symbol, weight: Math.min(Math.max(finite((row as Partial<BacktestRow>).weight), 0), 10_000) }]
    })
  const interval = input.interval === '1W' ? '1W' : '1D'
  const validRanges: BacktestRange[] = ['Max', '5Y', '3Y', '1Y', 'YTD']
  const range = validRanges.find((entry) => entry.toUpperCase() === String(input.range ?? '').toUpperCase()) ?? 'Max'
  const sizes = Array.isArray(input.splitterSizes)
    ? input.splitterSizes.slice(0, 2).map((entry) => Math.max(1, finite(entry, 1)))
    : [...DEFAULT_BACKTEST_PAGE_SETTINGS.splitterSizes]
  return {
    rows: rows.length ? rows : DEFAULT_BACKTEST_PAGE_SETTINGS.rows.map((row) => ({ ...row })),
    compareSymbol: String(input.compareSymbol ?? DEFAULT_BACKTEST_PAGE_SETTINGS.compareSymbol).trim().toUpperCase(),
    interval,
    range,
    splitterSizes: sizes.length === 2 ? sizes : [...DEFAULT_BACKTEST_PAGE_SETTINGS.splitterSizes],
  }
}

/** First occurrence wins, matching the PySide6 service's duplicate handling. */
export function normalizeBacktestRows(rows: unknown): { rows: BacktestRow[]; totalWeight: number } {
  const normalized: BacktestRow[] = []
  const seen = new Set<string>()
  let totalWeight = 0
  for (const value of Array.isArray(rows) ? rows : []) {
    if (!value || typeof value !== 'object') continue
    const row = value as Partial<BacktestRow>
    const symbol = String(row.symbol ?? '').trim().toUpperCase()
    const weight = finite(row.weight)
    if (!symbol || seen.has(symbol) || weight <= 0) continue
    seen.add(symbol)
    normalized.push({ symbol, weight })
    totalWeight += weight
  }
  return { rows: normalized, totalWeight }
}

function cleanSeries(series: BacktestPriceSeries | undefined): BacktestPriceSeries {
  const byDate = new Map<string, number>()
  if (series) {
    series.dates.forEach((date, index) => {
      const value = series.values[index]
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0) byDate.set(date, value)
    })
  }
  const dates = [...byDate.keys()].sort()
  return { dates, values: dates.map((date) => byDate.get(date)!) }
}

function yearsBefore(dateText: string, years: number): string {
  const date = new Date(`${dateText}T00:00:00Z`)
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  const year = date.getUTCFullYear() - years
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10)
}

function rangeStart(end: string, range: BacktestRange): string {
  if (range === 'Max') return '0000-01-01'
  if (range === 'YTD') return `${end.slice(0, 4)}-01-01`
  return yearsBefore(end, Number(range.slice(0, -1)))
}

export function emptyBacktestPayload(compareSymbol = ''): BacktestPayload {
  return {
    rows: [],
    weights: {},
    rawWeightTotal: 0,
    compareSymbol: compareSymbol.trim().toUpperCase(),
    compareError: '',
    points: [],
    stats: null,
  }
}

/** Pure buy-and-hold calculation ported from `services/backtest.py`. */
export function calculateBuyHoldBacktest(
  priceSeries: Record<string, BacktestPriceSeries>,
  rowsInput: unknown,
  options: {
    range?: BacktestRange
    compareSeries?: BacktestPriceSeries
    compareSymbol?: string
  } = {},
): BacktestPayload {
  const { rows, totalWeight } = normalizeBacktestRows(rowsInput)
  if (!rows.length) throw new Error('Add at least one ticker with a positive weight.')
  const weights = Object.fromEntries(rows.map((row) => [row.symbol, row.weight / totalWeight]))
  const cleaned = Object.fromEntries(rows.map((row) => [row.symbol, cleanSeries(priceSeries[row.symbol])]))
  const missing = rows.filter((row) => cleaned[row.symbol].dates.length < 2).map((row) => row.symbol)
  if (missing.length) throw new Error(`No valid price data for: ${missing.join(', ')}.`)

  const maps = Object.fromEntries(
    rows.map((row) => [
      row.symbol,
      new Map(cleaned[row.symbol].dates.map((date, index) => [date, cleaned[row.symbol].values[index]])),
    ]),
  )
  let dates = cleaned[rows[0].symbol].dates.filter((date) => rows.every((row) => maps[row.symbol].has(date)))
  if (dates.length) {
    const start = rangeStart(dates[dates.length - 1], options.range ?? 'Max')
    dates = dates.filter((date) => date >= start)
  }
  if (dates.length < 2) throw new Error('Not enough overlapping history for the selected range.')

  const firstValues = Object.fromEntries(rows.map((row) => [row.symbol, maps[row.symbol].get(dates[0])!]))
  const normalizedValues = dates.map((date) =>
    rows.reduce(
      (sum, row) => sum + (maps[row.symbol].get(date)! / firstValues[row.symbol]) * weights[row.symbol],
      0,
    ),
  )
  let peak = Number.NEGATIVE_INFINITY
  const returns = normalizedValues.map((value) => (value - 1) * 100)
  const drawdowns = normalizedValues.map((value) => {
    peak = Math.max(peak, value)
    return (value / peak - 1) * 100
  })

  const compareSymbol = String(options.compareSymbol ?? '').trim().toUpperCase()
  let compareError = ''
  const compareReturns = new Map<string, number>()
  if (compareSymbol) {
    const compare = cleanSeries(options.compareSeries)
    const start = dates[0]
    const end = dates[dates.length - 1]
    const windowDates = compare.dates.filter((date) => date >= start && date <= end)
    if (windowDates.length < 2) {
      compareError = `No valid compare data for ${compareSymbol} in the portfolio window.`
    } else {
      const compareMap = new Map(compare.dates.map((date, index) => [date, compare.values[index]]))
      const base = compareMap.get(windowDates[0])!
      let cursor = 0
      let current: number | null = null
      for (const date of dates) {
        while (cursor < windowDates.length && windowDates[cursor] <= date) {
          current = compareMap.get(windowDates[cursor])!
          cursor += 1
        }
        if (current !== null) compareReturns.set(date, (current / base - 1) * 100)
      }
      if (compareReturns.size < 2) {
        compareReturns.clear()
        compareError = `Compare data for ${compareSymbol} could not be aligned.`
      }
    }
  }

  const start = dates[0]
  const end = dates[dates.length - 1]
  const elapsedDays = Math.max(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
    0,
  )
  const lastValue = normalizedValues[normalizedValues.length - 1]
  const years = elapsedDays / 365.25
  const cagrPct = years > 0 && lastValue > 0 ? (lastValue ** (1 / years) - 1) * 100 : 0

  return {
    rows,
    weights,
    rawWeightTotal: totalWeight,
    compareSymbol,
    compareError,
    points: dates.map((date, index) => ({
      date,
      portfolioReturnPct: returns[index],
      drawdownPct: drawdowns[index],
      compareReturnPct: compareReturns.get(date) ?? null,
    })),
    stats: {
      start,
      end,
      totalReturnPct: returns[returns.length - 1],
      cagrPct,
      maxDrawdownPct: Math.min(...drawdowns),
      finalValue: BACKTEST_START_VALUE * lastValue,
    },
  }
}
