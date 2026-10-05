import type { BackgroundRequest, FundamentalsPagePayload, StocksPayload } from './contract.js'

export const AVGO_BLOCKS = ['market', 'financials', 'earnings'] as const
export type AvgoBlock = (typeof AVGO_BLOCKS)[number]
export interface AvgoRequest extends BackgroundRequest { force?: boolean }
export interface AvgoDocument { period: string; url: string }
export interface AvgoMetric {
  id: string
  label: string
  value: number | null
  text: string
  unit: 'USD' | 'USD/share' | '%' | 'text'
  basis: 'GAAP' | 'non-GAAP' | 'reported' | 'outlook'
  sourceUrl: string
}
export interface AvgoSegment { name: string; revenue: number; share: number; yearAgo: number; growth: number }
export interface AvgoEarnings {
  period: string
  periodEnd: string
  publishedAt: string
  sourceUrl: string
  metrics: AvgoMetric[]
  segments: AvgoSegment[]
  guidancePeriod: string
  guidance: AvgoMetric[]
  commentary: string[]
  warnings: string[]
}
export interface AvgoPayload {
  symbol: 'AVGO'
  market: StocksPayload | null
  financials: FundamentalsPagePayload | null
  earnings: AvgoEarnings | null
  progress: Record<AvgoBlock, 'loaded' | 'partial' | 'stale' | 'unavailable'>
  laneFetchedAt: Record<AvgoBlock, number | null>
  fetchedAt: number
}
export function emptyAvgoPayload(): AvgoPayload {
  return { symbol: 'AVGO', market: null, financials: null, earnings: null,
    progress: { market: 'unavailable', financials: 'unavailable', earnings: 'unavailable' },
    laneFetchedAt: { market: null, financials: null, earnings: null }, fetchedAt: 0 }
}

export function avgoPlain(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;|[\u201c\u201d]/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&ldquo;|&rdquo;|[\u201c\u201d]/g, '"')
    .replace(/&minus;/g, '-').replace(/&mdash;|&ndash;|[–—]/g, '-').replace(/\s+/g, ' ').trim()
}
export function avgoDocumentUrl(path: string): string {
  const url = new URL(path.replace(/&amp;/g, '&'), 'https://investors.broadcom.com')
  if (url.protocol !== 'https:' || !['investors.broadcom.com', 'www.broadcom.com', 'www.sec.gov'].includes(url.hostname)) {
    throw new Error('Unexpected Broadcom document host.')
  }
  return url.href
}
const quarters = ['first', 'second', 'third', 'fourth']
export function avgoPeriod(text: string): string {
  const match = /\b(first|second|third|fourth)[ -]quarter(?:\s+and)?(?:\s+of)?\s+(?:fiscal\s+(?:year\s+)?)?(20\d{2})\b/i.exec(text)
  return match ? `FY${match[2]} Q${quarters.indexOf(match[1].toLowerCase()) + 1}` : ''
}
export function discoverAvgoDocuments(html: string): AvgoDocument[] {
  const documents = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(match => {
    const title = avgoPlain(match[2])
    const period = avgoPeriod(title)
    if (!period || !/Broadcom.*(?:Announces|Reports).*Financial Results/i.test(title)) return []
    try { return [{ period, url: avgoDocumentUrl(match[1]) }] } catch { return [] }
  })
  return [...new Map(documents.map(document => [document.url, document])).values()].sort((a, b) => b.period.localeCompare(a.period))
}

/** Preserve cell order and select the highlights tables, never annual/YTD statement rows. */
export function parseAvgoEarnings(html: string, url: string, expectedPeriod?: string): AvgoEarnings {
  const sourceUrl = avgoDocumentUrl(url)
  const text = avgoPlain(html)
  const period = avgoPeriod(text)
  if (!period || (expectedPeriod && period !== expectedPeriod)) throw new Error('Broadcom release fiscal period does not match.')
  const year = period.slice(2, 6)
  const quarter = period.slice(-1)
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(table =>
    [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => avgoPlain(cell[1])).filter(Boolean)))
  const highlights = tables.find(rows => rows.some(row => row.includes('GAAP') && row.includes('Non-GAAP')) && rows.some(row => /^Net revenue$/i.test(row[0] ?? '')))
  if (!highlights) throw new Error('Broadcom GAAP/non-GAAP financial highlights table was not found.')
  const headers = highlights.flat().filter(cell => /^Q[1-4]\s+(?:20)?\d{2}$/i.test(cell))
  if (headers.length !== 4 || ![headers[0], headers[2]].every(header => new RegExp(`^Q${quarter}\\s+(?:${year}|${year.slice(-2)})$`, 'i').test(header))) {
    throw new Error('Broadcom GAAP/non-GAAP quarterly column layout changed.')
  }
  const scaleOf = (rows: string[][]) => {
    const scale = /Dollars in (millions|billions|thousands)/i.exec(rows.flat().join(' '))?.[1].toLowerCase()
    if (!scale) throw new Error('Broadcom table units could not be read.')
    return scale === 'millions' ? 1e6 : scale === 'billions' ? 1e9 : 1e3
  }
  const numbers = (row: string[] | undefined) => (row?.slice(1) ?? []).flatMap(cell => {
    const value = cell.replace(/[$,%\s]/g, '').replace(/^\((.*)\)$/, '-$1')
    if (/^[–—-]$/.test(cell)) return [null]
    return /^[+-]?\d[\d,]*(?:\.\d+)?$/.test(value) ? [Number(value.replace(/,/g, ''))] : []
  })
  const metrics: AvgoMetric[] = []
  const make = (id: string, label: string, value: number | null, unit: AvgoMetric['unit'], basis: AvgoMetric['basis'], display = ''): AvgoMetric =>
    ({ id, label, value, unit, basis, text: display, sourceUrl })
  const scale = scaleOf(highlights)
  for (const [id, label, pattern, unit] of [
    ['revenue', 'Revenue', /^Net revenue$/i, 'USD'], ['operatingIncome', 'Operating income', /^Operating income$/i, 'USD'],
    ['netIncome', 'Net income', /^Net income$/i, 'USD'], ['eps', 'Diluted EPS', /^Earnings per common share.*diluted$/i, 'USD/share'],
  ] as const) {
    const values = numbers(highlights.find(row => pattern.test(row[0] ?? '')))
    if (values.length && values.length !== 6) throw new Error(`Broadcom ${label} column layout changed.`)
    for (const [index, basis] of ['GAAP', 'non-GAAP'].entries()) {
      const value = values[index * 3]
      metrics.push(make(index ? `nonGaap${id[0].toUpperCase()}${id.slice(1)}` : id, label, value == null ? null : value * (unit === 'USD' ? scale : 1), unit, basis as AvgoMetric['basis']))
    }
  }
  const revenue = metrics.find(metric => metric.id === 'revenue')!.value
  if (revenue === null) throw new Error('Broadcom quarterly revenue could not be read.')
  const cashTable = tables.find(rows => rows.some(row => /^Free cash flow$/i.test(row[0] ?? '')) && rows.some(row => /^Cash flow from operations$/i.test(row[0] ?? '')))
  for (const [id, label, pattern] of [['operatingCashFlow', 'Operating cash flow', /^Cash flow from operations$/i], ['freeCashFlow', 'Free cash flow', /^Free cash flow$/i]] as const) {
    const value = numbers(cashTable?.find(row => pattern.test(row[0] ?? '')))[0]
    metrics.push(make(id, label, value == null ? null : value * scaleOf(cashTable!), 'USD', id === 'freeCashFlow' ? 'non-GAAP' : 'GAAP'))
  }
  const segmentTable = tables.find(rows => rows.some(row => /^Semiconductor solutions$/i.test(row[0] ?? '')) && rows.some(row => /^Infrastructure software$/i.test(row[0] ?? '')))
  const segments: AvgoSegment[] = []
  if (segmentTable) for (const name of ['Semiconductor solutions', 'Infrastructure software']) {
    const values = numbers(segmentTable.find(row => row[0] === name))
    if (values.length !== 5 || values.some(value => value === null)) throw new Error('Broadcom segment column layout changed.')
    const [current, share, prior, , growth] = values as number[]
    segments.push({ name, revenue: current * scaleOf(segmentTable), share, yearAgo: prior * scaleOf(segmentTable), growth })
  }
  if (segments.length && Math.abs(segments.reduce((sum, segment) => sum + segment.revenue, 0) - revenue) > scale) throw new Error('Broadcom segment revenues do not reconcile to quarterly revenue.')

  // Only management paragraphs before the highlights contain current AI results and outlook.
  const highlightsStart = text.search(/(?:First|Second|Third|Fourth) Quarter Fiscal Year 20\d{2} Financial Highlights/i)
  const intro = highlightsStart >= 0 ? text.slice(0, highlightsStart) : ''
  const commentary = [...intro.matchAll(/"([^"]+)"/g)].map(match => match[1])
    .filter(paragraph => /custom AI accelerators|AI networking/i.test(paragraph))
  const ai = new RegExp(`Q${quarter} (?:semiconductor revenue from AI|AI (?:semiconductor )?revenue)([^\"]{0,250})`, 'i').exec(intro)?.[1] ?? ''
  const aiAmount = /\$([\d.]+)\s+(billion|million)/i.exec(ai)
  metrics.push(make('aiRevenue', 'AI semiconductor revenue', aiAmount ? Number(aiAmount[1]) * (aiAmount[2].toLowerCase() === 'billion' ? 1e9 : 1e6) : null, 'USD', 'reported', /\b(over|approximately|about)\s*\$/i.exec(ai)?.[1] ?? ''))
  const aiGrowth = /(?:grew|grow|increasing|increased|growth (?:accelerated )?to)\s+(?:over\s+)?([\d.]+)\s*(?:%|percent)\s*year[ -]over[ -]year/i.exec(ai)
  const aiQoq = /([\d.]+)\s*(?:%|percent)\s*quarter[ -]over[ -]quarter/i.exec(ai)
  metrics.push(make('aiYoy', 'AI revenue YoY', aiGrowth ? Number(aiGrowth[1]) : null, '%', 'reported'))
  metrics.push(make('aiQoq', 'AI revenue QoQ', aiQoq ? Number(aiQoq[1]) : null, '%', 'reported'))
  const dividend = /(?:quarterly (?:common stock |cash )?dividend (?:of|to)|approved a quarterly cash dividend of)\s*\$([\d.]+)\s+per share/i.exec(text)
  metrics.push(make('dividend', 'Quarterly dividend', dividend ? Number(dividend[1]) : null, 'USD/share', 'reported'))
  const fcf = metrics.find(metric => metric.id === 'freeCashFlow')!.value
  metrics.push(make('fcfMargin', 'Free cash flow / revenue', fcf === null || revenue === 0 ? null : fcf / revenue * 100, '%', 'non-GAAP', 'Calculated from reported quarterly values'))

  const nextQuarter = Number(quarter) % 4 + 1
  const nextYear = Number(year) + (quarter === '4' ? 1 : 0)
  const guidancePeriod = `FY${nextYear} Q${nextQuarter}`
  const outlookStart = text.search(new RegExp(`${quarters[nextQuarter - 1]} Quarter Fiscal Year ${nextYear} Business Outlook`, 'i'))
  const outlook = outlookStart < 0 ? '' : text.slice(outlookStart).split(/Quarterly Dividends|Financial Results Conference Call/i)[0]
  const guidance: AvgoMetric[] = []
  const revenueGuide = /revenue guidance of (approximately )?\$([\d.]+)\s+(billion|million)/i.exec(outlook)
  guidance.push(make('revenueGuidance', 'Revenue', revenueGuide ? Number(revenueGuide[2]) * (revenueGuide[3].toLowerCase() === 'billion' ? 1e9 : 1e6) : null, 'USD', 'outlook', revenueGuide?.[1]?.trim() ?? ''))
  for (const [id, label, pattern] of [
    ['operatingMarginGuidance', 'Non-GAAP operating income / revenue', /non-GAAP operating income guidance of (approximately )?([\d.]+)\s*(?:percent|%) of projected revenue/i],
    ['ebitdaMarginGuidance', 'Adjusted EBITDA / revenue', /Adjusted EBITDA guidance of (approximately )?([\d.]+)\s*(?:percent|%) of projected revenue/i],
  ] as const) {
    const match = pattern.exec(outlook)
    if (match) guidance.push(make(id, label, Number(match[2]), '%', 'outlook', match[1]?.trim() ?? ''))
  }
  const aiOutlook = new RegExp(`(?:In Q${nextQuarter}|in Q${nextQuarter}|Q${nextQuarter} we expect)([\\s\\S]{0,250}?)(?=\"|said|$)`, 'i').exec(intro)?.[0] ?? ''
  const aiGuide = /(?:AI semiconductor revenue|semiconductor revenue from AI)[\s\S]{0,100}?\$([\d.]+)\s+(billion|million)/i.exec(aiOutlook)
  guidance.push(make('aiRevenueGuidance', 'AI semiconductor revenue', aiGuide ? Number(aiGuide[1]) * (aiGuide[2].toLowerCase() === 'billion' ? 1e9 : 1e6) : null, 'USD', 'outlook'))
  const aiGuideGrowth = /(?:up|grow)\s+(over\s+)?([\d.]+)\s*(?:%|percent)\s*year[ -]over[ -]year/i.exec(aiOutlook)
  guidance.push(make('aiGrowthGuidance', 'AI revenue YoY', aiGuideGrowth ? Number(aiGuideGrowth[2]) : null, '%', 'outlook', aiGuideGrowth?.[1]?.trim() ?? ''))
  const publishedMatch = /"datePublished"\s*:\s*"([^\"]+)"/.exec(html)?.[1] ?? /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s+20\d{2}/i.exec(text)?.[0]
  const publishedDate = publishedMatch ? /^\d{4}-\d{2}-\d{2}T/.test(publishedMatch) ? publishedMatch : `${publishedMatch} UTC` : ''
  const publishedAt = publishedDate && Number.isFinite(Date.parse(publishedDate)) ? new Date(publishedDate).toISOString().slice(0, 10) : ''
  const end = /\bended\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})/i.exec(intro)?.[1]
  const periodEnd = end && Number.isFinite(Date.parse(`${end} UTC`)) ? new Date(`${end} UTC`).toISOString().slice(0, 10) : ''
  const warnings = metrics.filter(metric => metric.value === null && !['aiQoq'].includes(metric.id)).map(metric => `Unavailable: ${metric.basis} ${metric.label}`)
  if (!segments.length) warnings.push('Segment results unavailable.')
  if (!publishedAt || !periodEnd) warnings.push('Release publication date or fiscal end date unavailable.')
  if (guidance[0].value === null) warnings.push('Next-quarter revenue guidance unavailable.')
  if (guidance.find(metric => metric.id === 'aiRevenueGuidance')?.value === null) warnings.push('AI revenue guidance not disclosed.')
  return { period, periodEnd, publishedAt, sourceUrl, metrics, segments, guidancePeriod, guidance, commentary, warnings }
}

export function avgoHistory(financials: FundamentalsPagePayload | null) {
  const keys = ['revenue', 'netIncome', 'operatingCashFlow', 'freeCashFlow'] as const
  const dates = [...new Set(keys.flatMap(key => financials?.quarterly[key].map(point => point.endDate) ?? []))].sort().slice(-12)
  return { dates, series: keys.map(key => ({ key, values: dates.map(date => financials?.quarterly[key].find(point => point.endDate === date)?.value ?? null) })) }
}
export function buildAvgoSnapshot(payload: AvgoPayload): string {
  return JSON.stringify({ title: 'AVGO — Broadcom', ...payload }, null, 2)
}
