import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Envelope, EnvelopeError } from '../shared/contract.js'
import { MU_BLOCKS, discoverMuDocuments, emptyMuPayload, muDocumentUrl, muHtmlText, parseMuEarnings, parseMuMemory, validateMuPeriod } from '../shared/mu.js'
import type { MuBlock, MuDocument, MuDocuments, MuEarnings, MuMemory, MuPayload, MuRequest, MuTextDocument } from '../shared/mu.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL, type TtlCache } from './cache.js'
import { fetchSecText, fetchSecFilingSnapshot } from './secEdgar.js'
import { getStocks } from './yahoo/stocks.js'
import { getFundamentalsPage } from './yahoo/fundamentalsPage.js'

export const MU_SOURCE = 'Yahoo Finance · SEC EDGAR · Micron investor relations'
export const MU_REPORT_FEED = 'https://investors.micron.com/feed/FinancialReport.svc/GetFinancialReportList?reportTypes=First%20Quarter,Second%20Quarter,Third%20Quarter,Fourth%20Quarter'

async function response(url: string): Promise<Response> {
  const target = muDocumentUrl(url)
  const result = await fetch(target, { headers: { 'User-Agent': 'BudgetTerminalElectron/0.1 mu-page', Accept: '*/*' }, signal: AbortSignal.timeout(20_000) })
  muDocumentUrl(result.url || target)
  if (!result.ok) throw new Error(`Micron request failed: HTTP ${result.status}`)
  return result
}

/** Preserve table columns and PDF page numbers for provenance and deterministic parsing. */
export async function muPdfPages(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes, useSystemFonts: true })
  const document = await task.promise
  try {
    const pages: string[] = []
    for (let number = 1; number <= document.numPages; number++) {
      const content = await (await document.getPage(number)).getTextContent()
      const rows: Array<{ y: number; cells: Array<{ x: number; text: string }> }> = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const y = item.transform[5]
        let row = rows.find(row => Math.abs(row.y - y) < 2)
        if (!row) { row = { y, cells: [] }; rows.push(row) }
        row.cells.push({ x: item.transform[4], text: item.str })
      }
      pages.push(rows.sort((a, b) => b.y - a.y).map(row => row.cells.sort((a, b) => a.x - b.x).map(cell => cell.text).join('\t')).join('\n'))
    }
    return pages
  } finally { await task.destroy() }
}

async function discover(force: boolean): Promise<MuDocuments> {
  return (await cache.resolve('mu:v1:documents', TTL.muReports, async () => discoverMuDocuments(await (await response(MU_REPORT_FEED)).json()), { force })).value
}

async function documentPages(document: MuDocument, force: boolean): Promise<MuTextDocument> {
  const result = await cache.resolve(`mu:v1:document:${document.url}`, TTL.muReports, async () => {
    const result = await response(document.url)
    return result.headers.get('content-type')?.includes('pdf') || /\.pdf(?:$|\?)/i.test(document.url)
      ? muPdfPages(new Uint8Array(await result.arrayBuffer())) : [muHtmlText(await result.text())]
  }, { force })
  return { document, pages: result.value }
}

async function earnings(force: boolean): Promise<MuEarnings> {
  const snapshot = await fetchSecFilingSnapshot('723125', force)
  if (snapshot.freshness === 'stale') throw new Error(snapshot.warnings.join(' · ') || 'SEC submissions refresh failed.')
  const filings = snapshot.filings.filter(filing => filing.form === '8-K' && filing.items.includes('2.02')).slice(0, 3)
  for (const filing of filings) {
    try {
      const directory = filing.documentUrl.slice(0, filing.documentUrl.lastIndexOf('/') + 1)
      const listing = JSON.parse(await fetchSecText(`${directory}index.json`)) as { directory?: { item?: Array<{ name: string }> } }
      const exhibits = listing.directory?.item?.filter(item => /(?:press.?release|ex99[._-]?1).*\.html?$/i.test(item.name)) ?? []
      for (const exhibit of exhibits) {
        const url = `${directory}${exhibit.name}`
        const text = muHtmlText(await fetchSecText(url))
        // Read the fiscal period from the filed quarterly table. Earnings must
        // not depend on an investor-relations feed to select its SEC document.
        const header = /Quarterly Financial Results[\s\S]*?\bFQ([1-4])[- ](\d{2})/i.exec(text)
        if (!header) continue
        const period = `FY20${header[2]} Q${header[1]}`
        try { return parseMuEarnings(text, { period, kind: 'release', url }) } catch { /* Try a matching exhibit. */ }
      }
    } catch { /* One inaccessible filing must not hide other available reports. */ }
  }
  throw new Error('Micron SEC earnings release is unavailable or its layout changed.')
}

async function memory(force: boolean): Promise<MuMemory> {
  const documents = await discover(force)
  const selected = [documents.remarks, documents.presentation].filter((document): document is MuDocument => Boolean(document))
  const results = await Promise.allSettled(selected.map(async document => {
    const result = await documentPages(document, force)
    validateMuPeriod(result.pages.join(' '), document.period)
    return result
  }))
  const available = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const parsed = parseMuMemory(available)
  parsed.warnings.push(...results.flatMap((result, index) => result.status === 'rejected' ? [`${selected[index].kind}: ${describeError(result.reason)}`] : []))
  if (!documents.remarks) parsed.warnings.push('Prepared remarks unavailable.')
  if (!documents.presentation) parsed.warnings.push('Earnings presentation unavailable.')
  return parsed
}

export interface MuFetchers {
  market: typeof getStocks
  financials: typeof getFundamentalsPage
  earnings: (force: boolean) => Promise<MuEarnings>
  memory: (force: boolean) => Promise<MuMemory>
}
const defaults: MuFetchers = { market: getStocks, financials: getFundamentalsPage, earnings, memory }

export async function getMu({ force = false }: MuRequest = {}, fetchers: MuFetchers = defaults, storage: TtlCache = cache): Promise<Envelope<MuPayload>> {
  const payload = emptyMuPayload()
  const errors: EnvelopeError[] = []
  let cached = false
  const lane = async <T>(block: MuBlock, ttl: number, loader: () => Promise<T>, apply: (value: T) => string[]) => {
    try {
      const result = await storage.resolveWithStaleFallback(`mu:sec-v3:${block}`, ttl,
        async () => ({ value: await loader(), fetchedAt: Date.now() }), { force })
      const warnings = apply(result.value.value)
      if (result.stale) warnings.push('Refresh failed; showing cached data.')
      payload.progress[block] = result.stale || warnings.some(warning => /showing cached/i.test(warning)) ? 'stale' : warnings.length ? 'partial' : 'loaded'
      payload.laneFetchedAt[block] = result.value.fetchedAt
      cached ||= result.fromCache
      warnings.forEach(reason => errors.push(err(MU_SOURCE, reason, `mu-${block}`, block)))
    } catch (error) { errors.push(err(MU_SOURCE, describeError(error), `mu-${block}`, block)) }
  }
  await Promise.all([
    lane('market', TTL.mu, () => fetchers.market('MU', force), result => {
      payload.market = result.payload
      return result.failures.map(failure => `${failure.block}: ${failure.reason}`)
    }),
    lane('financials', TTL.mu, () => fetchers.financials('MU', force), result => {
      payload.financials = result.payload
      return [...result.failures.map(failure => `${failure.operation}: ${failure.reason}`), ...(result.stale ? ['Financial refresh failed; showing cached statements.'] : [])]
    }),
    lane('earnings', TTL.muReports, () => fetchers.earnings(force), result => {
      payload.earnings = result
      return [...result.metrics.filter(metric => metric.value === null).map(metric => `Unavailable: ${metric.basis} ${metric.label}`),
        ...(!result.units.length || result.units.some(unit => unit.revenue === null || unit.grossMargin === null || unit.operatingMargin === null) ? ['Business-unit results unavailable or incomplete.'] : []),
        ...(!result.guidance.length || result.guidance.some(row => !row.gaap || !row.nonGaap) ? ['Next-quarter guidance unavailable or incomplete.'] : [])]
    }),
    lane('memory', TTL.muReports, () => fetchers.memory(force), result => { payload.memory = result; return [...result.warnings] }),
  ])
  if (payload.earnings && payload.memory && payload.earnings.period !== payload.memory.period) {
    payload.progress.memory = 'stale'
    errors.push(err(MU_SOURCE, `Memory disclosures are ${payload.memory.period}; earnings are ${payload.earnings.period}.`, 'mu-memory', 'memory'))
  }
  const times = Object.values(payload.laneFetchedAt).filter((time): time is number => time !== null)
  payload.fetchedAt = times.length ? Math.min(...times) : Date.now()
  const failed = MU_BLOCKS.every(block => payload.progress[block] === 'unavailable')
  const stale = MU_BLOCKS.some(block => payload.progress[block] === 'stale')
  const failureReason = errors.map(error => `${error.symbol}: ${error.reason}`).join(' · ')
  return { data: payload, errors, meta: { source: MU_SOURCE, fetchedAt: payload.fetchedAt,
    freshness: failed ? 'failed' : stale ? 'stale' : errors.length ? 'partial' : cached ? 'cached' : 'fresh',
    ...(failureReason ? { failureReason } : {}) } }
}

export const muTesting = { discover, earnings, memory, documentPages }
