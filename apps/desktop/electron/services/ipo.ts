/**
 * The IPO page's two loads, ported from `workers/ipo_calendar.py` (`IpoCalendarWorker`
 * and `CompletedIpoWorker`, page21).
 *
 * Both are a GET of one stockanalysis.com page, a table read out of its HTML, and a JSON
 * file on disk that the page paints from before anything touches the network. They are
 * completely independent: the reference launches a worker each and a failure in one leaves
 * the other's table on screen, which is what the page's two status lines assume.
 *
 * stockanalysis.com is not Yahoo, so **none of this goes through `paced()`** — the
 * `fearGreed.ts` precedent. Putting an unrelated host behind the Yahoo gate would let one
 * slow scrape throttle every other page in the app.
 *
 * There is no refresh timer. `init_page21` fires no request at all: it restores both
 * caches and stops, and every network load after that is the Refresh button or F5.
 *
 * Each feed has the reference's own two-source chain: StockAnalysis first, then Yahoo's
 * IPO calendar (`services/yahoo/ipoCalendar.ts`). The fallback is silent by design — the
 * reference logs it at INFO and returns the rows — and the payload's `source` is what
 * tells the page which one answered. Only when *both* fail does the load fall through to
 * the stale disk cache and the warning status line.
 *
 * That matters more here than it does in the reference: stockanalysis.com now sits behind
 * a Cloudflare interactive challenge and answers a plain HTTP client with `403`
 * (`cf-mitigated: challenge`) — the PySide6 app included. Until that changes, the Yahoo
 * fallback is in practice the source, and it is a much thinner one: a listing date, an
 * exchange, sometimes a price and a share count, and nothing else.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  CompletedIpoRow,
  EnvelopeError,
  IpoCompletedPayload,
  IpoUpcomingPayload,
  UpcomingIpoRow,
} from '../shared/contract.js'
import { err } from '../shared/envelope.js'
import {
  cleanText,
  completedIpoSourceUrl,
  completedWindow,
  IPO_CALENDAR_TTL_MS,
  IPO_COMPLETED_SOURCE_NAME,
  IPO_UPCOMING_SOURCE_NAME,
  IPO_UPCOMING_SOURCE_URL,
  IPO_YAHOO_SOURCE_NAME,
  IPO_YAHOO_SOURCE_URL,
  normalizeCompletedRows,
  normalizeUpcomingRows,
  parseIpoDate,
  todayIso,
  upcomingEndDate,
} from '../shared/ipo.js'
import { parseTables } from './etf/html.js'
import { httpGet } from './news/http.js'
import { fetchYahooCompletedIpos, fetchYahooUpcomingIpos } from './yahoo/ipoCalendar.js'

export const IPO_UPCOMING_SOURCE = 'stockanalysis ipo calendar'
export const IPO_COMPLETED_SOURCE = 'stockanalysis completed ipos'

/** `_HTTP_HEADERS`. StockAnalysis serves a default agent a challenge page, not a table. */
const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BudgetTerminal/1.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

/** `_HTTP_TIMEOUT_SECONDS`. */
const REQUEST_TIMEOUT_MS = 20_000

/** A completed-IPO year runs to a few hundred rows of markup; the cap is generous. */
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024

/**
 * Stamped into every cache entry and checked on the way back out, so an entry written by
 * an older payload shape is dropped rather than rendered.
 */
const CACHE_VERSION = 1

/* ------------------------------------------------------------------ caching */

interface DiskDocument<T> {
  version: number
  storedAt: number
  value: T
}

/**
 * This app owns its own store. The reference writes
 * `%LOCALAPPDATA%\BudgetTerminal\ipo_calendar_cache\`; that file is never touched here.
 */
function cachePath(name: string): string {
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'ipo-cache', name)
}

async function readDisk<T>(name: string): Promise<{ value: T; ageMs: number } | null> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(name), 'utf8')) as DiskDocument<T>
    if (parsed.version !== CACHE_VERSION || !Number.isFinite(parsed.storedAt)) return null
    if (!parsed.value || typeof parsed.value !== 'object') return null
    return { value: parsed.value, ageMs: Math.max(Date.now() - parsed.storedAt, 0) }
  } catch {
    return null
  }
}

async function writeDisk<T>(name: string, value: T): Promise<void> {
  const target = cachePath(name)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  const document: DiskDocument<T> = { version: CACHE_VERSION, storedAt: Date.now(), value }
  await writeFile(temporary, JSON.stringify(document), 'utf8')
  await rename(temporary, target)
}

/** Drop both cached feeds, for Reset Cache and Clear All User Data. */
export async function clearIpoCache(): Promise<void> {
  await rm(dirname(cachePath('upcoming.json')), { recursive: true, force: true })
}

/* --------------------------------------------------------------------- http */

async function fetchHtml(url: string): Promise<string> {
  const response = await httpGet(url, {
    headers: REQUEST_HEADERS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxBytes: MAX_RESPONSE_BYTES,
  })
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
  return response.body.toString('utf8')
}

/* ------------------------------------------------------------------ parsing */

/**
 * `_row_from_cells`: read the cells by the header above them rather than by position, so
 * a column StockAnalysis adds or reorders cannot silently shift every value one to the
 * left. `parseTables` lower-cases its headers, hence the lower-cased lookups.
 */
function byHeader(headers: string[], values: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (let index = 0; index < Math.min(headers.length, values.length); index += 1) {
    if (!map.has(headers[index])) map.set(headers[index], cleanText(values[index]))
  }
  return map
}

function pick(row: Map<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = row.get(name)
    if (value) return value
  }
  return ''
}

function hasHeaders(headers: string[], required: string[]): boolean {
  return required.every((name) => headers.includes(name))
}

/** `IpoCalendarWorker.parse_html`, over every table on the page. */
export function parseUpcomingHtml(html: string, today: string): UpcomingIpoRow[] {
  const endDate = upcomingEndDate(today)
  const rows: UpcomingIpoRow[] = []
  for (const table of parseTables(html)) {
    if (!hasHeaders(table.headers, ['ipo date', 'symbol'])) continue
    for (const cells of table.rows) {
      const row = byHeader(table.headers, cells)
      const dateDisplay = pick(row, 'ipo date')
      const symbol = pick(row, 'symbol').toUpperCase()
      const company = pick(row, 'company name')
      if (!dateDisplay || (!symbol && !company)) continue
      const isoDate = parseIpoDate(dateDisplay)
      if (isoDate === null || isoDate < today || isoDate > endDate) continue
      rows.push({
        date: isoDate,
        dateDisplay,
        symbol: symbol || '--',
        company: company || '--',
        exchange: pick(row, 'exchange') || '--',
        priceRange: pick(row, 'price range') || '--',
        sharesOffered: pick(row, 'shares offered') || '--',
        dealSize: pick(row, 'deal size') || '--',
        marketCap: pick(row, 'market cap') || '--',
        revenue: pick(row, 'revenue') || '--',
      })
    }
  }
  // The same normalisation the cache round-trip applies, so a live load and a cached one
  // cannot differ: it dedupes and orders the rows.
  return normalizeUpcomingRows(rows, today)
}

/** `CompletedIpoWorker.parse_html`. The extra `IPO Price` header is what tells the two
 *  stockanalysis tables apart — a completed page also carries an `IPO Date`/`Symbol` one. */
export function parseCompletedHtml(html: string, year: number, today: string): CompletedIpoRow[] {
  const { start, end } = completedWindow(year, today)
  const rows: CompletedIpoRow[] = []
  for (const table of parseTables(html)) {
    if (!hasHeaders(table.headers, ['ipo date', 'symbol', 'ipo price'])) continue
    for (const cells of table.rows) {
      const row = byHeader(table.headers, cells)
      const dateDisplay = pick(row, 'ipo date')
      const symbol = pick(row, 'symbol').toUpperCase()
      const company = pick(row, 'company name', 'company')
      if (!dateDisplay || (!symbol && !company)) continue
      const isoDate = parseIpoDate(dateDisplay)
      if (isoDate === null || isoDate < start || isoDate > end) continue
      rows.push({
        date: isoDate,
        dateDisplay,
        symbol: symbol || '--',
        company: company || '--',
        ipoPrice: pick(row, 'ipo price') || '--',
        currentPrice: pick(row, 'current') || '--',
        returnPct: pick(row, 'return') || '--',
      })
    }
  }
  return normalizeCompletedRows(rows, year, today)
}

/* -------------------------------------------------------------------- loads */

export interface IpoUpcomingFetchResult {
  payload: IpoUpcomingPayload
  errors: EnvelopeError[]
}

export interface IpoCompletedFetchResult {
  payload: IpoCompletedPayload
  errors: EnvelopeError[]
}

/** What a load with no cache and no answer renders. */
export function emptyUpcomingIpoPayload(today = todayIso()): IpoUpcomingPayload {
  return {
    rows: [],
    source: IPO_UPCOMING_SOURCE_NAME,
    sourceUrl: IPO_UPCOMING_SOURCE_URL,
    fetchedAt: 0,
    fromCache: false,
    cacheAgeSeconds: null,
    stale: false,
    warning: '',
    endDate: upcomingEndDate(today),
    estimatedDates: true,
  }
}

export function emptyCompletedIpoPayload(year: number): IpoCompletedPayload {
  return {
    rows: [],
    source: IPO_COMPLETED_SOURCE_NAME,
    sourceUrl: completedIpoSourceUrl(year),
    fetchedAt: 0,
    fromCache: false,
    cacheAgeSeconds: null,
    stale: false,
    warning: '',
    year,
  }
}

const UPCOMING_CACHE_FILE = 'upcoming.json'

/** What a live load produced, and which of the two sources produced it. */
interface LiveRows<T> {
  rows: T[]
  source: string
  sourceUrl: string
}

/**
 * `IpoCalendarWorker.fetch_live_payload`: StockAnalysis, and on *any* failure Yahoo's
 * calendar. The fallback is not an error — the reference logs it at INFO and returns the
 * rows — so nothing is reported beyond the source name the payload carries.
 */
async function liveUpcoming(today: string): Promise<LiveRows<UpcomingIpoRow>> {
  const endDate = upcomingEndDate(today)
  try {
    return {
      rows: parseUpcomingHtml(await fetchHtml(IPO_UPCOMING_SOURCE_URL), today),
      source: IPO_UPCOMING_SOURCE_NAME,
      sourceUrl: IPO_UPCOMING_SOURCE_URL,
    }
  } catch {
    return {
      rows: normalizeUpcomingRows(await fetchYahooUpcomingIpos(today, endDate), today),
      source: IPO_YAHOO_SOURCE_NAME,
      sourceUrl: IPO_YAHOO_SOURCE_URL,
    }
  }
}

/** `CompletedIpoWorker.fetch_live_payload`, over the target year's own window. */
async function liveCompleted(year: number, today: string): Promise<LiveRows<CompletedIpoRow>> {
  const sourceUrl = completedIpoSourceUrl(year)
  const { start, end } = completedWindow(year, today)
  try {
    return {
      rows: parseCompletedHtml(await fetchHtml(sourceUrl), year, today),
      source: IPO_COMPLETED_SOURCE_NAME,
      sourceUrl,
    }
  } catch {
    return {
      rows: normalizeCompletedRows(await fetchYahooCompletedIpos(start, end), year, today),
      source: IPO_YAHOO_SOURCE_NAME,
      sourceUrl: IPO_YAHOO_SOURCE_URL,
    }
  }
}

function completedCacheFile(year: number): string {
  return `completed-${year}.json`
}

/**
 * `IpoCalendarWorker.fetch`.
 *
 * Unless forced, a cache inside the 24h TTL short-circuits the network entirely — that is
 * what makes opening the page free. A failed fetch falls back to the cache *however old it
 * is* and flags it stale; note the reference's asymmetry, kept here: the upcoming fallback
 * only counts when the cache still has rows, because an empty stale cache is no better
 * than the error.
 */
export async function getUpcomingIpos(force = false): Promise<IpoUpcomingFetchResult> {
  const today = todayIso()
  const cached = await readDisk<IpoUpcomingPayload>(UPCOMING_CACHE_FILE)

  const fromCache = (entry: { value: IpoUpcomingPayload; ageMs: number }): IpoUpcomingPayload => ({
    ...entry.value,
    // Re-normalising on the way out is the reference's `_normalize_cached_rows` on read:
    // it re-applies the date window, so a row that fell behind today disappears without a
    // refetch.
    rows: normalizeUpcomingRows(entry.value.rows, today),
    endDate: upcomingEndDate(today),
    fromCache: true,
    cacheAgeSeconds: entry.ageMs / 1000,
    stale: false,
    warning: '',
  })

  if (!force && cached && cached.ageMs <= IPO_CALENDAR_TTL_MS) {
    return { payload: fromCache(cached), errors: [] }
  }

  try {
    const live = await liveUpcoming(today)
    const payload: IpoUpcomingPayload = {
      rows: live.rows,
      source: live.source,
      sourceUrl: live.sourceUrl,
      fetchedAt: Date.now(),
      fromCache: false,
      cacheAgeSeconds: 0,
      stale: false,
      warning: '',
      endDate: upcomingEndDate(today),
      estimatedDates: true,
    }
    await writeDisk(UPCOMING_CACHE_FILE, payload)
    return { payload, errors: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (cached && cached.value.rows?.length) {
      return {
        payload: { ...fromCache(cached), stale: true, warning: reason },
        errors: [err(IPO_UPCOMING_SOURCE, reason, 'ipo-upcoming')],
      }
    }
    throw error
  }
}

/**
 * `CompletedIpoWorker.fetch`. Same shape, and the same one difference the reference has:
 * a stale cache stands in even when it is empty, because an empty completed year is a
 * meaningful answer where an empty upcoming calendar is not.
 */
export async function getCompletedIpos(
  year: number,
  force = false,
): Promise<IpoCompletedFetchResult> {
  const today = todayIso()
  const file = completedCacheFile(year)
  const cached = await readDisk<IpoCompletedPayload>(file)

  const fromCache = (entry: { value: IpoCompletedPayload; ageMs: number }): IpoCompletedPayload => ({
    ...entry.value,
    rows: normalizeCompletedRows(entry.value.rows, year, today),
    year,
    fromCache: true,
    cacheAgeSeconds: entry.ageMs / 1000,
    stale: false,
    warning: '',
  })

  if (!force && cached && cached.ageMs <= IPO_CALENDAR_TTL_MS) {
    return { payload: fromCache(cached), errors: [] }
  }

  try {
    const live = await liveCompleted(year, today)
    const payload: IpoCompletedPayload = {
      rows: live.rows,
      source: live.source,
      sourceUrl: live.sourceUrl,
      fetchedAt: Date.now(),
      fromCache: false,
      cacheAgeSeconds: 0,
      stale: false,
      warning: '',
      year,
    }
    await writeDisk(file, payload)
    return { payload, errors: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (cached) {
      return {
        payload: { ...fromCache(cached), stale: true, warning: reason },
        errors: [err(IPO_COMPLETED_SOURCE, reason, 'ipo-completed')],
      }
    }
    throw error
  }
}
