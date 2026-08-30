import type {
  SignalCandidate,
  SignalResult,
  SignalsPayload,
  SignalsRequest,
} from '../../shared/contract.js'
import {
  completedMedianDollarVolume,
  dataErrorSignal,
  evaluateSignal,
  rankSignalCandidates,
  SIGNAL_EXCHANGES,
  SIGNAL_SOURCE_LIMIT,
  signalCandidateFromQuote,
  type SignalBar,
  type SignalFrames,
  type SignalRole,
} from '../../shared/signals.js'
import { cache } from '../cache.js'
import { paced, yahoo } from './client.js'
import { equitySignalsScreen } from './screener.js'

export const SIGNALS_SOURCE = 'Yahoo Finance'

const DAY = 24 * 60 * 60 * 1000
const UNIVERSE_TTL = DAY

interface UniversePayload {
  candidates: SignalCandidate[]
  sourcedAt: string
  sourceCandidateCount: number
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
  return join(appData, 'BudgetTerminalElectron', 'signals-latest-v2.json')
}

function validStoredPayload(value: unknown): value is SignalsPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<SignalsPayload>
  const age = Date.now() - Date.parse(String(payload.completedAt ?? ''))
  return (
    Array.isArray(payload.candidates) &&
    Array.isArray(payload.results) &&
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

async function sourceUniverse(force: boolean): Promise<UniversePayload & { fromCache: boolean }> {
  const sessionDate = localSessionDate()
  const resolved = await cache.resolve(
    `signals:universe:${sessionDate}`,
    UNIVERSE_TTL,
    async () => {
      const page = await equitySignalsScreen(5, 2e9, SIGNAL_EXCHANGES, SIGNAL_SOURCE_LIMIT)
      const quoteRows = page.quotes.flatMap((quote) => {
        const row = signalCandidateFromQuote(quote)
        return row ? [row] : []
      })
      const liquidity = await Promise.all(
        quoteRows.map(async (row) => {
          try {
            const bars = await fetchBars(
              row.ticker,
              { interval: '1d', lookbackDays: 90, ttlMs: UNIVERSE_TTL },
              force,
              'liquidity',
            )
            return completedMedianDollarVolume(bars, sessionDate)
          } catch {
            return null
          }
        }),
      )
      const passed: SignalCandidate[] = []
      quoteRows.forEach((row, index) => {
        const medianDollarVolume = liquidity[index]
        if (medianDollarVolume === null || medianDollarVolume < 20e6) return
        passed.push({
          ...row,
          medianDollarVolume,
          qualityRank: 1,
          reasons: [
            `Market cap $${(row.marketCap / 1e9).toFixed(1)}B`,
            `20-session median dollar volume $${(medianDollarVolume / 1e6).toFixed(1)}M`,
            `Listed on ${row.exchange}`,
          ],
        })
      })
      return {
        candidates: rankSignalCandidates(passed),
        sourcedAt: new Date().toISOString(),
        sourceCandidateCount: page.quotes.length,
        rejectedCandidateCount: Math.max(0, page.quotes.length - quoteRows.length) + quoteRows.length - passed.length,
        passedFilterCount: passed.length,
      }
    },
    { force },
  )
  return { ...resolved.value, fromCache: resolved.fromCache }
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
  try {
    await unlink(latestSignalsPath())
  } catch {
    // A cache file that does not exist is already cleared.
  }
}

/** Source the liquid universe, collect four timeframes, and isolate failures per ticker. */
export async function getSignals(request: SignalsRequest = {}): Promise<SignalsPayload> {
  const startedAt = new Date().toISOString()
  const universe = await sourceUniverse(Boolean(request.forceUniverseRefresh))
  if (!universe.candidates.length) {
    throw new Error('No liquid US equities passed the automatic universe filters')
  }
  const tickers = universe.candidates.map((candidate) => candidate.ticker)
  const symbolsByRole: Record<SignalRole, string[]> = {
    trend: [...tickers, 'SPY'],
    momentum: tickers,
    setup: tickers,
    entry: tickers,
  }
  const [trend, momentum, setup, entry] = await Promise.all(
    (Object.keys(symbolsByRole) as SignalRole[]).map((role) =>
      fetchRole(symbolsByRole[role], role, Boolean(request.forceMarketRefresh)),
    ),
  )
  const roleResults = { trend, momentum, setup, entry }
  const results: SignalResult[] = tickers.map((ticker) => {
    const frames = Object.fromEntries(
      (Object.keys(roleResults) as SignalRole[]).map((role) => [role, roleResults[role].frames[ticker] ?? []]),
    ) as SignalFrames
    try {
      return evaluateSignal(ticker, frames, {
        benchmark: roleResults.trend.frames.SPY,
        benchmarkSymbol: 'SPY',
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
    rejectedCandidateCount: universe.rejectedCandidateCount,
    passedFilterCount: universe.passedFilterCount,
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
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
