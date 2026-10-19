import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Envelope, EnvelopeError } from '../shared/contract.js'
import { HOOD_BLOCKS, discoverHoodDocument, emptyHoodPayload, parseHoodReport } from '../shared/hood.js'
import type { HoodBlock, HoodPayload, HoodReport, HoodRequest } from '../shared/hood.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL } from './cache.js'
import { getStocks } from './yahoo/stocks.js'
import { getFundamentalsPage } from './yahoo/fundamentalsPage.js'

const SOURCE = 'Yahoo Finance · SEC EDGAR · Robinhood investor relations'
export const hoodIndexes = {
  monthly: 'https://investors.robinhood.com/financials/monthly-metrics',
  quarterly: 'https://investors.robinhood.com/financials/quarterly-results',
}

async function response(url: string): Promise<Response> {
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.hostname !== 'investors.robinhood.com' || target.username || target.password) throw new Error('Unexpected Robinhood document host.')
  // Robinhood's edge rejects Electron's Node TLS client with HTTP 403 even with
  // browser headers. Use Chromium in the desktop app; keep Node fetch for CLI probes.
  const fetchDocument = process.versions.electron
    ? (await import('electron')).net.fetch
    : fetch
  const result = await fetchDocument(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' }, signal: AbortSignal.timeout(20_000) })
  if (!result.ok) throw new Error(`Robinhood document request failed: HTTP ${result.status}`)
  if (new URL(result.url || url).hostname !== 'investors.robinhood.com') throw new Error('Unexpected Robinhood document redirect.')
  return result
}

/** Preserve PDF rows and cells; merging the whole page loses table column boundaries. */
export async function hoodPdfText(bytes: Uint8Array): Promise<string> {
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
        let row = rows.find(row => Math.abs(row.y - y) < 2.5)
        if (!row) { row = { y, cells: [] }; rows.push(row) }
        row.cells.push({ x: item.transform[4], text: item.str })
      }
      pages.push(rows.sort((a, b) => b.y - a.y).map(row => row.cells.sort((a, b) => a.x - b.x).map(cell => cell.text).join('\t')).join('\n'))
    }
    return pages.join('\n')
  } finally { await task.destroy() }
}

async function fetchReport(kind: 'monthly' | 'quarterly'): Promise<HoodReport> {
  const index = await (await response(hoodIndexes[kind])).text()
  const document = discoverHoodDocument(index, kind)
  const result = await response(document.url)
  const pdf = result.headers.get('content-type')?.includes('pdf') || /\/pdf(?:$|\?)/i.test(document.url) || document.url.includes('/static-files/')
  const text = pdf ? await hoodPdfText(new Uint8Array(await result.arrayBuffer()))
    : (await result.text()).replace(/<\/(?:tr|p|li)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  return parseHoodReport(text, document, kind)
}

export interface HoodFetchers {
  market: typeof getStocks
  financials: typeof getFundamentalsPage
  report: (kind: 'monthly' | 'quarterly') => Promise<HoodReport>
}
const defaults: HoodFetchers = { market: getStocks, financials: getFundamentalsPage, report: fetchReport }

export async function getHood({ force = false }: HoodRequest = {}, fetchers: HoodFetchers = defaults): Promise<Envelope<HoodPayload>> {
  const payload = emptyHoodPayload()
  const errors: EnvelopeError[] = []
  const times: number[] = []
  let fromCache = false
  const lane = async <T>(block: HoodBlock, ttl: number, loader: () => Promise<T>, apply: (value: T) => string[]) => {
    try {
      const result = await cache.resolveWithStaleFallback(`hood:v1:${block}`, ttl, loader, { force })
      fromCache ||= result.fromCache
      const warnings = apply(result.value)
      if (result.stale) warnings.push('Refresh failed; showing cached data.')
      payload.progress[block] = result.stale ? 'stale' : warnings.length ? 'partial' : 'loaded'
      times.push(Date.now() - result.ageSeconds * 1000)
      for (const warning of warnings) errors.push(err(SOURCE, warning, `hood-${block}`, block))
    } catch (error) { errors.push(err(SOURCE, describeError(error), `hood-${block}`, block)) }
  }
  await Promise.all([
    lane('market', TTL.hood, () => fetchers.market('HOOD', force), result => {
      payload.market = result.payload
      return result.failures.map(failure => `${failure.block}: ${failure.reason}`)
    }),
    lane('financials', TTL.hood, () => fetchers.financials('HOOD', force), result => {
      payload.financials = result.payload
      const warnings = result.failures.map(failure => `${failure.operation}: ${failure.reason}`)
      if (result.stale) warnings.push('Financial refresh failed; showing cached statements.')
      return warnings
    }),
    ...(['monthly', 'quarterly'] as const).map(block => lane(block, TTL.hoodReports, () => fetchers.report(block), report => {
      payload[block] = report
      const missing = report.metrics.filter(metric => metric.value === null).map(metric => metric.label)
      return missing.length ? [`Unavailable metrics: ${missing.join(', ')}.`] : []
    })),
  ])
  payload.fetchedAt = times.length ? Math.min(...times) : Date.now()
  const allFailed = HOOD_BLOCKS.every(block => payload.progress[block] === 'unavailable')
  const stale = HOOD_BLOCKS.some(block => payload.progress[block] === 'stale')
  const failureReason = errors.map(error => `${error.symbol}: ${error.reason}`).join(' · ')
  return { data: payload, errors, meta: { source: SOURCE, fetchedAt: payload.fetchedAt,
    freshness: allFailed ? 'failed' : stale ? 'stale' : errors.length ? 'partial' : fromCache ? 'cached' : 'fresh',
    ...(failureReason ? { failureReason } : {}) } }
}

export const hoodTesting = { fetchReport, response }
