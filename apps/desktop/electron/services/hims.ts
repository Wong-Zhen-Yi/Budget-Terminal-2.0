import type { Envelope, EnvelopeError } from '../shared/contract.js'
import { HIMS_BLOCKS, HIMS_CIK, HIMS_METRICS, emptyHimsPayload, himsEarningsFilings, himsExhibitUrl, parseHimsMetrics, parseHimsReport } from '../shared/hims.js'
import type { HimsBlock, HimsEarnings, HimsPayload, HimsRequest } from '../shared/hims.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL, type TtlCache } from './cache.js'
import { fetchSecFilingSnapshot, fetchSecText } from './secEdgar.js'
import { getStocks } from './yahoo/stocks.js'
import { getFundamentalsPage } from './yahoo/fundamentalsPage.js'

export const HIMS_SOURCE = 'Yahoo Finance · SEC EDGAR · Hims & Hers investor relations'
const QUARTERS = ['First', 'Second', 'Third', 'Fourth']
async function irRelease(period: string): Promise<{ html: string; url: string }> {
  const match = /^(20\d{2}) Q([1-4])$/.exec(period)
  if (!match) throw new Error('Invalid HIMS quarter.')
  const quarter = Number(match[2])
  const title = quarter === 4 ? `Fourth-Quarter-and-Full-Year-${match[1]}` : `${QUARTERS[quarter - 1]}-Quarter-${match[1]}`
  const url = `https://investors.hims.com/news/news-details/${Number(match[1]) + (quarter === 4 ? 1 : 0)}/Hims--Hers-Health-Inc--Reports-${title}-Financial-Results/default.aspx`
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`HIMS investor relations: HTTP ${response.status}`)
  if (new URL(response.url || url).hostname !== 'investors.hims.com') throw new Error('Unexpected HIMS report redirect.')
  return { html: await response.text(), url }
}
export interface HimsDocumentFetchers {
  filings: typeof fetchSecFilingSnapshot
  text: typeof fetchSecText
  ir: typeof irRelease
}
const documentDefaults: HimsDocumentFetchers = { filings: fetchSecFilingSnapshot, text: fetchSecText, ir: irRelease }

export async function fetchHimsEarnings(force: boolean, sources: HimsDocumentFetchers = documentDefaults, storage: TtlCache = cache): Promise<HimsEarnings> {
  const snapshot = await sources.filings(HIMS_CIK, force)
  const filings = himsEarningsFilings(snapshot.filings)
  if (!filings.length) throw new Error('HIMS earnings filings were not found.')
  const warnings = [...snapshot.warnings]
  const reports: HimsEarnings['reports'] = []
  let next = 0
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < filings.length) {
      const filing = filings[next++]
      try {
        const result = await storage.resolve(`hims:v1:report:${filing.accessionNumber}`, TTL.himsReports, async () => {
          try {
            const html = await sources.text(filing.documentUrl)
            const url = himsExhibitUrl(html, filing.documentUrl)
            const report = parseHimsReport(await sources.text(url), url, filing.filedDate)
            // A release can contain a mislabelled KPI table. Use the matching 10-Q/10-K,
            // with validated years, rather than guessing what its columns represent.
            if (report.warnings.length) {
              const [year, quarter] = report.period.split(' Q').map(Number)
              const endDate = `${year}-${['03-31', '06-30', '09-30', '12-31'][quarter - 1]}`
              const statement = snapshot.filings.find(entry => /^(?:10-Q|10-K)$/.test(entry.form) && entry.reportPeriod === endDate)
              if (statement) {
                try {
                  const supplemental = parseHimsMetrics(await sources.text(statement.documentUrl), year)
                  let supplemented = false
                  for (const spec of HIMS_METRICS) {
                    if (report.metrics[spec.id].value !== null || supplemental[spec.id].value === null) continue
                    report.metrics[spec.id] = supplemental[spec.id]
                    supplemented = true
                    report.warnings = report.warnings.filter(warning => !warning.startsWith(`${spec.label} unavailable`))
                  }
                  if (supplemented) report.supplementalSourceUrl = statement.documentUrl
                } catch { /* Keep explicit missing metrics when the supplementary filing fails. */ }
              }
            }
            return report
          } catch (secError) {
            const date = new Date(`${filing.filedDate}T00:00:00Z`)
            const quarter = Math.floor(date.getUTCMonth() / 3)
            try {
              const release = await sources.ir(`${date.getUTCFullYear() - (quarter === 0 ? 1 : 0)} Q${quarter || 4}`)
              return parseHimsReport(release.html, release.url, filing.filedDate)
            } catch (irError) { throw new Error(`SEC: ${describeError(secError)} · IR: ${describeError(irError)}`) }
          }
        }, { force })
        reports.push(result.value)
      } catch (error) { warnings.push(`Earnings published ${filing.filedDate}: ${describeError(error)}`) }
    }
  }))
  if (!reports.length) throw new Error(warnings.join(' · ') || 'HIMS earnings unavailable.')
  const byPeriod = new Map<string, HimsEarnings['reports'][number]>()
  for (const report of reports.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))) {
    if (!byPeriod.has(report.period)) byPeriod.set(report.period, report)
  }
  const unique = [...byPeriod.values()].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 8)
  if (unique[0].publishedAt < filings[0].filedDate) warnings.push('Newest HIMS earnings unavailable; showing earlier results.')
  if (unique.length < 8) warnings.push(`Only ${unique.length} of eight quarterly releases available.`)
  return { reports: unique, warnings: [...warnings, ...unique.flatMap(report => report.warnings)] }
}

export interface HimsFetchers {
  market: typeof getStocks
  financials: typeof getFundamentalsPage
  earnings: (force: boolean) => Promise<HimsEarnings>
}
const defaults: HimsFetchers = { market: getStocks, financials: getFundamentalsPage, earnings: fetchHimsEarnings }
export async function getHims({ force = false }: HimsRequest = {}, fetchers: HimsFetchers = defaults, storage: TtlCache = cache): Promise<Envelope<HimsPayload>> {
  const payload = emptyHimsPayload()
  const errors: EnvelopeError[] = []
  let cached = false
  const lane = async <T>(block: HimsBlock, ttl: number, loader: () => Promise<T>, apply: (value: T) => string[]) => {
    try {
      const result = await storage.resolveWithStaleFallback(`hims:v1:${block}`, ttl, async () => ({ value: await loader(), fetchedAt: Date.now() }), { force })
      const warnings = apply(result.value.value)
      if (result.stale) warnings.push('Refresh failed; showing cached data.')
      payload.progress[block] = result.stale || warnings.some(warning => /showing cached|using cached/i.test(warning)) ? 'stale' : warnings.length ? 'partial' : 'loaded'
      payload.laneFetchedAt[block] = result.value.fetchedAt
      cached ||= result.fromCache
      warnings.forEach(reason => errors.push(err(HIMS_SOURCE, reason, `hims-${block}`, block)))
    } catch (error) { errors.push(err(HIMS_SOURCE, describeError(error), `hims-${block}`, block)) }
  }
  await Promise.all([
    lane('market', TTL.hims, () => fetchers.market('HIMS', force), result => {
      payload.market = result.payload
      return result.failures.map(failure => `${failure.block}: ${failure.reason}`)
    }),
    lane('financials', TTL.hims, () => fetchers.financials('HIMS', force), result => {
      payload.financials = result.payload
      return [...result.failures.map(failure => `${failure.operation}: ${failure.reason}`), ...(result.stale ? ['Financial refresh failed; showing cached statements.'] : [])]
    }),
    lane('earnings', TTL.himsReports, () => fetchers.earnings(force), result => {
      if (!result.reports.length) throw new Error('HIMS quarterly results unavailable.')
      payload.earnings = result
      return [...result.warnings]
    }),
  ])
  const times = Object.values(payload.laneFetchedAt).filter((time): time is number => time !== null)
  payload.fetchedAt = times.length ? Math.min(...times) : Date.now()
  const failed = HIMS_BLOCKS.every(block => payload.progress[block] === 'unavailable')
  const stale = HIMS_BLOCKS.some(block => payload.progress[block] === 'stale')
  const failureReason = errors.map(error => `${error.symbol}: ${error.reason}`).join(' · ')
  return { data: payload, errors, meta: { source: HIMS_SOURCE, fetchedAt: payload.fetchedAt,
    freshness: failed ? 'failed' : stale ? 'stale' : errors.length ? 'partial' : cached ? 'cached' : 'fresh',
    ...(failureReason ? { failureReason } : {}) } }
}
