import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ValuationMarketContext } from '../shared/valuation.js'
import { observeSource, type SourceSnapshot } from './sourceHealth.js'

/**
 * The long-term risk-free rate the Valuation page's CAPM required return anchors on,
 * ported from `services/risk_free.py`.
 *
 * Four tiers, first hit wins: a 15-minute process memo, a 12-hour disk entry, the two
 * Treasury CSVs, and finally a disk entry up to 30 days old marked `stale`. Callers treat
 * `null` as "no market anchor" and `estimateRequiredReturn` falls back to the pre-CAPM
 * heuristic, so losing this costs precision rather than correctness.
 *
 * home.treasury.gov is not Yahoo, so this stays **outside** `paced()`, on the
 * `fearGreed.ts` precedent — putting an unrelated host behind the Yahoo gate would let a
 * Treasury hiccup throttle the rest of the app. The endpoint renders each yearly CSV on
 * demand and answers in 10-20s even when healthy, which is why the timeout is generous and
 * why the memo exists at all.
 */

const TREASURY_CSV_URL =
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/' +
  'daily-treasury-rates.csv/{year}/all?type={kind}&field_tdr_date_value={year}&page&_format=csv'

const KIND_NOMINAL = 'daily_treasury_yield_curve'
const KIND_REAL = 'daily_treasury_real_yield_curve'

/** The 10-year yield moves in basis points per day; half a day of staleness is invisible. */
const TTL_MS = 12 * 60 * 60_000
/** A month-old yield is still far closer to the truth than the 10% heuristic baseline. */
const STALE_TTL_MS = 30 * 24 * 60 * 60_000
const MEMO_TTL_MS = 15 * 60_000
const OBSERVATION_STALE_MS = 7 * 24 * 60 * 60_000
const REQUEST_TIMEOUT_MS = 20_000
/** The current-year CSV is nearly empty in early January, so always ask for last year too. */
const YEARS = 2

const TENOR_LABEL = '10Y'
/** The nominal curve spells it `10 Yr` and the real curve spells it `10 YR`; match either. */
const TENOR_KEY = '10 yr'

interface MemoEntry {
  payload: ValuationMarketContext
  storedAt: number
  snapshot: SourceSnapshot
}

let memo: MemoEntry | null = null

function cachePath(): string {
  const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local')
  return join(local, 'BudgetTerminalElectron', 'cache', 'risk-free', 'us_treasury.json')
}

async function readCache(): Promise<{ payload: ValuationMarketContext; ageMs: number; snapshot: SourceSnapshot } | null> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(), 'utf8')) as {
      version?: number
      storedAt: number
      payload: ValuationMarketContext
      snapshot?: SourceSnapshot
    }
    const asOf = Date.parse(parsed.payload?.asOf)
    if (parsed.version !== 1 || !Number.isFinite(parsed.storedAt) || !Number.isFinite(parsed.payload?.riskFreeRate) || !Number.isFinite(asOf)) return null
    const stale = parsed.payload.freshness === 'stale' || Date.now() - asOf > OBSERVATION_STALE_MS
    return { payload: { ...parsed.payload, freshness: stale ? 'stale' : 'fresh' }, ageMs: Math.max(Date.now() - parsed.storedAt, 0),
      snapshot: parsed.snapshot ? { ...parsed.snapshot, stale: stale || parsed.snapshot.stale }
        : { fetchedAt: parsed.storedAt, asOf,
          expiresAt: parsed.storedAt + TTL_MS, stale, fromCache: true, failures: [] } }
  } catch {
    return null
  }
}

async function writeCache(payload: ValuationMarketContext, snapshot: SourceSnapshot): Promise<void> {
  const target = cachePath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify({ version: 1, storedAt: snapshot.fetchedAt, payload, snapshot }), 'utf8')
  await rename(temporary, target)
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (const char of line) {
    if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
    } else current += char
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

function isoStamp(value: string): string {
  const parts = value.split('/')
  if (parts.length === 3) {
    const [month, day, year] = parts.map((part) => Number(part))
    if ([month, day, year].every(Number.isFinite)) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : ''
}

/**
 * Parse one yearly rates CSV down to the 10-year tenor's latest `(date, rate)`.
 *
 * The column set changes between years — `4 Mo` and `1.5 Month` were added partway
 * through — and a tenor that was not auctioned on a given day is blank, so the column is
 * found by name and each cell coerced individually rather than read by position.
 */
export function parseTenYearTenor(text: string): { asOf: string; rate: number } | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return null
  const header = splitCsvLine(lines[0])
  const column = header.findIndex(
    (label) => label.split(/\s+/).join(' ').toLowerCase() === TENOR_KEY,
  )
  if (column <= 0) return null
  let best: { asOf: string; rate: number } | null = null
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const asOf = isoStamp(cells[0] ?? '')
    const raw = cells[column]?.trim()
    if (!raw || raw === '.' || /^(?:N\/?A|ND)$/i.test(raw)) continue
    const rate = Number(raw)
    if (!asOf || !Number.isFinite(rate)) continue
    if (!best || asOf > best.asOf) best = { asOf, rate }
  }
  return best
}

async function fetchYear(year: number, kind: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(
      TREASURY_CSV_URL.replaceAll('{year}', String(year)).replace('{kind}', kind),
      {
        headers: {
          'User-Agent': 'BudgetTerminalElectron/0.1 (personal finance research tool)',
          Accept: 'text/csv,text/plain,*/*',
        },
        signal: controller.signal,
      },
    )
    if (!response.ok) throw new Error(`Treasury ${kind} ${year}: HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * The latest 10-year point on one curve. Treasury serves one CSV per calendar year, so a
 * year that fails is skipped: a gap in old history is far better than losing the current
 * curve.
 */
async function curveTenor(kind: string): Promise<{ point: { asOf: string; rate: number } | null; failures: string[] }> {
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: YEARS }, (_, index) => thisYear - YEARS + 1 + index)
  const texts = await Promise.allSettled(years.map((year) => fetchYear(year, kind)))
  let best: { asOf: string; rate: number } | null = null
  for (const text of texts) {
    if (text.status !== 'fulfilled') continue
    const point = parseTenYearTenor(text.value)
    if (point && (!best || point.asOf > best.asOf)) best = point
  }
  const current = texts[texts.length - 1]
  // Old-year requests are candidates: a current-year point does not consume them.
  const failures = current.status === 'rejected' && (!best || !best.asOf.startsWith(String(thisYear)))
    ? [current.reason instanceof Error ? current.reason.message : String(current.reason)] : []
  if (!best && !failures.length) failures.push(`Treasury ${kind}: no 10Y observations`)
  return { point: best, failures }
}

/**
 * Read the 10-year nominal and TIPS tenors, fetching both curves at once.
 *
 * Each curve costs a full round-trip, so running them concurrently keeps the cold path at
 * one round-trip rather than two. Losing TIPS costs only the breakeven anchor, which
 * `terminalGrowthPct` then falls back from.
 */
async function buildSnapshot(): Promise<MemoEntry | null> {
  const [nominalCurve, realCurve] = await Promise.all([curveTenor(KIND_NOMINAL), curveTenor(KIND_REAL)])
  const nominal = nominalCurve.point
  const real = realCurve.point
  const fetchedAt = Date.now()
  const failures = [...nominalCurve.failures, ...realCurve.failures]
  // Daily releases older than a week need an explicit stale label, even after a fresh HTTP retrieval.
  const stale = [nominal, real].some(point => point && fetchedAt - Date.parse(point.asOf) > OBSERVATION_STALE_MS)
  const snapshot: SourceSnapshot = { fetchedAt, expiresAt: fetchedAt + TTL_MS,
    ...(nominal ? { asOf: Math.min(Date.parse(nominal.asOf), real ? Date.parse(real.asOf) : Infinity) } : {}),
    stale, fromCache: false, failures }
  observeSource(snapshot)
  if (!nominal) return null
  const payload: ValuationMarketContext = {
    riskFreeRate: nominal.rate,
    realRate: real ? real.rate : null,
    breakevenInflation: real && real.asOf === nominal.asOf ? nominal.rate - real.rate : null,
    asOf: nominal.asOf,
    tenor: TENOR_LABEL,
    freshness: stale ? 'stale' : 'fresh',
    source: 'US Treasury daily par yield curve, 10Y',
  }
  return { payload, storedAt: fetchedAt, snapshot }
}

/** Drop the memo and the disk entry, for Reset Cache and Clear All User Data. */
export async function clearRiskFreeCache(): Promise<void> {
  memo = null
  await rm(cachePath(), { force: true })
}

/** The latest 10-year Treasury snapshot, or null when every tier failed. */
export async function fetchRiskFreeSnapshot(force = false): Promise<ValuationMarketContext | null> {
  if (!force && memo && Date.now() - memo.storedAt < MEMO_TTL_MS
    && (memo.snapshot.stale || Date.now() < (memo.snapshot.expiresAt ?? Infinity))) {
    observeSource({ ...memo.snapshot, fromCache: true })
    return { ...memo.payload }
  }

  const cached = await readCache()
  if (!force && cached && cached.ageMs <= TTL_MS) {
    memo = { payload: cached.payload, storedAt: Date.now(), snapshot: cached.snapshot }
    observeSource({ ...cached.snapshot, fromCache: true })
    return { ...cached.payload }
  }

  const snapshot = await buildSnapshot().catch(() => null)
  if (snapshot) {
    await writeCache(snapshot.payload, snapshot.snapshot).catch(() => {})
    memo = snapshot
    return { ...snapshot.payload }
  }

  if (cached && cached.ageMs <= STALE_TTL_MS) {
    const stale: ValuationMarketContext = { ...cached.payload, freshness: 'stale' }
    memo = { payload: stale, storedAt: Date.now(), snapshot: { ...cached.snapshot, stale: true, fromCache: true } }
    observeSource(memo.snapshot)
    return { ...stale }
  }
  return null
}
