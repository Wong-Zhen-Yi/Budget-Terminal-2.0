import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  SignalCandidate,
  SignalRegime,
  SignalResult,
  SignalsPayload,
  SignalsRequest,
  SignalValidation,
} from '../../shared/contract.js'
import {
  alignBenchmark,
  calculateIndicators,
  completedMedianDollarVolume,
  dataErrorSignal,
  evaluateDailySignalAtIndex,
  evaluateSignal,
  neutralRegime,
  rankSignalCandidates,
  usExtendedSessionOpen,
  scoreRegime,
  signalBacktestSamples,
  signalCandidateFromQuote,
  summarizeBacktestSamples,
  SIGNAL_CONFIG,
  SIGNAL_CONFIRM_LIMIT,
  SIGNAL_EXCHANGES,
  SIGNAL_MINIMUM_DOLLAR_VOLUME,
  SIGNAL_SCREEN_OFFSETS,
  SIGNAL_SCREEN_PAGE_SIZE,
  SIGNAL_SCREEN_TARGET,
  type AlignedBenchmark,
  type BacktestSample,
  type CalculatedBar,
  type SignalBar,
  type SignalQuoteCandidate,
  type SignalFrames,
  type SignalRole,
} from '../../shared/signals.js'
import { cache } from '../cache.js'
import { paced, yahoo } from './client.js'
import { equitySignalsScreen } from './screener.js'

export const SIGNALS_SOURCE = 'Yahoo Finance'

const DAY = 24 * 60 * 60 * 1000
const UNIVERSE_TTL = DAY
const BENCHMARK_SYMBOL = 'SPY'
const VOLATILITY_SYMBOL = '^VIX'

interface UniversePayload {
  candidates: SignalCandidate[]
  sourcedAt: string
  sourceCandidateCount: number
  prefilteredCount: number
  confirmedCount: number
  rejectedCandidateCount: number
  passedFilterCount: number
}

interface RoleRequest {
  interval: '1d' | '1h' | '5m' | '1m'
  lookbackDays: number
  ttlMs: number
}

const ROLE_REQUESTS: Record<SignalRole, RoleRequest> = {
  trend: { interval: '1d', lookbackDays: 730, ttlMs: 4 * 60 * 60 * 1000 },
  momentum: { interval: '1h', lookbackDays: 180, ttlMs: 15 * 60 * 1000 },
  setup: { interval: '5m', lookbackDays: 30, ttlMs: 2 * 60 * 1000 },
  entry: { interval: '1m', lookbackDays: 7, ttlMs: 45 * 1000 },
}

let latestPayload: SignalsPayload | null = null

function latestSignalsPath(): string {
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'signals-latest-v4.json')
}

function validStoredPayload(value: unknown): value is SignalsPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<SignalsPayload>
  const age = Date.now() - Date.parse(String(payload.completedAt ?? ''))
  return (
    Array.isArray(payload.candidates) &&
    Array.isArray(payload.results) &&
    Array.isArray(payload.validation) &&
    Boolean(payload.regime) &&
    Number.isFinite(age) &&
    age >= 0 &&
    age <= 7 * DAY
  )
}

async function saveLatestSignals(payload: SignalsPayload): Promise<void> {
  const target = latestSignalsPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(payload), 'utf8')
  await rename(temporary, target)
}

function localSessionDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function finite(value: unknown): number | null {
  // Number(null) and Number('') are both 0, so an absent high or volume would otherwise
  // arrive as a real zero: a null high turns one true range into the whole price.
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

interface ChartResultLike {
  quotes: Array<{
    date: Date
    open?: number | null
    high?: number | null
    low?: number | null
    close?: number | null
    adjclose?: number | null
    volume?: number | null
  }>
}

function chartBars(result: ChartResultLike): SignalBar[] {
  const byTimestamp = new Map<number, SignalBar>()
  for (const quote of result.quotes) {
    const rawClose = finite(quote.close)
    const adjustedClose = finite(quote.adjclose)
    const close = adjustedClose ?? rawClose
    if (close === null) continue
    const timestamp = quote.date.getTime()
    if (!Number.isFinite(timestamp)) continue
    const ratio = rawClose && adjustedClose ? adjustedClose / rawClose : 1
    const scaled = (value: unknown) => {
      const numeric = finite(value)
      return numeric === null ? null : numeric * ratio
    }
    byTimestamp.set(timestamp, {
      timestamp,
      open: scaled(quote.open),
      high: scaled(quote.high),
      low: scaled(quote.low),
      close,
      volume: finite(quote.volume),
    })
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp)
}

async function fetchBars(
  symbol: string,
  request: RoleRequest,
  force: boolean,
  cacheRole: string,
): Promise<SignalBar[]> {
  const key = `signals:${cacheRole}:${symbol}:${request.interval}:${request.lookbackDays}`
  const result = await cache.resolve(
    key,
    request.ttlMs,
    async () => {
      const period1 = new Date(Date.now() - request.lookbackDays * DAY)
      const chart = await paced(() => yahoo.chart(symbol, { period1, interval: request.interval }))
      const bars = chartBars(chart as ChartResultLike)
      if (!bars.length) throw new Error(`No ${request.interval} history returned`)
      return bars
    },
    { force },
  )
  return result.value
}

async function fetchRole(
  symbols: string[],
  role: SignalRole,
  force: boolean,
): Promise<{ frames: Record<string, SignalBar[]>; errors: Record<string, string> }> {
  const request = ROLE_REQUESTS[role]
  const settled = await Promise.allSettled(
    symbols.map((symbol) => fetchBars(symbol, request, force, role)),
  )
  const frames: Record<string, SignalBar[]> = {}
  const errors: Record<string, string> = {}
  settled.forEach((outcome, index) => {
    const symbol = symbols[index]
    if (outcome.status === 'fulfilled') frames[symbol] = outcome.value
    else errors[symbol] = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
  })
  return { frames, errors }
}

/**
 * Page the screener rather than taking one top-100 slice.
 *
 * A single market-cap page returns the same mega-caps every day, so the shortlist could
 * never contain anything the user had not already seen. A failed page degrades the pool
 * instead of failing the scan, exactly as `screenEquityUniverse` handles its twelve.
 */
async function screenCandidates(): Promise<{ screened: number; rows: SignalQuoteCandidate[] }> {
  const settled = await Promise.allSettled(
    SIGNAL_SCREEN_OFFSETS.map((offset) =>
      equitySignalsScreen(5, 2e9, SIGNAL_EXCHANGES, SIGNAL_SCREEN_PAGE_SIZE, offset),
    ),
  )
  const bySymbol = new Map<string, SignalQuoteCandidate>()
  let screened = 0
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue
    screened += outcome.value.quotes.length
    for (const quote of outcome.value.quotes) {
      const row = signalCandidateFromQuote(quote)
      if (row && !bySymbol.has(row.ticker)) bySymbol.set(row.ticker, row)
    }
  }
  if (!screened) throw new Error('The Yahoo equity screener returned no rows')
  return { screened, rows: [...bySymbol.values()].slice(0, SIGNAL_SCREEN_TARGET) }
}

/**
 * Source the universe in two stages.
 *
 * Stage one prefilters on the screener's own average-volume fields, which costs no
 * requests — the reference downloaded a daily chart per candidate to learn the same thing.
 * Stage two buys 730 days of daily history for the survivors under the `trend` cache key
 * the scoring pass will reuse, confirms liquidity from those same bars, and scores the
 * daily sub-model so intraday history is only bought for names that earned it.
 */
async function sourceUniverse(force: boolean): Promise<UniversePayload & { fromCache: boolean }> {
  const sessionDate = localSessionDate()
  const resolved = await cache.resolve(
    `signals:universe:${sessionDate}`,
    UNIVERSE_TTL,
    async () => {
      const { screened, rows } = await screenCandidates()
      const prefiltered = rows
        .filter((row) => row.estimatedDollarVolume >= SIGNAL_MINIMUM_DOLLAR_VOLUME)
        .sort((left, right) => right.estimatedDollarVolume - left.estimatedDollarVolume)
      const confirming = prefiltered.slice(0, SIGNAL_CONFIRM_LIMIT)

      const daily = ROLE_REQUESTS.trend
      const benchmark = await fetchBars(BENCHMARK_SYMBOL, daily, force, 'trend').catch(() => [] as SignalBar[])
      const settled = await Promise.allSettled(
        confirming.map((row) => fetchBars(row.ticker, daily, force, 'trend')),
      )

      const passed: SignalCandidate[] = []
      confirming.forEach((row, index) => {
        const outcome = settled[index]
        if (outcome.status !== 'fulfilled') return
        const bars = outcome.value
        const medianDollarVolume = completedMedianDollarVolume(bars, sessionDate)
        if (medianDollarVolume === null || medianDollarVolume < SIGNAL_MINIMUM_DOLLAR_VOLUME) return
        const calculated = calculateIndicators(bars)
        const aligned = benchmark.length ? alignBenchmark(calculated, benchmark) : null
        const preScore = evaluateDailySignalAtIndex(calculated, calculated.length - 1, aligned)
        passed.push({
          ...row,
          medianDollarVolume,
          dailyPreScore: preScore.fraction,
          qualityRank: 1,
          reasons: [
            `Market cap $${(row.marketCap / 1e9).toFixed(1)}B`,
            `20-session median dollar volume $${(medianDollarVolume / 1e6).toFixed(1)}M`,
            `Daily sub-model scored ${preScore.score.toFixed(1)}/${preScore.maxScore} before intraday data`,
            `Listed on ${row.exchange}`,
          ],
        })
      })

      const candidates = rankSignalCandidates(passed)
      return {
        candidates,
        sourcedAt: new Date().toISOString(),
        sourceCandidateCount: screened,
        prefilteredCount: prefiltered.length,
        confirmedCount: passed.length,
        rejectedCandidateCount: Math.max(0, screened - passed.length),
        passedFilterCount: passed.length,
      }
    },
    { force },
  )
  return { ...resolved.value, fromCache: resolved.fromCache }
}

/**
 * Measure the daily sub-model against what actually happened next.
 *
 * This runs over the daily frames the scan already downloaded, so it costs nothing beyond
 * arithmetic, and it is the only claim on this page that is observed rather than asserted.
 */
function buildValidation(
  frames: Record<string, SignalBar[]>,
  tickers: string[],
  benchmark: SignalBar[],
): SignalValidation[] {
  const prepared: Array<{ rows: CalculatedBar[]; aligned: AlignedBenchmark | null }> = []
  for (const ticker of tickers) {
    const bars = frames[ticker]
    if (!bars || bars.length <= SIGNAL_CONFIG.backtestWarmup) continue
    const rows = calculateIndicators(bars)
    prepared.push({ rows, aligned: benchmark.length ? alignBenchmark(rows, benchmark) : null })
  }
  if (!prepared.length) return []
  return SIGNAL_CONFIG.backtestHorizons.map((horizon) => {
    const samples: BacktestSample[] = prepared.flatMap((entry) =>
      signalBacktestSamples(entry.rows, entry.aligned, horizon),
    )
    return summarizeBacktestSamples(samples, horizon, prepared.length)
  })
}

export async function getLatestSignals(): Promise<SignalsPayload | null> {
  if (latestPayload) return latestPayload
  try {
    const value: unknown = JSON.parse(await readFile(latestSignalsPath(), 'utf8'))
    latestPayload = validStoredPayload(value) ? value : null
  } catch {
    latestPayload = null
  }
  return latestPayload
}

export async function clearLatestSignals(): Promise<void> {
  latestPayload = null
  // The superseded documents are never read, but Clear cache should not leave them behind.
  const current = latestSignalsPath()
  const targets = [current, ...['-v3.json', '-v2.json'].map((old) => current.replace('-v4.json', old))]
  for (const target of targets) {
    try {
      await unlink(target)
    } catch {
      // A cache file that does not exist is already cleared.
    }
  }
}

/** Source the liquid universe, collect four timeframes, and isolate failures per ticker. */
export async function getSignals(request: SignalsRequest = {}): Promise<SignalsPayload> {
  const startedAt = new Date().toISOString()
  const universe = await sourceUniverse(Boolean(request.forceUniverseRefresh))
  if (!universe.candidates.length) {
    throw new Error('No liquid US equities passed the automatic universe filters')
  }
  const force = Boolean(request.forceMarketRefresh)
  const tickers = universe.candidates.map((candidate) => candidate.ticker)
  const symbolsByRole: Record<SignalRole, string[]> = {
    // The benchmark drives relative strength and the regime; the volatility index only the
    // regime. Both ride the daily cache the universe pass already warmed.
    trend: [...tickers, BENCHMARK_SYMBOL, VOLATILITY_SYMBOL],
    momentum: tickers,
    setup: tickers,
    entry: tickers,
  }
  const [trend, momentum, setup, entry] = await Promise.all(
    (Object.keys(symbolsByRole) as SignalRole[]).map((role) =>
      fetchRole(symbolsByRole[role], role, force),
    ),
  )
  const roleResults = { trend, momentum, setup, entry }
  const benchmark = roleResults.trend.frames[BENCHMARK_SYMBOL] ?? []
  const volatility = roleResults.trend.frames[VOLATILITY_SYMBOL] ?? []
  const regime: SignalRegime = benchmark.length
    ? scoreRegime(benchmark, volatility, BENCHMARK_SYMBOL)
    : neutralRegime(`Market regime was not scored: no usable ${BENCHMARK_SYMBOL} history.`)

  // Resolved once so every result in a scan agrees on the session, even if the run straddles
  // 20:00 ET — a table where half the rows say MARKET_CLOSED and half say STALE_DATA would
  // read as a feed fault rather than a closing bell.
  const marketOpen = usExtendedSessionOpen(Date.now())

  const results: SignalResult[] = tickers.map((ticker) => {
    const frames = Object.fromEntries(
      (Object.keys(roleResults) as SignalRole[]).map((role) => [role, roleResults[role].frames[ticker] ?? []]),
    ) as SignalFrames
    try {
      return evaluateSignal(ticker, frames, {
        benchmark,
        benchmarkSymbol: BENCHMARK_SYMBOL,
        regime,
        marketOpen,
      })
    } catch (error) {
      return dataErrorSignal(
        ticker,
        `Signal calculation failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
  const errors = Object.fromEntries(
    results.flatMap((result) => result.error ? [[result.ticker, result.error]] : []),
  )
  latestPayload = {
    candidates: universe.candidates,
    results,
    source: SIGNALS_SOURCE,
    sourcedAt: universe.sourcedAt,
    startedAt,
    completedAt: new Date().toISOString(),
    sourceCandidateCount: universe.sourceCandidateCount,
    prefilteredCount: universe.prefilteredCount,
    confirmedCount: universe.confirmedCount,
    rejectedCandidateCount: universe.rejectedCandidateCount,
    passedFilterCount: universe.passedFilterCount,
    regime,
    validation: buildValidation(roleResults.trend.frames, tickers, benchmark),
    errors,
    universeFromCache: universe.fromCache,
  }
  try {
    await saveLatestSignals(latestPayload)
  } catch {
    // A cache write must not turn a healthy live scan into a failed scan.
  }
  return latestPayload
}
