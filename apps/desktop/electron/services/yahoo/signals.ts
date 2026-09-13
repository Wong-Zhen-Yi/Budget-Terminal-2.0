import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { DayTradingCandidate, SignalsPayload, SignalsRequest } from '../../shared/contract.js'
import {
  completedMedianDollarVolume, signalCandidateFromQuote,
  SIGNAL_EXCHANGES, SIGNAL_MINIMUM_DOLLAR_VOLUME, SIGNAL_SCREEN_OFFSETS,
  SIGNAL_SCREEN_PAGE_SIZE, SIGNAL_SCREEN_TARGET,
  type SignalBar, type SignalQuoteCandidate,
} from '../../shared/signals.js'
import { dayTradingSession, evaluateDayTrading, validDayTradingPayload } from '../../shared/dayTrading.js'
import { cache } from '../cache.js'
import { equitySignalsScreen } from './screener.js'
import { getYahooSeries } from './series.js'

export const SIGNALS_SOURCE = 'Yahoo Finance'

const DAY = 24 * 60 * 60 * 1000
const UNIVERSE_TTL = DAY


interface UniversePayload {
  candidates: DayTradingCandidate[]
  sourcedAt: string
  sourceCandidateCount: number
  prefilteredCount: number
  confirmedCount: number
  rejectedCandidateCount: number
  passedFilterCount: number
}

interface RoleRequest {
  interval: '1d' | '1m'
  lookbackDays: number
  ttlMs: number
}

const DAILY_REQUEST: RoleRequest = { interval: '1d', lookbackDays: 90, ttlMs: 4 * 60 * 60 * 1000 }
const ENTRY_REQUEST: RoleRequest = { interval: '1m', lookbackDays: 7, ttlMs: 45 * 1000 }
let latestPayload: SignalsPayload | null = null
let inFlight: Promise<SignalsPayload> | null = null

function latestSignalsPath(): string {
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'signals-latest-v5.json')
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
      const chart = await getYahooSeries({
        symbol,
        start: period1,
        interval: request.interval,
        force,
      })
      const bars = chartBars({ quotes: chart.rows.map((row) => ({
        ...row,
        date: new Date(row.time * 1000),
      })) } as ChartResultLike)
      if (!bars.length) throw new Error(`No ${request.interval} history returned`)
      return bars
    },
    { force },
  )
  return result.value
}

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

/** Confirm liquidity in screener dollar-volume order; retain up to 30 eligible names. */
async function sourceUniverse(force: boolean): Promise<UniversePayload & { fromCache: boolean }> {
  const sessionDate = localSessionDate()
  const resolved = await cache.resolve(
    `signals:day-trading-universe-v5:${sessionDate}`,
    UNIVERSE_TTL,
    async () => {
      const { screened, rows } = await screenCandidates()
      const prefiltered = rows
        .filter((row) => row.estimatedDollarVolume >= SIGNAL_MINIMUM_DOLLAR_VOLUME)
        .sort((left, right) => right.estimatedDollarVolume - left.estimatedDollarVolume)
      const passed: DayTradingCandidate[] = []
      // Check successive batches until 30 pass, so failed top names do not discard
      // eligible liquid names farther down the screen. All requests remain paced.
      for (let offset = 0; offset < prefiltered.length && passed.length < 30; offset += 30) {
        const batch = prefiltered.slice(offset, offset + 30)
        const settled = await Promise.allSettled(batch.map((row) => fetchBars(row.ticker, DAILY_REQUEST, force, 'liquidity-v5')))
        batch.forEach((row, index) => {
          const outcome = settled[index]
          if (outcome.status !== 'fulfilled') return
          const medianDollarVolume = completedMedianDollarVolume(outcome.value, sessionDate)
          if (medianDollarVolume === null || medianDollarVolume < SIGNAL_MINIMUM_DOLLAR_VOLUME) return
          passed.push({ ...row, medianDollarVolume, qualityRank: passed.length + 1,
            reasons: [`20-session median dollar volume $${(medianDollarVolume / 1e6).toFixed(1)}M`, `Listed on ${row.exchange}`],
          })
        })
      }
      const candidates = passed.slice(0, 30)
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

export async function getLatestSignals(): Promise<SignalsPayload | null> {
  if (latestPayload && validDayTradingPayload(latestPayload)) return latestPayload
  try {
    const value: unknown = JSON.parse(await readFile(latestSignalsPath(), 'utf8'))
    latestPayload = validDayTradingPayload(value) ? value : null
  } catch {
    latestPayload = null
  }
  return latestPayload
}

export async function clearLatestSignals(): Promise<void> {
  latestPayload = null
  // The superseded documents are never read, but Clear cache should not leave them behind.
  const current = latestSignalsPath()
  const targets = [current, ...['-v4.json', '-v3.json', '-v2.json'].map((old) => current.replace('-v5.json', old))]
  for (const target of targets) {
    try {
      await unlink(target)
    } catch {
      // A cache file that does not exist is already cleared.
    }
  }
}

/** Scan requests share one promise, including concurrent windows and manual refreshes. */
export function getSignals(request: SignalsRequest = {}): Promise<SignalsPayload> {
  if (inFlight) return inFlight
  inFlight = scanSignals(request).finally(() => { inFlight = null })
  return inFlight
}

async function scanSignals(request: SignalsRequest): Promise<SignalsPayload> {
  const startedAt = new Date().toISOString()
  await getLatestSignals()
  const universe = await sourceUniverse(Boolean(request.forceUniverseRefresh))
  if (!universe.candidates.length) throw new Error('No liquid US equities passed the universe filters')
  const settled = await Promise.allSettled(universe.candidates.map((candidate) =>
    fetchBars(candidate.ticker, ENTRY_REQUEST, Boolean(request.forceMarketRefresh), 'day-trading-v5'),
  ))
  const now = Date.now()
  const session = dayTradingSession(now)
  const results = universe.candidates.flatMap((candidate, index) => {
    const outcome = settled[index]
    const error = outcome.status === 'rejected'
      ? outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) : null
    // Keep previous levels and timestamps when this ticker's request fails.
    const previous = latestPayload?.results.filter((row) => row.ticker === candidate.ticker && row.session === session.date)
    if (error && previous?.length) return previous.map((row) => ({ ...row, status: 'error' as const, error }))
    return evaluateDayTrading(candidate.ticker, outcome.status === 'fulfilled' ? outcome.value : [], now, error)
  })
  const errors = Object.fromEntries(results.flatMap((row) => row.error ? [[row.ticker, row.error]] : []))
  latestPayload = {
    version: 5, session: session.date, marketOpen: session.open,
    candidates: universe.candidates, results, source: SIGNALS_SOURCE,
    sourcedAt: universe.sourcedAt, startedAt, completedAt: new Date(now).toISOString(),
    sourceCandidateCount: universe.sourceCandidateCount, prefilteredCount: universe.prefilteredCount,
    confirmedCount: universe.confirmedCount, errors, universeFromCache: universe.fromCache,
  }
  try { await saveLatestSignals(latestPayload) } catch { /* A disk error must not discard a healthy scan. */ }
  return latestPayload
}
