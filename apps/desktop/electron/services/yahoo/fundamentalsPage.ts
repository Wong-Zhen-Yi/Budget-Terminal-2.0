import type {
  FundamentalSeriesKey,
  FundamentalSeriesMap,
  FundamentalSeriesPoint,
  FundamentalsPageCompany,
  FundamentalsPageFacts,
  FundamentalsPagePayload,
} from '../../shared/contract.js'
import {
  combineCashAndBonds,
  combineDebt,
  emptyFundamentalSeriesMap,
  mergeMetricSeries,
  periodLabel,
  sortSeries,
} from '../../shared/fundamentalsPage.js'
import { cache, TTL } from '../cache.js'
import { fetchSecCompanyBundle, type SecCompanyBundle } from '../secEdgar.js'
import { paced, yahoo } from './client.js'

export const FUNDAMENTALS_PAGE_SOURCE = 'SEC EDGAR + Yahoo Finance'

export interface FundamentalsPageFailure {
  source: string
  operation: string
  reason: string
}

export interface FundamentalsPageServiceResult {
  payload: FundamentalsPagePayload
  failures: FundamentalsPageFailure[]
  stale: boolean
}

export interface FundamentalsPageFetchers {
  summary(symbol: string): Promise<{
    company: FundamentalsPageCompany
    facts: FundamentalsPageFacts
  }>
  annual(symbol: string, period1: Date): Promise<unknown>
  quarterly(symbol: string, period1: Date): Promise<unknown>
  sec(symbol: string, force: boolean): Promise<SecCompanyBundle>
  price(symbol: string): Promise<number | null>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function finite(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function emptyCompany(symbol: string): FundamentalsPageCompany {
  return {
    name: symbol,
    exchange: '',
    sector: '',
    industry: '',
    currency: 'USD',
    website: '',
    irWebsite: '',
  }
}

function emptyFacts(): FundamentalsPageFacts {
  return {
    trailingPe: null,
    forwardPe: null,
    priceToSales: null,
    pegRatio: null,
    earningsGrowth: null,
    enterpriseValue: null,
    ebitda: null,
    marketCap: null,
    totalRevenue: null,
    freeCashFlow: null,
    totalCash: null,
    totalDebt: null,
    sharesOutstanding: null,
    beta: null,
    currentPrice: null,
  }
}

export function emptyFundamentalsPagePayload(symbolInput: string): FundamentalsPagePayload {
  const symbol = symbolInput.trim().toUpperCase()
  return {
    symbol,
    company: emptyCompany(symbol),
    facts: emptyFacts(),
    annual: emptyFundamentalSeriesMap(),
    quarterly: emptyFundamentalSeriesMap(),
    sec: {
      available: false,
      statementsAvailable: false,
      cik: '',
      freshness: 'failed',
      statementFreshness: 'failed',
      cacheAgeSeconds: 0,
      filings: [],
      warnings: [],
    },
    warnings: [],
    generatedAt: 0,
  }
}

function point(
  dateValue: unknown,
  value: unknown,
  period: 'annual' | 'quarterly',
): FundamentalSeriesPoint | null {
  const date = dateValue instanceof Date ? dateValue : new Date(String(dateValue ?? ''))
  const numeric = finite(value)
  if (!Number.isFinite(date.getTime()) || numeric === null) return null
  const endDate = date.toISOString().slice(0, 10)
  return { endDate, label: periodLabel(endDate, period), value: numeric, source: 'yahoo' }
}

function firstPoint(
  row: Record<string, unknown>,
  period: 'annual' | 'quarterly',
  ...keys: string[]
): FundamentalSeriesPoint | null {
  for (const key of keys) {
    const candidate = point(row.date, row[key], period)
    if (candidate) return candidate
  }
  return null
}

function normalizeYahooStatements(
  rowsInput: unknown,
  period: 'annual' | 'quarterly',
): FundamentalSeriesMap {
  const output = emptyFundamentalSeriesMap()
  const cashCombined: FundamentalSeriesPoint[] = []
  const cash: FundamentalSeriesPoint[] = []
  const shortTerm: FundamentalSeriesPoint[] = []
  const longTerm: FundamentalSeriesPoint[] = []
  const debtTotal: FundamentalSeriesPoint[] = []
  const debtCurrent: FundamentalSeriesPoint[] = []
  const debtLong: FundamentalSeriesPoint[] = []
  const push = (key: FundamentalSeriesKey, value: FundamentalSeriesPoint | null) => {
    if (value) output[key].push(value)
  }
  for (const raw of Array.isArray(rowsInput) ? rowsInput : []) {
    const row = record(raw)
    push('revenue', firstPoint(row, period, 'totalRevenue', 'operatingRevenue'))
    push('netIncome', firstPoint(row, period, 'netIncome', 'netIncomeCommonStockholders'))
    push('operatingCashFlow', firstPoint(row, period, 'operatingCashFlow'))
    push('freeCashFlow', firstPoint(row, period, 'freeCashFlow'))
    push('sharesOutstanding', firstPoint(row, period, 'ordinarySharesNumber', 'shareIssued'))
    push('sellingGeneralAdmin', firstPoint(row, period, 'sellingGeneralAndAdministration', 'generalAndAdministrativeExpense'))
    push('researchDevelopment', firstPoint(row, period, 'researchAndDevelopment'))
    const append = (target: FundamentalSeriesPoint[], value: FundamentalSeriesPoint | null) => {
      if (value) target.push(value)
    }
    append(cashCombined, firstPoint(row, period, 'cashCashEquivalentsAndShortTermInvestments'))
    append(cash, firstPoint(row, period, 'cashAndCashEquivalents', 'cashFinancial'))
    append(shortTerm, firstPoint(row, period, 'otherShortTermInvestments', 'shortTermInvestments'))
    append(longTerm, firstPoint(row, period, 'availableForSaleSecurities', 'longTermInvestments'))
    append(debtTotal, firstPoint(row, period, 'totalDebt'))
    append(debtCurrent, firstPoint(row, period, 'currentDebt', 'currentDebtAndCapitalLeaseObligation'))
    append(debtLong, firstPoint(row, period, 'longTermDebt', 'longTermDebtAndCapitalLeaseObligation'))
  }
  for (const key of Object.keys(output) as FundamentalSeriesKey[]) output[key] = sortSeries(output[key])
  output.cashAndBonds = combineCashAndBonds(cashCombined, cash, shortTerm, longTerm)
  output.totalDebt = combineDebt(debtTotal, debtCurrent, debtLong)
  return output
}

function mergeSeriesMaps(yahooMap: FundamentalSeriesMap, secMap: FundamentalSeriesMap): FundamentalSeriesMap {
  return Object.fromEntries(
    (Object.keys(yahooMap) as FundamentalSeriesKey[]).map((key) => [
      key,
      mergeMetricSeries(yahooMap[key], secMap[key]),
    ]),
  ) as FundamentalSeriesMap
}

async function fetchSummary(symbol: string): Promise<{
  company: FundamentalsPageCompany
  facts: FundamentalsPageFacts
}> {
  const summary = await paced(() => yahoo.quoteSummary(symbol, {
    modules: ['price', 'summaryDetail', 'financialData', 'defaultKeyStatistics', 'assetProfile'],
  }))
  const price = summary.price
  const detail = summary.summaryDetail
  const financial = summary.financialData
  const statistics = summary.defaultKeyStatistics
  const profile = summary.assetProfile
  return {
    company: {
      name: String(price?.longName ?? price?.shortName ?? symbol),
      exchange: String(price?.exchangeName ?? price?.exchange ?? ''),
      sector: String(profile?.sector ?? ''),
      industry: String(profile?.industry ?? ''),
      currency: String(price?.currency ?? financial?.financialCurrency ?? 'USD'),
      website: String(profile?.website ?? ''),
      irWebsite: String(profile?.irWebsite ?? ''),
    },
    facts: {
      trailingPe: finite(detail?.trailingPE, statistics?.trailingPE),
      forwardPe: finite(financial?.forwardPE, statistics?.forwardPE),
      priceToSales: finite(detail?.priceToSalesTrailing12Months, statistics?.priceToSalesTrailing12Months),
      pegRatio: finite(statistics?.pegRatio),
      earningsGrowth: finite(financial?.earningsGrowth),
      enterpriseValue: finite(statistics?.enterpriseValue),
      ebitda: finite(financial?.ebitda),
      marketCap: finite(price?.marketCap, detail?.marketCap),
      totalRevenue: finite(financial?.totalRevenue),
      freeCashFlow: finite(financial?.freeCashflow),
      totalCash: finite(financial?.totalCash),
      totalDebt: finite(financial?.totalDebt),
      sharesOutstanding: finite(statistics?.sharesOutstanding),
      beta: finite(detail?.beta),
      currentPrice: finite(financial?.currentPrice, price?.regularMarketPrice),
    },
  }
}

async function priceFallback(symbol: string): Promise<number | null> {
  try {
    const result = await paced(() => yahoo.chart(symbol, {
      period1: new Date(Date.now() - 7 * 24 * 60 * 60_000),
      interval: '1d',
    }))
    const quotes = Array.isArray(result.quotes) ? result.quotes : []
    return finite(quotes.at(-1)?.close)
  } catch {
    return null
  }
}

const defaultFetchers: FundamentalsPageFetchers = {
  summary: fetchSummary,
  annual: (symbol, period1) => paced(() => yahoo.fundamentalsTimeSeries(symbol, { period1, type: 'annual', module: 'all' })),
  quarterly: (symbol, period1) => paced(() => yahoo.fundamentalsTimeSeries(symbol, { period1, type: 'quarterly', module: 'all' })),
  sec: fetchSecCompanyBundle,
  price: priceFallback,
}

async function fetchUncached(
  symbol: string,
  force: boolean,
  fetchers: FundamentalsPageFetchers = defaultFetchers,
): Promise<Omit<FundamentalsPageServiceResult, 'stale'>> {
  const period1Annual = new Date(Date.now() - 11 * 365 * 24 * 60 * 60_000)
  const period1Quarterly = new Date(Date.now() - 5 * 365 * 24 * 60 * 60_000)
  const [summaryResult, annualResult, quarterlyResult, secResult] = await Promise.allSettled([
    fetchers.summary(symbol),
    fetchers.annual(symbol, period1Annual),
    fetchers.quarterly(symbol, period1Quarterly),
    fetchers.sec(symbol, force),
  ])
  const failures: FundamentalsPageFailure[] = []
  let company = emptyCompany(symbol)
  let facts = emptyFacts()
  if (summaryResult.status === 'fulfilled') ({ company, facts } = summaryResult.value)
  else failures.push({ source: 'Yahoo Finance', operation: 'company metadata', reason: String(summaryResult.reason) })

  const yahooAnnual = annualResult.status === 'fulfilled'
    ? normalizeYahooStatements(annualResult.value, 'annual')
    : emptyFundamentalSeriesMap()
  const yahooQuarterly = quarterlyResult.status === 'fulfilled'
    ? normalizeYahooStatements(quarterlyResult.value, 'quarterly')
    : emptyFundamentalSeriesMap()
  if (annualResult.status === 'rejected') failures.push({ source: 'Yahoo Finance', operation: 'annual statements', reason: String(annualResult.reason) })
  if (quarterlyResult.status === 'rejected') failures.push({ source: 'Yahoo Finance', operation: 'quarterly statements', reason: String(quarterlyResult.reason) })

  const sec = secResult.status === 'fulfilled'
    ? secResult.value
    : {
        annual: emptyFundamentalSeriesMap(),
        quarterly: emptyFundamentalSeriesMap(),
        metadata: {
          available: false,
          statementsAvailable: false,
          cik: '',
          freshness: 'failed' as const,
          statementFreshness: 'failed' as const,
          cacheAgeSeconds: 0,
          filings: [],
          warnings: [String(secResult.reason)],
        },
      }
  for (const warning of sec.metadata.warnings) failures.push({ source: 'SEC EDGAR', operation: 'fetch', reason: warning })

  const annual = mergeSeriesMaps(yahooAnnual, sec.annual)
  const quarterly = mergeSeriesMaps(yahooQuarterly, sec.quarterly)
  if (!annual.sharesOutstanding.length && facts.sharesOutstanding !== null) {
    annual.sharesOutstanding = [{ endDate: '9999-12-31', label: 'Current', value: facts.sharesOutstanding, source: 'yahoo' }]
  }
  if (facts.currentPrice === null) facts = { ...facts, currentPrice: await fetchers.price(symbol) }
  const hasStatements = [...Object.values(annual), ...Object.values(quarterly)].some((series) => series.length)
  const hasCompanyInfo = company.name !== symbol || Boolean(company.website || company.exchange || company.sector || company.industry)
  if (!hasCompanyInfo && facts.currentPrice === null && !hasStatements) {
    throw new Error(`No data found for '${symbol}'. Check the ticker symbol.`)
  }
  const warnings = [...new Set([...sec.metadata.warnings, ...failures.map((failure) => `${failure.source}: ${failure.reason}`)])]
  return {
    payload: { symbol, company, facts, annual, quarterly, sec: sec.metadata, warnings, generatedAt: Date.now() },
    failures,
  }
}

export async function getFundamentalsPage(symbolInput: string, force = false): Promise<FundamentalsPageServiceResult> {
  const symbol = symbolInput.trim().toUpperCase()
  if (!symbol) throw new Error('Enter a ticker symbol.')
  const resolved = await cache.resolveWithStaleFallback(
    `fundamentals-page:${symbol}`,
    TTL.profile,
    () => fetchUncached(symbol, force),
    { force },
  )
  return { ...resolved.value, stale: resolved.stale }
}

export const fundamentalsPageTesting = {
  fetchUncached,
  normalizeYahooStatements,
  mergeSeriesMaps,
}
