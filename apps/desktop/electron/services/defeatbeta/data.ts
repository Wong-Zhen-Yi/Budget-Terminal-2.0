import { defeatBeta, type DataRow, type DefeatBetaClient } from './client.js'
import { observeSource } from '../sourceHealth.js'
import type { YahooSeriesRow } from '../yahoo/series.js'

export const DEFEATBETA_PUBLISHED_SOURCE = 'DefeatBeta (published daily data)'

/** Periodic releases can serve historical workloads, but must not silently age out. */
export function requireRecentPublication(asOf: number): void {
  if (!Number.isFinite(asOf) || asOf > Date.now() + 86_400_000 || Date.now() - asOf > 7 * 86_400_000) {
    throw new Error('DefeatBeta publication is more than seven days old or has an invalid date.')
  }
}

export function publishedObservation(asOf: number): void {
  observeSource({ fetchedAt: Date.now(), asOf, stale: false, fromCache: false,
    sources: [DEFEATBETA_PUBLISHED_SOURCE], failures: [] })
}

export function number(value: unknown): number | null {
  const numeric = typeof value === 'bigint' ? Number(value) : value
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : null
}

function date(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null
}

export function normalizePrices(rows: DataRow[]): YahooSeriesRow[] {
  const byDate = new Map<number, YahooSeriesRow>()
  for (const raw of rows) {
    const time = date(raw.report_date)
    const open = number(raw.open)
    const high = number(raw.high)
    const low = number(raw.low)
    const close = number(raw.close)
    const volume = number(raw.volume)
    if (time === null || open === null || high === null || low === null || close === null
      || Math.min(open, high, low, close) <= 0 || high < Math.max(open, close, low)
      || low > Math.min(open, close) || volume === null || volume < 0) continue
    byDate.set(time, { time: time / 1000, open, high, low, close, volume, adjclose: null })
  }
  return [...byDate.values()].sort((a, b) => a.time - b.time)
}

export async function backupPrices(symbol: string, start: Date, end?: Date, client: DefeatBetaClient = defeatBeta) {
  const result = await client.rows('stock_prices', symbol)
  const all = normalizePrices(result.rows)
  const rows = all.filter(row => row.time * 1000 >= start.getTime() && (!end || row.time * 1000 < end.getTime()))
  if (!rows.length) throw new Error(`DefeatBeta has no daily history in the requested range for ${symbol}.`)
  return { rows, currency: 'USD', longName: symbol,
    meta: { dataSource: 'defeatbeta', currency: 'USD', regularMarketTime: new Date(all.at(-1)!.time * 1000) },
    asOf: all.at(-1)!.time * 1000, updatedAt: result.updatedAt }
}

/** Yahoo-sourced OHLC is already split-adjusted. Back-adjust cash dividends once. */
export function adjustDividendCloses(rows: YahooSeriesRow[], dividends: DataRow[]): YahooSeriesRow[] {
  const events = new Map<number, number>()
  for (const event of dividends) {
    const time = date(event.report_date)
    const amount = number(event.amount)
    if (time === null || amount === null || amount < 0) throw new Error('Invalid DefeatBeta dividend event.')
    if (amount === 0 || !rows.length || time / 1000 <= rows[0].time || time / 1000 > rows.at(-1)!.time) continue
    const index = rows.findIndex(row => row.time >= time / 1000)
    const previous = rows[index - 1]?.close
    if (previous === null || previous === undefined || amount >= previous) throw new Error('Invalid DefeatBeta dividend adjustment.')
    events.set(index, (events.get(index) ?? 1) * (1 - amount / previous))
  }
  let factor = 1
  const adjusted = rows.map(row => ({ ...row }))
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    adjusted[index].adjclose = rows[index].close === null ? null : rows[index].close! * factor
    factor *= events.get(index) ?? 1
  }
  return adjusted
}

export async function publishedAdjustedPrices(symbol: string, start: Date, end?: Date, client = defeatBeta) {
  const [prices, dividends] = await Promise.all([
    backupPrices(symbol, new Date(0), undefined, client), client.rows('stock_dividend_events', symbol),
  ])
  requireRecentPublication(prices.updatedAt)
  requireRecentPublication(dividends.updatedAt)
  requireRecentPublication(prices.asOf)
  const rows = adjustDividendCloses(prices.rows, dividends.rows)
    .filter(row => row.time * 1000 >= start.getTime() && (!end || row.time * 1000 < end.getTime()))
  if (!rows.length) throw new Error(`DefeatBeta has no adjusted history in the requested range for ${symbol}.`)
  return { ...prices, rows, meta: { ...prices.meta, adjustmentBasis: 'cash dividends on split-adjusted closes' } }
}

export async function publishedPrices(symbol: string, start: Date, client = defeatBeta) {
  const result = await backupPrices(symbol, start, undefined, client)
  requireRecentPublication(result.updatedAt)
  requireRecentPublication(result.asOf)
  publishedObservation(result.asOf)
  return result
}

export async function publishedSummary(symbol: string, client = defeatBeta) {
  const result = await backupSummary(symbol, client)
  requireRecentPublication(result.asOf)
  publishedObservation(result.asOf)
  return result
}

const ITEM_ALIASES: Record<string, string> = {
  basic_eps: 'basicEPS', diluted_eps: 'dilutedEPS',
  net_income_attributable_to_parent_company_shareholders: 'netIncome',
}

export function normalizeStatements(rows: DataRow[], period: 'annual' | 'quarterly', start: Date): DataRow[] {
  const byDate = new Map<number, DataRow>()
  for (const raw of rows) {
    const time = date(raw.report_date)
    const value = number(raw.item_value)
    if (raw.period_type !== period || time === null || time < start.getTime() || value === null
      || typeof raw.item_name !== 'string') continue
    const key = ITEM_ALIASES[raw.item_name] ?? raw.item_name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    const row = byDate.get(time) ?? { date: new Date(time), dataSource: 'defeatbeta' }
    row[key] = value
    byDate.set(time, row)
  }
  return [...byDate.entries()].sort(([a], [b]) => a - b).map(([, row]) => row)
}

export async function backupStatements(symbol: string, period: 'annual' | 'quarterly', start: Date, client = defeatBeta) {
  const result = await client.rows('stock_statement', symbol)
  const rows = normalizeStatements(result.rows, period, start)
  if (!rows.length) throw new Error(`DefeatBeta has no ${period} statements for ${symbol}.`)
  return { rows, asOf: result.updatedAt }
}

/** Populate only reported fields; analyst forecasts, holders and live metrics stay absent. */
export async function backupSummary(symbol: string, client = defeatBeta) {
  const [profileResult, company] = await Promise.all([client.rows('stock_profile', symbol), client.company(symbol)])
  const profile = profileResult.rows.at(-1)!
  const [prices, statements, sharesResult] = await Promise.allSettled([
    backupPrices(symbol, new Date(Date.now() - 14 * 86_400_000), undefined, client),
    client.rows('stock_statement', symbol),
    client.rows('stock_shares_outstanding', symbol),
  ])
  const latest = prices.status === 'fulfilled' ? prices.value.rows.at(-1) : undefined
  const previous = prices.status === 'fulfilled' ? prices.value.rows.at(-2) : undefined
  const ttm: DataRow = {}
  if (statements.status === 'fulfilled') for (const row of statements.value.rows) {
    if (row.report_date === 'TTM' && row.period_type === 'quarterly' && typeof row.item_name === 'string') {
      ttm[row.item_name] = number(row.item_value)
    }
  }
  const annual = statements.status === 'fulfilled'
    ? normalizeStatements(statements.value.rows, 'annual', new Date(0)).at(-1) ?? {} : {}
  const quarters = statements.status === 'fulfilled' ? normalizeStatements(statements.value.rows, 'quarterly', new Date(0)) : []
  const latestQuarter = quarters.at(-1)
  const lastYearDate = latestQuarter?.date instanceof Date ? new Date(latestQuarter.date) : undefined
  lastYearDate?.setUTCFullYear(lastYearDate.getUTCFullYear() - 1)
  const yearAgoQuarter = quarters.find(row => row.date instanceof Date && row.date.getTime() === lastYearDate?.getTime())
  const latestRevenue = number(latestQuarter?.totalRevenue)
  const yearAgoRevenue = number(yearAgoQuarter?.totalRevenue)
  const shareRows = sharesResult.status === 'fulfilled' ? sharesResult.value.rows
    .filter(row => date(row.report_date) !== null && (!latest || date(row.report_date)! <= latest.time * 1000))
    .sort((a, b) => String(a.report_date).localeCompare(String(b.report_date))) : []
  const shares = number(shareRows.at(-1)?.shares_outstanding)
  const marketCap = shares !== null && latest?.close ? shares * latest.close : undefined
  const financialCurrency = typeof company.financial_currency === 'string' ? company.financial_currency : undefined
  const ratio = (top: unknown, bottom: unknown) => {
    const numerator = number(top)
    const denominator = number(bottom)
    return numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : undefined
  }
  const trailingPE = financialCurrency === 'USD' ? ratio(latest?.close, ttm.diluted_eps) : undefined
  const financialData = { financialCurrency, currentPrice: latest?.close,
    revenueGrowth: latestRevenue !== null && yearAgoRevenue !== null && yearAgoRevenue > 0 ? latestRevenue / yearAgoRevenue - 1 : undefined,
    totalRevenue: ttm.total_revenue, ebitda: ttm.ebitda, freeCashflow: ttm.free_cash_flow,
    operatingCashflow: ttm.operating_cash_flow,
    grossMargins: ratio(ttm.gross_profit, ttm.total_revenue),
    operatingMargins: ratio(ttm.operating_income, ttm.total_revenue),
    profitMargins: ratio(ttm.net_income_common_stockholders, ttm.total_revenue),
    totalDebt: annual.totalDebt, totalCash: annual.cashCashEquivalentsAndShortTermInvestments }
  const summary = {
    price: { symbol, shortName: company.title ?? symbol, longName: company.title ?? symbol,
      quoteType: company.ticker === symbol ? 'EQUITY' : undefined, marketCap,
      // Dataset contains US listings in USD; financial reporting currency is separate.
      currency: 'USD', regularMarketPrice: latest?.close, regularMarketPreviousClose: previous?.close,
      regularMarketTime: latest ? new Date(latest.time * 1000) : undefined, regularMarketVolume: latest?.volume },
    summaryDetail: { currency: 'USD', previousClose: previous?.close, volume: latest?.volume, marketCap, trailingPE,
      priceToSalesTrailing12Months: financialCurrency === 'USD' ? ratio(marketCap, ttm.total_revenue) : undefined },
    financialData,
    defaultKeyStatistics: { netIncomeToCommon: ttm.net_income_common_stockholders, sharesOutstanding: shares,
      trailingEps: financialCurrency === 'USD' ? ttm.diluted_eps : undefined },
    assetProfile: { address1: profile.address, city: profile.city, country: profile.country, phone: profile.phone,
      zip: profile.zip, sector: profile.sector, industry: profile.industry, website: profile.web_site,
      longBusinessSummary: profile.long_business_summary, fullTimeEmployees: number(profile.full_time_employees) },
  }
  const limitations = ['Market cap uses the latest reported shares. Analyst targets, ownership, calendar, options and live metrics are unavailable.']
  if (prices.status === 'rejected') limitations.push(`Price unavailable: ${String(prices.reason)}`)
  if (statements.status === 'rejected') limitations.push(`Statements unavailable: ${String(statements.reason)}`)
  if (sharesResult.status === 'rejected') limitations.push(`Shares unavailable: ${String(sharesResult.reason)}`)
  return { summary, asOf: Math.min(profileResult.updatedAt, prices.status === 'fulfilled' ? prices.value.asOf : Infinity),
    limitations: limitations.join(' ') }
}
