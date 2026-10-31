import type {
  Candle,
  ChartPayload,
  ChartStats,
  IndicatorPoint,
  TimeframeLabel,
  TimeframeSpec,
} from '../../shared/contract.js'
import { TIMEFRAMES } from '../../shared/contract.js'
import { alignBackward, rsi, sma, toPoints } from '../indicators.js'
import { periodStart } from './client.js'
import { getMarketSeries } from '../marketSeries.js'
import { equityMarket } from '../../shared/equityMarkets.js'
import { getQuote } from './quotes.js'

export function timeframeSpec(label: TimeframeLabel): TimeframeSpec {
  return TIMEFRAMES.find((entry) => entry.label === label) ?? TIMEFRAMES[4]
}

interface RawChart {
  candles: Candle[]
  currency: string
  longName: string
  source?: string
  market?: string
}

/**
 * Yahoo refuses an intraday request that reaches further back than these, with an error
 * rather than a truncated response, so ask for one day less than the documented limit
 * to stay clear of the boundary as the request clock ticks.
 */
const MAX_LOOKBACK_DAYS: Record<string, number> = {
  '1m': 6,
  '5m': 59,
  '15m': 59,
  '1h': 729,
}

async function fetchCandles(symbol: string, spec: TimeframeSpec, force = false, seriesMarket?: string | false): Promise<RawChart> {
  const lookbackDays = Math.min(spec.lookbackDays, MAX_LOOKBACK_DAYS[spec.interval] ?? Infinity)
  const result = await getMarketSeries({
    symbol,
    start: periodStart(lookbackDays),
    interval: spec.interval,
    force,
    sourceMarket: seriesMarket || undefined,
    stockOnly: seriesMarket === false,
    allowPartialHistory: Boolean(seriesMarket),
  })

  const candles: Candle[] = []
  let previousTime = -Infinity
  for (const row of result.rows) {
    const { open, high, low, close } = row
    if (
      typeof open !== 'number' ||
      typeof high !== 'number' ||
      typeof low !== 'number' ||
      typeof close !== 'number' ||
      !Number.isFinite(close)
    ) {
      continue
    }
    const time = row.time
    // lightweight-charts rejects a series that is not strictly ascending, and Yahoo
    // occasionally repeats the final bar of a session.
    if (time <= previousTime) continue
    previousTime = time
    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume: typeof row.volume === 'number' && Number.isFinite(row.volume) ? row.volume : 0,
    })
  }

  if (!candles.length) throw new Error(`No chart data returned for ${symbol}.`)
  const provenance = result.meta as { source?: string; market?: string } | undefined
  if (!provenance?.market) {
    dropSyntheticQuoteBar(candles)
    if (!spec.intraday) dropPartialTrailingBar(candles, spec.interval)
  }
  return {
    candles,
    currency: result.currency,
    longName: result.longName,
    source: provenance?.source,
    market: provenance?.market,
  }
}

/**
 * On intraday series Yahoo tacks the live quote on as a bar of its own: a flat
 * open/high/low/close at the current price with no volume. Left in, it flattens the
 * header change to 0.00% and drags the last point of every indicator toward it.
 */
function dropSyntheticQuoteBar(candles: Candle[]): void {
  if (candles.length < 2) return
  const last = candles[candles.length - 1]
  const flat = last.open === last.high && last.high === last.low && last.low === last.close
  if (flat && last.volume === 0) candles.pop()
}

/**
 * Yahoo appends the current session as an extra row on weekly and monthly series, on
 * top of the aggregated bar that already includes it. Left in, it duplicates the latest
 * period: the quote header reads a 0% change, and every windowed indicator (RSI MA,
 * the MA200 alignment) is off by one bar against the PySide6 app.
 *
 * The tell is that the stray row falls inside the calendar period its predecessor
 * already covers, so bucket both by that period and drop the repeat.
 */
function dropPartialTrailingBar(candles: Candle[], interval: string): void {
  if (candles.length < 2) return
  const last = candles[candles.length - 1]
  const previous = candles[candles.length - 2]
  if (periodBucket(last.time, interval) === periodBucket(previous.time, interval)) candles.pop()
}

/** A stable key for the calendar period a timestamp belongs to, in UTC. */
function periodBucket(timeSeconds: number, interval: string): string {
  const date = new Date(timeSeconds * 1000)
  const year = date.getUTCFullYear()
  if (interval === '1mo') return `${year}-${date.getUTCMonth()}`
  if (interval === '1wk') {
    // Days since the Unix epoch, shifted so the week boundary lands on Monday
    // (1 Jan 1970 was a Thursday).
    const days = Math.floor(timeSeconds / 86400)
    return `w${Math.floor((days + 3) / 7)}`
  }
  return `${year}-${date.getUTCMonth()}-${date.getUTCDate()}`
}

/**
 * The 200-day moving average is always computed from daily bars and then carried onto
 * the displayed bars, whatever the timeframe — see `fetch_daily_ma200_payload` in the
 * PySide6 app. It is cached separately from the chart because every timeframe of the
 * same symbol shares it.
 */
async function fetchDailyMa200(symbol: string, force: boolean, market: string | false): Promise<IndicatorPoint[]> {
  const daily = await fetchCandles(symbol, timeframeSpec('1 Day'), force, market)
  const closes = daily.candles.map((candle) => candle.close)
  return toPoints(daily.candles, sma(closes, 200))
}

function buildStats(symbol: string, raw: RawChart): ChartStats {
  const candles = raw.candles
  const last = candles[candles.length - 1]
  const previous = candles.length > 1 ? candles[candles.length - 2] : last
  const absChange = last.close - previous.close
  return {
    symbol,
    price: last.close,
    change: previous.close ? (absChange / previous.close) * 100 : 0,
    absChange,
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
    volume: last.volume,
    currency: raw.currency,
    longName: raw.longName,
    source: raw.source ?? 'Yahoo Finance stock history',
    market: raw.market,
  }
}

export async function getChart(
  symbol: string,
  timeframe: TimeframeLabel,
  force = false,
): Promise<ChartPayload> {
  const spec = timeframeSpec(timeframe)
  const raw = await fetchCandles(symbol, spec, force)

  const closes = raw.candles.map((candle) => candle.close)
  const rsiSeries = rsi(closes, 14)
  const rsiPoints = toPoints(raw.candles, rsiSeries)
  const rsiMaPoints = toPoints(raw.candles, sma(rsiSeries, 14))

  // A missing MA200 should not cost us the chart; it is one line among three panes.
  let ma200: IndicatorPoint[] = []
  try {
    const daily = await fetchDailyMa200(symbol, force, raw.market ?? false)
    ma200 = spec.interval === '1d'
      ? daily.filter((point) => point.time >= raw.candles[0].time)
      : alignBackward(
          raw.candles.map((candle) => candle.time),
          daily,
          spec.intraday ? 'exact' : 'day',
        )
  } catch {
    ma200 = []
  }

  const stats = buildStats(symbol, raw)
  if (equityMarket(symbol)) {
    const quote = await getQuote(symbol, force)
    Object.assign(stats, { price: quote.price, change: quote.change, absChange: quote.absChange,
      priceSource: quote.source, priceBasis: quote.priceBasis, changeBasis: quote.changeBasis })
  }
  return {
    symbol,
    timeframe,
    interval: spec.interval,
    candles: raw.candles,
    stats,
    indicators: { ma200, rsi: rsiPoints, rsiMa: rsiMaPoints },
  }
}
