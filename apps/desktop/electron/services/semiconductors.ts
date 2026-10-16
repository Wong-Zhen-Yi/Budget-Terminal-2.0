import type { Envelope, EnvelopeError, NewsArticle } from '../shared/contract.js'
import { describeError, err, meta } from '../shared/envelope.js'
import { SEMICONDUCTOR_CATALOG, SEMICONDUCTOR_REVIEW_DATE } from '../shared/semiconductorCatalog.js'
import { finite } from '../shared/semiconductors.js'
import type { SemiconductorCompany, SemiconductorMarket, SemiconductorProfile, SemiconductorRow, SemiconductorsPayload, SemiconductorsRequest } from '../shared/semiconductors.js'
import { cache, TTL, type TtlCache } from './cache.js'
import { paced, yahoo } from './yahoo/client.js'
import { getYahooSeries } from './yahoo/series.js'
import { withBackupSummary } from './yahoo/backup.js'
import { fetchPortfolioNews } from './yahoo/newsPage.js'

const SOURCE = 'Yahoo Finance · reviewed SEC company catalog'
const DAY = 86_400_000
type Lane = 'market' | 'profile' | 'news'
interface LaneData<T> { value: T; warnings: string[]; fetchedAt: number }
export interface SemiconductorFetchers {
  market: (symbol: string, force: boolean) => Promise<{ value: SemiconductorMarket; warnings: string[] }>
  profile: (symbol: string) => Promise<SemiconductorProfile>
  news: (symbol: string) => Promise<NewsArticle[]>
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function timestamp(value: unknown): number | null {
  if (value instanceof Date) return finite(value.getTime())
  const number = finite(value)
  return number === null ? null : number < 1e12 ? number * 1000 : number
}
const defaults: SemiconductorFetchers = {
  async market(symbol, force) {
    const [quote, series] = await Promise.allSettled([
      paced(() => yahoo.quote(symbol)),
      getYahooSeries({ symbol, start: new Date(Date.now() - 400 * DAY), interval: '1d', force }),
    ])
    const warnings: string[] = []
    const raw = quote.status === 'fulfilled' ? object(quote.value) : {}
    if (quote.status === 'rejected') warnings.push(`Quote failed: ${describeError(quote.reason)}`)
    const history = series.status === 'fulfilled' ? series.value.rows.flatMap(point => {
      // Raw prices must never silently replace split/dividend-adjusted closes.
      const close = finite(point.adjclose)
      return close !== null && close > 0 ? [{ date: new Date(point.time * 1000).toISOString().slice(0, 10), close }] : []
    }).sort((a, b) => a.date.localeCompare(b.date)) : []
    if (series.status === 'rejected') warnings.push(`History failed: ${describeError(series.reason)}`)
    else if (series.value.stale) warnings.push('History refresh failed; showing cached data.')
    if (!history.length) warnings.push('Adjusted price history unavailable.')
    if (finite(raw.regularMarketPrice) === null) warnings.push('Share price unavailable.')
    const price = finite(raw.regularMarketPrice)
    const previous = finite(raw.regularMarketPreviousClose)
    if (price === null && !history.length) throw new Error(warnings.join(' · '))
    return { value: { price, dailyChange: finite(raw.regularMarketChangePercent) ?? (price !== null && previous !== null && previous > 0 ? (price / previous - 1) * 100 : null),
      marketCap: finite(raw.marketCap), quoteTime: timestamp(raw.regularMarketTime), history }, warnings }
  },
  async profile(symbol) {
    const raw = await withBackupSummary(symbol, () => paced(() => yahoo.quoteSummary(symbol, { modules: ['assetProfile', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'calendarEvents'] })))
    const profile = object(raw.assetProfile)
    const detail = object(raw.summaryDetail)
    const statistics = object(raw.defaultKeyStatistics)
    const financial = object(raw.financialData)
    const calendar = object(object(raw.calendarEvents).earnings)
    const dates = Array.isArray(calendar.earningsDate) ? calendar.earningsDate.flatMap(value => timestamp(value) === null ? [] : [timestamp(value)!]).filter(date => date >= Date.now() - DAY).sort((a, b) => a - b) : []
    if (!raw.assetProfile && !raw.summaryDetail && !raw.financialData) throw new Error('Company profile unavailable.')
    return { description: typeof profile.longBusinessSummary === 'string' ? profile.longBusinessSummary : '',
      trailingPe: finite(detail.trailingPE), forwardPe: finite(detail.forwardPE) ?? finite(statistics.forwardPE),
      revenue: finite(financial.totalRevenue), revenueGrowth: finite(financial.revenueGrowth), grossMargin: finite(financial.grossMargins), earningsDate: dates[0] ?? null }
  },
  // The page owns a ten-minute stale-fallback cache. Refresh the underlying news
  // service on expiry so its fifteen-minute cache cannot extend this TTL.
  news: symbol => fetchPortfolioNews(symbol, true),
}

export function emptySemiconductorsPayload(companies: readonly SemiconductorCompany[] = SEMICONDUCTOR_CATALOG): SemiconductorsPayload {
  return { rows: companies.map(company => ({ company, market: null, profile: null, news: [],
    progress: { market: 'unavailable', profile: 'unavailable', news: 'unavailable' },
    fetchedAt: { market: null, profile: null, news: null } })), fetchedAt: 0, catalogReviewedAt: SEMICONDUCTOR_REVIEW_DATE }
}

export async function getSemiconductors({ force = false }: SemiconductorsRequest = {}, fetchers = defaults, storage: TtlCache = cache,
  companies: readonly SemiconductorCompany[] = SEMICONDUCTOR_CATALOG): Promise<Envelope<SemiconductorsPayload>> {
  const payload = emptySemiconductorsPayload(companies)
  const errors: EnvelopeError[] = []
  let cached = false
  const lane = async <T>(row: SemiconductorRow, block: Lane, ttl: number, loader: () => Promise<{ value: T; warnings: string[] }>, apply: (value: T) => void) => {
    try {
      const result = await storage.resolveWithStaleFallback<LaneData<T>>(`semiconductors:v1:${row.company.symbol}:${block}`, ttl,
        async () => ({ ...await loader(), fetchedAt: Date.now() }), { force })
      apply(result.value.value)
      const warnings = [...result.value.warnings]
      if (result.stale) warnings.push('Refresh failed; showing cached data.')
      row.progress[block] = result.stale || warnings.some(warning => /cached data/i.test(warning)) ? 'stale' : warnings.length ? 'partial' : 'loaded'
      row.fetchedAt[block] = Math.min(result.value.fetchedAt, result.snapshot?.fetchedAt ?? Infinity)
      cached ||= result.fromCache
      warnings.forEach(reason => errors.push(err(SOURCE, reason, `semiconductors-${block}`, row.company.symbol)))
    } catch (error) { errors.push(err(SOURCE, describeError(error), `semiconductors-${block}`, row.company.symbol)) }
  }
  // Bound the number of stock tasks; the shared rate gate additionally paces every
  // individual Yahoo request and reserves foreground capacity during startup.
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, payload.rows.length) }, async () => {
    while (cursor < payload.rows.length) {
      const row = payload.rows[cursor++]
      await Promise.all([
        lane(row, 'market', TTL.semiconductors, () => fetchers.market(row.company.symbol, force), value => { row.market = value }),
        lane(row, 'profile', TTL.profile, async () => ({ value: await fetchers.profile(row.company.symbol), warnings: [] }), value => { row.profile = value }),
        lane(row, 'news', TTL.news, async () => ({ value: await fetchers.news(row.company.symbol), warnings: [] }), value => { row.news = value }),
      ])
    }
  }))
  payload.fetchedAt = Date.now()
  const usable = payload.rows.some(row => row.market || row.profile)
  const freshness = !usable ? 'failed' : errors.length ? 'partial' : cached ? 'cached' : 'fresh'
  return { data: payload, meta: meta(SOURCE, freshness, {
    fetchedAt: Math.min(...payload.rows.flatMap(row => Object.values(row.fetchedAt).filter((time): time is number => time !== null)), payload.fetchedAt),
    ...(errors.length ? { failureReason: `${errors.length} data issue(s); inspect company and panel warnings.` } : {}),
  }), errors }
}
