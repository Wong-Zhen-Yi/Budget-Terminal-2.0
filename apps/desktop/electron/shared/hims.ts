import type { BackgroundRequest, FundamentalsPagePayload, SecFiling, StocksPayload } from './contract.js'

export const HIMS_CIK = '1773751'
export const HIMS_BLOCKS = ['market', 'financials', 'earnings'] as const
export type HimsBlock = (typeof HIMS_BLOCKS)[number]
export interface HimsRequest extends BackgroundRequest { force?: boolean }
export const HIMS_METRICS = [
  { id: 'revenue', label: 'Revenue', unit: 'USD', pattern: /^(?:Total )?revenue$/i, scale: 1000 },
  { id: 'subscribers', label: 'Subscribers · period end', unit: 'count', pattern: /^Subscribers(?: \(end of period\))?\s*(?:\(\d+\))?$/i, scale: 1000 },
  { id: 'arpu', label: 'Monthly revenue per average subscriber', unit: 'USD/user', pattern: /^Monthly Revenue per Average Subscriber\s*(?:\(\d+\))?$/i, scale: 1 },
  { id: 'onlineArpu', label: 'Monthly online revenue per average subscriber', unit: 'USD/user', pattern: /^Monthly Online Revenue per Average Subscriber\s*(?:\(\d+\))?$/i, scale: 1 },
  { id: 'grossProfit', label: 'Gross profit', unit: 'USD', pattern: /^Gross profit$/i, scale: 1000 },
  { id: 'marketing', label: 'Marketing expense', unit: 'USD', pattern: /^Marketing$/i, scale: 1000 },
  { id: 'operatingIncome', label: 'Operating income / loss', unit: 'USD', pattern: /^(?:(?:Income|Loss|\(Loss\)|\(Income\))(?: \((?:loss|income)\)| (?:loss|income))? from operations|Operating (?:income|loss)(?: \((?:loss|income)\))?)$/i, scale: 1000 },
  { id: 'netIncome', label: 'Net income / loss', unit: 'USD', pattern: /^Net (?:\(loss\) income|income(?: \(loss\))?|loss(?: \(income\))?)$/i, scale: 1000 },
  { id: 'eps', label: 'Diluted EPS', unit: 'USD/share', pattern: /^Diluted$/i, scale: 1 },
  { id: 'ebitda', label: 'Adjusted EBITDA · non-GAAP', unit: 'USD', pattern: /^Adjusted EBITDA$/i, scale: 1000 },
  { id: 'operatingCashFlow', label: 'Operating cash flow', unit: 'USD', pattern: /^Net cash (?:\(used in\) provided by|provided by(?: \(used in\))?|used in(?: \(provided by\))?) operating activities$/i, scale: 1000 },
  { id: 'freeCashFlow', label: 'Free cash flow · non-GAAP', unit: 'USD', pattern: /^Free Cash Flow$/i, scale: 1000 },
  { id: 'usRevenue', label: 'United States', unit: 'USD', pattern: /^United States Revenue$/i, scale: 1000 },
  { id: 'internationalRevenue', label: 'Rest of the world', unit: 'USD', pattern: /^Rest of the World Revenue$/i, scale: 1000 },
  { id: 'onlineRevenue', label: 'Online', unit: 'USD', pattern: /^Online Revenue$/i, scale: 1000 },
  { id: 'wholesaleRevenue', label: 'Wholesale', unit: 'USD', pattern: /^Wholesale Revenue$/i, scale: 1000 },
] as const
export type HimsMetricId = (typeof HIMS_METRICS)[number]['id']
export interface HimsMetric { value: number | null; yearAgo: number | null }
export interface HimsGuidance {
  period: string
  revenueLow: number | null
  revenueHigh: number | null
  ebitdaLow: number | null
  ebitdaHigh: number | null
}
export interface HimsReport {
  period: string
  publishedAt: string
  sourceUrl: string
  supplementalSourceUrl?: string
  metrics: Record<HimsMetricId, HimsMetric>
  guidance: HimsGuidance[]
  warnings: string[]
}
export interface HimsEarnings { reports: HimsReport[]; warnings: string[] }
export interface HimsPayload {
  symbol: 'HIMS'
  market: StocksPayload | null
  financials: FundamentalsPagePayload | null
  earnings: HimsEarnings | null
  progress: Record<HimsBlock, 'loaded' | 'partial' | 'stale' | 'unavailable'>
  laneFetchedAt: Record<HimsBlock, number | null>
  fetchedAt: number
}
export function emptyHimsPayload(): HimsPayload {
  return { symbol: 'HIMS', market: null, financials: null, earnings: null,
    progress: { market: 'unavailable', financials: 'unavailable', earnings: 'unavailable' },
    laneFetchedAt: { market: null, financials: null, earnings: null }, fetchedAt: 0 }
}

export const himsText = (html: string): string => html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<\/?(?:p|div|br|tr|td|th|li|h[1-6])\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim()

export function himsNumber(text: string, scale = 1): number | null {
  const clean = text.replace(/[$,%\s]/g, '').replace(/[−–]/g, '-')
  if (/^[—-]$/.test(clean)) return 0 // An explicit accounting dash, never an absent cell.
  if (!/^(?:[+-]?\d+(?:\.\d+)?|\(\d+(?:\.\d+)?\))$/.test(clean)) return null
  const value = Number(clean.startsWith('(') ? `-${clean.slice(1, -1)}` : clean) * scale
  return Number.isFinite(value) ? value : null
}
export const himsGrowth = (value: number | null | undefined, before: number | null | undefined) =>
  value == null || before == null || before <= 0 ? null : (value / before - 1) * 100
export const himsMargin = (value: number | null | undefined, revenue: number | null | undefined) =>
  value == null || revenue == null || revenue <= 0 ? null : value / revenue * 100

const QUARTERS = ['first', 'second', 'third', 'fourth']
export function himsEarningsFilings(filings: readonly SecFiling[]) {
  return filings.filter(filing => filing.form === '8-K' && /\b2\.02\b/.test(filing.items))
    .sort((a, b) => b.filedDate.localeCompare(a.filedDate)).slice(0, 8)
}
export function himsExhibitUrl(html: string, documentUrl: string): string {
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = new URL(match[1], documentUrl)
    if (url.protocol === 'https:' && !url.username && !url.password && url.hostname === 'www.sec.gov' && url.pathname.startsWith(`/Archives/edgar/data/${HIMS_CIK}/`) && /(?:earnings|ex[-_]?99|exhibit[-_]?99)/i.test(url.pathname) && /\.html?$/i.test(url.pathname)) return url.href
  }
  throw new Error('HIMS earnings exhibit was not found.')
}
export function parseHimsMetrics(html: string, year: number): HimsReport['metrics'] {
  const metrics = Object.fromEntries(HIMS_METRICS.map(spec => [spec.id, { value: null, yearAgo: null }])) as HimsReport['metrics']
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => himsText(cell[1])))
    const label = (row: string[]) => row.find(cell => cell !== '') ?? ''
    const heading = rows.find(row => /Months Ended|Year Ended/i.test(row.join(' ')))
    if (!heading || !/^Three Months Ended/i.test(label(heading))) continue // Never label YTD values as quarterly.
    const years = rows.find(row => row.filter(cell => /^20\d{2}$/.test(cell)).length >= 2)?.filter(cell => /^20\d{2}$/.test(cell)).map(Number) ?? []
    if (!((years[0] === year && years[1] === year - 1) || (years[1] === year && years[0] === year - 1))) continue
    for (const spec of HIMS_METRICS) {
      if (metrics[spec.id].value !== null) continue
      const row = rows.find(row => spec.pattern.test(label(row)))
      if (!row) continue
      const rest = row.slice(row.findIndex(cell => cell !== '') + 1).join(' ').replace(/[$%]/g, '')
      const tokens = rest.match(/\(\s*[\d,]+(?:\.\d+)?\s*\)|[+−-]?\d[\d,]*(?:\.\d+)?|—|N\/?A/gi) ?? []
      if (tokens.length < 2) continue
      metrics[spec.id] = { value: himsNumber(tokens[years[0] === year ? 0 : 1]!, spec.scale), yearAgo: himsNumber(tokens[years[0] === year ? 1 : 0]!, spec.scale) }
    }
  }
  return metrics
}
export function parseHimsReport(html: string, sourceUrl: string, publishedAt: string): HimsReport {
  const text = himsText(html)
  const period = /financial results for (?:the|its) (first|second|third|fourth) quarter(?: and full year)? ended ([a-z]+) (\d{1,2}),? (20\d{2})/i.exec(text)
  const months = ['March', 'June', 'September', 'December']
  const quarter = period ? QUARTERS.indexOf(period[1].toLowerCase()) : -1
  if (!period || months[quarter].toLowerCase() !== period[2].toLowerCase() || Number(period[3]) !== [31, 30, 30, 31][quarter]) throw new Error('HIMS release does not identify a valid quarterly period.')
  const year = Number(period[4])
  const metrics = parseHimsMetrics(html, year)
  if (metrics.revenue.value === null && metrics.subscribers.value === null) throw new Error('HIMS quarterly metrics could not be read.')
  const guidance: HimsGuidance[] = []
  const outlook = text.slice(text.search(/Financial Outlook/i)).split(/Conference Call|Cautionary Note/)[0]
  for (const match of outlook.matchAll(/For the ((?:first|second|third|fourth) quarter|full year) (20\d{2}),? we expect:?([\s\S]*?)(?=For the|The guidance|$)/gi)) {
    const range = (label: string) => {
      const values = new RegExp(`${label} of \\$([\\d.]+) (million|billion) to \\$([\\d.]+) (million|billion)`, 'i').exec(match[3])
      return values ? [Number(values[1]) * (values[2].toLowerCase() === 'billion' ? 1e9 : 1e6), Number(values[3]) * (values[4].toLowerCase() === 'billion' ? 1e9 : 1e6)] : [null, null]
    }
    const [revenueLow, revenueHigh] = range('Revenue')
    const [ebitdaLow, ebitdaHigh] = range('Adjusted EBITDA')
    guidance.push({ period: `${match[2]} ${match[1].toLowerCase() === 'full year' ? 'FY' : `Q${QUARTERS.indexOf(match[1].split(' ')[0].toLowerCase()) + 1}`}`, revenueLow, revenueHigh, ebitdaLow, ebitdaHigh })
  }
  // Online ARPU was retired in 2026; geographical revenue replaced the channel breakdown.
  const required: HimsMetricId[] = ['revenue', 'subscribers', year >= 2026 ? 'arpu' : 'onlineArpu', 'grossProfit', 'marketing', 'netIncome', 'eps', 'ebitda', 'operatingCashFlow', 'freeCashFlow']
  const warnings = required.filter(id => metrics[id].value === null).map(id => `${HIMS_METRICS.find(spec => spec.id === id)!.label} unavailable for ${year} Q${quarter + 1}.`)
  return { period: `${year} Q${quarter + 1}`, publishedAt, sourceUrl, metrics, guidance, warnings }
}

/** Show one complete breakdown, never sum geographic and channel revenue together. */
export function himsRevenueMix(report: HimsReport | null | undefined) {
  if (!report) return []
  for (const ids of [['usRevenue', 'internationalRevenue'], ['onlineRevenue', 'wholesaleRevenue']] as const) {
    const values = ids.map(id => report.metrics[id].value)
    const total = report.metrics.revenue.value
    if (total === null || total <= 0 || values.some(value => value === null || value < 0) || Math.abs(values.reduce<number>((sum, value) => sum + (value ?? 0), 0) - total) > Math.max(2000, total * 0.002)) continue
    return ids.map(id => ({ label: HIMS_METRICS.find(spec => spec.id === id)!.label, value: report.metrics[id].value! }))
  }
  return []
}
