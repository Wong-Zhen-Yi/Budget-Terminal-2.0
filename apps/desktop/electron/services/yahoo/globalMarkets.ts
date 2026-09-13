import type {
  GlobalIndexConfig,
  GlobalIndexRow,
  GlobalMarketsPayload,
  MarketTiming,
} from '../../shared/contract.js'
import { GLOBAL_MARKET_INDEXES } from '../../shared/contract.js'
import { calculateAllIntervals, type DatedSeries } from '../../shared/globalMarkets.js'
import { cache, TTL } from '../cache.js'
import { getYahooSeries } from './series.js'

/**
 * The Global page's seventeen world indexes, ported from `GlobalMarketsDataService`.
 *
 * One chart call per symbol carries both halves of the page: the six years of daily
 * closes the interval buttons measure against, and the trading-period metadata the
 * session column prints. The reference fetches those separately — a `yf.download` for
 * history plus a one-minute intraday history per symbol purely for `get_history_metadata`
 * — which would be 34 trips through the rate gate on every load instead of 17.
 * `yahoo-finance2` hands back `meta` on the same response, so we take it from there.
 */

const HISTORY_YEARS = 6
const SOURCE = 'yahoo chart'
const CACHE_KEY = 'global:markets'

function historyStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear() - HISTORY_YEARS, now.getUTCMonth(), now.getUTCDate()))
}

/** Epoch seconds from whatever Yahoo put in a date-ish field, or null. */
function epochSeconds(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  return null
}

interface SymbolResult {
  series: DatedSeries
  timing: MarketTiming
  dayLow: number | null
  dayHigh: number | null
}

/**
 * A `YYYY-MM-DD` stamper for one exchange.
 *
 * Daily bars have to be dated in the **exchange** timezone, not UTC, because that is how
 * yfinance indexes them and the returns have to match. It also does the work of
 * `dropSyntheticQuoteBar`: Yahoo appends the live quote as a volume-less row stamped at
 * `regularMarketTime`, which for a late-closing market (Bovespa closes at 22:59 UTC)
 * falls on the next UTC day but the same local one — so it collapses onto the session it
 * belongs to instead of inventing a bar and flattening the 1D return to zero.
 */
export function localDateStamper(zone: string): (date: Date) => string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return (date) => formatter.format(date)
}

/**
 * Closes plus timing for one symbol. The close extraction matches `fetchCloses` in
 * `history.ts`: adjusted closes so a split does not read as a 50% loss, and a repeated
 * trailing date collapsed onto the newer value.
 */
async function fetchSymbol(symbol: string, start: Date, force: boolean): Promise<SymbolResult> {
  const result = await getYahooSeries({ symbol, start, interval: '1d', force, variant: 'adjusted' })
  const meta = result.meta as Record<string, unknown> | undefined
  const stamp = localDateStamper(String(meta?.exchangeTimezoneName ?? '').trim())

  const dates: string[] = []
  const values: number[] = []
  let previousDate = ''
  for (const row of result.rows) {
    const close = typeof row.adjclose === 'number' ? row.adjclose : row.close
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue
    const date = stamp(new Date(row.time * 1000))
    if (date === previousDate) {
      values[values.length - 1] = close
      continue
    }
    previousDate = date
    dates.push(date)
    values.push(close)
  }

  const typedMeta = meta as unknown as {
    currentTradingPeriod?: { regular?: { start?: unknown; end?: unknown } }
    regularMarketTime?: unknown
    fullExchangeName?: unknown
    exchangeName?: unknown
    exchangeTimezoneName?: unknown
  } | undefined
  const regular = typedMeta?.currentTradingPeriod?.regular
  const regularMarketTime = epochSeconds(typedMeta?.regularMarketTime)
  const timing: MarketTiming = {
    symbol,
    exchangeName: String(typedMeta?.fullExchangeName ?? typedMeta?.exchangeName ?? '').trim(),
    exchangeTimezone: String(typedMeta?.exchangeTimezoneName ?? '').trim(),
    regularStart: epochSeconds(regular?.start),
    regularEnd: epochSeconds(regular?.end),
    regularMarketTime,
    // Without an intraday frame the last tick is the regular market time, which is the
    // reference's own fallback when its one-minute history comes back empty.
    lastTickTime: regularMarketTime,
    source: 'unavailable',
  }
  if (timing.regularStart || timing.regularEnd || timing.regularMarketTime) {
    timing.source = 'yahoo chart metadata'
  }

  if (!dates.length) throw new Error(`No history returned for ${symbol}.`)
  // Merge the latest exchange-local session, including Yahoo's synthetic quote bar.
  // Never substitute an older session when the latest session has no valid range.
  const session = dates[dates.length - 1]
  const bars = result.rows.filter((row) => stamp(new Date(row.time * 1000)) === session &&
    row.low !== null && row.low > 0 && row.high !== null && row.high >= row.low)
  const dayLow = bars.length ? Math.min(...bars.map((row) => row.low!)) : null
  const dayHigh = bars.length ? Math.max(...bars.map((row) => row.high!)) : null
  return { series: { dates, values }, timing, dayLow, dayHigh }
}

function emptyTiming(symbol: string): MarketTiming {
  return {
    symbol,
    exchangeName: '',
    exchangeTimezone: '',
    regularStart: null,
    regularEnd: null,
    regularMarketTime: null,
    lastTickTime: null,
    source: 'unavailable',
  }
}

function buildRow(config: GlobalIndexConfig, result: SymbolResult | null): GlobalIndexRow {
  const series = result?.series ?? { dates: [], values: [] }
  const last = series.values.length - 1
  return {
    ...config,
    lastClose: last >= 0 ? series.values[last] : null,
    dayLow: result?.dayLow ?? null,
    dayHigh: result?.dayHigh ?? null,
    lastDate: last >= 0 ? series.dates[last] : '',
    intervals: calculateAllIntervals(series),
    marketTiming: result?.timing ?? emptyTiming(config.symbol),
  }
}

async function fetchAll(force: boolean): Promise<GlobalMarketsPayload> {
  const start = historyStart()
  // One symbol failing is a `--` row, not a blank page, so settle rather than race.
  const settled = await Promise.allSettled(
    GLOBAL_MARKET_INDEXES.map((config) => fetchSymbol(config.symbol, start, force)),
  )

  const rows: GlobalIndexRow[] = []
  const missing: string[] = []
  GLOBAL_MARKET_INDEXES.forEach((config, index) => {
    const outcome = settled[index]
    if (outcome.status === 'fulfilled') {
      rows.push(buildRow(config, outcome.value))
    } else {
      missing.push(config.symbol)
      rows.push(buildRow(config, null))
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    rows,
    missing,
  }
}

export async function getGlobalMarkets(force = false): Promise<GlobalMarketsPayload> {
  const result = await cache.resolve(CACHE_KEY, TTL.chartDaily, () => fetchAll(force), { force })
  return result.value
}
