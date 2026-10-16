import type { Candle, DiscoverySnapshot, DiscoveryUniverse } from '../../shared/contract.js'
import { companySymbolUniverse } from '../calendar.js'
import { cache, TTL } from '../cache.js'
import { paced, yahoo } from './client.js'
import { getYahooSeries } from './series.js'
import { withBackupSummary } from './backup.js'

const DAY = 86_400_000
const modules = ['price', 'summaryDetail', 'financialData', 'defaultKeyStatistics', 'assetProfile', 'calendarEvents'] as const

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function field(value: unknown, key: string): unknown {
  return object(value)[key]
}

function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return null
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function date(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  const numeric = number(value)
  if (numeric !== null) return numeric < 1e12 ? numeric * 1000 : numeric
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function ratio(top: number | null, bottom: number | null): number | null {
  return top === null || bottom === null || bottom === 0 ? null : top / bottom
}

function first(...values: unknown[]): number | null {
  for (const value of values) {
    const result = number(value)
    if (result !== null) return result
  }
  return null
}

export async function getDiscoveryUniverse(): Promise<DiscoveryUniverse> {
  const universe = await companySymbolUniverse(false)
  return { symbols: universe.value.discoverySymbols ?? [], stale: !universe.fresh }
}

export async function getDiscoverySnapshot(input: string): Promise<DiscoverySnapshot> {
  const symbol = input.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('Enter a valid ticker symbol.')

  // A fresh quote is separate from company facts. The shared history cache only reads
  // the recent tail on repeat visits, and profile facts survive many rotations.
  const [seriesResult, quoteResult, summaryResult] = await Promise.allSettled([
    getYahooSeries({ symbol, start: new Date(Date.now() - (5 * 365 + 14) * DAY), interval: '1d' }),
    paced(() => yahoo.quote(symbol)),
    cache.resolveWithStaleFallback(
      `discovery:profile:${symbol}`,
      TTL.profile,
      () => withBackupSummary(symbol, () => paced(() => yahoo.quoteSummary(symbol, { modules: [...modules] }))),
    ),
  ])
  if (seriesResult.status === 'rejected') throw seriesResult.reason
  const series = seriesResult.value
  const candles: Candle[] = series.rows.flatMap((row) =>
    row.open !== null && row.high !== null && row.low !== null && row.close !== null
      ? [{ time: row.time, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume ?? 0 }]
      : [],
  )
  if (!candles.length) throw new Error(`No price history returned for ${symbol}.`)
  if (Date.now() - candles.at(-1)!.time * 1000 > 10 * DAY) {
    throw new Error(`No recent trading history returned for ${symbol}.`)
  }

  const summary = summaryResult.status === 'fulfilled' ? object(summaryResult.value.value) : {}
  const quote = quoteResult.status === 'fulfilled' ? object(quoteResult.value) : {}
  const priceData = object(summary.price)
  const detail = object(summary.summaryDetail)
  const financial = object(summary.financialData)
  const statistics = object(summary.defaultKeyStatistics)
  const profile = object(summary.assetProfile)
  const calendar = object(summary.calendarEvents)
  const last = candles.at(-1)!
  const prior = candles.at(-2)
  const quotePrice = first(quote.regularMarketPrice, priceData.regularMarketPrice)
  const quoteTime = date(quote.regularMarketTime ?? priceData.regularMarketTime)
  const delayed = first(quote.exchangeDataDelayedBy, priceData.exchangeDataDelayedBy)
  const marketState = string(quote.marketState) ?? string(priceData.marketState)
  const price = quotePrice ?? last.close
  const previousClose = first(quote.regularMarketPreviousClose, detail.previousClose, priceData.regularMarketPreviousClose, prior?.close)
  const status: DiscoverySnapshot['quoteStatus'] = quotePrice === null
    ? 'previous close'
    : !marketState ? 'unavailable'
    : marketState === 'REGULAR' && delayed === 0
      ? 'real-time'
      : marketState === 'REGULAR' ? 'delayed' : 'previous close'
  const revenue = number(financial.totalRevenue)
  const netIncome = first(statistics.netIncomeToCommon, financial.netIncomeToCommon)
  const grossProfit = number(financial.grossProfits)
  const operatingIncome = number(financial.operatingIncome)
  const freeCashFlow = number(financial.freeCashflow)
  const marketCap = first(quote.marketCap, priceData.marketCap, detail.marketCap)
  const earningsDates = field(calendar.earnings, 'earningsDate')
  const nextEarnings = Array.isArray(earningsDates)
    ? earningsDates.map(date).filter((value): value is number => value !== null && value >= Date.now()).sort((a, b) => a - b)[0] ?? null
    : null
  const lastEarnings = Array.isArray(earningsDates)
    ? earningsDates.map(date).filter((value): value is number => value !== null && value < Date.now()).sort((a, b) => b - a)[0] ?? null
    : null
  const officers = Array.isArray(profile.companyOfficers) ? profile.companyOfficers : []
  const chiefExecutive = officers.find((officer) => /chief executive|\bceo\b/i.test(string(field(officer, 'title')) ?? ''))

  return {
    symbol,
    name: string(quote.longName) ?? string(priceData.longName) ?? string(quote.shortName) ?? series.longName,
    exchange: string(quote.fullExchangeName) ?? string(priceData.exchangeName) ?? string(quote.exchange),
    sector: string(profile.sector),
    industry: string(profile.industry),
    country: string(profile.country),
    employees: number(profile.fullTimeEmployees),
    ceo: string(field(chiefExecutive, 'name')),
    ipoDate: date(profile.ipoDate),
    website: string(profile.website),
    description: string(profile.longBusinessSummary),
    price,
    previousClose,
    quoteTime,
    quoteStatus: status,
    quoteDelayedMinutes: delayed,
    market: {
      open: first(quote.regularMarketOpen, detail.open, last.open),
      dayHigh: first(quote.regularMarketDayHigh, detail.dayHigh, last.high),
      dayLow: first(quote.regularMarketDayLow, detail.dayLow, last.low),
      high52: first(quote.fiftyTwoWeekHigh, detail.fiftyTwoWeekHigh),
      low52: first(quote.fiftyTwoWeekLow, detail.fiftyTwoWeekLow),
      volume: first(quote.regularMarketVolume, detail.volume, last.volume),
      averageVolume: first(quote.averageDailyVolume3Month, detail.averageVolume),
      marketCap,
      beta: first(detail.beta, statistics.beta),
      sharesOutstanding: first(quote.sharesOutstanding, statistics.sharesOutstanding),
    },
    valuation: {
      pe: first(quote.trailingPE, detail.trailingPE),
      forwardPe: first(detail.forwardPE, statistics.forwardPE),
      peg: first(statistics.pegRatio, detail.pegRatio),
      priceSales: first(statistics.priceToSalesTrailing12Months, detail.priceToSalesTrailing12Months, quote.priceToSalesTrailing12Months),
      priceBook: first(statistics.priceToBook, quote.priceToBook),
      evRevenue: number(statistics.enterpriseToRevenue),
      evEbitda: number(statistics.enterpriseToEbitda),
      enterpriseValue: number(statistics.enterpriseValue),
      fcfYield: ratio(freeCashFlow, marketCap),
      earningsYield: ratio(netIncome, marketCap),
    },
    financials: {
      revenue,
      revenueGrowth: number(financial.revenueGrowth),
      grossProfit,
      grossMargin: first(financial.grossMargins, ratio(grossProfit, revenue)),
      operatingIncome,
      operatingMargin: first(financial.operatingMargins, ratio(operatingIncome, revenue)),
      ebitda: number(financial.ebitda),
      ebitdaMargin: ratio(number(financial.ebitda), revenue),
      netIncome,
      eps: first(statistics.trailingEps, quote.epsTrailingTwelveMonths),
      epsGrowth: number(financial.earningsGrowth),
      freeCashFlow,
      cash: number(financial.totalCash),
      debt: number(financial.totalDebt),
      netCash: number(financial.totalCash) !== null && number(financial.totalDebt) !== null
        ? number(financial.totalCash)! - number(financial.totalDebt)! : null,
      debtEquity: number(financial.debtToEquity),
      roe: number(financial.returnOnEquity),
      roa: number(financial.returnOnAssets),
      roic: number(financial.returnOnInvestedCapital),
    },
    analyst: {
      count: number(financial.numberOfAnalystOpinions),
      target: number(financial.targetMeanPrice),
      recommendation: number(financial.recommendationMean),
      epsEstimate: number(field(calendar.earnings, 'earningsAverage')),
      revenueEstimate: number(field(calendar.earnings, 'revenueAverage')),
    },
    nextEarnings,
    lastEarnings,
    candles,
    stale: series.stale || summaryResult.status !== 'fulfilled' || summaryResult.value.stale || quoteResult.status !== 'fulfilled',
    generatedAt: Date.now(),
  }
}
