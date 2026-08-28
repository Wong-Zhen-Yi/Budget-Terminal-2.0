import type {
  Candle,
  ChartStats,
  ChartsComparePayload,
  ChartsCompareRequest,
  ChartsHistoryPayload,
  ChartsHistoryRequest,
  ChartsInterval,
  ChartsRange,
  ChartsRelationshipPayload,
  ChartsRelationshipRequest,
  ChartsSeriesPoint,
  IndicatorPoint,
} from '../../shared/contract.js'
import {
  aggregateFourHourCandles,
  buildRelationshipPayload,
  normalizeSymbols,
  validateRelationshipSymbols,
} from '../../shared/charts.js'
import { cache, TTL } from '../cache.js'
import { alignBackward, rsi, sma, toPoints } from '../indicators.js'
import { paced, yahoo } from './client.js'

const DAY = 24 * 60 * 60 * 1000

type YahooInterval = '1m' | '5m' | '15m' | '1h' | '1d' | '1wk' | '1mo'

const INTERVALS: Record<ChartsInterval, YahooInterval> = {
  '1 Minute': '1m',
  '5 Minutes': '5m',
  '15 Minutes': '15m',
  '1 Hour': '1h',
  '4 Hours': '1h',
  '1 Day': '1d',
  '1 Week': '1wk',
  '1 Month': '1mo',
}

const MAX_LOOKBACK_DAYS: Partial<Record<YahooInterval, number>> = {
  '1m': 6,
  '5m': 59,
  '15m': 59,
  '1h': 729,
}

export interface ChartsServiceResult<T> {
  payload: T
  stale: boolean
  fromCache: boolean
  cacheAgeSeconds: number
}

export interface ChartsBatchResult<T> extends ChartsServiceResult<T> {
  failures: Array<{ symbol: string; reason: string }>
}

function startOfRange(range: ChartsRange | ChartsCompareRequest['range'] | ChartsRelationshipRequest['range']): Date {
  const now = new Date()
  if (range === 'YTD') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  if (range === 'Max') return new Date(Date.UTC(1970, 0, 1))
  const matches = /^(\d+)([DMY])$/.exec(range)
  if (!matches) return new Date(now.getTime() - 365 * DAY)
  const amount = Number(matches[1])
  if (matches[2] === 'D') return new Date(now.getTime() - Math.max(amount, 2) * DAY)
  if (matches[2] === 'M') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - amount, now.getUTCDate()))
  return new Date(Date.UTC(now.getUTCFullYear() - amount, now.getUTCMonth(), now.getUTCDate()))
}

function requestStart(range: ChartsRange, interval: YahooInterval): Date {
  const requested = startOfRange(range)
  const maximum = MAX_LOOKBACK_DAYS[interval]
  if (!maximum) return requested
  return new Date(Math.max(requested.getTime(), Date.now() - maximum * DAY))
}

function periodBucket(time: number, interval: YahooInterval): string {
  const date = new Date(time * 1000)
  if (interval === '1mo') return `${date.getUTCFullYear()}-${date.getUTCMonth()}`
  if (interval === '1wk') return `w${Math.floor((Math.floor(time / 86400) + 3) / 7)}`
  return date.toISOString().slice(0, 10)
}

async function fetchCandles(symbol: string, start: Date, interval: YahooInterval, adjusted = false): Promise<{
  candles: Candle[]
  currency: string
  longName: string
}> {
  const result = await paced(() => yahoo.chart(symbol, { period1: start, interval }))
  const received: Candle[] = []
  for (const row of result.quotes) {
    const close = adjusted && typeof row.adjclose === 'number' ? row.adjclose : row.close
    const open = adjusted && typeof row.adjclose === 'number' ? row.adjclose : row.open
    const high = adjusted && typeof row.adjclose === 'number' ? row.adjclose : row.high
    const low = adjusted && typeof row.adjclose === 'number' ? row.adjclose : row.low
    if (![open, high, low, close].every((value) => typeof value === 'number' && Number.isFinite(value))) continue
    const candle: Candle = {
      time: Math.floor(row.date.getTime() / 1000),
      open: open as number,
      high: high as number,
      low: low as number,
      close: close as number,
      volume: typeof row.volume === 'number' && Number.isFinite(row.volume) ? row.volume : 0,
    }
    received.push(candle)
  }
  const candles = [...new Map(
    received
      .sort((left, right) => left.time - right.time)
      .map((candle) => [candle.time, candle]),
  ).values()]
  if (candles.length > 1) {
    const last = candles.at(-1)!
    const flat = last.open === last.high && last.high === last.low && last.low === last.close
    if (flat && last.volume === 0) candles.pop()
  }
  if (candles.length > 1 && (interval === '1wk' || interval === '1mo')) {
    const last = candles.at(-1)!
    const previous = candles.at(-2)!
    if (periodBucket(last.time, interval) === periodBucket(previous.time, interval)) candles.pop()
  }
  if (!candles.length) throw new Error(`No chart data returned for ${symbol}.`)
  return {
    candles,
    currency: result.meta?.currency ?? 'USD',
    longName: result.meta?.longName ?? result.meta?.shortName ?? symbol,
  }
}

async function cachedCandles(
  symbol: string,
  start: Date,
  interval: YahooInterval,
  force: boolean,
  adjusted = false,
): Promise<ChartsServiceResult<Awaited<ReturnType<typeof fetchCandles>>>> {
  const stamp = start.toISOString().slice(0, 10)
  const key = `${adjusted ? 'charts-adjusted' : 'charts-history'}:${symbol}:${interval}:${stamp}`
  const ttl = ['1m', '5m', '15m', '1h'].includes(interval) ? TTL.chartIntraday : TTL.chartDaily
  const result = await cache.resolveWithStaleFallback(
    key,
    ttl,
    () => fetchCandles(symbol, start, interval, adjusted),
    { force },
  )
  return { payload: result.value, stale: result.stale, fromCache: result.fromCache, cacheAgeSeconds: result.ageSeconds }
}

async function dailyMa200(symbol: string, force: boolean): Promise<IndicatorPoint[]> {
  const start = new Date(Date.now() - 730 * DAY)
  const raw = await cachedCandles(symbol, start, '1d', force)
  return toPoints(raw.payload.candles, sma(raw.payload.candles.map((row) => row.close), 200))
}

function stats(symbol: string, candles: Candle[], currency: string, longName: string): ChartStats {
  const last = candles.at(-1)!
  const previous = candles.at(-2) ?? last
  const absChange = last.close - previous.close
  return {
    symbol,
    price: last.close,
    change: previous.close ? absChange / previous.close * 100 : 0,
    absChange,
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
    volume: last.volume,
    currency,
    longName,
  }
}

export async function getChartsHistory(request: ChartsHistoryRequest): Promise<ChartsServiceResult<ChartsHistoryPayload>> {
  const symbol = request.symbol.trim().toUpperCase()
  if (!symbol) throw new Error('No chart symbol was provided.')
  const fetchInterval = INTERVALS[request.interval]
  const start = requestStart(request.range, fetchInterval)
  const raw = await cachedCandles(symbol, start, fetchInterval, Boolean(request.force))
  const candles = request.interval === '4 Hours' ? aggregateFourHourCandles(raw.payload.candles) : raw.payload.candles
  if (!candles.length) throw new Error(`No chart data returned for ${symbol}.`)
  const closes = candles.map((row) => row.close)
  const rsiValues = rsi(closes, 14)
  let ma200: IndicatorPoint[] = []
  try {
    const daily = await dailyMa200(symbol, Boolean(request.force))
    ma200 = fetchInterval === '1d'
      ? daily.filter((point) => point.time >= candles[0].time)
      : alignBackward(candles.map((row) => row.time), daily, ['1m', '5m', '15m', '1h'].includes(fetchInterval) ? 'exact' : 'day')
  } catch {
    ma200 = []
  }
  return {
    payload: {
      symbol,
      intervalLabel: request.interval,
      rangeLabel: request.range,
      interval: request.interval === '4 Hours' ? '4h' : fetchInterval,
      candles,
      stats: stats(symbol, candles, raw.payload.currency, raw.payload.longName),
      indicators: {
        ma200,
        rsi: toPoints(candles, rsiValues),
        rsiMa: toPoints(candles, sma(rsiValues, 14)),
      },
    },
    stale: raw.stale,
    fromCache: raw.fromCache,
    cacheAgeSeconds: raw.cacheAgeSeconds,
  }
}

export async function getChartsCompare(request: ChartsCompareRequest): Promise<ChartsBatchResult<ChartsComparePayload>> {
  const symbols = normalizeSymbols(request.symbols)
  const interval: YahooInterval = request.interval === '1 Week' ? '1wk' : '1d'
  const start = startOfRange(request.range)
  const settled = await Promise.allSettled(symbols.map((symbol) => cachedCandles(symbol, start, interval, Boolean(request.force))))
  const series: Record<string, ChartsSeriesPoint[]> = {}
  const missing: string[] = []
  const failures: ChartsBatchResult<ChartsComparePayload>['failures'] = []
  let stale = false
  let fromCache = true
  let cacheAgeSeconds = 0
  settled.forEach((outcome, index) => {
    const symbol = symbols[index]
    if (outcome.status === 'rejected') {
      missing.push(symbol)
      failures.push({ symbol, reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) })
      return
    }
    stale ||= outcome.value.stale
    fromCache &&= outcome.value.fromCache
    cacheAgeSeconds = Math.max(cacheAgeSeconds, outcome.value.cacheAgeSeconds)
    series[symbol] = outcome.value.payload.candles.map((row) => ({ time: row.time, close: row.close }))
  })
  return {
    payload: { symbols, interval: request.interval, range: request.range, series, missing },
    failures,
    stale,
    fromCache,
    cacheAgeSeconds,
  }
}

export async function getChartsRelationship(request: ChartsRelationshipRequest): Promise<ChartsBatchResult<ChartsRelationshipPayload>> {
  const symbols = validateRelationshipSymbols(request.symbols)
  const start = startOfRange(request.range)
  const settled = await Promise.allSettled(symbols.map((symbol) => cachedCandles(symbol, start, '1d', Boolean(request.force), true)))
  const failures: ChartsBatchResult<ChartsRelationshipPayload>['failures'] = []
  const available: Partial<Record<(typeof symbols)[number], ChartsSeriesPoint[]>> = {}
  let stale = false
  let fromCache = true
  let cacheAgeSeconds = 0
  settled.forEach((outcome, index) => {
    const symbol = symbols[index]
    if (outcome.status === 'rejected') {
      failures.push({ symbol, reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) })
      return
    }
    stale ||= outcome.value.stale
    fromCache &&= outcome.value.fromCache
    cacheAgeSeconds = Math.max(cacheAgeSeconds, outcome.value.cacheAgeSeconds)
    available[symbol] = outcome.value.payload.candles.map((row) => ({ time: row.time, close: row.close }))
  })
  const missing = symbols.filter((symbol) => !available[symbol])
  if (missing.length) {
    return {
      payload: {
        symbols,
        range: request.range,
        rollingWindow: request.rollingWindow,
        points: [],
        regressionLine: [],
        stats: {
          latestRatio: null,
          latestCorrelation: null,
          latestCorrelationSample: 0,
          beta: null,
          alphaDailyPct: null,
          r: null,
          rSquared: null,
          stdErrorPct: null,
          observations: 0,
        },
        missing,
      },
      failures,
      stale,
      fromCache,
      cacheAgeSeconds,
    }
  }
  return {
    payload: buildRelationshipPayload(symbols, available[symbols[0]]!, available[symbols[1]]!, request.range, request.rollingWindow),
    failures,
    stale,
    fromCache,
    cacheAgeSeconds,
  }
}

export const chartsPageTesting = {
  startOfRange,
  requestStart,
}
