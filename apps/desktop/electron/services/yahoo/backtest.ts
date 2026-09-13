import type {
  BacktestInterval,
  BacktestPayload,
  BacktestPriceSeries,
  BacktestRequest,
} from '../../shared/contract.js'
import { calculateBuyHoldBacktest, normalizeBacktestRows } from '../../shared/backtest.js'
import { getYahooSeries, type YahooSeriesRow } from './series.js'

export const BACKTEST_SOURCE = 'Yahoo Finance adjusted history'

interface BacktestServiceResult {
  payload: BacktestPayload
  stale: boolean
  fromCache: boolean
  cacheAgeSeconds: number
}

function yahooInterval(interval: BacktestInterval): '1d' | '1wk' {
  return interval === '1W' ? '1wk' : '1d'
}

/** One adjusted-close series, matching yfinance `auto_adjust=False` + `Adj Close`. */
export async function fetchBacktestSeries(
  symbolInput: string,
  interval: BacktestInterval,
): Promise<BacktestPriceSeries> {
  const symbol = symbolInput.trim().toUpperCase()
  if (!symbol) return { dates: [], values: [] }
  const result = await getYahooSeries({
    symbol,
    start: new Date(Date.UTC(1970, 0, 1)),
    interval: yahooInterval(interval),
    force: true,
    variant: 'adjusted',
  })
  return backtestSeries(symbol, result.rows)
}

function backtestSeries(symbol: string, rows: YahooSeriesRow[]): BacktestPriceSeries {
  const byDate = new Map<string, number>()
  for (const row of rows) {
    const close = typeof row.adjclose === 'number' ? row.adjclose : row.close
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue
    byDate.set(new Date(row.time * 1000).toISOString().slice(0, 10), close)
  }
  const dates = [...byDate.keys()].sort()
  if (dates.length < 2) throw new Error(`No history returned for ${symbol}.`)
  return { dates, values: dates.map((date) => byDate.get(date)!) }
}

async function cachedSeries(
  symbol: string,
  interval: BacktestInterval,
  force: boolean,
) {
  const result = await getYahooSeries({
    symbol,
    start: new Date(Date.UTC(1970, 0, 1)),
    interval: yahooInterval(interval),
    force,
    variant: 'adjusted',
  })
  return {
    value: backtestSeries(symbol, result.rows),
    stale: result.stale,
    fromCache: result.fromCache,
    ageSeconds: result.cacheAgeSeconds,
  }
}

export async function getBacktest(request: BacktestRequest): Promise<BacktestServiceResult> {
  const normalized = normalizeBacktestRows(request.rows)
  if (!normalized.rows.length) throw new Error('Add at least one ticker with a positive weight.')
  const symbols = normalized.rows.map((row) => row.symbol)
  const compareSymbol = request.compareSymbol.trim().toUpperCase()
  const requested = [...new Set([...symbols, compareSymbol].filter(Boolean))]
  const settled = await Promise.allSettled(
    requested.map((symbol) => cachedSeries(symbol, request.interval, Boolean(request.force))),
  )
  const results = new Map<string, Awaited<ReturnType<typeof cachedSeries>>>()
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') results.set(requested[index], outcome.value)
  })
  const missing = symbols.filter((symbol) => !results.has(symbol))
  if (missing.length) throw new Error(`No valid price data for: ${missing.join(', ')}.`)

  const priceSeries = Object.fromEntries(
    symbols.map((symbol) => [symbol, results.get(symbol)!.value]),
  )
  const payload = calculateBuyHoldBacktest(priceSeries, normalized.rows, {
    range: request.range,
    compareSymbol,
    compareSeries: results.get(compareSymbol)?.value,
  })
  const used = symbols.map((symbol) => results.get(symbol)!)
  const compareResult = compareSymbol ? results.get(compareSymbol) : undefined
  if (compareResult) used.push(compareResult)
  return {
    payload,
    stale: used.some((entry) => entry.stale),
    fromCache: used.every((entry) => entry.fromCache),
    cacheAgeSeconds: Math.max(0, ...used.map((entry) => entry.ageSeconds)),
  }
}
