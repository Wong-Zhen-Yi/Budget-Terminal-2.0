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
import { alignBackward, rsi, sma, toPoints } from '../indicators.js'
import { getYahooSeries } from './series.js'
import { getMarketSeries } from '../marketSeries.js'
import { equityMarket } from '../../shared/equityMarkets.js'
import { getQuote } from './quotes.js'
import { hyperliquidEquities } from '../hyperliquidEquities.js'
import { captureSources, observeSource } from '../sourceHealth.js'

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
  // Max must include provider history before the Unix epoch too.
  if (range === 'Max') return new Date(Date.UTC(1800, 0, 1))
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

interface RawCandles {
  candles: Candle[]
  currency: string
  longName: string
  source?: string
  market?: string
}

async function cachedCandles(
  symbol: string,
  start: Date,
  interval: YahooInterval,
  force: boolean,
  adjusted = false,
  sourceMarket?: string | false,
): Promise<ChartsServiceResult<RawCandles>> {
  const result = await getMarketSeries({
    symbol,
    start,
    interval,
    force,
    variant: adjusted ? 'adjusted' : 'ohlcv',
    sourceMarket: sourceMarket || undefined,
    stockOnly: sourceMarket === false,
    allowPartialHistory: Boolean(sourceMarket),
  })
  const payload = fetchCandlesFromSeries(result, adjusted, interval)
  return {
    payload,
    stale: result.stale,
    fromCache: result.fromCache,
    cacheAgeSeconds: result.cacheAgeSeconds,
  }
}

async function fourHourCandles(symbol: string, start: Date, force: boolean): Promise<ChartsServiceResult<RawCandles>> {
  if (!equityMarket(symbol)) return cachedCandles(symbol, start, '1h', force)
  try {
    const captured = await captureSources(() => hyperliquidEquities.getCandles(symbol, start, '4h', force))
    if (captured.snapshot) observeSource(captured.snapshot)
    const result = captured.value
    return { payload: { candles: result.candles, currency: 'USD', longName: `${symbol} equity perpetual`,
      source: result.source, market: result.market }, stale: result.stale, fromCache: result.fromCache, cacheAgeSeconds: result.cacheAgeSeconds }
  } catch (error) {
    const result = await cachedCandles(symbol, start, '1h', force, false, false)
    return { ...result, payload: { ...result.payload,
      source: `Yahoo stock history (${error instanceof Error ? error.message : String(error)})` } }
  }
}

function fetchCandlesFromSeries(
  result: Awaited<ReturnType<typeof getYahooSeries>>,
  adjusted: boolean,
  interval: YahooInterval,
): RawCandles {
  // Yahoo includes pre/post-market equity rows in intraday responses. These rows
  // have no traded volume and can carry extreme high/low quotes; aggregating them
  // into four-hour bars makes the regular-session chart appear wildly volatile.
  const instrumentType = (result.meta as { instrumentType?: unknown } | undefined)?.instrumentType
  const regularSessionOnly = ['1m', '5m', '15m', '1h'].includes(interval)
    && (instrumentType === 'EQUITY' || instrumentType === 'ETF')
  const received: Candle[] = result.rows.flatMap((row) => {
    if (regularSessionOnly && !(row.volume !== null && row.volume > 0)) return []
    const close = adjusted && row.adjclose !== null ? row.adjclose : row.close
    const open = adjusted && row.adjclose !== null ? row.adjclose : row.open
    const high = adjusted && row.adjclose !== null ? row.adjclose : row.high
    const low = adjusted && row.adjclose !== null ? row.adjclose : row.low
    if ([open, high, low, close].some((value) => value === null || !Number.isFinite(value))) return []
    return [{
      time: row.time,
      open: open as number,
      high: high as number,
      low: low as number,
      close: close as number,
      volume: row.volume ?? 0,
    }]
  })
  const candles = [...new Map(received.map((row) => [row.time, row])).values()]
  const provenance = result.meta as { source?: string; market?: string } | undefined
  if (!provenance?.market && candles.length > 1) {
    const last = candles.at(-1)!
    if (last.open === last.high && last.high === last.low && last.low === last.close && last.volume === 0) candles.pop()
  }
  if (!provenance?.market && candles.length > 1 && (interval === '1wk' || interval === '1mo')) {
    const last = candles.at(-1)!
    const previous = candles.at(-2)!
    if (periodBucket(last.time, interval) === periodBucket(previous.time, interval)) candles.pop()
  }
  if (!candles.length) throw new Error('No usable chart data returned.')
  return { candles, currency: result.currency, longName: result.longName,
    source: provenance?.source ?? 'Yahoo Finance stock history', market: provenance?.market }
}

async function dailyMovingAverages(symbol: string, firstTime: number, force: boolean, market: string | false) {
  // Warm up both daily SMAs before the displayed range, even on short or intraday charts.
  const start = new Date(Math.max(0, Math.min(Date.now() - 730 * DAY, firstTime * 1000 - 400 * DAY)))
  const raw = await cachedCandles(symbol, start, '1d', force, false, market)
  const closes = raw.payload.candles.map((row) => row.close)
  return {
    ma50: toPoints(raw.payload.candles, sma(closes, 50)),
    ma200: toPoints(raw.payload.candles, sma(closes, 200)),
  }
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
  const raw = request.interval === '4 Hours'
    ? await fourHourCandles(symbol, start, Boolean(request.force))
    : await cachedCandles(symbol, start, fetchInterval, Boolean(request.force))
  // Stock 4h bars follow trading sessions; Hyperliquid's native 4h bars use UTC
  // opening timestamps. Keep those native bars aligned with the candle stream.
  const candles = request.interval === '4 Hours' && !raw.payload.market ? aggregateFourHourCandles(raw.payload.candles) : raw.payload.candles
  if (request.interval === '4 Hours' && raw.payload.market) hyperliquidEquities.watchCandles(symbol, '4h')
  if (!candles.length) throw new Error(`No chart data returned for ${symbol}.`)
  const closes = candles.map((row) => row.close)
  const rsiValues = rsi(closes, 14)
  let ma50: IndicatorPoint[] = []
  let ma200: IndicatorPoint[] = []
  try {
    const daily = await dailyMovingAverages(symbol, candles[0].time, Boolean(request.force), raw.payload.market ?? false)
    const align = (points: IndicatorPoint[]) => alignBackward(
      candles.map((row) => row.time), points,
      ['1m', '5m', '15m', '1h'].includes(fetchInterval) ? 'exact' : 'day',
    )
    ma50 = align(daily.ma50)
    ma200 = align(daily.ma200)
  } catch {
    ma50 = []
    ma200 = []
  }
  const chartStats = stats(symbol, candles, raw.payload.currency, raw.payload.longName)
  Object.assign(chartStats, { source: raw.payload.source, market: raw.payload.market })
  if (equityMarket(symbol)) {
    const quote = await getQuote(symbol, Boolean(request.force))
    Object.assign(chartStats, { price: quote.price, change: quote.change, absChange: quote.absChange,
      priceSource: quote.source, priceBasis: quote.priceBasis, changeBasis: quote.changeBasis })
  }
  return {
    payload: {
      symbol,
      intervalLabel: request.interval,
      rangeLabel: request.range,
      interval: request.interval === '4 Hours' ? '4h' : fetchInterval,
      candles,
      stats: chartStats,
      indicators: {
        ma50,
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
  const sources: Record<string, string> = {}
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
    sources[symbol] = outcome.value.payload.source ?? 'Yahoo stock history'
  })
  return {
    payload: { symbols, interval: request.interval, range: request.range, series, sources, missing },
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
