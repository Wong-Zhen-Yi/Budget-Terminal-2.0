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
import { localDateStamper } from './globalMarkets.js'
import { fetchCloses } from './history.js'
import { getYahooSeries } from './series.js'

/**
 * The Pre-Market page's six data blocks, ported from `PreMarketWorker`.
 *
 * The reference fetches each macro panel over just enough history to print three numbers
 * (DXY 10d, ^TNX 30d, ^VIX 5d). This asks for two years instead, because the panels here
 * also carry a chart — the statistics only ever read the tail of the series
 * (`closes[-1]`, `closes[-2]`, `closes[-5]`, the mean of the last 20) so they come out
 * identical, and the range buttons get their data without a second round trip.
 */

// Pre-v2 aggregates may contain missing panels produced by the repaired history-cache decoder.
const CACHE_KEY = 'pre-market:data:v2'
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
async function fetchFuturesBars(symbol: string, force: boolean): Promise<Bar[]> {
  const start = daysAgo(5)
  const stamp = localDateStamper(FUTURES_ZONE)
  const read = async (interval: '1h' | '1d'): Promise<Bar[]> => {
    const result = await getYahooSeries({ symbol, start, interval, force })
    const bars: Bar[] = []
    for (const row of result.rows) {
      const close = row.close
      if (close === null) continue
      bars.push({ session: stamp(new Date(row.time * 1000)), close })
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

async function fetchFutures(force: boolean): Promise<FuturesRow[]> {
  const settled = await Promise.allSettled(
    PRE_MARKET_FUTURES.map(async ({ symbol, name }) => {
      const bars = await fetchFuturesBars(symbol, force)
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

async function fetchMacroSeries(symbol: string, force: boolean): Promise<MacroSeries> {
  const series = await fetchCloses(symbol, yearsAgo(2), force)
  return { dates: series.dates, values: series.values }
}

async function fetchDxy(force: boolean): Promise<DxySnapshot> {
  const series = await fetchMacroSeries('DX-Y.NYB', force)
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

async function fetchTnx(force: boolean): Promise<TnxSnapshot> {
  const series = await fetchMacroSeries('^TNX', force)
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

async function fetchVix(force: boolean): Promise<VixSnapshot> {
  const series = await fetchMacroSeries('^VIX', force)
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

async function fetchMomentum(force: boolean): Promise<SpyMomentumPayload> {
  const series = await fetchCloses('SPY', yearsAgo(2), force)
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
    fetchFutures(force).catch(() => [] as FuturesRow[]),
    fetchDxy(force).catch(() => null),
    fetchTnx(force).catch(() => null),
    fetchVix(force).catch(() => null),
    getFearGreed(force).catch(() => null),
    fetchMomentum(force).catch(() => null),
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
