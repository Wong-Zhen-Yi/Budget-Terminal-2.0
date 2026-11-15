import { CHANNELS } from '../shared/contract.js'
import { publishPageProgress } from './pageProgress.js'
import type { Envelope, EnvelopeError } from '../shared/contract.js'
import { GOOGL_BLOCKS, googlExhibitUrl, emptyGooglPayload, parseGooglReport } from '../shared/googl.js'
import type { GooglBlock, GooglEarnings, GooglPayload, GooglRequest } from '../shared/googl.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL, type TtlCache } from './cache.js'
import { fetchSecFilingSnapshot, fetchSecText } from './secEdgar.js'
import { getStocks } from './yahoo/stocks.js'

export const GOOGL_SOURCE = 'GOOGL market providers · SEC EDGAR'

export interface GooglDocumentFetchers {
  filings: typeof fetchSecFilingSnapshot
  text: typeof fetchSecText
}
const documentDefaults: GooglDocumentFetchers = { filings: fetchSecFilingSnapshot, text: fetchSecText }

export async function fetchGooglEarnings(force: boolean, sources: GooglDocumentFetchers = documentDefaults, storage: TtlCache = cache): Promise<GooglEarnings> {
  const warnings: string[] = []
  const snapshot = await sources.filings('1652044', force)
  const filings = snapshot.filings.filter(filing => filing.form === '8-K' && /\b2\.02\b/.test(filing.items)).sort((a, b) => b.filedDate.localeCompare(a.filedDate)).slice(0, 8)
  if (!filings.length) throw new Error('Alphabet earnings filings were not found.')
  warnings.push(...snapshot.warnings)
  const reports: GooglEarnings['reports'] = []
  // Bound the document fan-out; the SEC helper also applies its shared limiter.
  let next = 0
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < filings.length) {
      const filing = filings[next++]
      try {
        const result = await storage.resolve(`googl:sec-v2:report:${filing.accessionNumber}`, TTL.googlReports, async () => {
          const filingHtml = await sources.text(filing.documentUrl)
          const url = googlExhibitUrl(filingHtml, filing.documentUrl)
          return parseGooglReport(await sources.text(url), url, filing.filedDate)
        }, { force })
        reports.push(result.value)
      } catch (error) { warnings.push(`Earnings published ${filing.filedDate}: ${describeError(error)}`) }
    }
  }))
  if (!reports.length) throw new Error(warnings.join(' · ') || 'Alphabet earnings releases unavailable.')
  const byPeriod = new Map<string, GooglEarnings['reports'][number]>()
  for (const report of reports.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))) {
    if (!byPeriod.has(report.period)) byPeriod.set(report.period, report)
  }
  const unique = [...byPeriod.values()]
    .sort((a, b) => b.period.localeCompare(a.period)).slice(0, 8)
  if (unique.length < 8) warnings.push(`Only ${unique.length} of eight quarterly releases available.`)
  if (unique[0].publishedAt < filings[0].filedDate) warnings.push('The newest earnings release is unavailable; showing earlier results.')
  warnings.push(...unique.flatMap(report => report.warnings))
  return { reports: unique, warnings }
}

export interface GooglFetchers {
  market: typeof getStocks
  earnings: (force: boolean) => Promise<GooglEarnings>
}
const defaults: GooglFetchers = { market: getStocks, earnings: fetchGooglEarnings }

export async function getGoogl({ force = false }: GooglRequest = {}, fetchers: GooglFetchers = defaults, storage: TtlCache = cache): Promise<Envelope<GooglPayload>> {
  const payload = emptyGooglPayload()
  const errors: EnvelopeError[] = []
  let cached = false
  const lane = async <T>(block: GooglBlock, ttl: number, loader: () => Promise<T>, apply: (value: T) => string[]) => {
    try {
      const result = await storage.resolveWithStaleFallback(`googl:sec-v3:${block}`,
        entry => entry.warnings.length ? 10_000 : ttl,
        async () => {
          const value = await loader()
          return { value, fetchedAt: Date.now(), warnings: apply(value) }
        }, { force })
      const warnings = apply(result.value.value)
      if (result.stale) warnings.push('Refresh failed; showing cached data.')
      payload.progress[block] = result.stale || warnings.some(warning => /showing cached|using cached/i.test(warning)) ? 'stale' : warnings.length ? 'partial' : 'loaded'
      payload.laneFetchedAt[block] = result.value.fetchedAt
      cached ||= result.fromCache
      warnings.forEach(reason => errors.push(err(GOOGL_SOURCE, reason, `googl-${block}`, block)))
    } catch (error) { errors.push(err(GOOGL_SOURCE, describeError(error), `googl-${block}`, block)) } finally { publishPageProgress(payload, GOOGL_SOURCE, errors, CHANNELS.googl) }
  }
  await Promise.all([
    lane('market', TTL.googl, () => fetchers.market('GOOGL', force), result => {
      payload.market = result.payload
      return result.failures.map(failure => `${failure.block}: ${failure.reason}`)
    }),
    lane('earnings', TTL.googlReports, () => fetchers.earnings(force), result => {
      if (!result.reports.length) throw new Error('Alphabet quarterly results unavailable.')
      payload.earnings = result
      return [...result.warnings]
    }),
  ])
  const times = Object.values(payload.laneFetchedAt).filter((time): time is number => time !== null)
  payload.fetchedAt = times.length ? Math.min(...times) : Date.now()
  const failed = GOOGL_BLOCKS.every(block => payload.progress[block] === 'unavailable')
  const stale = GOOGL_BLOCKS.some(block => payload.progress[block] === 'stale')
  const failureReason = errors.map(error => `${error.symbol}: ${error.reason}`).join(' · ')
  return { data: payload, errors, meta: { source: GOOGL_SOURCE, fetchedAt: payload.fetchedAt,
    freshness: failed ? 'failed' : stale ? 'stale' : errors.length ? 'partial' : cached ? 'cached' : 'fresh',
    ...(failureReason ? { failureReason } : {}) } }
}
