import type { TradingVolumeRow, TradingVolumesPayload } from '../../shared/contract.js'
import {
  TRADING_VOLUME_LIMIT,
  advMetrics,
  marketCapHistory,
  priceReturns,
} from '../../shared/tradingVolumes.js'
import { rollingBeta } from '../../shared/tradingBeta.js'
import { cache, TTL } from '../cache.js'
import { getCloseVolumeBatch } from './history.js'
import { screenEquityUniverse, type ScreenerQuote } from './screener.js'

/**
 * The Trading Volumes payload, ported from `TradingVolumeWorker.fetch`.
 *
 * Screen the US equity universe, rank by one-day dollar volume, keep the top 100, then
 * pull three years of daily bars for those 100 to fill in every other column.
 */

const CACHE_KEY = 'trading-volumes:data:v2'
const SOURCE = 'Yahoo Finance'

export const TRADING_VOLUMES_SOURCE = SOURCE

/** First finite candidate, which is how the reference reads each of its fallback chains. */
function firstFinite(...values: Array<number | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

/** `as_of`: `datetime.now().strftime('%Y-%m-%d %H:%M')`, in local time as the reference is. */
function asOfStamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`
  )
}

/**
 * `_rows_from_quotes`. Everything beyond the one-day figures is filled in later from
 * daily history; what the screen provides is price, volume, market cap and a name.
 */
function rowsFromQuotes(quotes: ScreenerQuote[]): TradingVolumeRow[] {
  const rows: TradingVolumeRow[] = []

  for (const quote of quotes) {
    const ticker = quote.symbol?.trim().toUpperCase()
    if (!ticker) continue
    // The screen is filtered to equities already, but a fund occasionally slips through.
    if (quote.quoteType && quote.quoteType !== 'EQUITY') continue

    const price = firstFinite(quote.regularMarketPrice, quote.regularMarketPreviousClose)
    const volume = firstFinite(quote.regularMarketVolume)
    if (price === null || price <= 0 || volume === null || volume <= 0) continue

    const previousClose = firstFinite(quote.regularMarketPreviousClose, quote.previousClose)
    const avgShareVolume = firstFinite(
      quote.averageDailyVolume10Day,
      quote.averageDailyVolume3Month,
    )

    rows.push({
      ticker,
      name: quote.longName || quote.shortName || quote.displayName || ticker,
      // The screener response carries no sector; only the LLM export has a column for it.
      sector: quote.sectorDisp || quote.sector || 'N/A',
      marketCap: firstFinite(quote.marketCap),

      oneDayDollarVolume: price * volume,
      // A provisional estimate, overwritten by the history-derived mean when that lands.
      fiveDayAvgDollarVolume: avgShareVolume === null ? null : price * avgShareVolume,
      thirtyDayAvgDollarVolume: null,
      ytdAvgDollarVolume: null,
      oneYearAvgDollarVolume: null,
      threeYearAvgDollarVolume: null,

      oneDayPriceReturnPct:
        previousClose !== null && previousClose > 0 ? (price / previousClose - 1) * 100 : null,
      fiveDayPriceReturnPct: null,
      thirtyDayPriceReturnPct: null,
      ytdPriceReturnPct: null,
      oneYearPriceReturnPct: null,
      threeYearPriceReturnPct: null,

      marketCapHistory: [],
    })
  }

  return rows
}

function byOneDayDollarVolume(left: TradingVolumeRow, right: TradingVolumeRow): number {
  return (right.oneDayDollarVolume ?? -Infinity) - (left.oneDayDollarVolume ?? -Infinity)
}

async function fetchAll(force: boolean): Promise<TradingVolumesPayload> {
  const quotes = await screenEquityUniverse()
  const ranked = rowsFromQuotes(quotes).sort(byOneDayDollarVolume)
  const rows = ranked.slice(0, TRADING_VOLUME_LIMIT)

  if (!rows.length) {
    return { rows: [], asOf: asOfStamp(), source: SOURCE, missing: [] }
  }

  // `_merge_trading_volume_history`: three calendar years back, daily.
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear() - 3, now.getUTCMonth(), now.getUTCDate()))
  const { series, missing } = await getCloseVolumeBatch(
    [...rows.map((row) => row.ticker), '^GSPC'],
    start,
    force,
  )

  for (const row of rows) {
    const history = series[row.ticker]
    if (!history) continue

    const adv = advMetrics(history, now)
    const returns = priceReturns(history, now)

    // The history mean supersedes the screener's `price * avgShareVolume` estimate.
    if (adv.fiveDay !== null) row.fiveDayAvgDollarVolume = adv.fiveDay
    row.thirtyDayAvgDollarVolume = adv.thirtyDay
    row.ytdAvgDollarVolume = adv.ytd
    row.oneYearAvgDollarVolume = adv.oneYear
    row.threeYearAvgDollarVolume = adv.threeYear

    // The one field history does not overwrite: the screen's own quote is live, while
    // the daily bars lag it. Every other return has no live equivalent.
    if (row.oneDayPriceReturnPct === null) row.oneDayPriceReturnPct = returns.oneDay
    row.fiveDayPriceReturnPct = returns.fiveDay
    row.thirtyDayPriceReturnPct = returns.thirtyDay
    row.ytdPriceReturnPct = returns.ytd
    row.oneYearPriceReturnPct = returns.oneYear
    row.threeYearPriceReturnPct = returns.threeYear

    row.betaHistory = rollingBeta(
      { dates: history.dates, values: history.adjustedCloses ?? [] },
      { dates: series['^GSPC']?.dates ?? [], values: series['^GSPC']?.adjustedCloses ?? [] },
    )
    row.marketCapHistory = marketCapHistory(history, row.marketCap)
  }

  rows.sort(byOneDayDollarVolume)
  return { rows, asOf: asOfStamp(now), source: SOURCE, missing }
}

export function getTradingVolumes(force = false): Promise<TradingVolumesPayload> {
  return cache
    .resolve(CACHE_KEY, TTL.tradingVolumes, () => fetchAll(force), { force })
    .then((result) => result.value)
}
