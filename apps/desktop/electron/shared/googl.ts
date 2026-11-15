import type { BackgroundRequest, StocksPayload } from './contract.js'

export const GOOGL_BLOCKS = ['market', 'earnings'] as const
export type GooglBlock = (typeof GOOGL_BLOCKS)[number]
export interface GooglRequest extends BackgroundRequest { force?: boolean }
export const GOOGL_BUSINESSES = ['Search & other', 'YouTube ads', 'Google Network', 'Subscriptions, platforms & devices', 'Google Cloud', 'Other Bets'] as const
export interface GooglBusiness { name: string; revenue: number | null; yearAgoRevenue: number | null; growth: number | null }
export interface GooglReport {
  period: string
  publishedAt: string
  sourceUrl: string
  revenue: number
  revenueGrowth: number | null
  operatingIncome: number
  operatingMargin: number
  dilutedEps: number | null
  businesses: GooglBusiness[]
  servicesOperatingIncome: number | null
  cloudOperatingIncome: number | null
  otherBetsOperatingIncome: number | null
  alphabetLevelIncome: number | null
  tac: number | null
  tacRate: number | null
  operatingCashFlow: number | null
  capex: number | null
  freeCashFlow: number | null
  buybacks: number | null
  dividends: number | null
  warnings: string[]
}
export interface GooglEarnings { reports: GooglReport[]; warnings: string[] }
export interface GooglPayload {
  symbol: 'GOOGL'
  market: StocksPayload | null
  earnings: GooglEarnings | null
  progress: Record<GooglBlock, 'loaded' | 'partial' | 'stale' | 'unavailable'>
  laneFetchedAt: Record<GooglBlock, number | null>
  fetchedAt: number
}
export function emptyGooglPayload(): GooglPayload {
  return { symbol: 'GOOGL', market: null, earnings: null, progress: { market: 'unavailable', earnings: 'unavailable' }, laneFetchedAt: { market: null, earnings: null }, fetchedAt: 0 }
}

const text = (html: string) => html.replace(/<[^>]*>/g, ' ')
  .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)))
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
type Row = string[]
const label = (row: Row) => row.find(cell => cell !== '') ?? ''
const values = (row: Row) => row.slice(row.findIndex(cell => cell !== '') + 1).join(' ').replace(/[$%]/g, '')
  .match(/\(\s*[\d,]+(?:\.\d+)?\s*\)|[+−-]?\d[\d,]*(?:\.\d+)?|[—–]/g)?.map(value => {
    if (/^[—–]$/.test(value)) return 0
    const number = Number(value.replace(/[,\s]/g, '').replace('−', '-').replace(/^\((.*)\)$/, '-$1'))
    return Number.isFinite(number) ? number : null
  }) ?? []
const growth = (value: number | null, previous: number | null) => value === null || previous === null || previous <= 0 ? null : (value / previous - 1) * 100

export function googlExhibitUrl(html: string, documentUrl: string): string {
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = new URL(match[1], documentUrl)
    if (url.protocol === 'https:' && !url.username && !url.password && url.hostname === 'www.sec.gov' && url.pathname.startsWith('/Archives/edgar/data/1652044/') && /(?:exhibit99[._-]?1|ex99[._-]?1|ex991).*\.html?$/i.test(url.pathname.split('/').pop() ?? '')) return url.href
  }
  throw new Error('Alphabet earnings exhibit 99.1 was not found.')
}

/** Read only the quarterly pair; never substitute year-to-date or annual columns. USD amounts are in millions in the release. */
export function parseGooglReport(html: string, sourceUrl: string, publishedAt: string): GooglReport {
  const body = text(html)
  const title = /Alphabet Announces (First|Second|Third|Fourth) Quarter(?: and Fiscal Year)? (20\d{2}) Results/i.exec(body)
  if (!title || !/in millions/i.test(body)) throw new Error('Alphabet release period or monetary units changed.')
  const quarter = ['First', 'Second', 'Third', 'Fourth'].findIndex(value => value.toLowerCase() === title[1].toLowerCase()) + 1
  const year = Number(title[2])
  const all = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(table =>
    [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => text(cell[1]))))
  const readPair = (rows: Row[] | undefined, pattern: RegExp, scale = 1e6): [number | null, number | null] => {
    if (!rows) return [null, null]
    const header = rows.find(row => /(?:Quarter|Three Months) Ended/i.test(row.join(' ')))
    const years = rows.find(row => row.filter(cell => /^20\d{2}$/.test(cell)).length >= 2)?.filter(cell => /^20\d{2}$/.test(cell)) ?? []
    if (!header || Number(years[0]) !== year - 1 || Number(years[1]) !== year) return [null, null]
    const row = rows.find(row => pattern.test(label(row).replace(/\(\d+\)/g, '').trim()))
    const numbers = row ? values(row) : []
    if (numbers.length !== years.length) return [null, null]
    return [numbers[0] == null ? null : numbers[0] * scale, numbers[1] == null ? null : numbers[1] * scale]
  }
  const supplemental = all.find(rows => rows.some(row => /^Google Search & other$/.test(label(row))))
  const income = all.find(rows => rows.some(row => /^Income before income taxes$/.test(label(row))))
  const summary = all.find(rows => rows.some(row => /^Operating income$/.test(label(row))))
  const operations = all.find(rows => rows.some(row => /^Operating income \(loss\):?$/.test(label(row))))
  const cash = all.find(rows => rows.some(row => /^Purchases of property and equipment$/.test(label(row))) && rows.some(row => /^Net income$/.test(label(row))))
  const [priorRevenue, revenue] = readPair(supplemental, /^Total revenues$/)
  const operatingIncome = readPair(income, /^Income from operations$/)[1] ?? readPair(summary, /^Operating income$/)[1]
  if (revenue === null || revenue <= 0 || operatingIncome === null) throw new Error('Alphabet quarterly revenue or operating income columns unavailable.')
  const patterns = [/^Google Search & other$/, /^YouTube ads$/, /^Google Network$/, /^Google subscriptions, platforms, and devices$/, /^Google Cloud$/, /^Other Bets$/]
  const businesses = GOOGL_BUSINESSES.map((name, index) => {
    const [yearAgoRevenue, value] = readPair(supplemental, patterns[index])
    return { name, revenue: value, yearAgoRevenue, growth: growth(value, yearAgoRevenue) }
  })
  const tac = readPair(supplemental, /^Total TAC$/)[1]
  const advertising = readPair(supplemental, /^Google advertising$/)[1]
  const operatingCashFlow = readPair(cash, /^Net cash provided by operating activities$/)[1]
  const purchases = readPair(cash, /^Purchases of property and equipment$/)[1]
  const capex = purchases === null ? null : Math.abs(purchases)
  const report: GooglReport = { period: `${year} Q${quarter}`, sourceUrl, publishedAt, revenue, revenueGrowth: growth(revenue, priorRevenue), operatingIncome,
    operatingMargin: operatingIncome / revenue * 100, dilutedEps: readPair(income, /^Diluted net income per (?:common )?share$/, 1)[1], businesses,
    servicesOperatingIncome: readPair(operations, /^Google Services$/)[1], cloudOperatingIncome: readPair(operations, /^Google Cloud$/)[1],
    otherBetsOperatingIncome: readPair(operations, /^Other Bets$/)[1], alphabetLevelIncome: readPair(operations, /^Alphabet-level activities$/)[1],
    tac, tacRate: tac === null || advertising === null || advertising <= 0 ? null : tac / advertising * 100,
    operatingCashFlow, capex, freeCashFlow: operatingCashFlow === null || capex === null ? null : operatingCashFlow - capex,
    buybacks: readPair(cash, /^Repurchases of stock$/)[1], dividends: readPair(cash, /^Dividend payments(?: on preferred and common stock)?$/)[1], warnings: [] }
  if (report.buybacks !== null) report.buybacks = Math.abs(report.buybacks)
  if (report.dividends !== null) report.dividends = Math.abs(report.dividends)
  if (businesses.some(business => business.revenue === null)) report.warnings.push(`${report.period}: revenue breakdown is incomplete.`)
  const hedges = readPair(supplemental, /^Hedging gains \(losses\)$/)[1]
  if (businesses.every(business => business.revenue !== null) && hedges !== null && Math.abs(businesses.reduce((sum, business) => sum + business.revenue!, 0) + hedges - revenue) > 1e6) throw new Error('Alphabet revenue breakdown does not reconcile.')
  if ([report.dilutedEps, report.servicesOperatingIncome, report.cloudOperatingIncome, report.otherBetsOperatingIncome, report.alphabetLevelIncome, tac, operatingCashFlow, capex, report.buybacks, report.dividends].some(value => value === null)) report.warnings.push(`${report.period}: some operating or cash-flow metrics unavailable.`)
  return report
}
