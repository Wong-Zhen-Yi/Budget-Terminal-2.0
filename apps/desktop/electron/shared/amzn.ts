import type { BackgroundRequest, FundamentalsPagePayload, SecFiling, StocksPayload } from './contract.js'

export const AMZN_BLOCKS = ['market', 'financials', 'earnings'] as const
export type AmznBlock = (typeof AMZN_BLOCKS)[number]
export interface AmznRequest extends BackgroundRequest { force?: boolean }
export interface AmznSegment {
  name: string
  revenue: number | null
  yearAgoRevenue: number | null
  revenueGrowth: number | null
  operatingIncome: number | null
  operatingMargin: number | null
}
export interface AmznRevenueCategory { name: string; revenue: number | null; revenueGrowth: number | null }
export interface AmznGuidance {
  period: string
  revenueLow: number | null
  revenueHigh: number | null
  operatingIncomeLow: number | null
  operatingIncomeHigh: number | null
  notes: string
}
export interface AmznReport {
  period: string
  publishedAt: string
  sourceUrl: string
  revenue: number | null
  operatingIncome: number | null
  operatingMargin: number | null
  netIncome: number | null
  dilutedEps: number | null
  operatingCashFlow: number | null
  capex: number | null
  capexProceeds: number | null
  freeCashFlow: number | null
  ttmOperatingCashFlow: number | null
  ttmNetCapex: number | null
  ttmFreeCashFlow: number | null
  segments: AmznSegment[]
  revenueCategories: AmznRevenueCategory[]
  guidance: AmznGuidance
  warnings: string[]
}
export interface AmznEarnings { reports: AmznReport[]; warnings: string[] }
export interface AmznPayload {
  symbol: 'AMZN'
  market: StocksPayload | null
  financials: FundamentalsPagePayload | null
  earnings: AmznEarnings | null
  progress: Record<AmznBlock, 'loaded' | 'partial' | 'stale' | 'unavailable'>
  laneFetchedAt: Record<AmznBlock, number | null>
  fetchedAt: number
}
export function emptyAmznPayload(): AmznPayload {
  return { symbol: 'AMZN', market: null, financials: null, earnings: null,
    progress: { market: 'unavailable', financials: 'unavailable', earnings: 'unavailable' },
    laneFetchedAt: { market: null, financials: null, earnings: null }, fetchedAt: 0 }
}

export const amznText = (html: string): string => html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/\s+/g, ' ').trim()

export function amznNumber(text: string, scale = 1): number | null {
  const clean = text.replace(/[$,%\s]/g, '').replace(/[−–]/g, '-')
  if (/^[—-]$/.test(clean)) return 0
  if (!/^(?:[+-]?\d+(?:\.\d+)?|\(\d+(?:\.\d+)?\))$/.test(clean)) return null
  const value = Number(clean.startsWith('(') ? `-${clean.slice(1, -1)}` : clean) * scale
  return Number.isFinite(value) ? value : null
}
const percentChange = (value: number | null, previous: number | null) => value === null || previous === null || previous <= 0 ? null : (value / previous - 1) * 100
const margin = (income: number | null, revenue: number | null) => income === null || revenue === null || revenue <= 0 ? null : income / revenue * 100
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const QUARTERS = ['First', 'Second', 'Third', 'Fourth']
export function amznReleasePeriod(html: string): string {
  const match = /financial results for its (first|second|third|fourth) quarter ended ([a-z]+) \d{1,2},? (20\d{2})/i.exec(amznText(html))
  if (!match || MONTHS.findIndex(month => month.toLowerCase() === match[2].toLowerCase()) !== (QUARTERS.findIndex(q => q.toLowerCase() === match[1].toLowerCase()) + 1) * 3 - 1) {
    throw new Error('Amazon release does not identify a valid quarterly reporting period.')
  }
  return `${match[3]} Q${QUARTERS.findIndex(q => q.toLowerCase() === match[1].toLowerCase()) + 1}`
}
export function amznEarningsFilings(filings: readonly SecFiling[]): SecFiling[] {
  return filings.filter(filing => filing.form === '8-K' && /\b2\.02\b/.test(filing.items))
    .sort((a, b) => b.filedDate.localeCompare(a.filedDate)).slice(0, 8)
}
export function amznExhibitUrl(html: string, documentUrl: string): string {
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = new URL(match[1], documentUrl)
    if (url.protocol === 'https:' && !url.username && !url.password && url.hostname === 'www.sec.gov' && url.pathname.startsWith('/Archives/edgar/data/1018724/') && /(?:ex99[._-]?1|ex991)\.html?$/i.test(url.pathname)) return url.href
  }
  throw new Error('Amazon earnings exhibit 99.1 was not found.')
}
export function amznIrUrl(period: string): string {
  const match = /^(20\d{2}) Q([1-4])$/.exec(period)
  if (!match) throw new Error('Invalid Amazon reporting period.')
  const quarter = Number(match[2])
  return `https://ir.aboutamazon.com/news-release/news-release-details/${Number(match[1]) + (quarter === 4 ? 1 : 0)}/Amazon-com-Announces-${QUARTERS[quarter - 1]}-Quarter-Results/default.aspx?mode=light`
}
/** Earnings 8-K report dates describe publication, rather than the financial quarter. */
export function amznPeriodBeforePublication(publishedAt: string): string {
  const date = new Date(`${publishedAt}T00:00:00Z`)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid Amazon publication date.')
  const quarter = Math.floor(date.getUTCMonth() / 3)
  return `${date.getUTCFullYear() - (quarter === 0 ? 1 : 0)} Q${quarter || 4}`
}

type Row = string[]
function tables(html: string): Row[][] {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(table =>
    [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => amznText(cell[1]))))
}
function label(row: Row): string { return row.find(cell => cell !== '') ?? '' }
function numbers(row: Row): Array<number | null> {
  const start = row.findIndex(cell => cell !== '')
  const text = row.slice(start + 1).join(' ').replace(/[$%]/g, '')
  return [...text.matchAll(/\(\s*[\d,]+(?:\.\d+)?\s*\)|[+−-]?\d[\d,]*(?:\.\d+)?|—|N\/?A/gi)].map(match => amznNumber(match[0]))
}
function quarterlyValue(rows: Row[] | undefined, pattern: RegExp, year: number, scale = 1e6): number | null {
  if (!rows) return null
  // The first section must be the quarterly pair, followed only by YTD/annual pairs.
  const periods = rows.find(row => /Months Ended|Year Ended/.test(row.join(' ')))
  if (!periods || !/^Three Months Ended/.test(label(periods))) return null
  const years = rows.find(row => row.filter(cell => /^20\d{2}$/.test(cell)).length >= 2)?.filter(cell => /^20\d{2}$/.test(cell)) ?? []
  if (Number(years[0]) !== year - 1 || Number(years[1]) !== year) return null
  const values = rows.find(row => pattern.test(label(row)))
  const parsed = values ? numbers(values) : []
  if (parsed.length !== years.length) return null
  return parsed[1] == null ? null : parsed[1] * scale
}
function supplementalValue(rows: Row[] | undefined, pattern: RegExp, period: string, scale = 1e6): number | null {
  const header = rows?.find(row => row.some(cell => /^Q[1-4] 20\d{2}$/.test(cell)))
  if (!rows || !header) return null
  const periods = header.filter(cell => /^Q[1-4] 20\d{2}$/.test(cell)).map(cell => `${cell.slice(3)} ${cell.slice(0, 2)}`)
  const index = periods.indexOf(period)
  const row = rows.find(row => pattern.test(label(row)))
  const values = row ? numbers(row) : []
  if (index < 0 || (values.length !== periods.length && values.length !== periods.length + 1)) return null
  return values[index] == null ? null : values[index]! * scale
}
function sectionRows(rows: Row[], name: string): Row[] {
  const start = rows.findIndex(row => new RegExp(`^${name}(?: Segment)?:?$`, 'i').test(label(row)) && numbers(row).length === 0)
  if (start < 0) return []
  const end = rows.findIndex((row, index) => index > start && /^(?:North America|International|AWS|Consolidated)(?: Segment)?:?$/.test(label(row)) && numbers(row).length === 0)
  return rows.slice(start + 1, end < 0 ? undefined : end)
}

/** Read the accounting tables, preserving quarter/YTD/TTM column membership. */
export function parseAmznReport(html: string, sourceUrl: string, publishedAt: string, expectedPeriod?: string): AmznReport {
  const period = amznReleasePeriod(html)
  if (expectedPeriod && period !== expectedPeriod) throw new Error(`Amazon release is ${period}; expected ${expectedPeriod}.`)
  const year = Number(period.slice(0, 4))
  const all = tables(html)
  if (!/in millions/i.test(amznText(html)) || !all.length) throw new Error('Amazon earnings tables or monetary units changed.')
  const income = all.find(rows => rows.some(row => /^Total net sales$/i.test(label(row))) && rows.some(row => /^Diluted earnings per share$/i.test(label(row))))
  const cash = all.find(rows => rows.some(row => /^Purchases of property and equipment$/i.test(label(row))) && rows.some(row => /^Net cash provided by \(used in\) operating activities$/i.test(label(row))))
  const segmentTable = all.find(rows => /Three Months Ended/.test(rows.map(row => row.join(' ')).join(' ')) && rows.some(row => /^North America$/.test(label(row))))
  const supplemental = all.find(rows => rows.some(row => /^Free cash flow -- TTM/.test(label(row))))
  const categories = all.find(rows => rows.some(row => /^Online stores(?: \(\d+\))?$/.test(label(row))) && rows.some(row => /^Q[1-4] 20\d{2}$/.test(row.find(cell => /^Q[1-4]/.test(cell)) ?? '')))
  const revenue = quarterlyValue(income, /^Total net sales$/, year)
  const operatingIncome = quarterlyValue(income, /^Operating income$/, year)
  const operatingCashFlow = quarterlyValue(cash, /^Net cash provided by \(used in\) operating activities$/, year)
  const purchases = quarterlyValue(cash, /^Purchases of property and equipment$/, year)
  const capex = purchases === null ? null : Math.abs(purchases)
  const capexProceeds = quarterlyValue(cash, /^Proceeds from property and equipment sales and incentives$/, year)
  if (revenue === null || revenue <= 0 || operatingIncome === null) throw new Error('Amazon quarterly income statement columns changed or required results are missing.')
  const segments = ['North America', 'International', 'AWS'].map(name => {
    const rows = sectionRows(segmentTable ?? [], name)
    const combined = [...(segmentTable?.filter(row => /Months Ended/.test(row.join(' ')) || row.some(cell => /^20\d{2}$/.test(cell))) ?? []), ...rows]
    const revenue = quarterlyValue(combined, /^Net sales$/, year)
    const operatingIncome = quarterlyValue(combined, /^Operating income(?: \(loss\))?$/, year)
    const salesRow = rows.find(row => /^Net sales$/.test(label(row)))
    const yearAgoRevenue = salesRow && numbers(salesRow).length >= 2 ? numbers(salesRow)[0] === null ? null : numbers(salesRow)[0]! * 1e6 : null
    return { name, revenue, yearAgoRevenue, revenueGrowth: percentChange(revenue, yearAgoRevenue), operatingIncome, operatingMargin: margin(operatingIncome, revenue) }
  })
  const revenueCategories = ['Online stores', 'Physical stores', 'Third-party seller services', 'Advertising services', 'Subscription services', 'AWS', 'Other'].map(name => {
    const pattern = new RegExp(`^${name}(?: \\(\\d+\\))?$`, 'i')
    const revenue = supplementalValue(categories, pattern, period)
    const previous = supplementalValue(categories, pattern, `${year - 1} ${period.slice(-2)}`)
    return { name, revenue, revenueGrowth: percentChange(revenue, previous) }
  })
  const text = amznText(html)
  const guidanceText = /(?:First|Second|Third|Fourth) Quarter 20\d{2} Guidance([\s\S]*?)(?:Conference Call Information|Forward-Looking Statements)/i.exec(text)
  const guidanceTitle = /((?:First|Second|Third|Fourth) Quarter 20\d{2}) Guidance/i.exec(text)?.[1] ?? ''
  const range = (pattern: RegExp): [number | null, number | null] => {
    const match = pattern.exec(guidanceText?.[1] ?? '')
    return match ? [Number(match[1].replace(/,/g, '')) * 1e9, Number(match[2].replace(/,/g, '')) * 1e9] : [null, null]
  }
  const salesRange = range(/Net sales are expected to be between \$([\d,.]+) billion and \$([\d,.]+) billion/i)
  const incomeRange = range(/Operating income is expected to be between \$([\d,.]+) billion and \$([\d,.]+) billion/i)
  const ttmOperatingCashFlow = supplementalValue(supplemental, /^Operating cash flow -- trailing twelve months \(TTM\)$/, period)
  const ttmNetCapex = supplementalValue(supplemental, /^Purchases of property and equipment, net of proceeds from sales and incentives -- TTM/, period)
  const ttmFreeCashFlow = supplementalValue(supplemental, /^Free cash flow -- TTM/, period)
  const report: AmznReport = { period, publishedAt, sourceUrl, revenue, operatingIncome, operatingMargin: margin(operatingIncome, revenue),
    netIncome: quarterlyValue(income, /^Net income(?: \(loss\))?$/, year), dilutedEps: quarterlyValue(income, /^Diluted earnings per share$/, year, 1),
    operatingCashFlow, capex, capexProceeds, freeCashFlow: operatingCashFlow === null || capex === null || capexProceeds === null ? null : operatingCashFlow - capex + capexProceeds,
    ttmOperatingCashFlow, ttmNetCapex, ttmFreeCashFlow, segments, revenueCategories,
    guidance: { period: guidanceTitle, revenueLow: salesRange[0], revenueHigh: salesRange[1], operatingIncomeLow: incomeRange[0], operatingIncomeHigh: incomeRange[1], notes: guidanceText?.[1]?.trim() ?? '' }, warnings: [] }
  if ([report.netIncome, report.dilutedEps, operatingCashFlow, capex, capexProceeds, ttmOperatingCashFlow, ttmNetCapex, ttmFreeCashFlow].some(value => value === null)) report.warnings.push(`${period}: financial or cash-flow metrics unavailable.`)
  if (segments.some(segment => segment.revenue === null || segment.operatingIncome === null)) report.warnings.push(`${period}: segment results unavailable.`)
  if (revenueCategories.some(category => category.revenue === null)) report.warnings.push(`${period}: revenue categories unavailable.`)
  if (salesRange.includes(null) || incomeRange.includes(null)) report.warnings.push(`${period}: next-quarter guidance unavailable.`)
  const categoryTotal = revenueCategories.reduce((sum, category) => sum + (category.revenue ?? 0), 0)
  if (revenueCategories.every(category => category.revenue !== null) && Math.abs(categoryTotal - revenue) > 1e6) {
    report.revenueCategories = revenueCategories.map(category => ({ ...category, revenue: null, revenueGrowth: null }))
    report.warnings.push(`${period}: revenue categories do not reconcile to net sales.`)
  }
  if (ttmOperatingCashFlow !== null && ttmNetCapex !== null && ttmFreeCashFlow !== null && Math.abs(ttmOperatingCashFlow - ttmNetCapex - ttmFreeCashFlow) > 1e6) {
    report.ttmFreeCashFlow = null
    report.warnings.push(`${period}: trailing free cash flow does not reconcile to Amazon's disclosed definition.`)
  }
  return report
}
