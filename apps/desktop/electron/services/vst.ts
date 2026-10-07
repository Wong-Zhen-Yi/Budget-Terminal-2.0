import type { Envelope, EnvelopeError } from '../shared/contract.js'
import { VST_BLOCKS, vstDocumentUrl, discoverVstDocuments, emptyVstPayload, parseVstEarnings, parseVstOperations } from '../shared/vst.js'
import type { VstBlock, VstEarnings, VstOperations, VstPayload, VstRequest } from '../shared/vst.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL, type TtlCache } from './cache.js'
import { fetchSecFilingSnapshot, fetchSecText } from './secEdgar.js'
import { getStocks } from './yahoo/stocks.js'
import { getFundamentalsPage } from './yahoo/fundamentalsPage.js'

export const VST_SOURCE = 'Yahoo Finance · SEC EDGAR · Vistra investor relations'
export const VST_IR = 'https://investor.vistracorp.com/'
export const VST_RESULTS = 'https://investor.vistracorp.com/news?l=100'
export const VST_CIK = '1692819'

async function irText(url: string): Promise<string> {
  const target = vstDocumentUrl(url)
  const result = await fetch(target, { headers: { 'User-Agent': 'BudgetTerminalElectron/0.1 vst-page', Accept: 'text/html' }, signal: AbortSignal.timeout(20_000) })
  vstDocumentUrl(result.url || target)
  if (!result.ok) throw new Error(`Vistra request failed: HTTP ${result.status}`)
  return result.text()
}
export interface VstReportSources {
  text: (url: string) => Promise<string>
  filings: typeof fetchSecFilingSnapshot
  secText: typeof fetchSecText
}
const reportSources: VstReportSources = { text: irText, filings: fetchSecFilingSnapshot, secText: fetchSecText }

/** Compare published releases, including SEC exhibits, because the quarterly IR index can lag. */
export async function loadVstEarnings(force: boolean, sources: VstReportSources = reportSources): Promise<VstEarnings> {
  const discovery = await Promise.allSettled([sources.text(VST_IR), sources.text(VST_RESULTS), sources.filings(VST_CIK, force)])
  const warnings: string[] = []
  const irDocuments = discovery.slice(0, 2).flatMap(result => result.status === 'fulfilled' && typeof result.value === 'string' ? discoverVstDocuments(result.value) : [])
  const candidates = [...new Map(irDocuments.map(document => [document.url, document])).values()].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 2)
  const reports: VstEarnings[] = []
  const failedPeriods: string[] = []
  await Promise.all(candidates.map(async document => {
    try { reports.push(parseVstEarnings(await sources.text(document.url), document.url, document.period)) }
    catch { failedPeriods.push(document.period) }
  }))
  const filingsResult = discovery[2]
  let latestSecPeriodEnd = ''
  if (filingsResult.status === 'fulfilled' && typeof filingsResult.value !== 'string') {
    const snapshot = filingsResult.value
    if (snapshot.freshness === 'stale') warnings.push('SEC submissions are stale; latest earnings filing could not be verified.')
    const filings = snapshot.filings.filter(filing => filing.form === '8-K' && filing.items.includes('2.02')).sort((a, b) => b.filedDate.localeCompare(a.filedDate)).slice(0, 2)
    // An earnings 8-K reportPeriod is usually its announcement date, not fiscal quarter end.
    for (const filing of filings) {
      try {
        const directory = vstDocumentUrl(filing.documentUrl).slice(0, filing.documentUrl.lastIndexOf('/') + 1)
        const listing = JSON.parse(await sources.secText(`${directory}index.json`)) as { directory?: { item?: Array<{ name: string }> } }
        const exhibits = listing.directory?.item?.filter(item => /(?:ex(?:hibit)?[-_.]?99|99[._-]?1|earnings|press|release).*\.html?$/i.test(item.name)) ?? []
        for (const exhibit of exhibits) {
          try {
            const url = vstDocumentUrl(`${directory}${exhibit.name}`)
            const report = parseVstEarnings(await sources.secText(url), url)
            if (report.publishedAt && report.publishedAt > filing.filedDate) continue
            reports.push(report)
            if (filing === filings[0]) latestSecPeriodEnd = report.periodEnd
          } catch { /* Try the other release exhibits in this filing. */ }
        }
        if (filing === filings[0] && !latestSecPeriodEnd && !reports.some(report => report.publishedAt === filing.filedDate)) {
          warnings.push(`Latest SEC earnings exhibit (${filing.filedDate}) could not be read.`)
        }
      } catch {
        if (filing === filings[0] && !reports.some(report => report.publishedAt === filing.filedDate)) warnings.push(`Latest SEC earnings filing (${filing.filedDate}) could not be checked.`)
      }
    }
  } else warnings.push('SEC earnings discovery failed; showing the latest available Vistra release.')
  reports.sort((a, b) => b.period.localeCompare(a.period) || b.publishedAt.localeCompare(a.publishedAt) || Number(a.sourceUrl.includes('sec.gov')) - Number(b.sourceUrl.includes('sec.gov')))
  const selected = reports[0]
  if (!selected) throw new Error('Published Vistra earnings release is unavailable or its layout changed.')
  if (failedPeriods.some(period => period > selected.period)) warnings.push('A newer Vistra release could not be read; showing an older fiscal quarter.')
  selected.warnings.push(...warnings)
  return selected
}

export interface VstFetchers {
  market: typeof getStocks
  financials: typeof getFundamentalsPage
  earnings: (force: boolean) => Promise<VstEarnings>
  operations: (force: boolean) => Promise<VstOperations>
}

export async function loadVstOperations(force: boolean, sources: Pick<VstReportSources, 'filings' | 'secText'> = reportSources): Promise<VstOperations> {
  const snapshot = await sources.filings(VST_CIK, force)
  const filing = snapshot.filings.filter(filing => filing.form === '10-Q')
    .sort((a, b) => b.reportPeriod.localeCompare(a.reportPeriod) || b.filedDate.localeCompare(a.filedDate))[0]
  if (!filing) throw new Error('Vistra quarterly filing is unavailable.')
  const url = vstDocumentUrl(filing.documentUrl)
  const report = parseVstOperations(await sources.secText(url), url, filing.reportPeriod, filing.filedDate)
  report.warnings.push(...snapshot.warnings)
  if (snapshot.freshness === 'stale') report.warnings.push('SEC submissions are stale; the latest quarterly filing could not be verified.')
  return report
}

const defaults: VstFetchers = { market: getStocks, financials: getFundamentalsPage,
  earnings: async force => (await cache.resolve('vst:v2:release', TTL.vstReports, () => loadVstEarnings(force), { force })).value,
  operations: loadVstOperations }

export async function getVst({ force = false }: VstRequest = {}, fetchers: VstFetchers = defaults, storage: TtlCache = cache): Promise<Envelope<VstPayload>> {
  const payload = emptyVstPayload()
  const errors: EnvelopeError[] = []
  let cached = false
  const lane = async <T>(block: VstBlock, ttl: number, loader: () => Promise<T>, apply: (value: T) => string[]) => {
    try {
      const result = await storage.resolveWithStaleFallback(`vst:v2:${block}`, ttl, async () => ({ value: await loader(), fetchedAt: Date.now() }), { force })
      const warnings = apply(result.value.value)
      if (result.stale) warnings.push('Refresh failed; showing cached data.')
      payload.progress[block] = result.stale || warnings.some(warning => /showing cached/i.test(warning)) ? 'stale' : warnings.length ? 'partial' : 'loaded'
      payload.laneFetchedAt[block] = result.value.fetchedAt
      cached ||= result.fromCache
      warnings.forEach(reason => errors.push(err(VST_SOURCE, reason, `vst-${block}`, block)))
    } catch (error) { errors.push(err(VST_SOURCE, describeError(error), `vst-${block}`, block)) }
  }
  await Promise.all([
    lane('market', TTL.vst, () => fetchers.market('VST', force), result => {
      payload.market = result.payload
      return result.failures.map(failure => `${failure.block}: ${failure.reason}`)
    }),
    lane('financials', TTL.vst, () => fetchers.financials('VST', force), result => {
      payload.financials = result.payload
      return [...result.failures.map(failure => `${failure.operation}: ${failure.reason}`), ...(result.stale ? ['Financial refresh failed; showing cached statements.'] : [])]
    }),
    lane('earnings', TTL.vstReports, () => fetchers.earnings(force), result => {
      payload.earnings = result
      return [...result.warnings]
    }),
    lane('operations', TTL.vstReports, () => fetchers.operations(force), result => {
      payload.operations = result
      return [...result.warnings]
    }),
  ])
  const times = Object.values(payload.laneFetchedAt).filter((time): time is number => time !== null)
  payload.fetchedAt = times.length ? Math.min(...times) : Date.now()
  const failed = VST_BLOCKS.every(block => payload.progress[block] === 'unavailable')
  const stale = VST_BLOCKS.some(block => payload.progress[block] === 'stale')
  const failureReason = errors.map(error => `${error.symbol}: ${error.reason}`).join(' · ')
  return { data: payload, errors, meta: { source: VST_SOURCE, fetchedAt: payload.fetchedAt,
    freshness: failed ? 'failed' : stale ? 'stale' : errors.length ? 'partial' : cached ? 'cached' : 'fresh',
    ...(failureReason ? { failureReason } : {}) } }
}
