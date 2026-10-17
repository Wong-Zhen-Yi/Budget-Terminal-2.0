import type { Envelope, EnvelopeError } from '../shared/contract.js'
import { AMZN_BLOCKS, amznEarningsFilings, amznExhibitUrl, amznPeriodBeforePublication, emptyAmznPayload, parseAmznReport } from '../shared/amzn.js'
import type { AmznBlock, AmznEarnings, AmznPayload, AmznRequest } from '../shared/amzn.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL, type TtlCache } from './cache.js'
import { fetchSecFilingSnapshot, fetchSecText } from './secEdgar.js'
import { getStocks } from './yahoo/stocks.js'
import { getFundamentalsPage } from './yahoo/fundamentalsPage.js'

export const AMZN_SOURCE = 'Yahoo Finance · SEC EDGAR'

export interface AmznDocumentFetchers {
  filings: typeof fetchSecFilingSnapshot
  text: typeof fetchSecText
}
const documentDefaults: AmznDocumentFetchers = { filings: fetchSecFilingSnapshot, text: fetchSecText }

export async function fetchAmznEarnings(force: boolean, sources: AmznDocumentFetchers = documentDefaults, storage: TtlCache = cache): Promise<AmznEarnings> {
  const warnings: string[] = []
  const snapshot = await sources.filings('1018724', force)
  const filings = amznEarningsFilings(snapshot.filings)
  if (!filings.length) throw new Error('Amazon earnings filings were not found.')
  warnings.push(...snapshot.warnings)
  const reports: AmznEarnings['reports'] = []
  // Bound the document fan-out; the SEC helper also applies its shared limiter.
  let next = 0
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < filings.length) {
      const filing = filings[next++]
      try {
        const result = await storage.resolve(`amzn:sec-v2:report:${filing.accessionNumber}`, TTL.amznReports, async () => {
          const period = amznPeriodBeforePublication(filing.filedDate)
          const filingHtml = await sources.text(filing.documentUrl)
          const url = amznExhibitUrl(filingHtml, filing.documentUrl)
          return parseAmznReport(await sources.text(url), url, filing.filedDate, period)
        }, { force })
        reports.push(result.value)
      } catch (error) { warnings.push(`Earnings published ${filing.filedDate}: ${describeError(error)}`) }
    }
  }))
  if (!reports.length) throw new Error(warnings.join(' · ') || 'Amazon earnings releases unavailable.')
  const byPeriod = new Map<string, AmznEarnings['reports'][number]>()
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

export interface AmznFetchers {
  market: typeof getStocks
  financials: typeof getFundamentalsPage
  earnings: (force: boolean) => Promise<AmznEarnings>
}
const defaults: AmznFetchers = { market: getStocks, financials: getFundamentalsPage, earnings: fetchAmznEarnings }

export async function getAmzn({ force = false }: AmznRequest = {}, fetchers: AmznFetchers = defaults, storage: TtlCache = cache): Promise<Envelope<AmznPayload>> {
  const payload = emptyAmznPayload()
  const errors: EnvelopeError[] = []
  let cached = false
  const lane = async <T>(block: AmznBlock, ttl: number, loader: () => Promise<T>, apply: (value: T) => string[]) => {
    try {
      const result = await storage.resolveWithStaleFallback(`amzn:sec-v2:${block}`, ttl,
        async () => ({ value: await loader(), fetchedAt: Date.now() }), { force })
      const warnings = apply(result.value.value)
      if (result.stale) warnings.push('Refresh failed; showing cached data.')
      payload.progress[block] = result.stale || warnings.some(warning => /showing cached|using cached/i.test(warning)) ? 'stale' : warnings.length ? 'partial' : 'loaded'
      payload.laneFetchedAt[block] = result.value.fetchedAt
      cached ||= result.fromCache
      warnings.forEach(reason => errors.push(err(AMZN_SOURCE, reason, `amzn-${block}`, block)))
    } catch (error) { errors.push(err(AMZN_SOURCE, describeError(error), `amzn-${block}`, block)) }
  }
  await Promise.all([
    lane('market', TTL.amzn, () => fetchers.market('AMZN', force), result => {
      payload.market = result.payload
      return result.failures.map(failure => `${failure.block}: ${failure.reason}`)
    }),
    lane('financials', TTL.amzn, () => fetchers.financials('AMZN', force), result => {
      payload.financials = result.payload
      return [...result.failures.map(failure => `${failure.operation}: ${failure.reason}`), ...(result.stale ? ['Financial refresh failed; showing cached statements.'] : [])]
    }),
    lane('earnings', TTL.amznReports, () => fetchers.earnings(force), result => {
      if (!result.reports.length) throw new Error('Amazon quarterly results unavailable.')
      payload.earnings = result
      return [...result.warnings]
    }),
  ])
  const times = Object.values(payload.laneFetchedAt).filter((time): time is number => time !== null)
  payload.fetchedAt = times.length ? Math.min(...times) : Date.now()
  const failed = AMZN_BLOCKS.every(block => payload.progress[block] === 'unavailable')
  const stale = AMZN_BLOCKS.some(block => payload.progress[block] === 'stale')
  const failureReason = errors.map(error => `${error.symbol}: ${error.reason}`).join(' · ')
  return { data: payload, errors, meta: { source: AMZN_SOURCE, fetchedAt: payload.fetchedAt,
    freshness: failed ? 'failed' : stale ? 'stale' : errors.length ? 'partial' : cached ? 'cached' : 'fresh',
    ...(failureReason ? { failureReason } : {}) } }
}
