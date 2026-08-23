import type {
  DxySnapshot,
  FuturesRow,
  MacroSeries,
  PreMarketPayload,
  SpyMomentumPayload,
  TnxSnapshot,
  VixSnapshot,
} from '../../shared/contract.js'
import { PRE_MARKET_FUTURES } from '../../shared/contract.js'
import { dxyTrend, futuresDirection, rollingMean, vixRegime } from '../../shared/preMarket.js'
import { cache, TTL } from '../cache.js'
import { getFearGreed } from '../fearGreed.js'
import { paced, yahoo } from './client.js'
import { localDateStamper } from './globalMarkets.js'
import { fetchCloses } from './history.js'

/**
 * The Pre-Market page's six data blocks, ported from `PreMarketWorker`.
 *
 * The reference fetches each macro panel over just enough history to print three numbers
 * (DXY 10d, ^TNX 30d, ^VIX 5d). This asks for two years instead, because the panels here
 * also carry a chart — the statistics only ever read the tail of the series
 * (`closes[-1]`, `closes[-2]`, `closes[-5]`, the mean of the last 20) so they come out
 * identical, and the range buttons get their data without a second round trip.
 */

const CACHE_KEY = 'pre-market:data'
const SOURCE = 'yahoo chart'

/** Futures trade nearly around the clock, so sessions are ET days, as yfinance indexes them. */
const FUTURES_ZONE = 'America/New_York'

function yearsAgo(years: number): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()))
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

interface Bar {
  /** `YYYY-MM-DD` in the futures session timezone. */
  session: string
  close: number
}

/**
 * Hourly bars for one contract, falling back to daily.
 *
 * `dropSyntheticQuoteBar` is deliberately *not* applied: on a futures series the trailing
 * live bar is the pre-market price, which is the whole point of the panel. The
 * prior-close rule below keeps it out of the comparison instead.
 */
async function fetchFuturesBars(symbol: string): Promise<Bar[]> {
  const start = daysAgo(5)
  const stamp = localDateStamper(FUTURES_ZONE)
  const read = async (interval: '1h' | '1d'): Promise<Bar[]> => {
    const result = await paced(() => yahoo.chart(symbol, { period1: start, interval }))
    const bars: Bar[] = []
    for (const row of result.quotes ?? []) {
      const close = typeof row.close === 'number' ? row.close : null
      if (close === null || !Number.isFinite(close)) continue
      bars.push({ session: stamp(row.date), close })
    }
    return bars
  }
  const hourly = await read('1h')
  if (hourly.length) return hourly
  return read('1d')
}

/**
 * `_resolve_futures_prior_close`: the previous *session's* last close, not the previous
 * bar. On an hourly series those are three-quarters of a day apart, and using the bar
 * before would report an hour's move as the day's change.
 */
function priorClose(bars: Bar[]): number | null {
  if (bars.length < 2) return null
  const lastSession = bars[bars.length - 1].session
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (bars[index].session < lastSession) return bars[index].close
  }
  return bars[bars.length - 2].close
}

async function fetchFutures(): Promise<FuturesRow[]> {
  const settled = await Promise.allSettled(
    PRE_MARKET_FUTURES.map(async ({ symbol, name }) => {
      const bars = await fetchFuturesBars(symbol)
      if (bars.length < 2) return null
      const price = bars[bars.length - 1].close
      const prior = priorClose(bars)
      if (prior === null || !prior) return null
      const changePct = ((price - prior) / prior) * 100
      return { symbol, name, price, changePct, direction: futuresDirection(changePct) }
    }),
  )
  // A contract Yahoo has nothing for is dropped rather than shown blank, as the
  // reference's `continue` does — the table is five rows or fewer, never five with holes.
  return settled.flatMap((outcome) =>
    outcome.status === 'fulfilled' && outcome.value ? [outcome.value] : [],
  )
}

async function fetchMacroSeries(symbol: string): Promise<MacroSeries> {
  const series = await fetchCloses(symbol, yearsAgo(2))
  return { dates: series.dates, values: series.values }
}

async function fetchDxy(): Promise<DxySnapshot> {
  const series = await fetchMacroSeries('DX-Y.NYB')
  const closes = series.values
  const level = closes[closes.length - 1]
  const previous = closes[closes.length - 2]
  return {
    level,
    changePct: ((level - previous) / previous) * 100,
    trend: dxyTrend(closes),
    series,
  }
}

async function fetchTnx(): Promise<TnxSnapshot> {
  const series = await fetchMacroSeries('^TNX')
  const closes = series.values
  const current = closes[closes.length - 1]
  const previous = closes[closes.length - 2]
  const window = closes.slice(-20)
  const avg20d = window.reduce((total, value) => total + value, 0) / window.length
  return {
    yield: current,
    // ^TNX quotes the yield in percent, so a point of it is 100 basis points.
    changeBps: (current - previous) * 100,
    avg20d,
    vsAvg: current - avg20d,
    series,
  }
}

async function fetchVix(): Promise<VixSnapshot> {
  const series = await fetchMacroSeries('^VIX')
  const closes = series.values
  const level = closes[closes.length - 1]
  return {
    level,
    // Points, not percent — the reference prints `+1.20`, never `+1.20%`.
    change: level - closes[closes.length - 2],
    regime: vixRegime(level),
    series,
  }
}

async function fetchMomentum(): Promise<SpyMomentumPayload> {
  const series = await fetchCloses('SPY', yearsAgo(2))
  const ma125 = rollingMean(series.values, 125)
  return {
    dates: series.dates,
    closes: series.values,
    ma125,
    lastClose: series.values[series.values.length - 1] ?? null,
    lastMa: ma125[ma125.length - 1] ?? null,
  }
}

async function fetchAll(force: boolean): Promise<PreMarketPayload> {
  const [futures, dxy, tnx, vix, fearGreed, momentum] = await Promise.all([
    fetchFutures().catch(() => [] as FuturesRow[]),
    fetchDxy().catch(() => null),
    fetchTnx().catch(() => null),
    fetchVix().catch(() => null),
    getFearGreed(force).catch(() => null),
    fetchMomentum().catch(() => null),
  ])

  const missing: string[] = []
  if (!futures.length) missing.push('Futures')
  if (!dxy) missing.push('DXY')
  if (!tnx) missing.push('10Y Yield')
  if (!vix) missing.push('VIX')
  if (!fearGreed) missing.push('Fear & Greed')
  if (!momentum) missing.push('Market Momentum')

  return { futures, dxy, tnx, vix, fearGreed, momentum, missing }
}

export function getPreMarket(force = false): Promise<PreMarketPayload> {
  return cache
    .resolve(CACHE_KEY, TTL.chartDaily, () => fetchAll(force), { force })
    .then((result) => result.value)
}

export const PRE_MARKET_SOURCE = SOURCE
