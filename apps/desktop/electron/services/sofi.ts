import type { Envelope, EnvelopeError, StocksPayload } from '../shared/contract.js'
import { SOFI_CIK, SOFI_BLOCKS, combineSofiReports, emptySofiPayload, parseSofiReport, sofiBookRatios, sofiPlain, sofiPublishedAt, sofiReportWarnings } from '../shared/sofi.js'
import type { SofiBlock, SofiPayload, SofiReport, SofiReports, SofiRequest } from '../shared/sofi.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL } from './cache.js'
import { fetchSecFilingSnapshot, fetchSecText } from './secEdgar.js'
import { getStocks } from './yahoo/stocks.js'
import { getQuotes } from './yahoo/quotes.js'

const SOURCE = 'Yahoo Finance · SEC EDGAR · SoFi investor relations'
export const SOFI_RESULTS_URL = 'https://investors.sofi.com/financials/quarterly-results/default.aspx'
const SOFI_RESULTS_FEED = 'https://investors.sofi.com/feed/FinancialReport.svc/GetFinancialReportList?reportTypes=First%20Quarter,Second%20Quarter,Third%20Quarter,Fourth%20Quarter'
export interface SofiMarket {
  stock: StocksPayload | null
  price: number | null
  changePct: number | null
  priceAsOf: number | null
  warnings: string[]
  stale: boolean
}

async function fetchMarket(force: boolean): Promise<SofiMarket> {
  const [stockResult, quoteResult] = await Promise.allSettled([getStocks('SOFI', force), getQuotes(['SOFI'], force)])
  const stock = stockResult.status === 'fulfilled' ? stockResult.value.payload : null
  const quoteBatch = quoteResult.status === 'fulfilled' ? quoteResult.value : null
  const quote = quoteBatch?.quotes.SOFI
  if (!stock && !quote) throw new Error('SOFI market data unavailable.')
  const warnings = stockResult.status === 'fulfilled'
    ? stockResult.value.failures.filter(failure => ['Chart', 'Overview'].includes(failure.block)).map(failure => `${failure.block}: ${failure.reason}`)
    : [`Stock overview unavailable: ${describeError(stockResult.reason)}`]
  if (!quote) warnings.push('Current quote unavailable; last chart close is shown when available.')
  if (quoteBatch?.staleCount) warnings.push('Live quote refresh failed; showing cached quote.')
  const last = stock?.chart.candles.at(-1)
  return { stock, price: quote?.price ?? last?.close ?? null, changePct: quote?.change ?? stock?.chart.stats.change ?? null,
    priceAsOf: quote ? Date.now() - (quoteBatch?.cacheAgeSeconds ?? 0) * 1000 : last ? last.time * 1000 : null,
    warnings, stale: Boolean(quoteBatch?.staleCount || warnings.some(warning => /cached/i.test(warning))) }
}

export function discoverSofiExhibits(html: string, base: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].filter(row => /EX-99\.[12]/i.test(sofiPlain(row[1])))
    .flatMap(row => [...row[1].matchAll(/href=["']([^"']+)["']/gi)].map(link => new URL(link[1].replace(/&amp;/g, '&'), base).href))
    .filter(url => /\.html?(?:$|\?)/i.test(url) && new URL(url).hostname === 'www.sec.gov')
}

/** Never guess an exhibit filename; SEC filing indexes name the actual earnings document. */
async function fetchReports(force: boolean): Promise<SofiReports> {
  let filings: SofiReports['filings'] = []
  const warnings: string[] = []
  const reports: SofiReport[] = []
  try {
    const submissions = await fetchSecFilingSnapshot(SOFI_CIK, force)
    filings = submissions.filings
    warnings.push(...submissions.warnings)
    const earnings = filings.filter(filing => /^8-K/.test(filing.form) && filing.items.split(',').some(item => item.trim() === '2.02')).slice(0, 8)
    // Bound discovery requests while still sharing the SEC gate with every other page.
    for (let offset = 0; offset < earnings.length; offset += 2) {
      const settled = await Promise.allSettled(earnings.slice(offset, offset + 2).map(async filing => {
        const result = await cache.resolveWithStaleFallback(`sofi:v1:release:${filing.accessionNumber}`, TTL.sofiReports, async () => {
          const base = filing.documentUrl.slice(0, filing.documentUrl.lastIndexOf('/') + 1)
          const index = await fetchSecText(`${base}${filing.accessionNumber}-index.html`)
          const urls = discoverSofiExhibits(index, base)
          for (const url of urls) {
            try { return parseSofiReport(await fetchSecText(url), url, filing.filedDate) } catch { /* Another exhibit may be the earnings release. */ }
          }
          throw new Error(`No readable earnings exhibit in ${filing.accessionNumber}.`)
        }, { force })
        if (result.stale) warnings.push(`${filing.filedDate}: earnings refresh failed; showing cached release.`)
        return result.value
      }))
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') reports.push(result.value)
        else warnings.push(`${earnings[offset + index].filedDate}: ${describeError(result.reason)}`)
      })
    }
  } catch (error) { warnings.push(`SEC discovery: ${describeError(error)}`) }
  if (!reports.length) {
    reports.push(...await fetchInvestorReports())
    warnings.push('SEC earnings unavailable; using SoFi investor relations releases.')
  }
  const quarters = combineSofiReports(reports)
  if (!quarters.length) throw new Error('No SoFi reported quarters were available.')
  return { quarters, filings: filings.slice(0, 12), warnings, notes: [...new Set(reports.flatMap(report => report.notes))],
    releases: reports.map(report => ({ url: report.url, publishedAt: report.publishedAt, endDate: report.quarters.at(-1)!.endDate }))
      .sort((a, b) => b.endDate.localeCompare(a.endDate)) }
}

const IR_HOSTS = new Set(['investors.sofi.com', 's27.q4cdn.com'])
async function irResponse(url: string): Promise<Response> {
  const target = new URL(url)
  if (target.protocol !== 'https:' || !IR_HOSTS.has(target.hostname)) throw new Error('Unexpected SoFi investor relations host.')
  const response = await fetch(url, { headers: { 'User-Agent': 'BudgetTerminal/1.0 sofi-page', Accept: 'text/html,application/pdf' }, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`SoFi investor relations HTTP ${response.status}`)
  if (!IR_HOSTS.has(new URL(response.url || url).hostname)) throw new Error('Unexpected SoFi report redirect.')
  return response
}

export function discoverSofiInvestorLinks(html: string, base = SOFI_RESULTS_URL): string[] {
  return [...new Set([...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(link => /earnings.release|press.release/i.test(`${link[1]} ${sofiPlain(link[2])}`))
    .map(link => new URL(link[1].replace(/&amp;/g, '&'), base).href)
    .filter(url => IR_HOSTS.has(new URL(url).hostname)))].slice(0, 8)
}

async function fetchInvestorReports(): Promise<SofiReport[]> {
  let urls: string[] = []
  try { urls = discoverSofiInvestorFeed(await (await irResponse(SOFI_RESULTS_FEED)).json()) } catch { /* Archive HTML is the secondary discovery route. */ }
  if (!urls.length) urls = discoverSofiInvestorLinks(await (await irResponse(SOFI_RESULTS_URL)).text())
  const reports: SofiReport[] = []
  for (const url of urls) {
    try {
      const response = await irResponse(url)
      const reportHtml = response.headers.get('content-type')?.includes('pdf')
        ? await sofiPdfTables(new Uint8Array(await response.arrayBuffer())) : await response.text()
      const date = sofiPublishedAt(reportHtml)
      reports.push(parseSofiReport(reportHtml, url, date))
    } catch { /* One unavailable document must not hide the remaining quarters. */ }
  }
  if (!reports.length) throw new Error('SoFi earnings unavailable from SEC and investor relations.')
  return reports
}

export function discoverSofiInvestorFeed(body: unknown): string[] {
  const records = (body as { GetFinancialReportListResult?: unknown })?.GetFinancialReportListResult
  if (!Array.isArray(records)) throw new Error('SoFi quarterly archive schema unavailable.')
  return records.filter(report => typeof report.ReportYear === 'number').sort((a, b) => b.ReportYear - a.ReportYear ||
    String(b.ReportDate).localeCompare(String(a.ReportDate))).flatMap(report => {
      if (!Array.isArray(report.Documents)) return []
      return report.Documents.filter((document: Record<string, unknown>) => /press release|earnings release/i.test(String(document.DocumentTitle)))
        .map((document: Record<string, unknown>) => String(document.DocumentPath))
        .filter((url: string) => { try { const target = new URL(url); return target.protocol === 'https:' && IR_HOSTS.has(target.hostname) } catch { return false } })
    }).slice(0, 8)
}

/** Retain PDF cell positions and page headers for the official IR PDF fallback. */
async function sofiPdfTables(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: bytes, useSystemFonts: true })
  const pdf = await task.promise
  try {
    const tables: string[] = []
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const content = await (await pdf.getPage(index)).getTextContent()
      const rows: Array<{ y: number; cells: Array<{ x: number; text: string }> }> = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        let row = rows.find(row => Math.abs(row.y - item.transform[5]) < 2.5)
        if (!row) { row = { y: item.transform[5], cells: [] }; rows.push(row) }
        row.cells.push({ x: item.transform[4], text: item.str })
      }
      const ordered = rows.sort((a, b) => b.y - a.y)
      ordered.forEach(row => row.cells.sort((a, b) => a.x - b.x))
      const partialDate = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?$/i
      // PDF headers wrap months/days above years. Match their physical columns before parsing.
      for (let rowIndex = 1; rowIndex < ordered.length; rowIndex++) {
        const prior = ordered[rowIndex - 1]
        const fragments = prior.cells.filter(cell => partialDate.test(cell.text.trim()))
        if (!fragments.length) continue
        for (const cell of ordered[rowIndex].cells.filter(cell => /^20\d{2}$/.test(cell.text.trim()))) {
          const match = [...fragments].sort((a, b) => Math.abs(a.x - cell.x) - Math.abs(b.x - cell.x))[0]
          if (Math.abs(match.x - cell.x) < 40) cell.text = `${match.text} ${cell.text}`
        }
        prior.cells = prior.cells.filter(cell => !fragments.includes(cell))
      }
      const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const cells = ordered.filter(row => row.cells.length).map(row => row.cells.map(cell => cell.text.trim()))
      const headerIndex = cells.findIndex(row => row.filter(cell => /^(?:20\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*20\d{2})$/.test(cell)).length >= 2)
      // Publication prose is retained separately; table parsing starts at its own header.
      tables.push(`<p>${escape(cells.flat().join(' '))}</p>`)
      if (headerIndex < 0) continue
      const tableRows: string[][] = []
      for (const row of cells.slice(Math.max(0, headerIndex - 3))) {
        const previous = tableRows.at(-1)
        if (previous?.length === 1 && /^(Earnings per share|Net income attributable|Tangible book value per|Book value per)/i.test(previous[0]) &&
          /^(common stockholders|stockholders|common share|share)/i.test(row[0])) row[0] = `${tableRows.pop()![0]} ${row[0]}`
        // Join label fragments (such as 'common stockholders', '–', 'diluted'), keeping amounts separate.
        const numeric = row.findIndex(cell => /^(?:\$|\(?[+-]?\d[\d,]*(?:\.\d+)?\)?|[—–-])$/.test(cell))
        if (numeric > 1 && !row.some(cell => /months ended|quarter ended|20\d{2}/i.test(cell))) tableRows.push([row.slice(0, numeric).join(' '), ...row.slice(numeric)])
        else tableRows.push(row)
      }
      tables.push(`<table>${tableRows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</table>`)
    }
    return tables.join('\n')
  } finally { await task.destroy() }
}

export interface SofiFetchers { market: (force: boolean) => Promise<SofiMarket>; reports: (force: boolean) => Promise<SofiReports> }
const defaults: SofiFetchers = { market: fetchMarket, reports: fetchReports }

export async function getSofi({ force = false }: SofiRequest = {}, fetchers: SofiFetchers = defaults): Promise<Envelope<SofiPayload>> {
  const payload = emptySofiPayload()
  const errors: EnvelopeError[] = []
  const times: number[] = []
  let cached = false
  const lane = async <T>(block: SofiBlock, ttl: number, loader: () => Promise<T>, apply: (value: T) => { warnings: string[]; stale?: boolean }) => {
    try {
      const result = await cache.resolveWithStaleFallback(`sofi:v1:${block}`, ttl, loader, { force })
      const applied = apply(result.value)
      const stale = result.stale || applied.stale
      if (result.stale) applied.warnings.push('Refresh failed; showing cached data.')
      payload.progress[block] = stale ? 'stale' : applied.warnings.length ? 'partial' : 'loaded'
      times.push(Date.now() - result.ageSeconds * 1000)
      cached ||= result.fromCache
      for (const warning of applied.warnings) errors.push(err(SOURCE, warning, `sofi-${block}`, block))
    } catch (error) { errors.push(err(SOURCE, describeError(error), `sofi-${block}`, block)) }
  }
  await Promise.all([
    lane('market', TTL.sofi, () => fetchers.market(force), market => {
      payload.market = market.stock; payload.price = market.price; payload.changePct = market.changePct; payload.priceAsOf = market.priceAsOf
      return { warnings: [...market.warnings], stale: market.stale }
    }),
    lane('reports', TTL.sofiReports, () => fetchers.reports(force), reports => {
      payload.reports = reports
      return { warnings: sofiReportWarnings(reports), stale: reports.warnings.some(warning => /cached/i.test(warning)) }
    }),
  ])
  payload.valuation = sofiBookRatios(payload.price, payload.reports?.quarters.at(-1))
  payload.fetchedAt = times.length ? Math.min(...times) : Date.now()
  const allFailed = SOFI_BLOCKS.every(block => payload.progress[block] === 'unavailable')
  const stale = SOFI_BLOCKS.some(block => payload.progress[block] === 'stale')
  const failureReason = errors.map(error => `${error.symbol}: ${error.reason}`).join(' · ')
  return { data: payload, errors, meta: { source: SOURCE, fetchedAt: payload.fetchedAt,
    freshness: allFailed ? 'failed' : stale ? 'stale' : errors.length ? 'partial' : cached ? 'cached' : 'fresh',
    ...(failureReason ? { failureReason } : {}) } }
}

export const sofiTesting = { fetchReports, fetchMarket, fetchInvestorReports, sofiPdfTables }
