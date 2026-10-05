import type { BackgroundRequest, SecFiling, StocksPayload } from './contract.js'

export const SOFI_CIK = '0001818874'
export const SOFI_BLOCKS = ['market', 'reports'] as const
export type SofiBlock = (typeof SOFI_BLOCKS)[number]
export interface SofiRequest extends BackgroundRequest { force?: boolean }

export const SOFI_METRICS = [
  ['members', 'Members', 'count'],
  ['products', 'Products', 'count'],
  ['productsPerMember', 'Products / member', 'ratio'],
  ['deposits', 'Deposits', 'USD'],
  ['personalOriginations', 'Personal loan originations', 'USD'],
  ['studentOriginations', 'Student loan originations', 'USD'],
  ['homeOriginations', 'Home loan originations', 'USD'],
  ['totalOriginations', 'Total loan originations', 'USD'],
  ['revenue', 'Net revenue · GAAP', 'USD'],
  ['netIncome', 'Net income · GAAP', 'USD'],
  ['eps', 'Diluted EPS · GAAP', 'USD/share'],
  ['adjustedEbitda', 'Adjusted EBITDA · non-GAAP', 'USD'],
  ['lendingRevenue', 'Lending revenue', 'USD'],
  ['lendingProfit', 'Lending contribution profit', 'USD'],
  ['financialServicesRevenue', 'Financial Services revenue', 'USD'],
  ['financialServicesProfit', 'Financial Services contribution profit', 'USD'],
  ['technologyRevenue', 'Technology Platform revenue', 'USD'],
  ['technologyProfit', 'Technology Platform contribution profit', 'USD'],
  ['technologyAccounts', 'Technology Platform accounts', 'count'],
  ['bookValuePerShare', 'Book value / share · GAAP', 'USD/share'],
  ['tangibleBookValuePerShare', 'Tangible book / share · non-GAAP', 'USD/share'],
  ['equity', 'Equity · GAAP', 'USD'],
  ['goodwill', 'Goodwill adjustment', 'USD'],
  ['intangibles', 'Intangible assets adjustment', 'USD'],
  ['deferredTaxes', 'Related deferred tax liabilities', 'USD'],
  ['tangibleEquity', 'Tangible book value · non-GAAP', 'USD'],
  ['commonShares', 'Common shares at period end', 'count'],
] as const
export type SofiMetric = (typeof SOFI_METRICS)[number][0]
export type SofiUnit = (typeof SOFI_METRICS)[number][2]
export interface SofiSource { url: string; publishedAt: string; note?: string }
export interface SofiQuarter {
  endDate: string
  values: Record<SofiMetric, number | null>
  sources: Partial<Record<SofiMetric, SofiSource>>
}
export interface SofiReport {
  url: string
  publishedAt: string
  quarters: SofiQuarter[]
  notes: string[]
}
export interface SofiReports {
  quarters: SofiQuarter[]
  releases: Array<{ url: string; publishedAt: string; endDate: string }>
  filings: SecFiling[]
  notes: string[]
  warnings: string[]
}
export interface SofiPayload {
  symbol: 'SOFI'
  market: StocksPayload | null
  price: number | null
  changePct: number | null
  priceAsOf: number | null
  reports: SofiReports | null
  valuation: { priceToBook: number | null; priceToTangibleBook: number | null; bookAsOf: string | null }
  progress: Record<SofiBlock, 'loaded' | 'partial' | 'stale' | 'unavailable'>
  fetchedAt: number
}

export function emptySofiQuarter(endDate: string): SofiQuarter {
  return { endDate, values: Object.fromEntries(SOFI_METRICS.map(([key]) => [key, null])) as SofiQuarter['values'], sources: {} }
}

export function emptySofiPayload(): SofiPayload {
  return { symbol: 'SOFI', market: null, price: null, changePct: null, priceAsOf: null, reports: null,
    valuation: { priceToBook: null, priceToTangibleBook: null, bookAsOf: null },
    progress: { market: 'unavailable', reports: 'unavailable' }, fetchedAt: 0 }
}

export function sofiBookRatios(price: number | null, quarter: SofiQuarter | undefined): SofiPayload['valuation'] {
  const ratio = (book: number | null | undefined) => typeof price === 'number' && Number.isFinite(price) && price > 0 &&
    typeof book === 'number' && Number.isFinite(book) && book > 0 ? price / book : null
  return { priceToBook: ratio(quarter?.values.bookValuePerShare),
    priceToTangibleBook: ratio(quarter?.values.tangibleBookValuePerShare), bookAsOf: quarter?.endDate ?? null }
}

export function sofiNumber(text: string, scale = 1): number | null {
  const value = text.replace(/[$,\s]/g, '').replace(/[−–]/g, '-')
  if (!/^(?:[+-]?\d+(?:\.\d+)?|\(\d+(?:\.\d+)?\))$/.test(value)) return null
  const parsed = Number(value.startsWith('(') ? `-${value.slice(1, -1)}` : value) * scale
  return Number.isFinite(parsed) ? parsed : null
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export function sofiPlain(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) =>
    String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)))
    .replace(/&nbsp;|&thinsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—')
    .replace(/\s+/g, ' ').trim()
}

function dates(text: string): string[] {
  return [...text.matchAll(new RegExp(`(${MONTHS.join('|')})\\s*(\\d{1,2}),?\\s*(20\\d{2})`, 'gi'))].map(match =>
    `${match[3]}-${String(MONTHS.findIndex(month => month.toLowerCase() === match[1].toLowerCase()) + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`)
}

export function sofiPublishedAt(html: string): string {
  const lead = /SAN FRANCISCO[\s\S]{0,180}/i.exec(sofiPlain(html))?.[0] ?? ''
  return dates(lead)[0] ?? ''
}

function tablePeriods(rows: string[][]): string[] {
  const header = rows.slice(0, 5)
  for (const row of header) {
    const full = dates(row.join(' '))
    if (full.length) return /three months/i.test(header.flat().join(' ')) && /six months|nine months|year ended/i.test(header.flat().join(' ')) ? full.slice(0, 2) : full
  }
  const day = new RegExp(`(${MONTHS.join('|')})\\s*(\\d{1,2}),?`, 'i').exec(header.flat().join(' '))
  const years = header.find(row => row.filter(cell => /^20\d{2}$/.test(cell)).length >= 1)
  if (!day || !years) return []
  // The first pair are quarterly columns; later columns can be year-to-date or changes.
  return years.filter(cell => /^20\d{2}$/.test(cell)).slice(0, 2).map(year =>
    `${year}-${String(MONTHS.findIndex(month => month.toLowerCase() === day[1].toLowerCase()) + 1).padStart(2, '0')}-${day[2].padStart(2, '0')}`)
}

function segmentOf(text: string): string {
  if (/financial services/i.test(text)) return 'financialServices'
  if (/technology platform/i.test(text)) return 'technology'
  if (/lending/i.test(text)) return 'lending'
  if (/corporate/i.test(text)) return 'corporate'
  if (/consolidated/i.test(text)) return ''
  return ''
}

/** Read table cells without flattening numeric columns or swallowing missing-value dashes. */
export function parseSofiReport(html: string, url: string, publishedAt: string): SofiReport {
  const quarters = new Map<string, SofiQuarter>()
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => sofiPlain(cell[1])).filter(Boolean)).filter(row => row.length)
    const periods = tablePeriods(rows)
    if (!periods.length) continue
    const header = rows.slice(0, 4).flat().join(' ')
    const flow = /three months|quarter ended/i.test(header)
    const isBook = /book value per|tangible book value/i.test(sofiPlain(table[1]))
    const dollarScale = /in billions/i.test(header) ? 1e9 : /in millions/i.test(header) ? 1e6 : 1e3
    let segment = /segment results/i.test(header) ? segmentOf(header) : ''
    let origination = false
    for (const row of rows) {
      const label = row[0].replace(/\(\d+(?:,\d+)*\)/g, '').replace(/\.{2,}/g, '').replace(/\s*\$$/, '').trim()
      if (/^(Lending|Financial Services|Technology Platform|Corporate\/Other|Consolidated)$/.test(label)) segment = segmentOf(label)
      if (/origination volume/i.test(label)) origination = true
      if (/average loan balance/i.test(label)) origination = false
      let metric: SofiMetric | undefined
      if (/^Members$/i.test(label)) metric = 'members'
      else if (/^Total Products$/i.test(label)) metric = 'products'
      else if (/^Total Accounts.*Technology Platform|^Technology Platform.*Accounts/i.test(label)) metric = 'technologyAccounts'
      else if (/^Total deposits$/i.test(label)) metric = 'deposits'
      else if (/^Tangible book value per (?:common )?share/i.test(label)) metric = 'tangibleBookValuePerShare'
      else if (/^Book value per (?:common )?share|^Permanent equity per common share/i.test(label)) metric = 'bookValuePerShare'
      else if (isBook && /^Equity|^Permanent equity/i.test(label)) metric = 'equity'
      else if (isBook && /^Goodwill$/i.test(label)) metric = 'goodwill'
      else if (isBook && /^Intangible assets$/i.test(label)) metric = 'intangibles'
      else if (isBook && /^Related deferred tax liabilities/i.test(label)) metric = 'deferredTaxes'
      else if (isBook && /^Tangible book value\b/i.test(label)) metric = 'tangibleEquity'
      else if (isBook && /^Common stock outstanding/i.test(label)) metric = 'commonShares'
      else if (flow && origination && /^Personal loans$/i.test(label)) metric = 'personalOriginations'
      else if (flow && origination && /^Student loans$/i.test(label)) metric = 'studentOriginations'
      else if (flow && origination && /^Home loans$/i.test(label)) metric = 'homeOriginations'
      else if (flow && origination && /^Total$/i.test(label)) metric = 'totalOriginations'
      else if (flow && /^Total net revenue(?:s)?(?:\s|$)/i.test(label)) {
        const name = segmentOf(label) || segment
        metric = name === 'corporate' ? undefined : name ? `${name}Revenue` as SofiMetric : 'revenue'
      } else if (flow && /^Contribution profit(?:\s|$)/i.test(label) && !/non-GAAP/i.test(label)) {
        const name = segmentOf(label) || segment
        if (name && name !== 'corporate') metric = `${name}Profit` as SofiMetric
      } else if (flow && /^Net income(?: \(loss\))?(?: \(GAAP\))?$/i.test(label)) metric = 'netIncome'
      else if (flow && /^(?:Adjusted EBITDA)(?:\s|$)/i.test(label) && !/margin/i.test(label)) metric = 'adjustedEbitda'
      else if (flow && /^(?:Earnings per share attributable to common stockholders.*diluted|Diluted earnings per share|Diluted EPS)(?:\s|$)/i.test(label)) metric = 'eps'
      if (!metric) continue
      const unit = SOFI_METRICS.find(([key]) => key === metric)![2]
      const scale = unit === 'USD/share' ? 1 : unit === 'count' ? (metric === 'commonShares' ? dollarScale : /in millions/i.test(header) ? 1e6 : /in thousands/i.test(header) ? 1e3 : 1) : dollarScale
      const values = row.slice(1).filter(cell => /^\(?\s*\$?\s*[+−–-]?\d[\d,]*(?:\.\d+)?\s*\)?$/.test(cell) || /^[—–-]$|^N\/A$|^NM$/i.test(cell))
      // Do not guess column positions if the table contains an unsupported layout.
      if (values.length < periods.length) continue
      for (let index = 0; index < periods.length; index += 1) {
        const endDate = periods[index]
        if (!/-(03-31|06-30|09-30|12-31)$/.test(endDate)) continue
        const quarter = quarters.get(endDate) ?? emptySofiQuarter(endDate)
        const value = sofiNumber(values[index], scale)
        if (value !== null) {
          quarter.values[metric] = value
          quarter.sources[metric] = { url, publishedAt }
        }
        quarters.set(endDate, quarter)
      }
    }
  }
  const parsed = [...quarters.values()].sort((a, b) => a.endDate.localeCompare(b.endDate))
  if (!parsed.some(quarter => quarter.values.members !== null && quarter.values.revenue !== null)) {
    throw new Error('SoFi earnings tables could not be read: members and quarterly revenue are required.')
  }
  const notes = html.split(/<\/?(?:p|div)\b[^>]*>/gi).map(sofiPlain)
    .filter(text => text.length < 1400 && /prior periods were revised|modified the presentation|updated our.*metric|total number of members and products|includes SoFi accounts/i.test(text))
  return { url, publishedAt, quarters: parsed, notes: [...new Set(notes)] }
}

/** A newer release may restate earlier quarters; merge at metric grain, keeping provenance. */
export function combineSofiReports(reports: SofiReport[]): SofiQuarter[] {
  const quarters = new Map<string, SofiQuarter>()
  for (const report of [...reports].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) {
    for (const incoming of report.quarters) {
      const quarter = quarters.get(incoming.endDate) ?? emptySofiQuarter(incoming.endDate)
      for (const [metric] of SOFI_METRICS) {
        const value = incoming.values[metric]
        if (value !== null) { quarter.values[metric] = value; quarter.sources[metric] = incoming.sources[metric] }
      }
      quarters.set(quarter.endDate, quarter)
    }
  }
  return [...quarters.values()].sort((a, b) => a.endDate.localeCompare(b.endDate)).slice(-8).map(quarter => {
    const { members, products } = quarter.values
    quarter.values.productsPerMember = members !== null && members > 0 && products !== null ? products / members : null
    quarter.sources.productsPerMember = quarter.sources.products
    return quarter
  })
}

export function sofiReportWarnings(reports: SofiReports): string[] {
  const warnings = [...reports.warnings]
  if (reports.quarters.length < 8) warnings.push(`Only ${reports.quarters.length} of eight quarters are available.`)
  const required = SOFI_METRICS.filter(([key]) => !['equity', 'goodwill', 'intangibles', 'deferredTaxes', 'tangibleEquity', 'commonShares'].includes(key))
  for (const quarter of reports.quarters) {
    const missing = required.filter(([key]) => quarter.values[key] === null).map(([, label]) => label)
    if (missing.length) warnings.push(`${quarter.endDate}: unavailable ${missing.join(', ')}.`)
  }
  return warnings
}
