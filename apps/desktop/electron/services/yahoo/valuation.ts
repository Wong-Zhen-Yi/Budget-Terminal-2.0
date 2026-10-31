import type {
  EnvelopeError,
  FundamentalSeriesMap,
  FundamentalSeriesPoint,
  ValuationPayload,
  ValuationProvenanceEntry,
} from '../../shared/contract.js'
import { emptyFundamentalSeriesMap } from '../../shared/fundamentalsPage.js'
import { describeError } from '../../shared/envelope.js'
import {
  deriveValuationSuggestions,
  finiteOrNull,
  type ValuationAnalystEstimates,
  type ValuationMetrics,
  type ValuationPeerRow,
  type ValuationTrends,
} from '../../shared/valuation.js'
import {
  buildPeerRow,
  normalizePeerSymbols,
  peerCandidateSymbols,
  peerInfoHasUsableData,
  peerSymbols,
  type PeerInfo,
} from '../../shared/valuationPeers.js'
import { cache, TTL } from '../cache.js'
import { fetchRiskFreeSnapshot } from '../riskFree.js'
import { paced, yahoo } from './client.js'
import { withYahooSummary } from './requests.js'
import { getFundamentalsPage } from './fundamentalsPage.js'
import { getYahooSeries } from './series.js'
import { getQuote } from './quotes.js'
import { equityMarket } from '../../shared/equityMarkets.js'

/**
 * The Valuation page's data load, ported from `workers/valuation.py`
 * (`fetch_company_analysis_payload`).
 *
 * Two things are deliberately *not* re-implemented here. The statements come from
 * `getFundamentalsPage`, which already merges SEC EDGAR XBRL over Yahoo's own frames and
 * caches the result — the reference calls `fetch_company_bundle` and `merge_sec_frames`
 * by hand for exactly that, so the Fundamentals page and this one now share one statement
 * layer and one cache entry. And the risk-free rate comes from `riskFree.ts`, outside
 * `paced()` because treasury.gov is not Yahoo.
 *
 * Everything derived from those inputs — the ratio block, the five-year trends, the
 * assumption derivation — is pure and lives in `shared/valuation.ts`, so the probe and the
 * renderer compute the same numbers this does.
 */

export const VALUATION_SOURCE = 'Yahoo Finance + SEC EDGAR valuation'

/** One Yahoo request per peer candidate, so the candidate list is the request budget. */
const PEER_INFO_TTL = TTL.profile

/**
 * Yahoo quotes a handful of listings in the minor unit (pence, cents, agorot) while the
 * statements stay in the major unit, and it spells the minor unit by lower-casing the last
 * letter: `GBp` against `GBP`. Those two are 100x apart, so the codes below are compared
 * case-sensitively while every other pair is compared case-insensitively.
 */
const MINOR_UNIT_CURRENCY_CODES = new Set(['GBp', 'ZAc', 'ILA'])

function currencyCode(value: unknown): string {
  const text = String(value ?? '').trim()
  return /^[A-Za-z]{2,4}$/.test(text) ? text : ''
}

/**
 * Whether a quote price and a statement-derived value share a unit.
 *
 * An unknown code on either side returns true: a missing `financialCurrency` is the common
 * case for US issuers and must not raise a warning on its own.
 */
function currenciesAgree(quoteCurrency: string, statementCurrency: string): boolean {
  if (!quoteCurrency || !statementCurrency) return true
  if (quoteCurrency === statementCurrency) return true
  if (MINOR_UNIT_CURRENCY_CODES.has(quoteCurrency) || MINOR_UNIT_CURRENCY_CODES.has(statementCurrency)) {
    return false
  }
  return quoteCurrency.toUpperCase() === statementCurrency.toUpperCase()
}

/** Preserve valid zero values while applying source precedence. */
function prefer(primary: number | null, fallback: number | null): number | null {
  return primary !== null ? primary : fallback
}

function latestPoint(series: FundamentalSeriesPoint[] | undefined): number | null {
  const sorted = [...(series ?? [])].sort((left, right) => left.endDate.localeCompare(right.endDate))
  return sorted.length ? finiteOrNull(sorted[sorted.length - 1].value) : null
}

/**
 * Sum the latest four quarters, but only when they are actually consecutive.
 *
 * `_latest_complete_quarter_sum` rejects gaps outside 50-140 days: a restated or missing
 * quarter would otherwise be silently summed with one from a different year and reported
 * as a trailing twelve months.
 */
function completeQuarterTtm(series: FundamentalSeriesPoint[] | undefined): number | null {
  const sorted = [...(series ?? [])]
    .filter((point) => Number.isFinite(point.value) && point.endDate)
    .sort((left, right) => right.endDate.localeCompare(left.endDate))
  if (sorted.length < 4) return null
  const latest = sorted.slice(0, 4)
  for (let index = 0; index < 3; index += 1) {
    const gap =
      (Date.parse(`${latest[index].endDate}T00:00:00Z`) -
        Date.parse(`${latest[index + 1].endDate}T00:00:00Z`)) /
      86_400_000
    if (!Number.isFinite(gap) || gap < 50 || gap > 140) return null
  }
  return latest.reduce((sum, point) => sum + point.value, 0)
}

/** Resolve a reported flow as complete-quarter TTM, then the latest annual filing. */
function reportedFlow(
  quarterly: FundamentalSeriesMap,
  annual: FundamentalSeriesMap,
  key: keyof FundamentalSeriesMap,
): number | null {
  const ttm = completeQuarterTtm(quarterly[key])
  return ttm !== null ? ttm : latestPoint(annual[key])
}

/** Resolve a reported instant as the latest quarterly point, then the latest annual one. */
function reportedInstant(
  quarterly: FundamentalSeriesMap,
  annual: FundamentalSeriesMap,
  key: keyof FundamentalSeriesMap,
): number | null {
  const value = latestPoint(quarterly[key])
  return value !== null ? value : latestPoint(annual[key])
}

interface SummaryInfo extends PeerInfo {
  symbol: string
  currency?: string | null
  financialCurrency?: string | null
  previousClose?: number | null
  enterpriseValue?: number | null
  totalRevenue?: number | null
  netIncomeToCommon?: number | null
  ebitda?: number | null
  operatingCashflow?: number | null
  sharesOutstanding?: number | null
  totalCash?: number | null
  totalDebt?: number | null
  trailingEps?: number | null
  priceToBook?: number | null
  pegRatio?: number | null
  dividendYield?: number | null
  beta?: number | null
}

/** The `earningsTrend` rows keyed by symbol, so the anchor's estimates survive a cache hit. */
const analystCache = new Map<string, Array<Record<string, unknown>>>()

/** A cancelled transport can be transient; each attempt still uses Yahoo's rate gate. */
async function retryInterrupted<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (!/^(AbortError|TimeoutError)$/.test(name) && !/\b(aborted|timed out)\b/i.test(describeError(error))) throw error
    return request()
  }
}

async function fetchInfo(symbol: string, force: boolean): Promise<SummaryInfo> {
  const resolved = await cache.resolveWithStaleFallback(
    `valuation-info:${symbol}`,
    PEER_INFO_TTL,
    async () => {
      const summary = await withYahooSummary(symbol, () => retryInterrupted(() => paced(() =>
        yahoo.quoteSummary(symbol, {
          modules: [
            'price',
            'summaryDetail',
            'financialData',
            'defaultKeyStatistics',
            'assetProfile',
            'quoteType',
            'earningsTrend',
          ],
        }),
      )))
      const price = summary.price
      const detail = summary.summaryDetail
      const financial = summary.financialData
      const statistics = summary.defaultKeyStatistics
      const profile = summary.assetProfile
      const info: SummaryInfo = {
        symbol,
        shortName: price?.shortName ?? null,
        longName: price?.longName ?? null,
        sector: profile?.sector ?? null,
        industry: profile?.industry ?? null,
        quoteType: summary.quoteType?.quoteType ?? price?.quoteType ?? null,
        currency: price?.currency ?? detail?.currency ?? null,
        financialCurrency: financial?.financialCurrency ?? null,
        currentPrice: finiteOrNull(financial?.currentPrice),
        regularMarketPrice: finiteOrNull(price?.regularMarketPrice),
        previousClose: finiteOrNull(detail?.previousClose ?? price?.regularMarketPreviousClose),
        marketCap: finiteOrNull(price?.marketCap ?? detail?.marketCap),
        enterpriseValue: finiteOrNull(statistics?.enterpriseValue),
        totalRevenue: finiteOrNull(financial?.totalRevenue),
        netIncomeToCommon: finiteOrNull(statistics?.netIncomeToCommon),
        ebitda: finiteOrNull(financial?.ebitda),
        operatingCashflow: finiteOrNull(financial?.operatingCashflow),
        freeCashflow: finiteOrNull(financial?.freeCashflow),
        sharesOutstanding: finiteOrNull(statistics?.sharesOutstanding ?? statistics?.impliedSharesOutstanding),
        totalCash: finiteOrNull(financial?.totalCash),
        totalDebt: finiteOrNull(financial?.totalDebt),
        trailingEps: finiteOrNull(statistics?.trailingEps),
        trailingPE: finiteOrNull(detail?.trailingPE ?? statistics?.trailingPE),
        forwardPE: finiteOrNull(financial?.forwardPE ?? statistics?.forwardPE),
        priceToBook: finiteOrNull(statistics?.priceToBook),
        pegRatio: finiteOrNull(statistics?.pegRatio ?? statistics?.trailingPegRatio),
        dividendYield: finiteOrNull(detail?.dividendYield),
        enterpriseToEbitda: finiteOrNull(statistics?.enterpriseToEbitda),
        profitMargins: finiteOrNull(financial?.profitMargins ?? statistics?.profitMargins),
        revenueGrowth: finiteOrNull(financial?.revenueGrowth),
        beta: finiteOrNull(detail?.beta ?? statistics?.beta),
      }
      return { info, trend: summary.earningsTrend?.trend ?? [] }
    },
    { force },
  )
  analystCache.set(symbol, resolved.value.trend)
  if (equityMarket(symbol)) {
    try {
      const quote = await getQuote(symbol, force)
      return { ...resolved.value.info, currentPrice: quote.price, regularMarketPrice: quote.price }
    } catch { /* Retain the dated company snapshot; source health records the quote failure. */ }
  }
  return resolved.value.info
}

/**
 * Normalize Yahoo's analyst trend into plain percentages.
 *
 * Yahoo reports these growth figures as decimal fractions, so every value is scaled by 100
 * here — the valuation maths works in percentage points throughout. Yahoo leaves the
 * stock's own long-term (+5y) trend empty for most tickers, so that leg is usually absent
 * and the next-year estimate carries the blend.
 */
function analystEstimates(trend: Array<Record<string, unknown>>): ValuationAnalystEstimates {
  const byPeriod = new Map(trend.map((row) => [String(row.period ?? ''), row]))
  const estimateOf = (period: string, field: string): number | null => {
    const row = byPeriod.get(period)
    if (!row) return null
    const estimate = row.earningsEstimate as Record<string, unknown> | undefined
    return finiteOrNull(estimate?.[field])
  }
  const longTerm = finiteOrNull(byPeriod.get('+5y')?.growth)
  const nextYear = estimateOf('+1y', 'growth')
  const currentYear = estimateOf('0y', 'growth')
  const analystCount = estimateOf('+1y', 'numberOfAnalysts')
  const estimates: ValuationAnalystEstimates = {
    longTermGrowthPct: longTerm === null ? null : longTerm * 100,
    nextYearGrowthPct: nextYear === null ? null : nextYear * 100,
    currentYearGrowthPct: currentYear === null ? null : currentYear * 100,
    analystCount: analystCount === null ? null : Math.trunc(analystCount),
    source: 'Yahoo analyst earnings trend',
    available: false,
  }
  estimates.available = [
    estimates.longTermGrowthPct,
    estimates.nextYearGrowthPct,
    estimates.currentYearGrowthPct,
  ].some((value) => value !== null)
  return estimates
}

/**
 * Every ratio below divides a quoted figure by a reported one. When the two currencies
 * differ the quotient is meaningless, so it is withheld rather than shown at the wrong
 * scale — the same rule `_extract_metrics` applies.
 */
function extractMetrics(
  symbol: string,
  info: SummaryInfo,
  annual: FundamentalSeriesMap,
  quarterly: FundamentalSeriesMap,
  fallbackPrice: number | null,
  preferStatements: boolean,
): ValuationMetrics {
  const quoteCurrency = currencyCode(info.currency)
  const statementCurrency = currencyCode(info.financialCurrency)
  const currencyMismatch = !currenciesAgree(quoteCurrency, statementCurrency)
  const price =
    finiteOrNull(info.currentPrice) ?? finiteOrNull(info.regularMarketPrice) ??
    finiteOrNull(info.previousClose) ?? fallbackPrice
  const marketCap = finiteOrNull(info.marketCap)

  const pick = (reported: number | null, quoted: number | null): number | null =>
    preferStatements ? prefer(reported, quoted) : prefer(quoted, reported)

  const revenue = pick(reportedFlow(quarterly, annual, 'revenue'), finiteOrNull(info.totalRevenue))
  const netIncome = pick(
    reportedFlow(quarterly, annual, 'netIncome'),
    finiteOrNull(info.netIncomeToCommon),
  )
  const ebitda = finiteOrNull(info.ebitda)
  const operatingCashFlow = pick(
    reportedFlow(quarterly, annual, 'operatingCashFlow'),
    finiteOrNull(info.operatingCashflow),
  )
  const freeCashFlow = pick(
    reportedFlow(quarterly, annual, 'freeCashFlow'),
    finiteOrNull(info.freeCashflow),
  )
  const shares = pick(
    reportedInstant(quarterly, annual, 'sharesOutstanding'),
    finiteOrNull(info.sharesOutstanding),
  )
  let eps = finiteOrNull(info.trailingEps)
  if (eps === null && netIncome !== null && shares) eps = netIncome / shares
  const fcfPerShare = freeCashFlow !== null && shares ? freeCashFlow / shares : null
  const cash = pick(reportedInstant(quarterly, annual, 'cashAndBonds'), finiteOrNull(info.totalCash))
  const debt = pick(reportedInstant(quarterly, annual, 'totalDebt'), finiteOrNull(info.totalDebt))

  let enterpriseValue = finiteOrNull(info.enterpriseValue)
  if (enterpriseValue === null && marketCap !== null && !currencyMismatch) {
    // marketCap is quoted, debt and cash are reported: summing them across a currency
    // split would produce a number with no unit at all.
    enterpriseValue = marketCap + (debt ?? 0) - (cash ?? 0)
  }

  const basisType = fcfPerShare !== null && fcfPerShare > 0 ? 'FCF' : 'EPS'
  const basisValue = basisType === 'FCF' ? fcfPerShare : eps
  const dividendYield = finiteOrNull(info.dividendYield)
  const revenueGrowth = finiteOrNull(info.revenueGrowth)
  return {
    ticker: symbol,
    companyName: String(info.longName ?? info.shortName ?? '').trim() || symbol,
    sector: String(info.sector ?? '').trim() || 'N/A',
    industry: String(info.industry ?? '').trim() || 'N/A',
    currency: quoteCurrency || null,
    financialCurrency: statementCurrency || null,
    currencyMismatch,
    price,
    previousClose: finiteOrNull(info.previousClose),
    marketCap,
    enterpriseValue,
    revenue,
    netIncome,
    ebitda,
    operatingCashFlow,
    freeCashFlow,
    shares,
    eps,
    fcfPerShare,
    basisType,
    basisValue,
    cash,
    debt,
    netDebt: debt !== null || cash !== null ? (debt ?? 0) - (cash ?? 0) : null,
    pe: price !== null && eps !== null && eps > 0 && !currencyMismatch ? price / eps : null,
    forwardPe: finiteOrNull(info.forwardPE),
    ps: marketCap && revenue && revenue > 0 && !currencyMismatch ? marketCap / revenue : null,
    pb: finiteOrNull(info.priceToBook),
    evEbitda:
      enterpriseValue && ebitda && ebitda > 0 && !currencyMismatch ? enterpriseValue / ebitda : null,
    fcfYield:
      freeCashFlow !== null && marketCap && !currencyMismatch
        ? (freeCashFlow / marketCap) * 100
        : null,
    earningsYield: price && eps && eps > 0 && !currencyMismatch ? (eps / price) * 100 : null,
    peg: finiteOrNull(info.pegRatio),
    dividendYield: dividendYield === null ? null : dividendYield * 100,
    netMargin: netIncome !== null && revenue ? (netIncome / revenue) * 100 : null,
    revenueGrowth: revenueGrowth === null ? null : revenueGrowth * 100,
    beta: finiteOrNull(info.beta),
  }
}

function annualPoints(series: FundamentalSeriesPoint[] | undefined): Array<[string, number]> {
  return [...(series ?? [])]
    .sort((left, right) => left.endDate.localeCompare(right.endDate))
    .map((point): [string, number] => [point.endDate.slice(0, 4), point.value])
    .filter(([label]) => label.length === 4)
    .slice(-5)
}

/**
 * The five-year revenue / EPS / FCF trend, and the count of comparable annual periods that
 * sizes the model quality and the margin of safety.
 *
 * `_build_trends` divides each period by that period's diluted average share count and
 * falls back to today's share count when it has none. The merged statement map here
 * carries `sharesOutstanding` rather than a diluted average, which is a documented
 * departure: it is the same instant the reference's balance-sheet fallback reads, and the
 * approximate flag is raised the same way whenever no period figure exists at all.
 */
function buildTrends(annual: FundamentalSeriesMap, metrics: ValuationMetrics): ValuationTrends {
  const revenuePoints = annualPoints(annual.revenue)
  const netIncomePoints = annualPoints(annual.netIncome)
  const freeCashFlowPoints = annualPoints(annual.freeCashFlow)
  const sharePoints = new Map(annualPoints(annual.sharesOutstanding).filter(([, value]) => value > 0))
  const labels = (revenuePoints.length ? revenuePoints : netIncomePoints).map(([label]) => label)
  const currentShares = metrics.shares ?? 0
  let usedCurrentShareFallback = false

  const perShare = (points: Array<[string, number]>): Array<number | null> => {
    const map = new Map(points)
    return labels.map((label) => {
      const value = map.get(label)
      const periodShares = sharePoints.get(label)
      if (value === undefined) return null
      if (periodShares) return value / periodShares
      if (currentShares) {
        usedCurrentShareFallback = true
        return value / currentShares
      }
      return null
    })
  }

  const epsSeries = perShare(netIncomePoints)
  const fcfMap = new Map(freeCashFlowPoints)
  const fcfPerShareSeries = perShare(freeCashFlowPoints)
  const basisSeries = metrics.basisType === 'FCF' ? fcfPerShareSeries : epsSeries
  const revenueMap = new Map(revenuePoints)
  return {
    labels,
    revenue: labels.map((label) => revenueMap.get(label) ?? null),
    eps: epsSeries,
    fcf: labels.map((label) => fcfMap.get(label) ?? null),
    fcfPerShare: fcfPerShareSeries,
    perShareApproximate: usedCurrentShareFallback,
    perShareSource:
      sharePoints.size && !usedCurrentShareFallback
        ? 'Period reported shares outstanding'
        : 'Current shares fallback (approximate)',
    comparableHistoryPoints: basisSeries.filter((value) => value !== null && value > 0).length,
  }
}

async function peerInfo(symbol: string, force: boolean): Promise<SummaryInfo | null> {
  try {
    return await fetchInfo(symbol, force)
  } catch {
    return null
  }
}

async function buildPeerRows(
  symbol: string,
  info: SummaryInfo,
  customPeers: string[],
  force: boolean,
): Promise<{ rows: ValuationPeerRow[]; warnings: string[] }> {
  const infos: Record<string, PeerInfo> = { [symbol]: info }
  const warnings: string[] = []
  // Concurrently, like the auto candidates below: each is one paced Yahoo request, and
  // waiting them out one at a time made a five-peer list five round trips deep.
  const custom = await Promise.all(customPeers.map((peer) => peerInfo(peer, force)))
  customPeers.forEach((peer, index) => {
    const loaded = custom[index]
    if (loaded && peerInfoHasUsableData(loaded)) infos[peer] = loaded
    else warnings.push(`${peer} returned no usable peer data.`)
  })
  const candidates = peerCandidateSymbols(symbol, info).filter((peer) => !(peer in infos))
  const loaded = await Promise.all(candidates.map((peer) => peerInfo(peer, force)))
  candidates.forEach((peer, index) => {
    infos[peer] = loaded[index] ?? {}
  })
  const usableCustom = customPeers.filter((peer) => peer in infos)
  const rows = peerSymbols(symbol, info, infos, usableCustom).map((peer) =>
    buildPeerRow(
      peer,
      infos[peer] ?? {},
      peer === symbol ? 'Loaded' : usableCustom.includes(peer) ? 'Custom' : 'Auto',
    ),
  )
  return { rows, warnings }
}

/**
 * The five-year monthly close series behind the price-vs-fair-value band and the
 * historical P/E curve. The reference asks `history(period='5y', interval='1mo')`.
 */
async function fetchPriceHistory(symbol: string, force: boolean): Promise<Array<{ date: string; close: number }>> {
  const period1 = new Date(Date.now() - 5 * 365 * 24 * 60 * 60_000)
  const result = await getYahooSeries({ symbol, start: period1, interval: '1mo', force })
  return result.rows
    .map((row) => ({
      date: new Date(row.time * 1000).toISOString().slice(0, 10),
      close: finiteOrNull(row.close),
    }))
    .filter((point): point is { date: string; close: number } => Boolean(point.date) && point.close !== null)
}

/**
 * Describe where one valuation input actually came from.
 *
 * A documented departure from `_selected_sec_provenance`: this repo's SEC layer normalizes
 * XBRL into series points that keep the source but not the tag or the accession number, so
 * the citation names the source, the basis and the period rather than the filing. The
 * distinction the page needs — SEC-reported versus Yahoo metadata, and TTM versus a single
 * annual filing — survives intact.
 */
function provenanceFor(
  label: string,
  quarterly: FundamentalSeriesMap,
  annual: FundamentalSeriesMap,
  key: keyof FundamentalSeriesMap,
  flow: boolean,
  secBacked: boolean,
): ValuationProvenanceEntry {
  const yahooEntry: ValuationProvenanceEntry = {
    metric: label,
    source: 'Yahoo Finance',
    basis: 'Yahoo metadata or statement fallback',
    period: '',
    facts: [],
  }
  if (!secBacked) return yahooEntry
  const quarterlyPoints = [...(quarterly[key] ?? [])].sort((left, right) =>
    right.endDate.localeCompare(left.endDate),
  )
  if (flow && completeQuarterTtm(quarterly[key]) !== null) {
    const latest = quarterlyPoints.slice(0, 4)
    return {
      metric: label,
      source: 'SEC EDGAR',
      basis: 'TTM from four complete quarters',
      period: `${latest[3].endDate} to ${latest[0].endDate}`,
      facts: [...latest].reverse().map((point) => `${point.label} (${point.source})`),
    }
  }
  const annualPointsSorted = [...(annual[key] ?? [])].sort((left, right) =>
    right.endDate.localeCompare(left.endDate),
  )
  if (flow && annualPointsSorted.length) {
    const latest = annualPointsSorted[0]
    return {
      metric: label,
      source: 'SEC EDGAR',
      basis: 'Latest annual filing',
      period: latest.endDate,
      facts: [`${latest.label} (${latest.source})`],
    }
  }
  if (!flow) {
    const instants = [...quarterlyPoints, ...annualPointsSorted].sort((left, right) =>
      right.endDate.localeCompare(left.endDate),
    )
    if (instants.length) {
      return {
        metric: label,
        source: 'SEC EDGAR',
        basis: 'Latest reported instant',
        period: instants[0].endDate,
        facts: [`${instants[0].label} (${instants[0].source})`],
      }
    }
  }
  return yahooEntry
}

const PROVENANCE_ROWS: Array<[string, keyof FundamentalSeriesMap, boolean]> = [
  ['Revenue', 'revenue', true],
  ['Net income', 'netIncome', true],
  ['Operating cash flow', 'operatingCashFlow', true],
  ['Free cash flow', 'freeCashFlow', true],
  ['Cash and equivalents', 'cashAndBonds', false],
  ['Debt', 'totalDebt', false],
  ['Shares', 'sharesOutstanding', false],
]

/** The shape the page paints before a load, and the shape a failed load falls back to. */
export function emptyValuation(symbol: string): ValuationPayload {
  const metrics: ValuationMetrics = {
    ticker: symbol,
    companyName: symbol || 'Valuation',
    sector: 'N/A',
    industry: 'N/A',
    currency: null,
    financialCurrency: null,
    currencyMismatch: false,
    price: null,
    previousClose: null,
    marketCap: null,
    enterpriseValue: null,
    revenue: null,
    netIncome: null,
    ebitda: null,
    operatingCashFlow: null,
    freeCashFlow: null,
    shares: null,
    eps: null,
    fcfPerShare: null,
    basisType: 'FCF',
    basisValue: null,
    cash: null,
    debt: null,
    netDebt: null,
    pe: null,
    forwardPe: null,
    ps: null,
    pb: null,
    evEbitda: null,
    fcfYield: null,
    earningsYield: null,
    peg: null,
    dividendYield: null,
    netMargin: null,
    revenueGrowth: null,
    beta: null,
  }
  const trends: ValuationTrends = {
    labels: [],
    revenue: [],
    eps: [],
    fcf: [],
    fcfPerShare: [],
    perShareApproximate: false,
    perShareSource: '',
    comparableHistoryPoints: 0,
  }
  const analyst: ValuationAnalystEstimates = {
    longTermGrowthPct: null,
    nextYearGrowthPct: null,
    currentYearGrowthPct: null,
    analystCount: null,
    source: 'Yahoo analyst earnings trend',
    available: false,
  }
  return {
    ticker: symbol,
    metrics,
    trends,
    priceHistory: [],
    market: null,
    analyst,
    suggestions: deriveValuationSuggestions(metrics, trends, 'FCF'),
    peerRows: [],
    peerWarnings: [],
    customPeers: [],
    statementSource: 'Yahoo Finance',
    secBacked: false,
    provenance: [],
    sources: { quote: '', statements: '', computed: '', suggestions: '' },
    generatedAt: 0,
  }
}

export interface ValuationFetchResult {
  payload: ValuationPayload
  errors: EnvelopeError[]
  stale: boolean
  fromCache: boolean
  cacheAgeSeconds: number
}

interface ValuationFetchers {
  info: typeof fetchInfo
  statements: typeof getFundamentalsPage
  history: typeof fetchPriceHistory
  market: typeof fetchRiskFreeSnapshot
  peers: typeof buildPeerRows
}

async function fetchUncached(
  symbol: string,
  customPeers: string[],
  force: boolean,
  fetchers: ValuationFetchers = {
    info: fetchInfo,
    statements: getFundamentalsPage,
    history: fetchPriceHistory,
    market: fetchRiskFreeSnapshot,
    peers: buildPeerRows,
  },
): Promise<{ payload: ValuationPayload; errors: EnvelopeError[] }> {
  const errors: EnvelopeError[] = []
  const info = await fetchers.info(symbol, force)
  const analyst = analystEstimates(analystCache.get(symbol) ?? [])

  const [statementsResult, historyResult, marketResult] = await Promise.allSettled([
    fetchers.statements(symbol, force),
    fetchers.history(symbol, force),
    fetchers.market(force),
  ])

  let annual: FundamentalSeriesMap | null = null
  let quarterly: FundamentalSeriesMap | null = null
  let secBacked = false
  let statementSource = 'Yahoo Finance'
  if (statementsResult.status === 'fulfilled') {
    annual = statementsResult.value.payload.annual
    quarterly = statementsResult.value.payload.quarterly
    secBacked = statementsResult.value.payload.sec.statementsAvailable
    statementSource = secBacked ? 'SEC EDGAR' : 'Yahoo Finance'
    for (const failure of statementsResult.value.failures) {
      errors.push({ ...failure, symbol })
    }
    if (statementsResult.value.stale && !statementsResult.value.failures.length) {
      errors.push({ source: statementSource, operation: 'statements', symbol, reason: 'Using cached statements because the source refresh failed.' })
    }
  } else {
    errors.push({
      source: VALUATION_SOURCE,
      reason: describeError(statementsResult.reason),
      operation: 'statements',
      symbol: 'Statements',
    })
  }
  const annualMap = annual ?? emptyFundamentalSeriesMap()
  const quarterlyMap = quarterly ?? emptyFundamentalSeriesMap()

  const priceHistory = historyResult.status === 'fulfilled' ? historyResult.value : []
  if (historyResult.status === 'rejected') {
    errors.push({
      source: VALUATION_SOURCE,
      reason: describeError(historyResult.reason),
      operation: 'history',
      symbol: 'Price history',
    })
  }
  const market = marketResult.status === 'fulfilled' ? marketResult.value : null
  if (!market) {
    errors.push({
      source: 'US Treasury',
      reason: 'The 10Y Treasury yield was unavailable; the required return uses the heuristic baseline.',
      operation: 'riskFree',
      symbol: 'Risk-free rate',
    })
  }

  const metrics = extractMetrics(
    symbol,
    info,
    annualMap,
    quarterlyMap,
    priceHistory.length ? priceHistory[priceHistory.length - 1].close : null,
    secBacked,
  )
  if (metrics.price === null) {
    throw new Error(`No quote data found for '${symbol}'. Check the ticker symbol.`)
  }

  const peers = await fetchers.peers(symbol, info, customPeers, force)
  const trends = buildTrends(annualMap, metrics)
  const suggestions = deriveValuationSuggestions(metrics, trends, metrics.basisType, {
    market,
    analyst,
    peerRows: peers.rows,
  })

  return {
    payload: {
      ticker: symbol,
      metrics,
      trends,
      priceHistory,
      market,
      analyst,
      suggestions,
      peerRows: peers.rows,
      peerWarnings: peers.warnings,
      customPeers,
      statementSource,
      secBacked,
      provenance: PROVENANCE_ROWS.map(([label, key, flow]) =>
        provenanceFor(label, quarterlyMap, annualMap, key, flow, secBacked),
      ),
      sources: {
        quote: 'Yahoo Finance quote and 5-year monthly history',
        statements: secBacked
          ? 'SEC EDGAR XBRL with Yahoo Finance fallback'
          : 'Yahoo Finance financial statements',
        computed: 'Computed from quote, statements, and assumptions',
        suggestions: [
          secBacked
            ? 'SEC-backed consecutive annual statements and Yahoo quote metadata'
            : 'Consecutive annual statements and Yahoo quote metadata',
          market
            ? `${market.tenor} Treasury yield (${market.freshness}) for CAPM`
            : 'no risk-free rate, so the required return falls back to a heuristic',
          analyst.available ? 'Yahoo analyst earnings trend for near-term growth' : 'no analyst estimates',
          `${peers.rows.length} peer rows for the exit multiple`,
        ].join('; '),
      },
      generatedAt: Date.now(),
    },
    errors,
  }
}

/**
 * One valuation load. Cached on the symbol *and* its custom peer list, because adding a
 * peer changes the exit multiple and therefore every derived assumption downstream of it.
 */
export async function getValuation(
  symbolInput: string,
  customPeersInput: string[] = [],
  force = false,
): Promise<ValuationFetchResult> {
  const symbol = symbolInput.trim().toUpperCase()
  if (!symbol) throw new Error('Enter a ticker to load valuation data.')
  const customPeers = normalizePeerSymbols(customPeersInput, symbol)
  const resolved = await cache.resolveWithStaleFallback(
    `valuation:equity-perps-v1:${symbol}:${customPeers.join(',')}`,
    TTL.profile,
    () => fetchUncached(symbol, customPeers, force),
    { force },
  )
  const priceErrors: EnvelopeError[] = []
  const quote = equityMarket(symbol) ? await getQuote(symbol, force).catch(error => {
    priceErrors.push({ source: 'market prices', operation: 'quote', symbol, reason: `Current price refresh failed: ${describeError(error)}` })
    return undefined
  }) : undefined
  return {
    payload: quote ? { ...resolved.value.payload, metrics: { ...resolved.value.payload.metrics, price: quote.price },
      sources: { ...resolved.value.payload.sources, quote: `${quote.source}; Yahoo stock monthly history` } } : resolved.value.payload,
    errors: [...resolved.value.errors, ...priceErrors],
    stale: resolved.stale,
    fromCache: resolved.fromCache,
    cacheAgeSeconds: resolved.ageSeconds,
  }
}

export const valuationTesting = {
  analystEstimates,
  buildTrends,
  completeQuarterTtm,
  currenciesAgree,
  extractMetrics,
  fetchInfo,
  fetchUncached,
  provenanceFor,
  retryInterrupted,
}
