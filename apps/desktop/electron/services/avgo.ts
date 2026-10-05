import type { Envelope, EnvelopeError } from '../shared/contract.js'
import { AVGO_BLOCKS, avgoDocumentUrl, discoverAvgoDocuments, emptyAvgoPayload, parseAvgoEarnings } from '../shared/avgo.js'
import type { AvgoBlock, AvgoEarnings, AvgoPayload, AvgoRequest } from '../shared/avgo.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL, type TtlCache } from './cache.js'
import { fetchSecFilingSnapshot, fetchSecText } from './secEdgar.js'
import { getStocks } from './yahoo/stocks.js'
import { getFundamentalsPage } from './yahoo/fundamentalsPage.js'

export const AVGO_SOURCE = 'Yahoo Finance · SEC EDGAR · Broadcom investor relations'
export const AVGO_IR = 'https://investors.broadcom.com/'
export const AVGO_RESULTS = 'https://investors.broadcom.com/financial-information/quarterly-results'
export const AVGO_CIK = '1730168'

async function irText(url: string): Promise<string> {
  const target = avgoDocumentUrl(url)
  const result = await fetch(target, { headers: { 'User-Agent': 'BudgetTerminalElectron/0.1 avgo-page', Accept: 'text/html' }, signal: AbortSignal.timeout(20_000) })
  avgoDocumentUrl(result.url || target)
  if (!result.ok) throw new Error(`Broadcom request failed: HTTP ${result.status}`)
  return result.text()
}
export interface AvgoReportSources {
  text: (url: string) => Promise<string>
  filings: typeof fetchSecFilingSnapshot
  secText: typeof fetchSecText
}
const reportSources: AvgoReportSources = { text: irText, filings: fetchSecFilingSnapshot, secText: fetchSecText }

/** Compare published releases, including SEC exhibits, because the quarterly IR index can lag. */
export async function loadAvgoEarnings(force: boolean, sources: AvgoReportSources = reportSources): Promise<AvgoEarnings> {
  const discovery = await Promise.allSettled([sources.text(AVGO_IR), sources.text(AVGO_RESULTS), sources.filings(AVGO_CIK, force)])
  const warnings: string[] = []
  const irDocuments = discovery.slice(0, 2).flatMap(result => result.status === 'fulfilled' && typeof result.value === 'string' ? discoverAvgoDocuments(result.value) : [])
  const candidates = [...new Map(irDocuments.map(document => [document.url, document])).values()].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 2)
  const reports: AvgoEarnings[] = []
  const failedPeriods: string[] = []
  await Promise.all(candidates.map(async document => {
    try { reports.push(parseAvgoEarnings(await sources.text(document.url), document.url, document.period)) }
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
        const directory = avgoDocumentUrl(filing.documentUrl).slice(0, filing.documentUrl.lastIndexOf('/') + 1)
        const listing = JSON.parse(await sources.secText(`${directory}index.json`)) as { directory?: { item?: Array<{ name: string }> } }
        const exhibits = listing.directory?.item?.filter(item => /(?:ex(?:hibit)?[-_.]?99|99[._-]?1|earnings|press|release).*\.html?$/i.test(item.name)) ?? []
        for (const exhibit of exhibits) {
          try {
            const url = avgoDocumentUrl(`${directory}${exhibit.name}`)
            const report = parseAvgoEarnings(await sources.secText(url), url)
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
  } else warnings.push('SEC earnings discovery failed; showing the latest available Broadcom release.')
  reports.sort((a, b) => b.period.localeCompare(a.period) || b.publishedAt.localeCompare(a.publishedAt) || Number(a.sourceUrl.includes('sec.gov')) - Number(b.sourceUrl.includes('sec.gov')))
  const selected = reports[0]
  if (!selected) throw new Error('Published Broadcom earnings release is unavailable or its layout changed.')
  if (failedPeriods.some(period => period > selected.period)) warnings.push('A newer Broadcom release could not be read; showing an older fiscal quarter.')
  selected.warnings.push(...warnings)
  return selected
}

export interface AvgoFetchers {
  market: typeof getStocks
  financials: typeof getFundamentalsPage
  earnings: (force: boolean) => Promise<AvgoEarnings>
}
const defaults: AvgoFetchers = { market: getStocks, financials: getFundamentalsPage,
  earnings: async force => (await cache.resolve('avgo:v1:release', TTL.avgoReports, () => loadAvgoEarnings(force), { force })).value }

export async function getAvgo({ force = false }: AvgoRequest = {}, fetchers: AvgoFetchers = defaults, storage: TtlCache = cache): Promise<Envelope<AvgoPayload>> {
  const payload = emptyAvgoPayload()
  const errors: EnvelopeError[] = []
  let cached = false
  const lane = async <T>(block: AvgoBlock, ttl: number, loader: () => Promise<T>, apply: (value: T) => string[]) => {
    try {
      const result = await storage.resolveWithStaleFallback(`avgo:v1:${block}`, ttl, async () => ({ value: await loader(), fetchedAt: Date.now() }), { force })
      const warnings = apply(result.value.value)
      if (result.stale) warnings.push('Refresh failed; showing cached data.')
      payload.progress[block] = result.stale || warnings.some(warning => /showing cached/i.test(warning)) ? 'stale' : warnings.length ? 'partial' : 'loaded'
      payload.laneFetchedAt[block] = result.value.fetchedAt
      cached ||= result.fromCache
      warnings.forEach(reason => errors.push(err(AVGO_SOURCE, reason, `avgo-${block}`, block)))
    } catch (error) { errors.push(err(AVGO_SOURCE, describeError(error), `avgo-${block}`, block)) }
  }
  await Promise.all([
    lane('market', TTL.avgo, () => fetchers.market('AVGO', force), result => {
      payload.market = result.payload
      return result.failures.map(failure => `${failure.block}: ${failure.reason}`)
    }),
    lane('financials', TTL.avgo, () => fetchers.financials('AVGO', force), result => {
      payload.financials = result.payload
      return [...result.failures.map(failure => `${failure.operation}: ${failure.reason}`), ...(result.stale ? ['Financial refresh failed; showing cached statements.'] : [])]
    }),
    lane('earnings', TTL.avgoReports, () => fetchers.earnings(force), result => {
      payload.earnings = result
      return [...result.warnings]
    }),
  ])
  const times = Object.values(payload.laneFetchedAt).filter((time): time is number => time !== null)
  payload.fetchedAt = times.length ? Math.min(...times) : Date.now()
  const failed = AVGO_BLOCKS.every(block => payload.progress[block] === 'unavailable')
  const stale = AVGO_BLOCKS.some(block => payload.progress[block] === 'stale')
  const failureReason = errors.map(error => `${error.symbol}: ${error.reason}`).join(' · ')
  return { data: payload, errors, meta: { source: AVGO_SOURCE, fetchedAt: payload.fetchedAt,
    freshness: failed ? 'failed' : stale ? 'stale' : errors.length ? 'partial' : cached ? 'cached' : 'fresh',
    ...(failureReason ? { failureReason } : {}) } }
}
