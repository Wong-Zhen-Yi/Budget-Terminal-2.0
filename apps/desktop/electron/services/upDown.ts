import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  EnvelopeError,
  UpDownInterval,
  UpDownPayload,
  UpDownRequest,
  UpDownRow,
  UpDownSource,
  UpDownTargetsPayload,
} from '../shared/contract.js'
import {
  calculateUpDownRow,
  normalizeUpDownSymbols,
  sortUpDownRows,
  type UpDownCloseSeries,
} from '../shared/upDown.js'
import { cache } from './cache.js'
import { getEtfHoldings, type EtfHoldingsResult } from './etf/holdings.js'
import { paced, yahoo } from './yahoo/client.js'
import { getFundamentals } from './yahoo/fundamentals.js'

export const UP_DOWN_SOURCE = 'Yahoo Finance Up/Down'

const CACHE_VERSION = 1
const PAYLOAD_TTL_MS = 15 * 60_000
const HOLDINGS_TTL_MS = 24 * 60 * 60_000
const TARGET_TTL_MS = 24 * 60 * 60_000
const STALE_TTL_MS = 7 * 24 * 60 * 60_000
const HISTORY_TTL_MS = 5 * 60_000

interface DiskDocument<T> {
  version: number
  storedAt: number
  value: T
}

interface DiskHit<T> {
  value: T
  ageSeconds: number
  fresh: boolean
}

interface UpDownLoad {
  payload: UpDownPayload
  errors: EnvelopeError[]
}

export interface UpDownFetchResult extends UpDownLoad {
  fromCache: boolean
  stale: boolean
  cacheAgeSeconds: number
}

interface TargetEntry {
  fetchedAt: number
  target: number | null
}

function cacheRoot(): string {
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'up-down-cache')
}

function safeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'default'
}

async function readDisk<T>(path: string, ttlMs: number): Promise<DiskHit<T> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as DiskDocument<T>
    if (parsed.version !== CACHE_VERSION || !Number.isFinite(parsed.storedAt)) return null
    const ageMs = Math.max(Date.now() - parsed.storedAt, 0)
    if (ageMs > STALE_TTL_MS) return null
    return { value: parsed.value, ageSeconds: ageMs / 1000, fresh: ageMs <= ttlMs }
  } catch {
    return null
  }
}

async function writeDisk<T>(path: string, value: T): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(
    temporary,
    JSON.stringify({ version: CACHE_VERSION, storedAt: Date.now(), value }, null, 2),
    'utf8',
  )
  await rename(temporary, path)
}

function normalizeSource(value: unknown): UpDownSource {
  return value === 'spy' || value === 'qqq' || value === 'custom' ? value : 'portfolio'
}

function normalizeInterval(value: unknown): UpDownInterval {
  return value === '5d' || value === '30d' || value === 'ytd' || value === '1y' ? value : '1d'
}

function sourceLabel(source: UpDownSource): string {
  if (source === 'spy') return 'SPY Holdings'
  if (source === 'qqq') return 'QQQ Holdings'
  if (source === 'custom') return 'Custom'
  return 'Portfolio'
}

function localMinute(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function monthsAgo(months: number): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()))
}

function historyStart(interval: UpDownInterval): Date {
  const now = new Date()
  if (interval === '1d' || interval === '5d') {
    return new Date(Date.now() - 15 * 24 * 60 * 60_000)
  }
  if (interval === '30d') return monthsAgo(2)
  if (interval === '1y') return monthsAgo(13)
  return new Date(Date.UTC(now.getUTCFullYear(), 0, -9))
}

function yahooSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, '-')
}

async function fetchCloseSeries(
  symbol: string,
  interval: UpDownInterval,
  force: boolean,
): Promise<UpDownCloseSeries> {
  const start = historyStart(interval)
  const key = `up-down-history:${symbol}:${interval}:${start.toISOString().slice(0, 10)}`
  const result = await cache.resolve(
    key,
    HISTORY_TTL_MS,
    async () => {
      const chart = await paced(() =>
        yahoo.chart(yahooSymbol(symbol), { period1: start, interval: '1d' }),
      )
      const byDate = new Map<string, number>()
      for (const quote of chart.quotes) {
        const close = quote.close
        if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue
        byDate.set(quote.date.toISOString().slice(0, 10), close)
      }
      const points = [...byDate].sort(([left], [right]) => left.localeCompare(right))
      if (points.length < 2) throw new Error(`No daily close history returned for ${symbol}.`)
      return { dates: points.map(([date]) => date), values: points.map(([, close]) => close) }
    },
    { force },
  )
  return result.value
}

async function loadHoldings(
  ticker: 'SPY' | 'QQQ',
  force: boolean,
): Promise<{ result: EtfHoldingsResult; stale: boolean; ageSeconds: number }> {
  const path = join(cacheRoot(), 'holdings', `${ticker}.json`)
  const disk = await readDisk<EtfHoldingsResult>(path, HOLDINGS_TTL_MS)
  if (!force && disk?.fresh) return { result: disk.value, stale: false, ageSeconds: disk.ageSeconds }
  try {
    const result = await getEtfHoldings(ticker, force)
    await writeDisk(path, result)
    return { result, stale: false, ageSeconds: 0 }
  } catch (error) {
    if (disk) return { result: disk.value, stale: true, ageSeconds: disk.ageSeconds }
    throw error
  }
}

async function symbolsFor(
  source: UpDownSource,
  supplied: string[],
  force: boolean,
): Promise<{ symbols: string[]; names: Record<string, string>; holdingsSource: string; errors: EnvelopeError[] }> {
  if (source !== 'spy' && source !== 'qqq') {
    return { symbols: normalizeUpDownSymbols(supplied), names: {}, holdingsSource: '', errors: [] }
  }
  const ticker = source === 'spy' ? 'SPY' : 'QQQ'
  const loaded = await loadHoldings(ticker, force)
  const symbols: string[] = []
  const names: Record<string, string> = {}
  for (const holding of loaded.result.holdings) {
    const [symbol] = normalizeUpDownSymbols([holding.symbol])
    if (!symbol || symbols.includes(symbol)) continue
    symbols.push(symbol)
    if (holding.name.trim()) names[symbol] = holding.name.trim()
  }
  const errors: EnvelopeError[] = []
  if (loaded.stale) {
    errors.push({
      source: loaded.result.issuer || `${ticker} holdings`,
      operation: 'up_down_holdings',
      symbol: ticker,
      reason: `Live holdings were unavailable; cached holdings from ${Math.max(1, Math.floor(loaded.ageSeconds / 60))} minute(s) ago were retained.`,
    })
  }
  if (loaded.result.isPartial) {
    errors.push({
      source: loaded.result.issuer,
      operation: 'up_down_holdings',
      symbol: ticker,
      reason: `Only Yahoo's top-holdings fallback was available for ${ticker}.`,
    })
  }
  return {
    symbols,
    names,
    holdingsSource: loaded.result.issuer || `${ticker} holdings`,
    errors,
  }
}

async function fetchLive(request: UpDownRequest): Promise<UpDownLoad> {
  const source = normalizeSource(request.source)
  const interval = normalizeInterval(request.interval)
  const force = Boolean(request.force)
  const seed = await symbolsFor(source, request.symbols ?? [], force)
  const settled = await Promise.allSettled(
    seed.symbols.map(async (symbol) => {
      const series = await fetchCloseSeries(symbol, interval, force)
      return calculateUpDownRow(symbol, series, interval, seed.names[symbol] ?? '')
    }),
  )
  const rows: UpDownRow[] = []
  const missing: string[] = []
  settled.forEach((outcome, index) => {
    const symbol = seed.symbols[index]
    if (outcome.status === 'fulfilled' && outcome.value) rows.push(outcome.value)
    else missing.push(symbol)
  })
  const errors = [...seed.errors]
  if (missing.length) {
    errors.push({
      source: 'Yahoo Finance',
      operation: 'up_down_history',
      symbol: sourceLabel(source),
      reason: `${missing.length} ticker(s) had no usable daily history.`,
    })
  }
  return {
    payload: {
      source,
      interval,
      rows: sortUpDownRows(rows),
      missing,
      asOf: localMinute(),
      dataSource: 'Yahoo Finance',
      holdingsSource: seed.holdingsSource,
      forceTargets: force,
    },
    errors,
  }
}

export async function getUpDown(request: UpDownRequest): Promise<UpDownFetchResult> {
  const source = normalizeSource(request.source)
  const interval = normalizeInterval(request.interval)
  const symbols = normalizeUpDownSymbols(request.symbols ?? [])
  const force = Boolean(request.force)
  const diskPath = join(cacheRoot(), 'payloads', `${safeKey(source)}-${interval}.json`)
  const disk = source === 'spy' || source === 'qqq'
    ? await readDisk<UpDownPayload>(diskPath, PAYLOAD_TTL_MS)
    : null
  if (!force && disk?.fresh) {
    return {
      payload: { ...disk.value, forceTargets: false },
      errors: [],
      fromCache: true,
      stale: false,
      cacheAgeSeconds: disk.ageSeconds,
    }
  }

  const signature = source === 'spy' || source === 'qqq' ? `${source}:${interval}` : `${source}:${interval}:${symbols.join(',')}`
  try {
    const resolved = await cache.resolveWithStaleFallback(
      `up-down:${signature}`,
      PAYLOAD_TTL_MS,
      async () => {
        const loaded = await fetchLive({ source, interval, symbols, force })
        if (source === 'spy' || source === 'qqq') {
          await writeDisk(diskPath, { ...loaded.payload, forceTargets: false })
        }
        return loaded
      },
      { force },
    )
    return {
      payload: {
        ...resolved.value.payload,
        forceTargets: force && !resolved.fromCache,
      },
      errors: resolved.value.errors,
      fromCache: resolved.fromCache,
      stale: resolved.stale,
      cacheAgeSeconds: resolved.ageSeconds,
    }
  } catch (error) {
    if (!disk) throw error
    return {
      payload: { ...disk.value, forceTargets: false },
      errors: [{
        source: UP_DOWN_SOURCE,
        operation: 'up_down',
        symbol: sourceLabel(source),
        reason: error instanceof Error ? error.message : String(error),
      }],
      fromCache: true,
      stale: true,
      cacheAgeSeconds: disk.ageSeconds,
    }
  }
}

let targetEntriesPromise: Promise<Map<string, TargetEntry>> | null = null
let targetWriteQueue: Promise<void> = Promise.resolve()

async function targetEntries(): Promise<Map<string, TargetEntry>> {
  if (!targetEntriesPromise) {
    targetEntriesPromise = readDisk<Record<string, TargetEntry>>(
      join(cacheRoot(), 'targets.json'),
      STALE_TTL_MS,
    ).then((hit) => new Map(Object.entries(hit?.value ?? {})))
  }
  return targetEntriesPromise
}

function saveTargets(entries: Map<string, TargetEntry>): Promise<void> {
  targetWriteQueue = targetWriteQueue
    .catch(() => undefined)
    .then(() => {
      const cutoff = Date.now() - STALE_TTL_MS
      const value = Object.fromEntries([...entries].filter(([, entry]) => entry.fetchedAt >= cutoff))
      return writeDisk(join(cacheRoot(), 'targets.json'), value)
    })
  return targetWriteQueue
}

export async function getUpDownTargets(
  tickers: string[],
  force = false,
): Promise<UpDownTargetsPayload> {
  const symbols = normalizeUpDownSymbols(tickers)
  const entries = await targetEntries()
  const now = Date.now()
  const targets: Record<string, number | null> = {}
  const pending: string[] = []
  for (const symbol of symbols) {
    const cached = entries.get(symbol)
    if (!force && cached && now - cached.fetchedAt <= TARGET_TTL_MS) targets[symbol] = cached.target
    else pending.push(symbol)
  }
  if (pending.length) {
    const facts = await getFundamentals(pending, force)
    for (const symbol of pending) {
      const target = facts[symbol]?.targetMeanPrice ?? null
      targets[symbol] = target
      entries.set(symbol, { fetchedAt: Date.now(), target })
    }
    await saveTargets(entries)
  }
  return {
    targets,
    resolved: symbols.length,
    available: Object.values(targets).filter((target) => target !== null).length,
  }
}

export async function clearUpDownCaches(): Promise<void> {
  await targetWriteQueue.catch(() => undefined)
  targetEntriesPromise = null
  targetWriteQueue = Promise.resolve()
  await rm(cacheRoot(), { recursive: true, force: true })
}
