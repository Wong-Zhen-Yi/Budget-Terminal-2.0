import type { BackgroundRequest, FundamentalsPagePayload, StocksPayload } from './contract.js'

export const MU_BLOCKS = ['market', 'financials', 'earnings', 'memory'] as const
export type MuBlock = (typeof MU_BLOCKS)[number]
export interface MuRequest extends BackgroundRequest { force?: boolean }
export interface MuDocument { period: string; url: string; kind: 'release' | 'remarks' | 'presentation' }
export interface MuDocuments { period: string; release: MuDocument | null; remarks: MuDocument | null; presentation: MuDocument | null }
export interface MuMetric {
  id: string
  label: string
  value: number | null
  text: string
  unit: 'USD' | '%' | 'USD/share' | 'days' | 'text'
  basis: 'GAAP' | 'non-GAAP' | 'reported' | 'outlook'
  sourceUrl: string
  page: number | null
}
export interface MuBusinessUnit { name: string; revenue: number | null; grossMargin: number | null; operatingMargin: number | null }
export interface MuEarnings {
  period: string
  publishedAt: string
  sourceUrl: string
  metrics: MuMetric[]
  units: MuBusinessUnit[]
  guidancePeriod: string
  guidance: Array<{ label: string; gaap: string; nonGaap: string }>
}
export interface MuMemory { period: string; metrics: MuMetric[]; sources: MuDocument[]; warnings: string[] }
export interface MuPayload {
  symbol: 'MU'
  market: StocksPayload | null
  financials: FundamentalsPagePayload | null
  earnings: MuEarnings | null
  memory: MuMemory | null
  progress: Record<MuBlock, 'loaded' | 'partial' | 'stale' | 'unavailable'>
  laneFetchedAt: Record<MuBlock, number | null>
  fetchedAt: number
}

export function emptyMuPayload(): MuPayload {
  return { symbol: 'MU', market: null, financials: null, earnings: null, memory: null,
    progress: { market: 'unavailable', financials: 'unavailable', earnings: 'unavailable', memory: 'unavailable' },
    laneFetchedAt: { market: null, financials: null, earnings: null, memory: null }, fetchedAt: 0 }
}

export function muPlain(text: string): string {
  return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&minus;/g, '-').replace(/&mdash;|&ndash;/g, '—').replace(/\s+/g, ' ').trim()
}

/** Keep table rows and cells distinct; concatenating HTML loses GAAP column membership. */
export function muHtmlText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row: string) => '\n' + [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => muPlain(cell[1])).join('\t') + '\n')
    .replace(/<\/(?:p|li|h[1-6]|div)>/gi, '\n')
    .split('\n').map(line => line.split('\t').map(muPlain).join('\t').trim()).filter(Boolean).join('\n')
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export function muDocumentUrl(path: string): string {
  const url = new URL(path.replace(/&amp;/g, '&'), 'https://investors.micron.com')
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:' || !['investors.micron.com', 's25.q4cdn.com', 'www.sec.gov'].includes(url.hostname)) {
    throw new Error('Unexpected Micron document host.')
  }
  return url.href
}

/** Q4's public financial-report feed supplies the same documents as the IR overview. */
export function discoverMuDocuments(body: unknown): MuDocuments {
  const rows = record(body).GetFinancialReportListResult
  if (!Array.isArray(rows)) throw new Error('Micron financial-report feed schema changed.')
  const quarters = ['First Quarter', 'Second Quarter', 'Third Quarter', 'Fourth Quarter']
  const candidates = rows.flatMap(raw => {
    const row = record(raw)
    const quarter = quarters.indexOf(String(row.ReportSubType)) + 1
    const year = Number(row.ReportYear)
    if (!quarter || !Number.isInteger(year) || year < 2000 || !Array.isArray(row.Documents)) return []
    const period = `FY${year} Q${quarter}`
    const result: MuDocuments = { period, release: null, remarks: null, presentation: null }
    for (const rawDocument of row.Documents) {
      const doc = record(rawDocument)
      const label = `${doc.DocumentCategory} ${doc.DocumentTitle}`
      const kind = /remarks/i.test(label) ? 'remarks' : /presentation/i.test(label) ? 'presentation' : /press release|^news\b/i.test(label) ? 'release' : null
      if (kind && typeof doc.DocumentPath === 'string' && doc.DocumentPath) {
        try { result[kind] = { period, kind, url: muDocumentUrl(doc.DocumentPath) } }
        catch { /* Historical reports may link retired third-party hosts. */ }
      }
    }
    return result.release || result.remarks || result.presentation ? [result] : []
  }).sort((a, b) => b.period.localeCompare(a.period))
  if (!candidates.length) throw new Error('No published Micron quarterly documents were found.')
  return candidates[0]
}

export function validateMuPeriod(text: string, period: string): void {
  const [, year, quarter] = /^FY(\d{4}) Q([1-4])$/.exec(period) ?? []
  const compact = muPlain(text).replace(/[‐‑–—]/g, '-')
  const shortYear = year?.slice(-2)
  const named = ['first', 'second', 'third', 'fourth'][Number(quarter) - 1]
  if (!year || !new RegExp(`(?:fiscal\\s+Q${quarter}\\s+${year}|FQ${quarter}[- ]${shortYear}|${named}[- ]quarter[\\s\\S]{0,40}${year}|Q${quarter}\\s+(?:FY)?${year})`, 'i').test(compact)) {
    throw new Error(`Micron document does not identify ${period}.`)
  }
}

function numericCells(line: string): Array<number | null> {
  const cells = line.slice(line.indexOf('\t') + 1).split('\t').map(cell => cell.trim()).filter(cell => cell && cell !== '$' && cell !== '%')
  return cells.flatMap(cell => {
    if (/^[—–-]$/.test(cell)) return [null]
    const clean = cell.replace(/[$,%\s]/g, '')
    if (!/^\(?-?\d[\d,]*(?:\.\d+)?\)?$/.test(clean)) return []
    return [Number(clean.replace(/,/g, '').replace(/^\((.*)\)$/, '-$1'))]
  })
}

export function parseMuEarnings(text: string, doc: MuDocument): MuEarnings {
  validateMuPeriod(text, doc.period)
  const source = (id: string, label: string, value: number | null, unit: MuMetric['unit'], basis: MuMetric['basis']): MuMetric =>
    ({ id, label, value, unit, basis, text: '', sourceUrl: doc.url, page: null })
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const quarterlyStart = lines.findIndex(line => /Quarterly Financial Results/i.test(line))
  const annualStart = lines.findIndex((line, i) => i > quarterlyStart && /Annual Financial Results|Investments in capital/i.test(line))
  const quarterly = lines.slice(quarterlyStart + 1, annualStart < 0 ? undefined : annualStart)
  if (quarterlyStart < 0) throw new Error('Micron quarterly financial table was not found.')
  const quarterHeader = quarterly.flatMap(line => line.match(/FQ[1-4][- ]\d{2}/gi) ?? [])
  const currentHeader = `FQ${doc.period.slice(-1)}-${doc.period.slice(4, 6)}`
  if (quarterHeader.length !== 6 || quarterHeader[0].replace(' ', '-') !== currentHeader || quarterHeader[3].replace(' ', '-') !== currentHeader) {
    throw new Error('Micron GAAP/non-GAAP quarterly column layout changed.')
  }
  const scaleLabel = /(?:in|amounts in)\s+(millions|billions|thousands)/i.exec(quarterly.join(' '))?.[1].toLowerCase()
  const scale = scaleLabel === 'millions' ? 1e6 : scaleLabel === 'billions' ? 1e9 : scaleLabel === 'thousands' ? 1e3 : null
  if (scale === null) throw new Error('Micron financial-table units could not be read.')
  const row = (pattern: RegExp) => numericCells(quarterly.find(line => pattern.test(line)) ?? '\t')
  const revenue = row(/^Revenue\b/i)
  const eps = row(/^Diluted earnings per share\b/i)
  const grossIndex = quarterly.findIndex(line => /^Gross margin\b/i.test(line))
  const margin = numericCells(quarterly.slice(grossIndex + 1).find(line => /^Percent of revenue\b/i.test(line)) ?? '\t')
  const metrics = [
    source('revenue', 'Quarterly revenue', revenue[0] == null ? null : revenue[0] * scale, 'USD', 'GAAP'),
    source('grossMargin', 'Gross margin', margin[0] ?? null, '%', 'GAAP'),
    source('eps', 'Diluted EPS', eps[0] ?? null, 'USD/share', 'GAAP'),
    source('nonGaapGrossMargin', 'Gross margin', margin[3] ?? null, '%', 'non-GAAP'),
    source('nonGaapEps', 'Diluted EPS', eps[3] ?? null, 'USD/share', 'non-GAAP'),
  ]
  if (metrics[0].value === null) throw new Error('Micron current-quarter revenue column could not be read.')
  const unitStart = lines.findIndex(line => /Quarterly Business Unit Financial Results/i.test(line))
  const outlookStart = lines.findIndex((line, i) => i > unitStart && /^Business Outlook/i.test(line))
  const unitLines = unitStart < 0 ? [] : lines.slice(unitStart + 1, outlookStart < 0 ? undefined : outlookStart)
  const units: MuBusinessUnit[] = []
  for (let i = 0; i < unitLines.length; i++) {
    if (!/Business Unit/i.test(unitLines[i])) continue
    const next = unitLines.slice(i + 1, i + 7)
    const first = (pattern: RegExp) => numericCells(next.find(line => pattern.test(line)) ?? '\t')[0] ?? null
    const value = first(/^Revenue\b/i)
    units.push({ name: unitLines[i].split('\t')[0], revenue: value === null ? null : value * scale,
      grossMargin: first(/^Gross margin\b/i), operatingMargin: first(/^Operating margin\b/i) })
  }
  const guidanceEnd = lines.findIndex((line, i) => i > outlookStart && /Further information|Product Highlights|Investor Webcast/i.test(line))
  const outlook = outlookStart < 0 ? [] : lines.slice(outlookStart + 1, guidanceEnd < 0 ? undefined : guidanceEnd)
  const guidance = outlook.filter(line => /^(Revenue|Gross margin|Operating expenses|Diluted earnings per share)\b/i.test(line)).map(line => {
    const cells = line.split('\t').map(muPlain).filter(Boolean)
    return { label: cells[0], gaap: cells[1] ?? '', nonGaap: cells[2] ?? '' }
  })
  const guidanceMatch = /FQ([1-4])[- ](\d{2})/i.exec(outlook.join(' '))
  const published = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}/.exec(muPlain(text))?.[0] ?? ''
  return { period: doc.period, publishedAt: published, sourceUrl: doc.url, metrics, units, guidance,
    guidancePeriod: guidanceMatch ? `FY20${guidanceMatch[2]} Q${guidanceMatch[1]}` : '' }
}

export interface MuTextDocument { document: MuDocument; pages: string[] }

/** Prose extraction is scoped to product paragraphs, keeping approximations as reported. */
export function parseMuMemory(documents: MuTextDocument[]): MuMemory {
  if (!documents.length) throw new Error('Micron memory disclosures are unavailable.')
  const period = documents[0].document.period
  const metrics: MuMetric[] = []
  const add = (id: string, label: string, value: number | null, text: string, unit: MuMetric['unit'], sourceUrl: string, page: number, basis: MuMetric['basis'] = 'reported') => {
    if (!metrics.some(metric => metric.id === id)) metrics.push({ id, label, value, text, unit, sourceUrl, page, basis })
  }
  for (const { document: doc, pages } of documents) {
    if (doc.period !== period) throw new Error('Micron memory documents have different fiscal periods.')
    validateMuPeriod(pages.join(' '), period)
    for (const [index, pageText] of pages.entries()) {
      const text = muPlain(pageText).replace(/[‐‑]/g, '-')
      const quarter = period.slice(-1)
      // Presentation columns interleave at equal y coordinates. Read each bullet's
      // left/right membership and stop before the annual technology breakdown.
      const rows = pageText.split('\n')
      const shortYear = period.slice(4, 6)
      const headerIndex = rows.findIndex(row => new RegExp(`DRAM\\s+FQ${quarter}-${shortYear}\\s+NAND\\s+FQ${quarter}-${shortYear}`, 'i').test(muPlain(row)))
      if (headerIndex >= 0) {
        for (const row of rows.slice(headerIndex + 1)) {
          if (/\b(?:DRAM|NAND)\s+FY/i.test(muPlain(row))) break
          const columns = row.split('•').slice(1).map(muPlain)
          if (columns.length !== 2) continue
          for (const [column, product] of ['DRAM', 'NAND'].entries()) {
            const content = columns[column]
            const base = product.toLowerCase()
            const amount = /\$([\d.]+)\s+(billion|million),?\s+representing\s+([\d.]+)%/i.exec(content)
            if (amount) {
              add(`${base}Revenue`, `${product} revenue`, Number(amount[1]) * (amount[2].toLowerCase() === 'billion' ? 1e9 : 1e6), '', 'USD', doc.url, index + 1)
              add(`${base}Share`, `${product} revenue share`, Number(amount[3]), '', '%', doc.url, index + 1)
            }
            const growth = /Revenue (increased|decreased)\s+([\d.]+)%\s+Q\/Q/i.exec(content)
            if (growth) add(`${base}Qoq`, `${product} revenue QoQ`, Number(growth[2]) * (growth[1].toLowerCase() === 'decreased' ? -1 : 1), '', '%', doc.url, index + 1)
            const shipments = /^Bit shipments\s+(.+?)\s+Q\/Q/i.exec(content)
            const pricing = /^(?:ASPs|Prices)\s+(.+?)\s+Q\/Q/i.exec(content)
            if (shipments) add(`${base}Shipments`, `${product} bit shipments QoQ`, null, shipments[1], 'text', doc.url, index + 1)
            if (pricing) add(`${base}Pricing`, `${product} pricing QoQ`, null, pricing[1], 'text', doc.url, index + 1)
          }
        }
      }
      for (const product of ['DRAM', 'NAND'] as const) {
        const other = product === 'DRAM' ? 'NAND' : 'DRAM'
        const section = new RegExp(`(?:Fiscal Q${quarter}\\s+${product} revenue|${product} revenue (?:in|for) (?:fiscal )?Q${quarter})[^.]*?\\$([\\d,.]+)\\s+(billion|million)([\\s\\S]*?)(?=(?:${other}|Consolidated gross margin|Gross margin|Financial performance)\\b|$)`, 'i').exec(text)
        if (!section) continue
        const base = product.toLowerCase()
        add(`${base}Revenue`, `${product} revenue`, Number(section[1].replace(/,/g, '')) * (section[2].toLowerCase() === 'billion' ? 1e9 : 1e6), '', 'USD', doc.url, index + 1)
        const tail = section[3]
        const share = /represented\s+([\d.]+)%/i.exec(tail)
        const yoy = /up\s+([\d.]+)%\s+year.over.year/i.exec(tail)
        const qoq = /(?:revenue (?:increased|decreased|grew)|up|down)\s+([\d.]+)%/i.exec(tail.slice(tail.toLowerCase().indexOf('sequential')))
        if (share) add(`${base}Share`, `${product} revenue share`, Number(share[1]), '', '%', doc.url, index + 1)
        if (yoy) add(`${base}Yoy`, `${product} revenue YoY`, Number(yoy[1]), '', '%', doc.url, index + 1)
        if (qoq) add(`${base}Qoq`, `${product} revenue QoQ`, /decreased|down/i.test(qoq[0]) ? -Number(qoq[1]) : Number(qoq[1]), '', '%', doc.url, index + 1)
        const shipments = /Bit shipments\s+((?:\.(?=\d)|[^.!])+[.!]?)/i.exec(tail)?.[1].trim()
        const pricing = /(?:Prices|Average selling prices|ASPs)\s+((?:\.(?=\d)|[^.!])+[.!]?)/i.exec(tail)?.[1].trim()
        if (shipments) add(`${base}Shipments`, `${product} bit shipments QoQ`, null, shipments, 'text', doc.url, index + 1)
        if (pricing) add(`${base}Pricing`, `${product} pricing QoQ`, null, pricing, 'text', doc.url, index + 1)
      }
      const hbmAmount = /HBM revenue\s+(?:was|reached|exceeded|crossed|of)[^.!]{0,35}?\$([\d.]+)\s+(billion|million)/i.exec(text)
      if (hbmAmount) add('hbmRevenue', 'HBM revenue', Number(hbmAmount[1]) * (hbmAmount[2].toLowerCase() === 'billion' ? 1e9 : 1e6), hbmAmount[0], 'USD', doc.url, index + 1)
      const hbmGrowth = /(?:In HBM,?\s+our revenue|HBM revenue)[^.]{0,200}(?:grew|growth|increased)[^.]{0,150}\./i.exec(text)?.[0]
      if (hbmGrowth) add('hbmGrowth', 'HBM growth disclosure', null, hbmGrowth, 'text', doc.url, index + 1)
      const supply = /(?:We have completed agreements[^.]{0,200}HBM[^.]{0,150}|(?:Our |We expect our )?HBM[^.]{0,80}(?:sold out|supply (?:is|has|will)|capacity (?:is|has|will))[^.]{0,200})\./i.exec(text)?.[0]
      if (supply && /HBM/i.test(supply)) add('hbmSupply', 'HBM supply commitments', null, supply, 'text', doc.url, index + 1, 'outlook')
      const inventory = /days of inventory(?:\s*\(DIO\))?\s+(?:at|of|were|was)\s+(\d+)/i.exec(text)
      if (inventory) add('inventoryDays', 'Inventory days', Number(inventory[1]), '', 'days', doc.url, index + 1)
      const capex = /(?:in fiscal Q[1-4],[^.]{0,90})?Capital expenditures were \$([\d.]+) (billion|million)/i.exec(text)
      if (capex) add('capex', 'Quarterly capital expenditure', Number(capex[1]) * (capex[2].toLowerCase() === 'billion' ? 1e9 : 1e6), '', 'USD', doc.url, index + 1, 'non-GAAP')
    }
  }
  const required = ['dramRevenue', 'nandRevenue', 'dramShare', 'nandShare', 'dramPricing', 'nandPricing', 'dramShipments', 'nandShipments']
  if (!metrics.some(metric => metric.id === 'dramRevenue' || metric.id === 'nandRevenue')) throw new Error('Micron DRAM/NAND disclosures could not be read.')
  const warnings = required.filter(id => !metrics.some(metric => metric.id === id)).map(id => `Unavailable disclosure: ${id}`)
  for (const [id, label, unit] of [
    ['hbmRevenue', 'HBM revenue', 'USD'], ['hbmGrowth', 'HBM growth disclosure', 'text'], ['hbmSupply', 'HBM supply commitments', 'text'],
    ['inventoryDays', 'Inventory days', 'days'], ['capex', 'Quarterly capital expenditure', 'USD'],
  ] as const) {
    if (!metrics.some(metric => metric.id === id)) metrics.push({ id, label, value: null, text: 'Not disclosed', unit, basis: 'reported', sourceUrl: documents[0].document.url, page: null })
  }
  return { period, metrics, sources: documents.map(({ document }) => document), warnings }
}

export function muHistory(financials: FundamentalsPagePayload | null) {
  const keys = ['revenue', 'netIncome', 'operatingCashFlow', 'freeCashFlow'] as const
  const dates = [...new Set(keys.flatMap(key => financials?.quarterly[key].map(point => point.endDate) ?? []))].sort().slice(-12)
  return { dates, series: keys.map(key => ({ key, values: dates.map(date => financials?.quarterly[key].find(point => point.endDate === date)?.value ?? null) })) }
}

export function buildMuSnapshot(payload: MuPayload): string {
  return JSON.stringify({ title: 'MU — Micron Technology', ...payload }, null, 2)
}
