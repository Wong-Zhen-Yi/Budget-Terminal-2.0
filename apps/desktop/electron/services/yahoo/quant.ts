import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  QuantPairDetail,
  QuantScanPayload,
  QuantScreenRow,
} from '../../shared/contract.js'
import {
  buildPairDetail,
  discoverPairs,
  rankScreenRows,
  screenMetrics,
  type QuantBar,
  type QuantCandidate,
} from '../../shared/quant.js'
import {
  SIGNAL_EXCHANGES,
  signalCandidateFromQuote,
  type SignalQuoteLike,
} from '../../shared/signals.js'
import { cache } from '../cache.js'
import { equitySignalsScreen } from './screener.js'
import { getYahooSeries } from './series.js'

export const QUANT_SOURCE = 'Yahoo Finance'

const DAY = 24 * 60 * 60 * 1000
const UNIVERSE_TTL = DAY
const HISTORY_TTL = 4 * 60 * 60 * 1000
const RESULT_TTL = 12 * 60 * 60 * 1000
const SOURCE_LIMIT = 250
const SHORTLIST_LIMIT = 100
const PAIR_UNIVERSE_LIMIT = 40

export interface QuantUniverse {
  candidates: QuantCandidate[]
  sourcedAt: string
  fromCache: boolean
}

interface ChartResultLike {
  quotes: Array<{
    date: Date
    close?: number | null
    adjclose?: number | null
    volume?: number | null
  }>
}

export interface QuantScanDependencies {
  sourceUniverse: (force: boolean) => Promise<QuantUniverse>
  fetchHistory: (symbol: string, force?: boolean) => Promise<QuantBar[]>
}

function finite(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function localSessionDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function chartBars(result: ChartResultLike): QuantBar[] {
  const byDate = new Map<string, QuantBar>()
  for (const quote of result.quotes) {
    const close = finite(quote.adjclose) ?? finite(quote.close)
    if (close === null || close <= 0) continue
    const date = quote.date.toISOString().slice(0, 10)
    byDate.set(date, { date, close, volume: finite(quote.volume) })
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

async function fetchDaily(
  symbol: string,
  lookbackDays: number,
  role: string,
  force: boolean,
): Promise<QuantBar[]> {
  const resolved = await cache.resolveWithStaleFallback(
    `quant:${role}:${symbol}:${lookbackDays}`,
    role === 'liquidity' ? UNIVERSE_TTL : HISTORY_TTL,
    async () => {
      const chart = await getYahooSeries({
        symbol,
        start: new Date(Date.now() - lookbackDays * DAY),
        interval: '1d',
        force,
        adjusted: role !== 'liquidity',
      })
      const bars = chartBars({ quotes: chart.rows.map((row) => ({
        ...row,
        date: new Date(row.time * 1000),
      })) } as ChartResultLike)
      if (!bars.length) throw new Error('No daily history returned.')
      return bars
    },
    { force },
  )
  return resolved.value
}

function completedMedianDollarVolume(bars: QuantBar[], sessionDate: string): number | null {
  const values = bars
    .filter((bar) => bar.date < sessionDate && bar.volume !== null && bar.volume > 0)
    .map((bar) => bar.close * bar.volume!)
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(-20)
    .sort((left, right) => left - right)
  if (values.length < 20) return null
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
}

export async function sourceLiquidUniverse(force: boolean): Promise<QuantUniverse> {
  const sessionDate = localSessionDate()
  const result = await cache.resolve(
    `quant:universe:published-v1:${sessionDate}`,
    UNIVERSE_TTL,
    async () => {
      const page = await equitySignalsScreen(5, 2e9, SIGNAL_EXCHANGES, SOURCE_LIMIT)
      const quotes = page.quotes.flatMap((quote) => {
        const candidate = signalCandidateFromQuote(quote as SignalQuoteLike)
        return candidate ? [candidate] : []
      })
      const liquidity = await Promise.allSettled(
        quotes.map((quote) => fetchDaily(quote.ticker, 100, 'liquidity', force)),
      )
      const candidates = quotes.flatMap((quote, index) => {
        const outcome = liquidity[index]
        if (outcome.status !== 'fulfilled') return []
        const medianDollarVolume = completedMedianDollarVolume(outcome.value, sessionDate)
        if (medianDollarVolume === null || medianDollarVolume < 20e6) return []
        return [{
          ticker: quote.ticker,
          name: quote.name,
          exchange: quote.exchange,
          marketCap: quote.marketCap,
          medianDollarVolume,
        }]
      })
      candidates.sort((left, right) =>
        right.medianDollarVolume - left.medianDollarVolume ||
        right.marketCap - left.marketCap ||
        left.ticker.localeCompare(right.ticker),
      )
      return { candidates: candidates.slice(0, SHORTLIST_LIMIT), sourcedAt: new Date().toISOString() }
    },
    { force },
  )
  return { ...result.value, fromCache: result.fromCache }
}

function latestQuantPath(): string {
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'quant-latest-v1.json')
}

let latestPayload: QuantScanPayload | null = null

function validLatest(value: unknown): value is QuantScanPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<QuantScanPayload>
  const age = Date.now() - Date.parse(String(payload.completedAt ?? ''))
  return Array.isArray(payload.rows) && Array.isArray(payload.pairs) && Number.isFinite(age) && age >= 0 && age <= RESULT_TTL
}

async function saveLatest(payload: QuantScanPayload): Promise<void> {
  latestPayload = payload
  const target = latestQuantPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(payload), 'utf8')
  await rename(temporary, target)
}

export async function getLatestQuant(): Promise<QuantScanPayload | null> {
  if (latestPayload && validLatest(latestPayload)) return latestPayload
  try {
    const value: unknown = JSON.parse(await readFile(latestQuantPath(), 'utf8'))
    latestPayload = validLatest(value) ? value : null
  } catch {
    latestPayload = null
  }
  return latestPayload
}

export async function clearLatestQuant(): Promise<void> {
  latestPayload = null
  try {
    await unlink(latestQuantPath())
  } catch {
    // A missing latest-result file is already cleared.
  }
}

/** Source, factor-score and pair-screen the same liquid universe as the PySide6 page. */
export async function runQuantScan(
  forceUniverseRefresh = false,
  dependencies: QuantScanDependencies = {
    sourceUniverse: sourceLiquidUniverse,
    fetchHistory: (symbol, force = false) => fetchDaily(symbol, 740, 'history', force),
  },
): Promise<QuantScanPayload> {
  const startedAt = new Date().toISOString()
  const universe = await dependencies.sourceUniverse(forceUniverseRefresh)
  if (!universe.candidates.length) throw new Error('No liquid US equities passed the automatic universe filters')
  const outcomes = await Promise.allSettled(
    universe.candidates.map((candidate) => dependencies.fetchHistory(candidate.ticker, forceUniverseRefresh)),
  )
  const errors: Record<string, string> = {}
  const histories: Record<string, QuantBar[]> = {}
  const rows: QuantScreenRow[] = []
  universe.candidates.forEach((candidate, index) => {
    const outcome = outcomes[index]
    if (outcome.status !== 'fulfilled') {
      errors[candidate.ticker] = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
      return
    }
    const metrics = screenMetrics(outcome.value)
    if (!metrics.observations) {
      errors[candidate.ticker] = 'No usable close history.'
      return
    }
    histories[candidate.ticker] = outcome.value
    rows.push({
      ticker: candidate.ticker,
      name: candidate.name,
      exchange: candidate.exchange,
      marketCap: candidate.marketCap,
      ...metrics,
      medianDollarVolume: metrics.medianDollarVolume ?? candidate.medianDollarVolume,
      composite: null,
      rank: 0,
    })
  })
  if (!rows.length) throw new Error('No ticker returned usable daily history for the Quant screen')
  const ranked = rankScreenRows(rows)
  const pairTickers = [...ranked]
    .sort((left, right) => (right.medianDollarVolume ?? 0) - (left.medianDollarVolume ?? 0))
    .slice(0, PAIR_UNIVERSE_LIMIT)
    .map((row) => row.ticker)
  const pairHistories = Object.fromEntries(pairTickers.flatMap((ticker) => histories[ticker] ? [[ticker, histories[ticker]]] : []))
  const payload: QuantScanPayload = {
    rows: ranked,
    pairs: discoverPairs(pairHistories),
    source: QUANT_SOURCE,
    sourcedAt: universe.sourcedAt,
    startedAt,
    completedAt: new Date().toISOString(),
    universeSize: universe.candidates.length,
    errors,
    universeFromCache: universe.fromCache,
  }
  await saveLatest(payload)
  return payload
}

export async function analyzeQuantPair(leftInput: string, rightInput: string, force = false): Promise<QuantPairDetail> {
  const left = leftInput.trim().toUpperCase()
  const right = rightInput.trim().toUpperCase()
  if (!left || !right) throw new Error('Enter two ticker symbols.')
  if (left === right) throw new Error('Choose two different ticker symbols.')
  const outcomes = await Promise.allSettled([
    fetchDaily(left, 740, 'history', force),
    fetchDaily(right, 740, 'history', force),
  ])
  const missing = [left, right].filter((_symbol, index) => outcomes[index].status !== 'fulfilled')
  if (missing.length) {
    const failed = outcomes[[left, right].indexOf(missing[0])]
    const detail = failed.status === 'rejected'
      ? failed.reason instanceof Error ? failed.reason.message : String(failed.reason)
      : 'no daily history returned'
    throw new Error(`Could not load history for ${missing.join(', ')}: ${detail}`)
  }
  return buildPairDetail(
    left,
    right,
    (outcomes[0] as PromiseFulfilledResult<QuantBar[]>).value,
    (outcomes[1] as PromiseFulfilledResult<QuantBar[]>).value,
  )
}
