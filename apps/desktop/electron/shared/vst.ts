import type { BackgroundRequest, FundamentalsPagePayload, StocksPayload } from './contract.js'

export const VST_BLOCKS = ['market', 'financials', 'earnings', 'operations'] as const
export type VstBlock = (typeof VST_BLOCKS)[number]
export interface VstRequest extends BackgroundRequest { force?: boolean }
export interface VstMetric {
  id: string
  label: string
  value: number | null
  unit: 'USD' | '%'
  basis: 'GAAP' | 'non-GAAP' | 'reported'
  sourceUrl: string
}
export interface VstSegment { name: string; ebitda: number; yearAgo: number; growth: number | null }
export interface VstGuidance { label: string; year: string; low: number; high: number; sourceUrl: string }
export interface VstOperations {
  period: string
  periodEnd: string
  publishedAt: string
  sourceUrl: string
  revenues: Array<{ id: string; label: string; value: number }>
  totalRevenue: number
  generation: Array<{ name: string; gwh: number | null; share: number | null; revenue: null }>
  totalGenerationGwh: number
  warnings: string[]
}
export interface VstEarnings {
  period: string
  periodEnd: string
  publishedAt: string
  sourceUrl: string
  metrics: VstMetric[]
  segments: VstSegment[]
  guidance: VstGuidance[]
  hedges: Array<{ year: string; percent: number }>
  hedgeAsOf: string
  warnings: string[]
}
export interface VstPayload {
  symbol: 'VST'
  market: StocksPayload | null
  financials: FundamentalsPagePayload | null
  earnings: VstEarnings | null
  operations: VstOperations | null
  progress: Record<VstBlock, 'loaded' | 'partial' | 'stale' | 'unavailable'>
  laneFetchedAt: Record<VstBlock, number | null>
  fetchedAt: number
}
export function emptyVstPayload(): VstPayload {
  return { symbol: 'VST', market: null, financials: null, earnings: null, operations: null,
    progress: { market: 'unavailable', financials: 'unavailable', earnings: 'unavailable', operations: 'unavailable' },
    laneFetchedAt: { market: null, financials: null, earnings: null, operations: null }, fetchedAt: 0 }
}

export function vstText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&minus;/g, '-').replace(/&mdash;|&ndash;|[–—]/g, '-').replace(/\s+/g, ' ').trim()
}
export function vstDocumentUrl(path: string): string {
  const url = new URL(path.replace(/&amp;/g, '&'), 'https://investor.vistracorp.com/')
  if (url.protocol !== 'https:' || !['investor.vistracorp.com', 'www.sec.gov'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Unexpected Vistra document host.')
  }
  if (url.hostname === 'www.sec.gov' && !url.pathname.startsWith('/Archives/edgar/data/1692819/')) throw new Error('Unexpected Vistra SEC document.')
  return url.href
}
export function vstPeriod(text: string): string {
  const match = /Vistra\s+Reports\s+(First|Second|Third|Fourth)\s+Quarter\s+(?:and\s+Full[- ]Year\s+)?(20\d{2})\s+(?:and\s+Full[- ]Year\s+)?Results/i.exec(text)
  return match ? `${match[2]} Q${['first', 'second', 'third', 'fourth'].indexOf(match[1].toLowerCase()) + 1}` : ''
}
export function discoverVstDocuments(html: string): Array<{ period: string; url: string }> {
  const documents = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(match => {
    const period = vstPeriod(vstText(match[2]))
    if (!period) return []
    try { return [{ period, url: vstDocumentUrl(match[1]) }] } catch { return [] }
  })
  return [...new Map(documents.map(document => [document.url, document])).values()].sort((a, b) => b.period.localeCompare(a.period))
}

function values(cells: string[]): Array<number | null> {
  return cells.filter(cell => cell !== '$' && cell !== '').map(cell => {
    const text = cell.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
    return /^[-+]?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null
  })
}
function isoDate(text: string): string {
  const time = text ? Date.parse(`${text} UTC`) : NaN
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : ''
}

function vstTables(html: string) {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(table => ({ text: vstText(table[1]), rows:
    [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => vstText(cell[1])).filter(Boolean)) }))
}

/** Note 3 reports revenue by sales category; MD&A reports production by fuel, in GWh. */
export function parseVstOperations(html: string, url: string, periodEnd: string, publishedAt: string): VstOperations {
  const sourceUrl = vstDocumentUrl(url)
  if (!/^20\d{2}-(?:03-31|06-30|09-30)$/.test(periodEnd)) throw new Error('Vistra 10-Q period is unavailable.')
  const year = periodEnd.slice(0, 4)
  const quarter = Number(periodEnd.slice(5, 7)) / 3
  const monthDay = ['March 31', 'June 30', 'September 30'][quarter - 1]
  const tables = vstTables(html)
  const revenueTable = tables.find(table => table.text.includes(`Three Months Ended ${monthDay}, ${year}`)
    && /Wholesale generation revenue from ISO\/RTO/.test(table.text) && /Total revenues/.test(table.text))
  if (!revenueTable || !/\(in millions\)/i.test(revenueTable.text)) throw new Error('Vistra quarterly revenue table or units changed.')
  const headers = revenueTable.rows.slice(0, revenueTable.rows.findIndex(row => /^Revenue from contracts/.test(row[0] ?? ''))).flat()
  if (headers.filter(header => header === 'Consolidated').length !== 1 || headers.at(-2) !== 'Consolidated') throw new Error('Vistra consolidated revenue column changed.')
  const consolidated = (pattern: RegExp): number => {
    const row = revenueTable.rows.find(row => pattern.test(row[0] ?? ''))
    const amounts = values(row?.slice(1) ?? [])
    // Seven segments/columns include eliminations; the final column is consolidated.
    if (amounts.length !== 7) throw new Error(`Vistra revenue column layout changed (${row?.[0] ?? pattern.source}: ${amounts.length} columns).`)
    const value = row?.at(-1) === '-' ? 0 : amounts.at(-1)
    if (value === null || value === undefined) throw new Error('Vistra consolidated revenue value is unavailable.')
    return value * 1e6
  }
  const categories: Array<[string, string, RegExp]> = [
    ['retailErcot', 'Retail electricity · ERCOT', /^Retail energy charge in ERCOT$/],
    ['retailOther', 'Retail electricity · Northeast/Midwest', /^Retail energy charge in Northeast\/Midwest$/],
    ['wholesale', 'Wholesale generation · ISO/RTO', /^Wholesale generation revenue from ISO\/RTO$/],
    ['capacity', 'Capacity · ISO/RTO', /^Capacity revenue from ISO\/RTO/],
    ['contracts', 'Other wholesale contracts', /^Revenue from other wholesale contracts$/],
    ['ptc', 'Transferable production tax credits', /^Transferable PTC revenues/],
    ['realized', 'Hedging · realized', /^Hedging revenues - realized$/],
    ['unrealized', 'Hedging · unrealized', /^Hedging revenues - unrealized$/],
    ['insurance', 'Business interruption insurance', /^Business interruption insurance proceeds$/],
    ['other', 'Intangible amortization & other', /^Intangible amortization and other revenues$/],
  ]
  const revenues = categories.map(([id, label, pattern]) => ({ id, label, value: consolidated(pattern) }))
  const totalRevenue = consolidated(/^Total revenues$/)
  const sum = (rows: Array<{ value: number }>) => rows.reduce((total, row) => total + row.value, 0)
  if (Math.abs(sum(revenues.slice(0, 5)) - consolidated(/^Total revenue from contracts with customers$/)) > 2e6
    || Math.abs(sum(revenues) - totalRevenue) > 3e6) throw new Error('Vistra revenue categories do not reconcile to consolidated revenue.')

  const productionTables = tables.filter(table => /Production volumes \(GWh\)/.test(table.text))
  // Texas, East and West appear once each; never silently sum a partial fleet.
  if (productionTables.length !== 3) throw new Error('Vistra generation regions are incomplete.')
  const fuels: Array<[string, string, number]> = [
    ['Natural gas', 'Natural gas facilities', 3], ['Nuclear', 'Nuclear facilities', 2],
    ['Coal & lignite', 'Lignite and coal facilities', 2], ['Solar', 'Solar facilities', 2],
  ]
  for (const table of productionTables) {
    const start = table.rows.findIndex(row => /^Production volumes \(GWh\)/.test(row[0] ?? ''))
    const header = table.rows.slice(0, start).flat().join(' ')
    const years = table.rows.slice(0, start).flat().filter(cell => /^20\d{2}$/.test(cell))
    if (!header.includes(`Three Months Ended ${monthDay},`) || years.length !== 4
      || years.some((value, index) => value !== (index % 2 === 0 ? year : String(Number(year) - 1)))) throw new Error('Vistra generation quarterly columns changed.')
  }
  const generation = fuels.map(([name, label, regions]) => {
    const amounts = productionTables.flatMap(table => {
      const start = table.rows.findIndex(row => /^Production volumes \(GWh\)/.test(row[0] ?? ''))
      const end = table.rows.findIndex(row => /^Capacity factors/.test(row[0] ?? ''))
      const row = table.rows.slice(start + 1, end < 0 ? undefined : end).find(row => row[0] === label)
      if (!row) return []
      const numbers = values(row.slice(1))
      if (numbers.length !== 4 || numbers.some(value => value === null || value < 0)) throw new Error('Vistra production volume is unavailable.')
      return [numbers[0]!]
    })
    if (amounts.length !== regions) throw new Error(`Vistra ${name} production regions are incomplete.`)
    return { name, gwh: amounts.reduce((total, amount) => total + amount, 0), share: null as number | null, revenue: null }
  })
  const totalGenerationGwh = generation.reduce((total, row) => total + row.gwh, 0)
  for (const row of generation) row.share = totalGenerationGwh > 0 ? row.gwh / totalGenerationGwh * 100 : null
  return { period: `${year} Q${quarter}`, periodEnd, publishedAt, sourceUrl, revenues, totalRevenue,
    generation: [...generation, { name: 'Battery storage', gwh: null, share: null, revenue: null }], totalGenerationGwh, warnings: [] }
}

/** Read quarterly columns from the summary, never the YTD or reconciliation tables. */
export function parseVstEarnings(html: string, url: string, expectedPeriod?: string): VstEarnings {
  const sourceUrl = vstDocumentUrl(url)
  const text = vstText(html)
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
  const period = vstPeriod(heading ? vstText(heading) : text)
  if (!period || (expectedPeriod && period !== expectedPeriod)) throw new Error('Vistra earnings period does not match.')
  const year = period.slice(0, 4)
  const quarter = Number(period.slice(-1))
  const periodEnd = `${year}-${['03-31', '06-30', '09-30', '12-31'][quarter - 1]}`
  const publishedAt = /\/(20\d{2}-\d{2}-\d{2})-Vistra-Reports/.exec(sourceUrl)?.[1]
    ?? isoDate(/(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s+20\d{2}/i.exec(text)?.[0] ?? '')
  const tables = vstTables(html)
  const summary = tables.find(table => /Three Months Ended/i.test(table.text) && /Ongoing operations Adjusted EBITDA/i.test(table.text) && /Adjusted EBITDA by Segment/i.test(table.text))
  if (!summary || !/Millions of Dollars|\$ in millions/i.test(text)) throw new Error('Vistra quarterly summary or monetary units changed.')
  const netIncomeLabel = /^Net (?:income|loss)(?: \((?:income|loss)\))?$/i
  const summaryHeaders = summary.rows.slice(0, summary.rows.findIndex(row => netIncomeLabel.test(row[0] ?? ''))).flat().join(' ')
  if (!new RegExp(`Three Months Ended (?:March 31|June 30|September 30|December 31)`).test(summaryHeaders)
    || !new RegExp(`${year} ${Number(year) - 1}`).test(summaryHeaders)
    || !summaryHeaders.includes(['March 31', 'June 30', 'September 30', 'December 31'][quarter - 1])) throw new Error('Vistra quarterly column layout changed.')
  const summaryValue = (name: RegExp) => {
    const row = summary.rows.find(row => name.test(row[0] ?? ''))
    const amounts = row ? values(row.slice(1)) : []
    if (amounts.length < 2 || amounts[0] === null || amounts[1] === null) throw new Error('Vistra summary values are unavailable.')
    return [amounts[0] * 1e6, amounts[1] * 1e6]
  }
  const metrics: VstMetric[] = []
  const add = (id: string, label: string, value: number | null, basis: VstMetric['basis'], unit: VstMetric['unit'] = 'USD') => metrics.push({ id, label, value, basis, unit, sourceUrl })
  const [netIncome] = summaryValue(netIncomeLabel)
  const [ebitda, priorEbitda] = summaryValue(/^Ongoing operations Adjusted EBITDA$/i)
  add('netIncome', 'Quarterly net income', netIncome, 'GAAP')
  add('ebitda', 'Ongoing operations adjusted EBITDA', ebitda, 'non-GAAP')
  add('ebitdaGrowth', 'Adjusted EBITDA growth YoY', priorEbitda > 0 ? (ebitda / priorEbitda - 1) * 100 : null, 'non-GAAP', '%')
  const segments = ['Retail', 'Texas', 'East', 'West', 'Corporate and Other', 'Asset Closure'].map(name => {
    const [current, yearAgo] = summaryValue(new RegExp(`^${name}$`, 'i'))
    return { name, ebitda: current, yearAgo, growth: yearAgo > 0 ? (current / yearAgo - 1) * 100 : null }
  })
  const sum = segments.filter(segment => segment.name !== 'Asset Closure').reduce((total, segment) => total + segment.ebitda, 0)
  if (Math.abs(sum - ebitda) > 3e6) throw new Error('Vistra segment EBITDA does not reconcile to ongoing operations.')
  const guidanceTable = tables.find(table => /Guidance Ranges/i.test(table.text) && /FCFbG/i.test(table.text))
  const guidanceYear = /(20\d{2}) Guidance Ranges/i.exec(guidanceTable?.text ?? '')?.[1]
  const guidance: VstGuidance[] = (guidanceTable?.rows ?? []).flatMap(row => {
    if (!/^Ongoing Operations Adjusted (?:EBITDA|FCFbG)$/i.test(row[0] ?? '') || !guidanceYear) return []
    const range = /\$?\s*([\d,]+)\s*-\s*\$?\s*([\d,]+)/.exec(row.slice(1).join(' '))
    if (!range) return []
    const low = Number(range[1].replace(/,/g, '')) * 1e6
    const high = Number(range[2].replace(/,/g, '')) * 1e6
    return low <= high ? [{ label: row[0], year: guidanceYear, low, high, sourceUrl }] : []
  })
  // Keep hedges tied to their own dated disclosure, distinct from earnings dates.
  const hedgeText = /As of ([A-Za-z]+\.? \d{1,2}, 20\d{2}), Vistra had hedged ([\s\S]*?)(?:\.(?=\s|$)|$)/i.exec(text)
  const hedges = [...(hedgeText?.[2] ?? '').matchAll(/(?:approximately\s+)?(\d+(?:\.\d+)?)%\s+(?:of its expected generation volumes\s+)?for\s+(20\d{2})/gi)]
    .map(match => ({ year: match[2], percent: Number(match[1]) })).filter(hedge => hedge.percent <= 100)
  const warnings = []
  if (guidance.length !== 2) warnings.push('Annual EBITDA/FCFbG guidance is unavailable in this release.')
  if (!hedges.length) warnings.push('Generation hedge disclosure is unavailable in this release.')
  return { period, periodEnd, publishedAt, sourceUrl, metrics, segments, guidance, hedges, hedgeAsOf: isoDate(hedgeText?.[1] ?? ''), warnings }
}

export function vstHistory(financials: FundamentalsPagePayload | null) {
  const keys = ['revenue', 'netIncome', 'operatingCashFlow', 'freeCashFlow'] as const
  const dates = [...new Set(keys.flatMap(key => financials?.quarterly[key].map(point => point.endDate) ?? []))].sort().slice(-12)
  return { dates, series: keys.map(key => ({ key, values: dates.map(date => financials?.quarterly[key].find(point => point.endDate === date)?.value ?? null) })) }
}
export function buildVstSnapshot(payload: VstPayload): string {
  return JSON.stringify({ title: 'VST — Vistra Energy', ...payload }, null, 2)
}
