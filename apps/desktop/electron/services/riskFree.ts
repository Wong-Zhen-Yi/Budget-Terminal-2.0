import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ValuationMarketContext } from '../shared/valuation.js'

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
const REQUEST_TIMEOUT_MS = 20_000
/** The current-year CSV is nearly empty in early January, so always ask for last year too. */
const YEARS = 2

const TENOR_LABEL = '10Y'
/** The nominal curve spells it `10 Yr` and the real curve spells it `10 YR`; match either. */
const TENOR_KEY = '10 yr'

interface MemoEntry {
  payload: ValuationMarketContext
  storedAt: number
}

let memo: MemoEntry | null = null

function cachePath(): string {
  const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local')
  return join(local, 'BudgetTerminalElectron', 'cache', 'risk-free', 'us_treasury.json')
}

async function readCache(): Promise<{ payload: ValuationMarketContext; ageMs: number } | null> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(), 'utf8')) as {
      storedAt: number
      payload: ValuationMarketContext
    }
    if (!Number.isFinite(parsed.storedAt) || !Number.isFinite(parsed.payload?.riskFreeRate)) return null
    return { payload: parsed.payload, ageMs: Math.max(Date.now() - parsed.storedAt, 0) }
  } catch {
    return null
  }
}

async function writeCache(payload: ValuationMarketContext): Promise<void> {
  const target = cachePath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify({ storedAt: Date.now(), payload }), 'utf8')
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
    const rate = Number(cells[column])
    if (!asOf || !Number.isFinite(rate)) continue
    if (!best || asOf > best.asOf) best = { asOf, rate }
  }
  return best
}

async function fetchYear(year: number, kind: string): Promise<string | null> {
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
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * The latest 10-year point on one curve. Treasury serves one CSV per calendar year, so a
 * year that fails is skipped: a gap in old history is far better than losing the current
 * curve.
 */
async function curveTenor(kind: string): Promise<{ asOf: string; rate: number } | null> {
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: YEARS }, (_, index) => thisYear - YEARS + 1 + index)
  const texts = await Promise.all(years.map((year) => fetchYear(year, kind)))
  let best: { asOf: string; rate: number } | null = null
  for (const text of texts) {
    if (!text) continue
    const point = parseTenYearTenor(text)
    if (point && (!best || point.asOf > best.asOf)) best = point
  }
  return best
}

/**
 * Read the 10-year nominal and TIPS tenors, fetching both curves at once.
 *
 * Each curve costs a full round-trip, so running them concurrently keeps the cold path at
 * one round-trip rather than two. Losing TIPS costs only the breakeven anchor, which
 * `terminalGrowthPct` then falls back from.
 */
async function buildSnapshot(): Promise<ValuationMarketContext | null> {
  const [nominal, real] = await Promise.all([curveTenor(KIND_NOMINAL), curveTenor(KIND_REAL)])
  if (!nominal) return null
  return {
    riskFreeRate: nominal.rate,
    realRate: real ? real.rate : null,
    breakevenInflation: real ? nominal.rate - real.rate : null,
    asOf: nominal.asOf,
    tenor: TENOR_LABEL,
    freshness: 'fresh',
    source: 'US Treasury daily par yield curve, 10Y',
  }
}

/** Drop the memo and the disk entry, for Reset Cache and Clear All User Data. */
export async function clearRiskFreeCache(): Promise<void> {
  memo = null
  await rm(cachePath(), { force: true })
}

/** The latest 10-year Treasury snapshot, or null when every tier failed. */
export async function fetchRiskFreeSnapshot(force = false): Promise<ValuationMarketContext | null> {
  if (!force && memo && Date.now() - memo.storedAt < MEMO_TTL_MS) return { ...memo.payload }

  const cached = await readCache()
  if (!force && cached && cached.ageMs <= TTL_MS) {
    memo = { payload: cached.payload, storedAt: Date.now() }
    return { ...cached.payload }
  }

  const snapshot = await buildSnapshot().catch(() => null)
  if (snapshot) {
    await writeCache(snapshot).catch(() => {})
    memo = { payload: snapshot, storedAt: Date.now() }
    return { ...snapshot }
  }

  if (cached && cached.ageMs <= STALE_TTL_MS) {
    const stale: ValuationMarketContext = { ...cached.payload, freshness: 'stale' }
    memo = { payload: stale, storedAt: Date.now() }
    return { ...stale }
  }
  return null
}
