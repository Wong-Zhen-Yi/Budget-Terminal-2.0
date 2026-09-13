import type {
  Candle,
  StocksInstitutionalRow,
  StocksInsiderRow,
  StocksNewsRow,
  StocksPayload,
} from '../../shared/contract.js'
import {
  buildStocksStats,
  calculateMfi,
  finiteNumber,
  firstFinite,
  normalizeStocksFacts,
  stocksCurrency,
  stocksDate,
  stocksHolderChange,
  stocksHolderPercentage,
  stocksShares,
  type StocksRawFacts,
} from '../../shared/stocks.js'
import { normalizeNewsSymbol } from '../../shared/news.js'
import { cache, TTL } from '../cache.js'
import { paced, yahoo } from './client.js'
import { searchNews } from './newsPage.js'
import { getYahooSeries } from './series.js'

export const STOCKS_SOURCE = 'yahoo stocks'

export interface StocksFailure {
  block: string
  reason: string
}

export interface StocksServiceResult {
  payload: StocksPayload
  failures: StocksFailure[]
}

interface ChartResult {
  candles: Candle[]
  currency: string
  longName: string
  stale: boolean
}

interface SummaryResult {
  facts: StocksRawFacts
  institutional: StocksInstitutionalRow[]
  insiders: StocksInsiderRow[]
  stale: boolean
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function valueOf(source: unknown, key: string): unknown {
  return record(source)[key]
}

function firstValue(source: unknown, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = valueOf(source, key)
    if (value !== null && value !== undefined && value !== '' && value !== 'N/A') return value
  }
  return undefined
}

function threeYearsAgo(): Date {
  const date = new Date()
  date.setUTCFullYear(date.getUTCFullYear() - 3)
  return date
}

async function fetchChart(symbol: string, force: boolean): Promise<ChartResult> {
  const resolved = await getYahooSeries({ symbol, start: threeYearsAgo(), interval: '1d', force })
  const candles = resolved.rows.flatMap((row): Candle[] =>
    row.open !== null && row.high !== null && row.low !== null && row.close !== null
      ? [{
          time: row.time,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume ?? 0,
        }]
      : [],
  )
  if (!candles.length) throw new Error(`No chart data returned for ${symbol}.`)
  return {
    candles,
    currency: resolved.currency,
    longName: resolved.longName,
    stale: resolved.stale,
  }
}

async function statementFallback(symbol: string): Promise<Record<string, unknown>> {
  const rows = await paced(() =>
    yahoo.fundamentalsTimeSeries(symbol, {
      period1: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000),
      type: 'quarterly',
      module: 'all',
    }),
  )
  const ordered = [...rows]
    .map((row) => record(row))
    .sort((left, right) => {
      const leftDate = new Date(String(left.date ?? 0)).getTime()
      const rightDate = new Date(String(right.date ?? 0)).getTime()
      return rightDate - leftDate
    })
  return ordered[0] ?? {}
}

function ratio(numerator: unknown, denominator: unknown): number | null {
  const top = finiteNumber(numerator)
  const bottom = finiteNumber(denominator)
  return top === null || bottom === null || bottom === 0 ? null : top / bottom
}

export function normalizeInstitutional(source: unknown): StocksInstitutionalRow[] {
  const rows = Array.isArray(valueOf(source, 'ownershipList'))
    ? valueOf(source, 'ownershipList') as unknown[]
    : []
  return rows
    .map(record)
    .filter((row) => String(row.organization ?? '').trim())
    .sort((left, right) =>
      (firstFinite(right.pctHeld, right.value, right.position) ?? -Infinity) -
      (firstFinite(left.pctHeld, left.value, left.position) ?? -Infinity),
    )
    .slice(0, 25)
    .map((row) => ({
      holder: String(row.organization).trim(),
      pctHeld: stocksHolderPercentage(row.pctHeld),
      shares: stocksShares(row.position),
      value: stocksCurrency(row.value),
      pctChange: stocksHolderChange(row.pctChange),
      reported: stocksDate(row.reportDate),
    }))
}

export function normalizeInsiders(source: unknown): StocksInsiderRow[] {
  const rows = Array.isArray(valueOf(source, 'transactions'))
    ? valueOf(source, 'transactions') as unknown[]
    : []
  return rows
    .map(record)
    .sort((left, right) =>
      new Date(String(right.startDate ?? 0)).getTime() - new Date(String(left.startDate ?? 0)).getTime(),
    )
    .slice(0, 25)
    .map((row) => ({
      date: stocksDate(row.startDate),
      insider: String(row.filerName || '—').trim() || '—',
      title: String(row.filerRelation || '—').trim() || '—',
      transaction: String(row.transactionText || '—').trim() || '—',
      shares: stocksShares(row.shares),
      value: stocksCurrency(row.value),
    }))
}

async function fetchSummary(symbol: string, force: boolean): Promise<SummaryResult> {
  const resolved = await cache.resolveWithStaleFallback(
    `stocks:summary:${symbol}`,
    TTL.profile,
    async () => {
      const summary = await paced(() =>
        yahoo.quoteSummary(symbol, {
          modules: [
            'price',
            'summaryDetail',
            'financialData',
            'defaultKeyStatistics',
            'assetProfile',
            'calendarEvents',
            'institutionOwnership',
            'insiderTransactions',
          ],
        }),
      )
      const price = summary.price
      const details = summary.summaryDetail
      const financial = summary.financialData
      const statistics = summary.defaultKeyStatistics
      const profile = summary.assetProfile
      const calendar = summary.calendarEvents

      let fallback: Record<string, unknown> = {}
      const needsFallback = [
        financial?.totalRevenue,
        statistics?.netIncomeToCommon,
        statistics?.trailingEps,
        financial?.grossMargins,
        financial?.operatingMargins,
        financial?.profitMargins,
        statistics?.sharesOutstanding,
      ].some((value) => finiteNumber(value) === null)
      if (needsFallback) fallback = await statementFallback(symbol).catch(() => ({}))

      const revenue = firstFinite(financial?.totalRevenue, fallback.totalRevenue, fallback.operatingRevenue)
      const netIncome = firstFinite(
        statistics?.netIncomeToCommon,
        fallback.netIncome,
        fallback.netIncomeCommonStockholders,
      )
      const earnings = calendar?.earnings?.earningsDate ?? []
      const facts: StocksRawFacts = {
        companyName: price?.longName || price?.shortName || symbol,
        exchange: price?.exchange || price?.exchangeName,
        sector: profile?.sector,
        industry: profile?.industry,
        description: profile?.longBusinessSummary || profile?.description,
        marketCap: firstFinite(price?.marketCap, details?.marketCap),
        revenue,
        netIncome,
        eps: firstFinite(statistics?.trailingEps, fallback.dilutedEPS, fallback.basicEPS),
        grossMargin: firstFinite(financial?.grossMargins, ratio(fallback.grossProfit, revenue)),
        operatingMargin: firstFinite(financial?.operatingMargins, ratio(fallback.operatingIncome, revenue)),
        netMargin: firstFinite(financial?.profitMargins, statistics?.profitMargins, ratio(netIncome, revenue)),
        sharesOutstanding: firstFinite(statistics?.sharesOutstanding, fallback.ordinarySharesNumber),
        pe: details?.trailingPE,
        forwardPe: firstFinite(details?.forwardPE, statistics?.forwardPE),
        dividendRate: firstValue(details, 'dividendRate', 'trailingAnnualDividendRate'),
        dividendYield: firstValue(details, 'dividendYield', 'trailingAnnualDividendYield'),
        exDividendDate: calendar?.exDividendDate || details?.exDividendDate,
        volume: firstFinite(details?.volume, details?.regularMarketVolume, price?.regularMarketVolume),
        beta: firstFinite(details?.beta, statistics?.beta),
        earningsDates: earnings,
        targetLow: financial?.targetLowPrice,
        targetMean: financial?.targetMeanPrice,
        targetHigh: financial?.targetHighPrice,
        analystCount: financial?.numberOfAnalystOpinions,
        currentPrice: firstFinite(financial?.currentPrice, price?.regularMarketPrice),
      }
      return {
        facts,
        institutional: normalizeInstitutional(summary.institutionOwnership),
        insiders: normalizeInsiders(summary.insiderTransactions),
      }
    },
    { force },
  )
  return { ...resolved.value, stale: resolved.stale }
}

async function fetchNews(symbol: string, force: boolean): Promise<{ rows: StocksNewsRow[]; stale: boolean }> {
  const resolved = await cache.resolveWithStaleFallback(
    `stocks:news:${symbol}`,
    TTL.news,
    async () => {
      const wanted = normalizeNewsSymbol(symbol)
      const articles = await searchNews(symbol, 20)
      return articles
        .filter((article) => (article.relatedTickers ?? []).map(normalizeNewsSymbol).includes(wanted))
        .map((article) => ({
          id: article.uuid,
          ticker: symbol,
          title: article.title,
          source: article.publisher,
          publishedAt: article.providerPublishTime?.getTime() ?? 0,
          url: article.link,
        }))
        .sort((left, right) => right.publishedAt - left.publishedAt)
        .slice(0, 20)
    },
    { force },
  )
  return { rows: resolved.value, stale: resolved.stale }
}

export async function getStocks(symbolInput: string, force = false): Promise<StocksServiceResult> {
  const symbol = symbolInput.trim().toUpperCase()
  if (!symbol) throw new Error('Enter a ticker symbol.')

  const [chartResult, summaryResult, newsResult] = await Promise.allSettled([
    fetchChart(symbol, force),
    fetchSummary(symbol, force),
    fetchNews(symbol, force),
  ])
  if (chartResult.status === 'rejected') throw chartResult.reason

  const chart = chartResult.value
  const stats = buildStocksStats(symbol, chart.candles, chart.currency, chart.longName)
  const failures: StocksFailure[] = []
  if (chart.stale) failures.push({ block: 'Chart', reason: 'Live chart refresh failed; showing cached data.' })

  let summary: SummaryResult = { facts: {}, institutional: [], insiders: [], stale: false }
  if (summaryResult.status === 'fulfilled') {
    summary = summaryResult.value
    if (summary.stale) {
      for (const block of ['Overview', 'Price targets', 'Description', 'Institutional holders', 'Insider transactions']) {
        failures.push({ block, reason: 'Live company-data refresh failed; showing cached data.' })
      }
    }
  } else {
    const reason = describe(summaryResult.reason)
    for (const block of ['Overview', 'Price targets', 'Description', 'Institutional holders', 'Insider transactions']) {
      failures.push({ block, reason })
    }
  }

  let news: StocksNewsRow[] = []
  if (newsResult.status === 'fulfilled') {
    news = newsResult.value.rows
    if (newsResult.value.stale) failures.push({ block: 'News', reason: 'Live news refresh failed; showing cached data.' })
  } else failures.push({ block: 'News', reason: describe(newsResult.reason) })

  const normalized = normalizeStocksFacts(symbol, {
    ...summary.facts,
    companyName: summary.facts.companyName || stats.longName,
    currentPrice: summary.facts.currentPrice ?? stats.close,
    volume: summary.facts.volume ?? stats.volume,
  })
  const missing = [...new Set(failures.map((failure) => failure.block))]
  return {
    payload: {
      symbol,
      ...normalized,
      chart: { candles: chart.candles, stats, mfi: calculateMfi(chart.candles) },
      news,
      institutional: summary.institutional,
      insiders: summary.insiders,
      missing,
      generatedAt: Date.now(),
    },
    failures,
  }
}
