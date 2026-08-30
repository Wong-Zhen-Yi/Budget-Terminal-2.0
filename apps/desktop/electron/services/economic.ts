import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  EconomicGroup,
  EconomicPayload,
  EconomicPoint,
  EconomicProvider,
  EconomicRequest,
  EconomicRow,
} from '../shared/contract.js'
import {
  alignDifference,
  buildRow,
  buildYieldCurve,
  ECONOMIC_SERIES,
  HISTORY_YEARS,
  normalizeGroups,
  PROVIDER_LABELS,
  type EconomicSeries,
} from '../shared/economic.js'

/**
 * US macroeconomic series for the Economic page, ported from `services/economic.py`.
 *
 * Every provider here is keyless, so no credential handling and no new dependency:
 *
 * - `treasury` — home.treasury.gov publishes the daily par yield curve as one CSV per year,
 *   carrying every tenor at once. Spreads and TIPS breakevens are derived from it rather
 *   than fetched separately.
 * - `bls` — api.bls.gov answers a batched POST for up to 25 series, covering CPI, PPI and
 *   the whole labour block.
 * - `nyfed` — markets.newyorkfed.org publishes EFFR and SOFR as JSON.
 * - `umich` — the Surveys of Consumers publish the sentiment index as a CSV.
 * - `fred` — the original source, kept as the fallback for everything the direct providers
 *   do not carry. FRED emits `.` for a missing observation, so its numeric coercion has to
 *   tolerate that sentinel.
 *
 * **None of these hosts is Yahoo, so none of this goes through `paced()`**, on the
 * `fearGreed.ts` precedent — five unrelated providers behind the Yahoo gate would let one
 * slow government host throttle the whole app, and this page is the single most patient
 * load in it. FRED is reachable from most networks but not all, so the fetch treats a
 * provider that fails repeatedly as down and stops paying its timeout for every remaining
 * series.
 */

/* --------------------------------------------------------------- endpoints */

const FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}'

const TREASURY_CSV_URL =
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/' +
  'daily-treasury-rates.csv/{year}/all?type={kind}&field_tdr_date_value={year}&page&_format=csv'

const TREASURY_KIND_NOMINAL = 'daily_treasury_yield_curve'
const TREASURY_KIND_REAL = 'daily_treasury_real_yield_curve'

const BLS_API_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
/** Unregistered BLS callers may ask for 25 series and a ten-year span per request. */
const BLS_MAX_SERIES_PER_REQUEST = 25
const BLS_MAX_YEARS = 10

/**
 * The `last/N` form rejects anything past 500 observations, so history comes from the dated
 * search endpoint instead.
 */
const NYFED_RATE_URL =
  'https://markets.newyorkfed.org/api/rates/{group}/{kind}/search.json' +
  '?startDate={start}&endDate={end}'

const UMICH_SENTIMENT_URL = 'https://www.sca.isr.umich.edu/files/tbmics.csv'

/**
 * Identify the client honestly. Do NOT put a browser user-agent here: FRED sits behind
 * Akamai, which reads a request claiming to be Chrome without Chrome's TLS fingerprint as a
 * bot and tarpits it until the client times out. A spoofed UA loses every FRED series; a
 * plain product token answers in well under a second. Treasury, BLS, NY Fed and UMich were
 * each checked against both and return identical responses, so none of them needs one.
 */
const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'BudgetTerminalElectron/0.1 (personal finance research tool)',
  Accept: 'text/csv,application/json,text/plain,*/*',
}

const REQUEST_TIMEOUT_MS = 15_000

/**
 * home.treasury.gov renders each yearly CSV on demand and takes 18-20s to answer even when
 * it is perfectly healthy, so the shared 15s timeout expired on every request and lost all
 * 16 treasury-backed series. Give that one host a timeout above its measured latency; the
 * fan-out over `HISTORY_YEARS` still bounds the wall time because `MAX_WORKERS` years run
 * at once.
 */
const TREASURY_REQUEST_TIMEOUT_MS = 45_000

/**
 * A short probe timeout for the first fallback download. A reachable FRED answers in under
 * a second; a blocked one only reveals itself by timing out, and paying the full timeout
 * once per series would add minutes to every refresh on a network that cannot reach it.
 */
const FRED_PROBE_TIMEOUT_MS = 6_000

/**
 * Consecutive failures from one provider, with none of its series yet successful, that mean
 * the host is unreachable rather than a handful of series being retired. Without this the
 * fetch spends timeout x series-count (minutes) hanging whenever a provider is blocked.
 */
const PROVIDER_BLACKOUT_THRESHOLD = 4

const MAX_WORKERS = 6

/* ------------------------------------------------------------------ caching */

/**
 * Fresh window, and the ceiling past which a cached payload is discarded rather than shown.
 * Macro series update monthly at best, so a wide stale window is correct: a failed refresh
 * should still paint last week's numbers instead of blanking the page.
 */
const PAYLOAD_TTL_MS = 6 * 60 * 60_000
const STALE_TTL_MS = 7 * 24 * 60 * 60_000

/**
 * Stamped into every cache entry and checked on the way back out. Bump it whenever the
 * payload shape changes, so an entry written by an older shape is dropped rather than
 * rendered.
 */
const CACHE_VERSION = 1

export const ECONOMIC_SOURCE = 'US Treasury, BLS, NY Fed, UMich and FRED'

export interface EconomicFetchResult {
  payload: EconomicPayload
  fromCache: boolean
  stale: boolean
  cacheAgeSeconds: number
}

interface DiskDocument {
  version: number
  storedAt: number
  value: EconomicPayload
}

function cachePath(): string {
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'economic-cache', 'payload.json')
}

async function readDisk(): Promise<{ value: EconomicPayload; ageMs: number } | null> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(), 'utf8')) as DiskDocument
    if (parsed.version !== CACHE_VERSION || !Number.isFinite(parsed.storedAt)) return null
    if (!Array.isArray(parsed.value?.rows)) return null
    const ageMs = Math.max(Date.now() - parsed.storedAt, 0)
    if (ageMs > STALE_TTL_MS) return null
    return { value: parsed.value, ageMs }
  } catch {
    return null
  }
}

async function writeDisk(value: EconomicPayload): Promise<void> {
  const target = cachePath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  const document: DiskDocument = { version: CACHE_VERSION, storedAt: Date.now(), value }
  await writeFile(temporary, JSON.stringify(document), 'utf8')
  await rename(temporary, target)
}

/** Drop the cached payload, for Reset Cache and Clear All User Data. */
export async function clearEconomicCache(): Promise<void> {
  await rm(dirname(cachePath()), { recursive: true, force: true })
}

/* ------------------------------------------------------------------- http */

async function httpGet(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { headers: REQUEST_HEADERS, signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

/** Run `worker` over `items` with at most `limit` in flight, preserving input order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.max(Math.min(limit, items.length), 1) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

/* ----------------------------------------------------------------- parsing */

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

function csvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map(splitCsvLine)
}

/**
 * Coerce a CSV cell to a number, rejecting the sentinels the providers use.
 *
 * `Number('')` is 0 and `Number('.')` is NaN, so the empty check has to come first or every
 * unauctioned tenor and every suppressed FRED observation lands in the series as a real
 * zero.
 */
function cell(value: string | undefined): number | null {
  const text = (value ?? '').replace(/,/g, '').trim()
  if (!text || text === '.') return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

/**
 * Normalize a provider date to `YYYY-MM-DD`.
 *
 * Treasury writes `MM/DD/YYYY` and FRED writes ISO, so neither format can be assumed.
 */
function isoStamp(value: string): string {
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const parts = text.split('/')
  if (parts.length === 3) {
    const [month, day, year] = parts.map((part) => Number(part))
    if ([month, day, year].every(Number.isFinite)) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : ''
}

function sortPoints(points: EconomicPoint[]): EconomicPoint[] {
  points.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
  return points
}

/**
 * Parse a FRED CSV body into ascending `(iso_date, value)` pairs.
 *
 * FRED emits `.` for a missing observation and has used both `DATE` and `observation_date`
 * as the first column header over time, so neither the header name nor the cell type can be
 * assumed.
 */
export function parseFredCsv(text: string): EconomicPoint[] {
  const rows = csvRows(text)
  if (rows.length < 2 || rows[0].length < 2) return []
  const points: EconomicPoint[] = []
  for (const row of rows.slice(1)) {
    const stamp = isoStamp(row[0] ?? '')
    const value = cell(row[1])
    if (!stamp || value === null) continue
    points.push([stamp, value])
  }
  return sortPoints(points)
}

/**
 * Parse one yearly treasury rates CSV into `{column_label: points}`.
 *
 * The column set changes between years — `4 Mo` and `1.5 Month` were added partway
 * through — and a tenor that was not auctioned on a given day is blank, so columns are read
 * by name and coerced individually rather than by position.
 */
export function parseTreasuryCsv(text: string): Map<string, EconomicPoint[]> {
  const rows = csvRows(text)
  const series = new Map<string, EconomicPoint[]>()
  if (rows.length < 2 || rows[0].length < 2) return series
  const header = rows[0]
  for (const row of rows.slice(1)) {
    const stamp = isoStamp(row[0] ?? '')
    if (!stamp) continue
    for (let column = 1; column < header.length; column += 1) {
      const value = cell(row[column])
      if (value === null) continue
      const label = header[column]
      const bucket = series.get(label)
      if (bucket) bucket.push([stamp, value])
      else series.set(label, [[stamp, value]])
    }
  }
  for (const points of series.values()) sortPoints(points)
  return series
}

/**
 * Turn a BLS API response into `{series_id: points}`.
 *
 * BLS periods are codes rather than dates: `M01`-`M12` are months, `Q01`-`Q04` are quarters,
 * and `M13`/`S03` are annual and semiannual averages that would otherwise land on top of a
 * real observation.
 */
export function parseBlsPayload(payload: unknown): Map<string, EconomicPoint[]> {
  const out = new Map<string, EconomicPoint[]>()
  const document = payload as { Results?: { series?: unknown[] } } | null
  for (const entry of document?.Results?.series ?? []) {
    const record = entry as {
      seriesID?: string
      data?: Array<{ year?: unknown; period?: unknown; value?: unknown }>
    }
    const seriesId = String(record?.seriesID ?? '').trim()
    if (!seriesId) continue
    const points: EconomicPoint[] = []
    for (const observation of record.data ?? []) {
      const stamp = blsPeriodToDate(observation?.year, observation?.period)
      const value = cell(String(observation?.value ?? ''))
      if (!stamp || value === null) continue
      points.push([stamp, value])
    }
    out.set(seriesId, sortPoints(points))
  }
  return out
}

function blsPeriodToDate(year: unknown, period: unknown): string | null {
  const yearValue = Number(String(year ?? '').trim())
  if (!Number.isFinite(yearValue)) return null
  const code = String(period ?? '').trim().toUpperCase()
  if (code.length !== 3) return null
  const ordinal = Number(code.slice(1))
  if (!Number.isFinite(ordinal)) return null
  let month: number
  if (code[0] === 'M') {
    // M13 is the annual average, which is not an observation in the monthly series.
    if (ordinal < 1 || ordinal > 12) return null
    month = ordinal
  } else if (code[0] === 'Q') {
    if (ordinal < 1 || ordinal > 4) return null
    month = ordinal * 3
  } else return null
  return `${String(Math.trunc(yearValue)).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
}

/** Parse an NY Fed reference-rate JSON body into ascending points. */
export function parseNyfedRates(text: string): EconomicPoint[] {
  let document: { refRates?: Array<{ effectiveDate?: string; percentRate?: unknown }> }
  try {
    document = JSON.parse(text)
  } catch {
    return []
  }
  const points: EconomicPoint[] = []
  for (const row of document?.refRates ?? []) {
    const stamp = isoStamp(String(row?.effectiveDate ?? ''))
    const value = Number(row?.percentRate)
    if (!stamp || !Number.isFinite(value)) continue
    points.push([stamp, value])
  }
  return sortPoints(points)
}

const MONTH_NAMES = new Map(
  [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ].map((name, index) => [name, index + 1]),
)

/** Parse the UMich sentiment CSV (`Month,YYYY,ICS_ALL`) into ascending points. */
export function parseUmichCsv(text: string): EconomicPoint[] {
  const rows = csvRows(text)
  if (rows.length < 2 || rows[0].length < 3) return []
  const points: EconomicPoint[] = []
  for (const row of rows.slice(1)) {
    const month = MONTH_NAMES.get((row[0] ?? '').trim().toLowerCase())
    const year = cell(row[1])
    const value = cell(row[2])
    if (month === undefined || year === null || value === null) continue
    points.push([
      `${String(Math.trunc(year)).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`,
      value,
    ])
  }
  return sortPoints(points)
}

/* --------------------------------------------------------------- providers */

/** Download one FRED series and return ascending `(iso_date, value)` pairs. */
export async function fetchSeriesCsv(seriesId: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<EconomicPoint[]> {
  const identifier = seriesId.trim().toUpperCase()
  if (!identifier) return []
  return parseFredCsv(await httpGet(FRED_CSV_URL.replace('{series_id}', identifier), timeoutMs))
}

/**
 * Download the daily par yield curve and merge the yearly files into one series per tenor.
 *
 * Treasury serves one CSV per calendar year, so a decade of history is a fan-out rather than
 * a single request. A year that fails is skipped: a gap in old history is far better than
 * losing the current curve.
 */
export async function fetchTreasuryCurve(
  kind = TREASURY_KIND_NOMINAL,
  years = HISTORY_YEARS,
): Promise<Map<string, EconomicPoint[]>> {
  const span = Math.max(Math.trunc(years) || HISTORY_YEARS, 1)
  const thisYear = new Date().getFullYear()
  const wanted = Array.from({ length: span }, (_, index) => thisYear - span + 1 + index)
  const chunks = await mapLimit(wanted, MAX_WORKERS, async (year) => {
    try {
      const text = await httpGet(
        TREASURY_CSV_URL.replaceAll('{year}', String(year)).replace('{kind}', kind),
        TREASURY_REQUEST_TIMEOUT_MS,
      )
      return parseTreasuryCsv(text)
    } catch {
      return new Map<string, EconomicPoint[]>()
    }
  })
  const merged = new Map<string, EconomicPoint[]>()
  for (const chunk of chunks) {
    for (const [column, points] of chunk) {
      const bucket = merged.get(column)
      if (bucket) bucket.push(...points)
      else merged.set(column, [...points])
    }
  }
  if (!merged.size) throw new Error('Treasury yield curve returned no data')
  for (const points of merged.values()) sortPoints(points)
  return merged
}

/** Fetch BLS series in batches of 25, which is the unregistered per-request ceiling. */
export async function fetchBlsBatch(
  seriesIds: readonly string[],
  years = BLS_MAX_YEARS,
): Promise<Map<string, EconomicPoint[]>> {
  const identifiers = seriesIds.map((item) => item.trim()).filter(Boolean)
  const out = new Map<string, EconomicPoint[]>()
  if (!identifiers.length) return out
  const span = Math.min(Math.max(Math.trunc(years) || BLS_MAX_YEARS, 1), BLS_MAX_YEARS)
  const endYear = new Date().getFullYear()
  const startYear = endYear - span + 1
  for (let offset = 0; offset < identifiers.length; offset += BLS_MAX_SERIES_PER_REQUEST) {
    const chunk = identifiers.slice(offset, offset + BLS_MAX_SERIES_PER_REQUEST)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 2)
    try {
      const response = await fetch(BLS_API_URL, {
        method: 'POST',
        headers: { ...REQUEST_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seriesid: chunk,
          startyear: String(startYear),
          endyear: String(endYear),
        }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = (await response.json()) as { status?: string }
      const status = String(payload?.status ?? '')
      // The daily quota and malformed-series errors both arrive as a 200 with a status
      // string, so the HTTP code alone cannot be trusted here.
      if (status && status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS request rejected: ${status}`)
      for (const [key, points] of parseBlsPayload(payload)) out.set(key, points)
    } finally {
      clearTimeout(timer)
    }
  }
  return out
}

/** Fetch one NY Fed reference rate, given a `'<group>/<kind>'` key. */
export async function fetchNyfedRate(rateKey: string, years = HISTORY_YEARS): Promise<EconomicPoint[]> {
  const key = rateKey.trim().replace(/^\/+|\/+$/g, '')
  if (!key.includes('/')) return []
  const [group, kind] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)]
  const span = Math.max(Math.trunc(years) || HISTORY_YEARS, 1)
  const end = new Date()
  const start = new Date(end.getTime() - span * 366 * 86_400_000)
  const url = NYFED_RATE_URL.replace('{group}', group)
    .replace('{kind}', kind)
    .replace('{start}', start.toISOString().slice(0, 10))
    .replace('{end}', end.toISOString().slice(0, 10))
  return parseNyfedRates(await httpGet(url, REQUEST_TIMEOUT_MS * 2))
}

/** Fetch the University of Michigan index of consumer sentiment. */
export async function fetchUmichSentiment(): Promise<EconomicPoint[]> {
  return parseUmichCsv(await httpGet(UMICH_SENTIMENT_URL, REQUEST_TIMEOUT_MS * 2))
}

/* --------------------------------------------------------------- resolvers */

type Resolved = Map<string, EconomicPoint[]>

/**
 * The three treasury providers share one resolver group because they all come out of the
 * same pair of curve downloads; grouping them stops the curve being fetched three times.
 */
function resolverGroup(provider: EconomicProvider): EconomicProvider {
  return provider === 'treasury_spread' || provider === 'treasury_breakeven' ? 'treasury' : provider
}

/** Resolve every tenor, spread and breakeven from at most two curve downloads. */
async function resolveTreasury(catalog: readonly EconomicSeries[]): Promise<Resolved> {
  const needsReal = catalog.some(
    (series) =>
      series.provider === 'treasury_breakeven' ||
      (series.provider === 'treasury' && (series.providerKey ?? '').startsWith('real:')),
  )
  // The two curves are independent downloads of about 40s each against a host that takes
  // 18-20s per yearly file, so running them back to back doubled the refresh for no reason.
  // Overlap them; each still fans its years out over MAX_WORKERS. Losing TIPS costs only
  // breakevens, so its failure is swallowed while the nominal curve's is not.
  const [nominal, real] = await Promise.all([
    fetchTreasuryCurve(TREASURY_KIND_NOMINAL),
    needsReal
      ? fetchTreasuryCurve(TREASURY_KIND_REAL).catch(() => new Map<string, EconomicPoint[]>())
      : Promise.resolve(new Map<string, EconomicPoint[]>()),
  ])
  const resolved: Resolved = new Map()
  for (const series of catalog) {
    const key = series.providerKey ?? ''
    if (series.provider === 'treasury') {
      const source = key.startsWith('real:') ? real.get(key.slice(5).trim()) : nominal.get(key)
      resolved.set(series.seriesId, [...(source ?? [])])
    } else if (series.provider === 'treasury_spread' && key.includes('|')) {
      const [left, right] = key.split('|').map((part) => part.trim())
      resolved.set(series.seriesId, alignDifference(nominal.get(left), nominal.get(right)))
    } else if (series.provider === 'treasury_breakeven' && key.includes('|')) {
      const [left, right] = key.split('|').map((part) => part.trim())
      resolved.set(series.seriesId, alignDifference(nominal.get(left), real.get(right)))
    }
  }
  return resolved
}

async function resolveBls(catalog: readonly EconomicSeries[]): Promise<Resolved> {
  const byKey = new Map(
    catalog.filter((series) => series.providerKey).map((series) => [series.providerKey!, series.seriesId]),
  )
  const fetched = await fetchBlsBatch([...byKey.keys()])
  const resolved: Resolved = new Map()
  for (const [key, seriesId] of byKey) resolved.set(seriesId, [...(fetched.get(key) ?? [])])
  return resolved
}

async function resolveNyfed(catalog: readonly EconomicSeries[]): Promise<Resolved> {
  const resolved: Resolved = new Map()
  for (const series of catalog) {
    resolved.set(series.seriesId, await fetchNyfedRate(series.providerKey ?? ''))
  }
  return resolved
}

async function resolveUmich(catalog: readonly EconomicSeries[]): Promise<Resolved> {
  const points = await fetchUmichSentiment()
  const resolved: Resolved = new Map()
  for (const series of catalog) resolved.set(series.seriesId, [...points])
  return resolved
}

const BATCH_RESOLVERS: Partial<Record<EconomicProvider, (catalog: readonly EconomicSeries[]) => Promise<Resolved>>> = {
  treasury: resolveTreasury,
  bls: resolveBls,
  nyfed: resolveNyfed,
  umich: resolveUmich,
}

/**
 * Download the per-series FRED fallback, giving up once the host looks unreachable.
 *
 * Every catalog entry is keyed by its FRED series id even where a direct provider serves it,
 * so anything a batch left empty can still be retried here. Restricting this to FRED-native
 * series meant one slow or blocked host blanked its whole group while the same numbers sat
 * on the fallback a second away.
 */
async function fetchFallback(
  fallback: readonly EconomicSeries[],
  unreachable: EconomicProvider[],
): Promise<Resolved> {
  const resolved: Resolved = new Map()
  if (!fallback.length) return resolved
  let successes = 0
  let failures = 0
  let blackout = false

  const one = async (series: EconomicSeries, timeoutMs?: number): Promise<EconomicPoint[]> => {
    if (blackout) return []
    try {
      return await fetchSeriesCsv(series.seriesId, timeoutMs ?? REQUEST_TIMEOUT_MS)
    } catch {
      return []
    }
  }

  // Probe with the first series before fanning out. One short timeout is the whole cost of a
  // blocked FRED, instead of one full timeout for every remaining series.
  const [probe, ...pending] = fallback
  const probed = await one(probe, FRED_PROBE_TIMEOUT_MS)
  resolved.set(probe.seriesId, probed)
  if (probed.length) successes += 1
  else blackout = true

  if (pending.length) {
    const found = await mapLimit(pending, MAX_WORKERS, async (series) => {
      const points = await one(series)
      if (points.length) {
        successes += 1
        failures = 0
      } else {
        failures += 1
        if (successes === 0 && failures >= PROVIDER_BLACKOUT_THRESHOLD) blackout = true
      }
      return points
    })
    pending.forEach((series, index) => resolved.set(series.seriesId, found[index]))
  }
  if (blackout) unreachable.push('fred')
  return resolved
}

/* ------------------------------------------------------------------- fetch */

function planBatches(catalog: readonly EconomicSeries[]): Map<EconomicProvider, EconomicSeries[]> {
  const batches = new Map<EconomicProvider, EconomicSeries[]>()
  for (const series of catalog) {
    const provider = series.provider ?? 'fred'
    if (provider === 'fred') continue
    const name = resolverGroup(provider)
    const bucket = batches.get(name)
    if (bucket) bucket.push(series)
    else batches.set(name, [series])
  }
  return batches
}

/**
 * Resolve every series in the requested groups and build the payload.
 *
 * Batched providers run first and in parallel, then anything still empty falls back to one
 * FRED download per series. A failure never raises: the series lands in `missing` and the
 * page renders the rest, because one unreachable host must not blank the page.
 */
async function buildPayload(groups: EconomicGroup[]): Promise<EconomicPayload> {
  const catalog = ECONOMIC_SERIES.filter((series) => groups.includes(series.group))
  const resolved: Resolved = new Map()
  const unreachable: EconomicProvider[] = []

  const batches = [...planBatches(catalog)]
  const results = await Promise.all(
    batches.map(async ([name, members]) => {
      try {
        return { name, resolved: await BATCH_RESOLVERS[name]!(members) }
      } catch {
        return { name, resolved: null }
      }
    }),
  )
  for (const result of results) {
    if (result.resolved === null) unreachable.push(result.name)
    else for (const [key, points] of result.resolved) resolved.set(key, points)
  }

  const fallback = catalog.filter((series) => !resolved.get(series.seriesId)?.length)
  for (const [key, points] of await fetchFallback(fallback, unreachable)) resolved.set(key, points)

  // A provider whose series were all recovered from FRED is not worth reporting as down: the
  // page has the numbers, so the status line should name only the real gaps.
  const stillEmpty = new Set(
    catalog
      .filter((series) => !resolved.get(series.seriesId)?.length)
      .map((series) => resolverGroup(series.provider ?? 'fred')),
  )
  const reported = [...new Set(unreachable.filter((name) => stillEmpty.has(name)))].sort()

  const rows: EconomicRow[] = []
  const missing: string[] = []
  for (const series of catalog) {
    const points = resolved.get(series.seriesId) ?? []
    if (!points.length) missing.push(series.seriesId)
    rows.push(buildRow(series, points))
  }
  const order = new Map(ECONOMIC_SERIES.map((series, index) => [series.seriesId, index]))
  rows.sort((left, right) => (order.get(left.seriesId) ?? 10_000) - (order.get(right.seriesId) ?? 10_000))

  return {
    generatedAt: new Date().toISOString().slice(0, 19),
    source: ECONOMIC_SOURCE,
    groups,
    rows,
    missing,
    unreachable: reported,
    yieldCurve: buildYieldCurve(rows),
  }
}

/**
 * The Economic payload, cached on disk for six hours and served stale for up to a week.
 *
 * The cache is on disk rather than in the shared `TtlCache` because this page paints from
 * it on the very first frame after a cold start: a decade of treasury CSVs is the slowest
 * load in the app, and an in-memory entry would be gone by the next launch.
 */
export async function getEconomic(request: EconomicRequest = {}): Promise<EconomicFetchResult> {
  const groups = normalizeGroups(null)
  const disk = await readDisk()
  if (!request.force && disk && disk.ageMs <= PAYLOAD_TTL_MS) {
    return { payload: disk.value, fromCache: true, stale: false, cacheAgeSeconds: disk.ageMs / 1000 }
  }
  try {
    const payload = await buildPayload(groups)
    if (!payload.rows.some((row) => row.available) && disk?.value.rows.some((row) => row.available)) {
      // A total blackout must never overwrite a good cached payload with an empty one.
      return {
        payload: disk.value,
        fromCache: true,
        stale: true,
        cacheAgeSeconds: disk.ageMs / 1000,
      }
    }
    await writeDisk(payload).catch(() => {})
    return { payload, fromCache: false, stale: false, cacheAgeSeconds: 0 }
  } catch (error) {
    if (!disk) throw error
    return { payload: disk.value, fromCache: true, stale: true, cacheAgeSeconds: disk.ageMs / 1000 }
  }
}

/** The provider names behind a payload's gaps, for the envelope's error list. */
export function economicErrors(payload: EconomicPayload): Array<{ source: string; reason: string; operation: string }> {
  return payload.unreachable.map((provider) => ({
    source: ECONOMIC_SOURCE,
    operation: 'economic',
    reason: `${PROVIDER_LABELS[provider] ?? provider} was unreachable from this network.`,
  }))
}
