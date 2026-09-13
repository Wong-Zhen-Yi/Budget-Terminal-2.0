import type {
  RollCandidate,
  RollChartBar,
  RollCompanyInfo,
  RollNewsRow,
  RollPayload,
  RollQuote,
  RollRequest,
  RollTopOption,
} from '../../shared/contract.js'
import {
  applyRollPatternAnalysis,
  ROLL_CANDIDATE_LIMIT,
  ROLL_MAX_OPTION_EXPIRIES,
  ROLL_PATTERN_CANDIDATE_LIMIT,
  ROLL_PATTERN_MODES,
  rollCandidateFromQuote,
  rollQuoteIsScreenable,
  rollScreeningSummary,
  selectRollCandidate,
  type RollBar,
  type RollPatternMode,
} from '../../shared/roll.js'
import { cache } from '../cache.js'
import { paced, yahoo } from './client.js'
import { searchNews } from './newsPage.js'
import { equityRollScreen, type ScreenerQuote } from './screener.js'
import { getYahooSeries } from './series.js'

/**
 * The Roll page's data access, ported from `workers/random_recommender.py` (page18).
 *
 * Roll is a *dice throw over a screen*: it scores a sampled pool of liquid US equities,
 * optionally runs the six technical evaluators over a year of daily bars for each one, and
 * then draws one name weighted by score. Everything Yahoo goes through `paced()`.
 *
 * Three documented departures from the reference are here rather than in the maths:
 *
 * - **No progress or partial frames.** `RandomStockWorker` emits `progress` and `partial`
 *   signals so the Qt page fills in stage by stage; an IPC request/response carries no
 *   intermediate frames — the same wall the Crypto and Economic ports hit. One payload
 *   comes back and the page's status line reports the load.
 * - **A cancelled roll is discarded, not interrupted.** The reference threads a
 *   `_cancel_event` through every blocking call so a second Roll click kills the first
 *   mid-flight. An in-flight `ipcRenderer.invoke` cannot be cancelled, so a superseded
 *   roll is dropped by request id in the renderer and its Yahoo work still lands in the
 *   caches, where the next roll reuses it.
 * - **The balanced roll fetches one history, not thirty.** `_load_chart` hands the whole
 *   pool to `yf.download`, which is *one* request for thirty symbols; here it would be
 *   thirty paced requests to draw one chart. With patterns on, every candidate needs its
 *   own bars either way and the batch is unavoidable.
 */

export const ROLL_SOURCE = 'Yahoo Finance'

/** `_SCAN_CACHE_TTL_SECONDS` and friends. */
const SCREEN_TTL = 10 * 60_000
const HISTORY_TTL = 10 * 60_000
const OPTION_EXPIRY_TTL = 15 * 60_000
const OPTION_CHAIN_TTL = 5 * 60_000
const INFO_TTL = 12 * 60 * 60_000
const NEWS_TTL = 10 * 60_000

/** `_POOL_FETCH_SIZE`: how deep each ordering is read. */
const POOL_FETCH_SIZE = 80

const DAY = 24 * 60 * 60 * 1000

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === 'N/A') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = finiteOrNull(value)
    if (numeric !== null) return numeric
  }
  return null
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text && text !== 'N/A') return text
  }
  return ''
}

function normalizeModes(values: string[] | undefined): RollPatternMode[] {
  const allowed = new Set<string>(ROLL_PATTERN_MODES)
  const seen = new Set<RollPatternMode>()
  for (const value of values ?? []) {
    const mode = String(value ?? '').trim().toLowerCase()
    if (allowed.has(mode)) seen.add(mode as RollPatternMode)
  }
  return [...seen].sort()
}

function symbolSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => String(value ?? '').trim().toUpperCase()).filter(Boolean))
}

/* ---------------------------------------------------------------- screening */

interface ScreenBuckets {
  total: number
  buckets: Record<'liquidity' | 'momentum' | 'loser' | 'random', RollQuote[]>
}

const BUCKET_NAMES = ['liquidity', 'momentum', 'loser', 'random'] as const
type BucketName = (typeof BUCKET_NAMES)[number]

/**
 * `_fetch_screen_buckets`.
 *
 * Six fixed orderings plus up to four random offsets into the ticker-sorted screen, each
 * read `POOL_FETCH_SIZE` deep. The three ascending orderings matter: without the day's
 * and the year's losers in the pool, a downtrend or double-bottom search has nothing to
 * find but recent winners.
 */
async function fetchScreenBuckets(total: number): Promise<ScreenBuckets['buckets']> {
  const offsets = new Set<number>([0])
  if (total > POOL_FETCH_SIZE) {
    const maxOffset = Math.max(total - POOL_FETCH_SIZE, 0)
    for (let index = 0; index < 3; index += 1) {
      offsets.add(Math.floor(Math.random() * (maxOffset + 1)))
    }
  }
  const requests: Array<{ bucket: BucketName; sortField: string; sortAsc: boolean; offset: number }> = [
    { bucket: 'liquidity', sortField: 'intradaymarketcap', sortAsc: false, offset: 0 },
    { bucket: 'liquidity', sortField: 'avgdailyvol3m', sortAsc: false, offset: 0 },
    { bucket: 'momentum', sortField: 'percentchange', sortAsc: false, offset: 0 },
    { bucket: 'momentum', sortField: 'fiftytwowkpercentchange', sortAsc: false, offset: 0 },
    { bucket: 'loser', sortField: 'percentchange', sortAsc: true, offset: 0 },
    { bucket: 'loser', sortField: 'fiftytwowkpercentchange', sortAsc: true, offset: 0 },
    ...[...offsets]
      .sort((left, right) => left - right)
      .map((offset) => ({ bucket: 'random' as BucketName, sortField: 'ticker', sortAsc: true, offset })),
  ]
  const seenRequests = new Set<string>()
  const unique = requests.filter((request) => {
    const key = `${request.sortField}:${request.sortAsc}:${request.offset}`
    if (seenRequests.has(key)) return false
    seenRequests.add(key)
    return true
  })

  const settled = await Promise.allSettled(
    unique.map((request) =>
      equityRollScreen(request.sortField, request.sortAsc, request.offset, POOL_FETCH_SIZE),
    ),
  )

  // Each bucket is filled by interleaving its own slices, so two orderings that both feed
  // one bucket contribute alternately rather than one of them filling it outright.
  const slicesByBucket: Record<BucketName, ScreenerQuote[][]> = {
    liquidity: [],
    momentum: [],
    loser: [],
    random: [],
  }
  settled.forEach((outcome, index) => {
    if (outcome.status !== 'fulfilled') return
    slicesByBucket[unique[index].bucket].push(outcome.value.quotes)
  })

  const buckets: ScreenBuckets['buckets'] = { liquidity: [], momentum: [], loser: [], random: [] }
  for (const name of BUCKET_NAMES) {
    const slices = slicesByBucket[name]
    const positions = new Array<number>(slices.length).fill(0)
    const seen = new Set<string>()
    let added = true
    while (added) {
      added = false
      for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex += 1) {
        while (positions[sliceIndex] < slices[sliceIndex].length) {
          const quote = slices[sliceIndex][positions[sliceIndex]] as RollQuote
          positions[sliceIndex] += 1
          const symbol = (quote.symbol ?? '').trim().toUpperCase()
          if (!symbol || seen.has(symbol) || !rollQuoteIsScreenable(quote)) continue
          seen.add(symbol)
          buckets[name].push(quote)
          added = true
          break
        }
      }
    }
  }
  return buckets
}

/** `_screening_snapshot`: one cached universe read shared by every roll for ten minutes. */
async function screeningSnapshot(force: boolean): Promise<ScreenBuckets> {
  const resolved = await cache.resolve<ScreenBuckets>(
    'roll:universe:v1',
    SCREEN_TTL,
    async () => {
      const page = await equityRollScreen('ticker', true, 0, 1)
      const total = Math.max(0, page.total)
      if (total <= 0) throw new Error('No liquid US equity candidates were returned by the screener.')
      const buckets = await fetchScreenBuckets(total)
      if (!BUCKET_NAMES.some((name) => buckets[name].length)) {
        throw new Error('Could not find a scored candidate with usable quote data.')
      }
      return { total, buckets }
    },
    { force },
  )
  return resolved.value
}

/** `_round_robin_screen_quotes`: take one from each bucket in turn until the limit is met. */
function roundRobin(buckets: ScreenBuckets['buckets'], limit: number): RollQuote[] {
  const positions: Record<BucketName, number> = { liquidity: 0, momentum: 0, loser: 0, random: 0 }
  const selected: RollQuote[] = []
  const seen = new Set<string>()
  let added = true
  while (selected.length < limit && added) {
    added = false
    for (const name of BUCKET_NAMES) {
      const quotes = buckets[name]
      while (positions[name] < quotes.length) {
        const quote = quotes[positions[name]]
        positions[name] += 1
        const symbol = (quote.symbol ?? '').trim().toUpperCase()
        if (!symbol || seen.has(symbol)) continue
        seen.add(symbol)
        selected.push(quote)
        added = true
        break
      }
      if (selected.length >= limit) break
    }
  }
  return selected
}

/**
 * `_build_candidate_pool`.
 *
 * With patterns on the pool is round-robined across the four buckets so every ordering is
 * represented among the 120 histories that get downloaded; without them the buckets are
 * merged and ranked by quote score alone, and only the top 30 survive.
 */
function buildCandidatePool(
  snapshot: ScreenBuckets,
  modes: RollPatternMode[],
  excludeSymbols: Set<string>,
  historySymbols: Set<string>,
): RollCandidate[] {
  const limit = modes.length ? ROLL_PATTERN_CANDIDATE_LIMIT : ROLL_CANDIDATE_LIMIT
  let quotes: RollQuote[]
  if (modes.length) {
    quotes = roundRobin(snapshot.buckets, limit)
  } else {
    const bySymbol = new Map<string, RollQuote>()
    for (const name of BUCKET_NAMES) {
      for (const quote of snapshot.buckets[name]) {
        const symbol = (quote.symbol ?? '').trim().toUpperCase()
        if (symbol && !bySymbol.has(symbol)) bySymbol.set(symbol, quote)
      }
    }
    quotes = [...bySymbol.values()]
  }
  const candidates = quotes
    .map((quote) => rollCandidateFromQuote(quote, excludeSymbols, historySymbols))
    .filter((candidate): candidate is RollCandidate => candidate !== null)
  if (!modes.length) candidates.sort((left, right) => right.score - left.score)
  candidates.forEach((candidate, index) => {
    candidate.rank = index + 1
  })
  return candidates.slice(0, limit)
}

/* ------------------------------------------------------------------ history */

/**
 * The scheduled NYSE close for a session, in ET.
 *
 * The reference asks `pandas_market_calendars` and falls back to a plain weekday 16:00;
 * this repo has no market-calendar dependency, so only the fallback is ported. The cost is
 * an early-close session (the half day after Thanksgiving, Christmas Eve): between 13:00
 * and 16:00 ET that day the final bar is treated as partial and dropped, which loses one
 * completed session rather than admitting a partial one — the safer error of the two.
 */
function beforeSessionClose(barDate: string, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const field = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const today = `${field('year')}-${field('month')}-${field('day')}`
  if (barDate !== today) return false
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const hour = Number(field('hour')) % 24
  const minute = Number(field('minute'))
  return hour * 60 + minute < 16 * 60
}

interface ChartQuoteLike {
  date: Date
  open?: number | null
  high?: number | null
  low?: number | null
  close?: number | null
  adjclose?: number | null
  volume?: number | null
}

/**
 * `_normalize_history_frame`.
 *
 * The reference asks yfinance for unadjusted bars and then re-applies the adjustment
 * factor itself, so splits and dividends never show up as a pattern. Yahoo's chart
 * response carries both, so the same ratio is applied here — dropping it would read a
 * 2:1 split as a 50% single-session collapse and match every downtrend filter.
 */
function normalizeBars(quotes: ChartQuoteLike[]): RollBar[] {
  const byDate = new Map<string, RollBar>()
  for (const quote of quotes) {
    const rawClose = finiteOrNull(quote.close)
    const adjustedClose = finiteOrNull(quote.adjclose)
    const close = adjustedClose ?? rawClose
    const open = finiteOrNull(quote.open)
    const high = finiteOrNull(quote.high)
    const low = finiteOrNull(quote.low)
    const volume = finiteOrNull(quote.volume)
    if (close === null || open === null || high === null || low === null || volume === null) continue
    const time = quote.date?.getTime?.()
    if (!Number.isFinite(time)) continue
    const date = new Date(time).toISOString().slice(0, 10)
    const ratio = rawClose && adjustedClose ? adjustedClose / rawClose : 1
    const factor = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
    byDate.set(date, {
      date,
      open: open * factor,
      high: high * factor,
      low: low * factor,
      close,
      volume,
    })
  }
  const bars = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
  // Today's bar is still forming until the close; the reference drops it so a half-session
  // range cannot decide a consolidation or a breakout.
  if (bars.length && beforeSessionClose(bars[bars.length - 1].date)) bars.pop()
  return bars
}

/** `_PATTERN_HISTORY_PERIOD`: one year of daily bars per candidate. */
async function fetchHistory(symbol: string, force: boolean): Promise<RollBar[]> {
  const resolved = await cache.resolve<RollBar[]>(
    `roll:history:${symbol}`,
    HISTORY_TTL,
    async () => {
      const chart = await getYahooSeries({
        symbol,
        start: new Date(Date.now() - 370 * DAY),
        interval: '1d',
        force,
      })
      const bars = normalizeBars(chart.rows.map((row) => ({
        ...row,
        date: new Date(row.time * 1000),
      })) as ChartQuoteLike[])
      if (!bars.length) throw new Error(`No daily history returned for ${symbol}`)
      return bars
    },
    { force },
  )
  return resolved.value
}

/**
 * `_prepare_pattern_histories`.
 *
 * yfinance batches this into one `yf.download`; `yahoo-finance2` has no multi-symbol chart
 * endpoint that carries OHLCV, so it is one paced request per candidate — the same cost
 * profile as the Trading Volumes page, and the ten-minute cache is what makes a second
 * roll in the same session nearly free. A symbol whose history fails is kept in the pool
 * with no bars: every evaluator answers "unavailable" for it rather than dropping the row.
 */
async function prepareHistories(symbols: string[], force: boolean): Promise<Map<string, RollBar[]>> {
  const unique = [...new Set(symbols)]
  const settled = await Promise.allSettled(unique.map((symbol) => fetchHistory(symbol, force)))
  const histories = new Map<string, RollBar[]>()
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') histories.set(unique[index], outcome.value)
  })
  return histories
}

/* --------------------------------------------------------------- enrichment */

/** `_load_info` merged over `_fallback_info_from_quote`: the summary, then the screener quote. */
async function fetchInfo(symbol: string, quote: RollQuote, force: boolean): Promise<RollCompanyInfo> {
  let summary: Record<string, Record<string, unknown>> = {}
  try {
    const resolved = await cache.resolve(
      `roll:info:${symbol}`,
      INFO_TTL,
      async () =>
        (await paced(() =>
          yahoo.quoteSummary(symbol, {
            modules: ['price', 'summaryDetail', 'financialData', 'defaultKeyStatistics', 'assetProfile'],
          }),
        )) as unknown as Record<string, Record<string, unknown>>,
      { force },
    )
    summary = resolved.value ?? {}
  } catch {
    // `_load_info` treats a failed metadata refresh as a warning, not an error: the
    // screener quote already carries a name and a price, which is all the page needs.
    summary = {}
  }
  const price = summary.price ?? {}
  const detail = summary.summaryDetail ?? {}
  const financial = summary.financialData ?? {}
  const statistics = summary.defaultKeyStatistics ?? {}
  const profile = summary.assetProfile ?? {}

  const currentPrice = firstFinite(
    financial.currentPrice,
    price.regularMarketPrice,
    quote.regularMarketPrice,
    quote.regularMarketPreviousClose,
  )
  const previousClose = firstFinite(
    price.regularMarketPreviousClose,
    detail.previousClose,
    quote.regularMarketPreviousClose,
  )
  let change = firstFinite(price.regularMarketChange, quote.regularMarketChange)
  if (change === null && currentPrice !== null && previousClose) change = currentPrice - previousClose
  /**
   * The two sources disagree on units: the screener quote's `regularMarketChangePercent`
   * is already a percentage (-2.44), while `quoteSummary`'s price module returns the same
   * move as a fraction (-0.0244). Reading the summary's value straight through renders a
   * 2.4% down day as "-0.02%", so the percentage is derived from the change and the
   * previous close wherever both exist and only falls back to the screener's own figure.
   */
  let changePercent =
    change !== null && previousClose ? (change / previousClose) * 100 : null
  if (changePercent === null) changePercent = finiteOrNull(quote.regularMarketChangePercent)

  const website = firstText(profile.website)
  const irUrl =
    firstText(profile.irWebsite) || `https://www.google.com/search?q=${symbol}+investor+relations`

  return {
    name: firstText(price.longName, price.shortName, quote.longName, quote.shortName) || symbol,
    exchange:
      firstText(price.exchangeName, price.exchange, quote.fullExchangeName, quote.exchange) || 'N/A',
    sector: firstText(profile.sector) || 'N/A',
    industry: firstText(profile.industry) || 'N/A',
    currency: firstText(price.currency, financial.financialCurrency, quote.currency) || 'USD',
    price: currentPrice,
    previousClose,
    change,
    changePercent,
    marketCap: firstFinite(price.marketCap, detail.marketCap, quote.marketCap),
    revenue: firstFinite(financial.totalRevenue),
    profitMargin: firstFinite(financial.profitMargins, statistics.profitMargins),
    trailingPe: firstFinite(detail.trailingPE, quote.trailingPE),
    forwardPe: firstFinite(detail.forwardPE, statistics.forwardPE, quote.forwardPE),
    priceToSales: firstFinite(detail.priceToSalesTrailing12Months),
    beta: firstFinite(detail.beta, statistics.beta, quote.beta),
    dividendYield: firstFinite(detail.dividendYield, detail.trailingAnnualDividendYield, quote.dividendYield),
    fiftyTwoWeekLow: firstFinite(detail.fiftyTwoWeekLow, quote.fiftyTwoWeekLow),
    fiftyTwoWeekHigh: firstFinite(detail.fiftyTwoWeekHigh, quote.fiftyTwoWeekHigh),
    averageVolume: firstFinite(
      detail.averageVolume,
      detail.averageDailyVolume3Month,
      quote.averageDailyVolume3Month,
    ),
    meanTarget: firstFinite(financial.targetMeanPrice, quote.targetMeanPrice),
    website,
    irUrl,
  }
}

/** `_load_news`, filtered the way the Stocks page filters: Yahoo's own `relatedTickers`. */
async function fetchNews(symbol: string, force: boolean): Promise<{ rows: RollNewsRow[]; status: string }> {
  try {
    const resolved = await cache.resolve<RollNewsRow[]>(
      `roll:news:${symbol}`,
      NEWS_TTL,
      async () => {
        const articles = await searchNews(symbol, 20)
        return articles
          .filter((article) =>
            (article.relatedTickers ?? []).some((ticker) => ticker.trim().toUpperCase() === symbol),
          )
          .map((article) => ({
            ticker: symbol,
            title: article.title,
            source: article.publisher || 'N/A',
            url: article.link,
            publishedAt: article.providerPublishTime?.getTime() ?? 0,
          }))
          .sort((left, right) => right.publishedAt - left.publishedAt)
          .slice(0, 12)
      },
      { force },
    )
    return { rows: resolved.value, status: '' }
  } catch {
    return { rows: [], status: `Recent headlines could not be loaded for ${symbol}.` }
  }
}

/**
 * `_load_top_options`: the single highest-volume contract on each of the four nearest
 * expirations, calls and puts ranked together.
 */
async function fetchTopOptions(
  symbol: string,
  force: boolean,
): Promise<{ rows: RollTopOption[]; status: string }> {
  let expiries: string[]
  try {
    const resolved = await cache.resolve<string[]>(
      `roll:expiries:${symbol}`,
      OPTION_EXPIRY_TTL,
      async () => {
        const result = await paced(() => yahoo.options(symbol))
        return (result.expirationDates ?? []).map((date) => date.toISOString().slice(0, 10))
      },
      { force },
    )
    expiries = resolved.value
  } catch {
    return { rows: [], status: 'Top options unavailable: expirations could not be loaded.' }
  }
  if (!expiries.length) {
    return { rows: [], status: 'No options expirations were available for this ticker.' }
  }

  const scanned = expiries.slice(0, ROLL_MAX_OPTION_EXPIRIES)
  const settled = await Promise.allSettled(
    scanned.map((expiry) =>
      cache
        .resolve<RollTopOption | null>(
          `roll:chain:${symbol}:${expiry}`,
          OPTION_CHAIN_TTL,
          async () => {
            const result = await paced(() => yahoo.options(symbol, { date: expiry }))
            const chain = result.options?.[0]
            if (!chain) return null
            const rows = [
              ...((chain.calls ?? []) as Array<Record<string, unknown>>).map((contract) => ({
                contract,
                type: 'Call',
              })),
              ...((chain.puts ?? []) as Array<Record<string, unknown>>).map((contract) => ({
                contract,
                type: 'Put',
              })),
            ]
            if (!rows.length) return null
            // `sort_values(['volume', 'openInterest'], ascending=False).head(1)`: a missing
            // volume sorts last rather than winning by accident.
            rows.sort(
              (left, right) =>
                (finiteOrNull(right.contract.volume) ?? 0) - (finiteOrNull(left.contract.volume) ?? 0) ||
                (finiteOrNull(right.contract.openInterest) ?? 0) -
                  (finiteOrNull(left.contract.openInterest) ?? 0),
            )
            const top = rows[0]
            return {
              ticker: symbol,
              type: top.type,
              expiration: expiry,
              strike: finiteOrNull(top.contract.strike),
              lastPrice: finiteOrNull(top.contract.lastPrice),
              volume: finiteOrNull(top.contract.volume) ?? 0,
              openInterest: finiteOrNull(top.contract.openInterest) ?? 0,
              impliedVolatility: finiteOrNull(top.contract.impliedVolatility),
            }
          },
          { force },
        )
        .then((resolved) => resolved.value),
    ),
  )

  const rows: RollTopOption[] = []
  let failed = 0
  settled.forEach((outcome) => {
    if (outcome.status === 'fulfilled' && outcome.value) rows.push(outcome.value)
    else failed += 1
  })
  if (!rows.length) return { rows: [], status: 'Top options unavailable: near-term option-chain loads failed.' }
  const status = failed
    ? `Top options loaded for ${rows.length} of ${scanned.length} near-term expirations.`
    : ''
  return { rows, status }
}

/* ---------------------------------------------------------------- the roll */

/** `RandomStockWorker.fetch`: screen, score, optionally analyse, draw one, then enrich it. */
export async function getRoll(request: RollRequest = {}): Promise<RollPayload> {
  const force = Boolean(request.force)
  const modes = normalizeModes(request.patternModes)
  const excludeSymbols = symbolSet(request.excludeSymbols)
  const historySymbols = symbolSet(request.historySymbols)
  const targetSymbol = String(request.targetSymbol ?? '').trim().toUpperCase()

  let universeTotal = 0
  let pool: RollCandidate[]
  let quoteBySymbol = new Map<string, RollQuote>()

  if (targetSymbol) {
    // Re-opening a Roll History row skips the screen entirely, exactly as `fetch` does
    // when `target_symbol` is set: there is nothing to sample from.
    pool = [
      {
        rank: 0,
        symbol: targetSymbol,
        name: targetSymbol,
        sector: 'N/A',
        score: 0,
        reasons: ['selected candidate'],
        dayChangePct: null,
        fiftyTwoWeekChangePct: null,
        averageVolume: null,
        marketCap: null,
        matchTier: 'fallback',
        matchedModes: [],
        primaryPatternMode: '',
        patternMatch: false,
        patternType: 'None',
        patternScore: 0,
        patternReasons: [],
        patternFallbackReason: '',
        technicalSnapshot: {},
      },
    ]
  } else {
    const snapshot = await screeningSnapshot(force)
    universeTotal = snapshot.total
    pool = buildCandidatePool(snapshot, modes, excludeSymbols, historySymbols)
    if (!pool.length) throw new Error('Could not find a scored candidate with usable quote data.')
    quoteBySymbol = new Map(
      BUCKET_NAMES.flatMap((name) =>
        snapshot.buckets[name].map(
          (quote) => [(quote.symbol ?? '').trim().toUpperCase(), quote] as [string, RollQuote],
        ),
      ),
    )
  }

  const histories = new Map<string, RollBar[]>()
  if (modes.length && !targetSymbol) {
    const loaded = await prepareHistories(
      pool.map((candidate) => candidate.symbol),
      force,
    )
    for (const [symbol, bars] of loaded) histories.set(symbol, bars)
    const analysis = applyRollPatternAnalysis(pool, modes, histories)
    if (analysis.candidates.length) pool = analysis.candidates
  }

  const selected = selectRollCandidate(pool, {
    targetSymbol,
    excludeSymbols,
    historySymbols,
    patternActive: modes.length > 0,
  })
  if (!selected) throw new Error('Could not find a scored candidate with usable quote data.')

  const symbol = selected.symbol
  const quote = quoteBySymbol.get(symbol) ?? {}
  const warnings: string[] = []

  // The chart, the metadata, the headlines and the option chains are independent: a
  // failure in one leaves the rest of the workspace usable, as `_load_payload_for_candidate`
  // does with its four enrichment futures.
  const [historyResult, infoResult, newsResult, optionsResult] = await Promise.allSettled([
    histories.has(symbol) ? Promise.resolve(histories.get(symbol) as RollBar[]) : fetchHistory(symbol, force),
    fetchInfo(symbol, quote, force),
    fetchNews(symbol, force),
    fetchTopOptions(symbol, force),
  ])

  const chart: RollChartBar[] = historyResult.status === 'fulfilled' ? historyResult.value : []
  let chartStatus = ''
  if (!chart.length) {
    chartStatus = 'Chart history could not be loaded.'
    warnings.push(chartStatus)
  }

  const info: RollCompanyInfo =
    infoResult.status === 'fulfilled'
      ? infoResult.value
      : await fetchInfo(symbol, quote, false).catch(() => ({
          name: symbol,
          exchange: 'N/A',
          sector: 'N/A',
          industry: 'N/A',
          currency: 'USD',
          price: null,
          previousClose: null,
          change: null,
          changePercent: null,
          marketCap: null,
          revenue: null,
          profitMargin: null,
          trailingPe: null,
          forwardPe: null,
          priceToSales: null,
          beta: null,
          dividendYield: null,
          fiftyTwoWeekLow: null,
          fiftyTwoWeekHigh: null,
          averageVolume: null,
          meanTarget: null,
          website: '',
          irUrl: `https://www.google.com/search?q=${symbol}+investor+relations`,
        }))

  const news = newsResult.status === 'fulfilled' ? newsResult.value : { rows: [], status: '' }
  if (news.status) warnings.push(news.status)
  const options =
    optionsResult.status === 'fulfilled'
      ? optionsResult.value
      : { rows: [], status: 'Top options unavailable: near-term option-chain loads failed.' }
  if (options.status.startsWith('Top options unavailable')) warnings.push(options.status)

  if (!info.name || info.price === null) {
    throw new Error('Could not find a scored candidate with usable company and price data.')
  }

  return {
    symbol,
    info,
    candidatePool: pool,
    candidateRank: selected.rank,
    candidateScore: selected.score,
    candidateReasons: selected.reasons,
    universeTotal,
    screeningSummary: rollScreeningSummary(pool.length, universeTotal, modes, targetSymbol),
    patternModes: modes,
    matchTier: selected.matchTier,
    matchedModes: selected.matchedModes,
    primaryPatternMode: selected.primaryPatternMode,
    patternMatch: selected.patternMatch,
    patternType: selected.patternType,
    patternScore: selected.patternScore,
    patternReasons: selected.patternReasons,
    patternFallbackReason: selected.patternFallbackReason,
    technicalSnapshot: selected.technicalSnapshot,
    chart,
    chartStatus,
    topOptions: options.rows,
    topOptionsStatus: options.status,
    news: news.rows,
    newsStatus: news.status,
    warnings: [...new Set(warnings)],
    rolledAt: Date.now(),
  }
}
