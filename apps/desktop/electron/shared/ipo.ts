/**
 * The IPO page's dates, row normalisation and sort keys, ported from
 * `mixins/ipo_page.py` (page21) and `workers/ipo_calendar.py`.
 *
 * Nothing here is financial maths — the page passes scraped text through and only ever
 * parses a date. What it does own is every rule that decides which rows survive: the two
 * calendar windows, the two dedupe orderings, and the sort keys that make a price *range*
 * and a signed percentage sort the way the reference sorts them.
 *
 * No Electron and no React imports, like every other `shared/` module: the main process
 * normalises with these on the way into the disk cache, the page sorts with them, and the
 * probe asserts them.
 */

import type { CompletedIpoRow, UpcomingIpoRow } from './contract.js'

/** `IPO_CALENDAR_CACHE_TTL_SECONDS`, in the milliseconds this app counts in. */
export const IPO_CALENDAR_TTL_MS = 24 * 60 * 60_000

export const IPO_UPCOMING_SOURCE_NAME = 'StockAnalysis IPO Calendar'
export const IPO_UPCOMING_SOURCE_URL = 'https://stockanalysis.com/ipos/calendar/'
export const IPO_COMPLETED_SOURCE_NAME = 'StockAnalysis Completed IPOs'

/**
 * The fallback's name and the page a reader should open to check it.
 *
 * The reference calls this `yfinance IPO Calendar`; the rows come from the same Yahoo
 * endpoint yfinance posts to, but no yfinance is involved, so the label says Yahoo.
 */
export const IPO_YAHOO_SOURCE_NAME = 'Yahoo IPO Calendar'
export const IPO_YAHOO_SOURCE_URL = 'https://finance.yahoo.com/calendar/ipo'

/** `completed_ipo_source_url`. */
export function completedIpoSourceUrl(year: number): string {
  return `https://stockanalysis.com/ipos/${year}/`
}

/* --------------------------------------------------------------------- text */

/** `_clean_text`: NBSP becomes a space and runs of whitespace collapse to one. */
export function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/* --------------------------------------------------------------------- dates */

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** A civil date is an ISO `YYYY-MM-DD` string here, so every comparison is a string compare. */
function civil(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > days) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * `_parse_date`: ISO first (on the leading ten characters, which is how a cached row's
 * timestamped date still parses), then the four display formats StockAnalysis and the
 * yfinance frame use between them. `null` on anything else, which drops the row.
 */
export function parseIpoDate(value: unknown): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text.slice(0, 10))
  if (iso) return civil(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  // '%b %d, %Y' and '%B %d, %Y'. Python's strptime accepts an unpadded day for either.
  const named = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(text)
  if (named) {
    const name = named[1].toLowerCase()
    const month = MONTHS.findIndex((full) => full === name || full.slice(0, 3) === name)
    return month >= 0 ? civil(Number(named[3]), month + 1, Number(named[2])) : null
  }

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text)
  if (slashed) {
    const raw = Number(slashed[3])
    // '%y': Python maps 69-99 to the 1900s and 00-68 to the 2000s.
    const year = slashed[3].length === 2 ? (raw >= 69 ? 1900 + raw : 2000 + raw) : raw
    return civil(year, Number(slashed[1]), Number(slashed[2]))
  }

  return null
}

/** `_format_date`, `%b %d, %Y` — the day is zero-padded, as `%d` is. */
export function formatIpoDate(isoDate: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!parts) return ''
  return `${MONTH_ABBR[Number(parts[2]) - 1]} ${parts[3]}, ${parts[1]}`
}

/** Today as a civil ISO date in the machine's own zone, which is what `date.today()` is. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** `_upcoming_end_date`: 31 December of the current year, never a rolling window. */
export function upcomingEndDate(today: string): string {
  return `${today.slice(0, 4)}-12-31`
}

/**
 * The completed window: 1 January of the target year through today for the current year,
 * and through 31 December for any earlier one.
 */
export function completedWindow(year: number, today: string): { start: string; end: string } {
  const currentYear = Number(today.slice(0, 4))
  return {
    start: `${year}-01-01`,
    end: year === currentYear ? today : `${year}-12-31`,
  }
}

/* ------------------------------------------------------- yahoo fallback text */

/**
 * `_format_price`. Only the Yahoo fallback needs these: StockAnalysis publishes its
 * figures already formatted and the scrape passes them through untouched, while Yahoo
 * answers with raw numbers that have to be printed to match.
 *
 * Anything at or below zero is missing, not free — yfinance replaces a literal `0.0` with
 * NaN on exactly these columns before the reference ever reads them.
 */
export function formatIpoPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return '--'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * `_format_price_range`. A band whose ends are within half a cent of each other prints as
 * one price, which is how a fixed-price deal reads in the reference.
 */
export function formatIpoPriceRange(low: number | null, high: number | null): string {
  const lowValue = low !== null && Number.isFinite(low) && low > 0 ? low : null
  const highValue = high !== null && Number.isFinite(high) && high > 0 ? high : null
  if (lowValue === null && highValue === null) return '--'
  if (lowValue === null) return formatIpoPrice(highValue)
  if (highValue === null || Math.abs(highValue - lowValue) < 0.005) return formatIpoPrice(lowValue)
  return `${formatIpoPrice(lowValue)} - ${formatIpoPrice(highValue)}`
}

/** `_format_yfinance_quantity`: a share count with thousands separators and no decimals. */
export function formatIpoQuantity(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return '--'
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/* ------------------------------------------------------------------- dedupe */

interface Identity {
  date: string
  symbol: string
  company: string
}

function dedupeKey(row: Identity): string {
  return `${row.date}\u0000${row.symbol.toUpperCase()}\u0000${row.company.toLowerCase()}`
}

function sortKey(row: Identity): string {
  return `${row.date}\u0000${row.symbol}\u0000${row.company}`
}

function dedupe<T extends Identity>(rows: T[], descending: boolean): T[] {
  const ordered = [...rows].sort((a, b) => {
    const left = sortKey(a)
    const right = sortKey(b)
    if (left === right) return 0
    return (left < right ? -1 : 1) * (descending ? -1 : 1)
  })
  const seen = new Set<string>()
  const kept: T[] = []
  for (const row of ordered) {
    const key = dedupeKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(row)
  }
  return kept
}

/** `IpoCalendarWorker._dedupe_rows` — oldest first, so the next IPO is the top row. */
export function dedupeUpcoming(rows: UpcomingIpoRow[]): UpcomingIpoRow[] {
  return dedupe(rows, false)
}

/** `CompletedIpoWorker._dedupe_rows` — newest first, the reverse of the upcoming list. */
export function dedupeCompleted(rows: CompletedIpoRow[]): CompletedIpoRow[] {
  return dedupe(rows, true)
}

/* --------------------------------------------------------------- normalising */

const DASH = '--'

function field(value: unknown): string {
  return String(value ?? '').trim()
}

function orDash(value: string): string {
  return value || DASH
}

/**
 * `IpoCalendarWorker._normalize_cached_rows`.
 *
 * This runs on every cache read *and* every cache write, and it re-applies the date
 * window each time — which is why a table can shrink without a refetch on the day one of
 * its rows falls behind. Missing optional fields become the literal `'--'`; the reference
 * renders that string rather than an empty cell.
 */
export function normalizeUpcomingRows(raw: unknown, today: string): UpcomingIpoRow[] {
  if (!Array.isArray(raw)) return []
  const endDate = upcomingEndDate(today)
  const rows: UpcomingIpoRow[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Record<string, unknown>
    const isoDate = parseIpoDate(field(source.date) || field(source.dateDisplay))
    if (isoDate === null || isoDate < today || isoDate > endDate) continue
    rows.push({
      date: isoDate,
      dateDisplay: field(source.dateDisplay) || formatIpoDate(isoDate),
      symbol: orDash(field(source.symbol).toUpperCase()),
      company: orDash(field(source.company)),
      exchange: orDash(field(source.exchange)),
      priceRange: orDash(field(source.priceRange)),
      sharesOffered: orDash(field(source.sharesOffered)),
      dealSize: orDash(field(source.dealSize)),
      marketCap: orDash(field(source.marketCap)),
      revenue: orDash(field(source.revenue)),
    })
  }
  return dedupeUpcoming(rows)
}

/** `CompletedIpoWorker._normalize_cached_rows`, over the completed year's own window. */
export function normalizeCompletedRows(
  raw: unknown,
  year: number,
  today: string,
): CompletedIpoRow[] {
  if (!Array.isArray(raw)) return []
  const { start, end } = completedWindow(year, today)
  const rows: CompletedIpoRow[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Record<string, unknown>
    const isoDate = parseIpoDate(field(source.date) || field(source.dateDisplay))
    if (isoDate === null || isoDate < start || isoDate > end) continue
    rows.push({
      date: isoDate,
      dateDisplay: field(source.dateDisplay) || formatIpoDate(isoDate),
      symbol: orDash(field(source.symbol).toUpperCase()),
      company: orDash(field(source.company)),
      ipoPrice: orDash(field(source.ipoPrice)),
      currentPrice: orDash(field(source.currentPrice)),
      returnPct: orDash(field(source.returnPct)),
    })
  }
  return dedupeCompleted(rows)
}

/* ---------------------------------------------------------------- sort keys */

/**
 * `_p21_numeric_sort_value`. Two details are deliberate and both are load-bearing:
 *
 * - The K/M/B suffix is stripped *before* the range split, so `$1.2B - $2.4B` sorts as
 *   2.4 billion rather than 2.4.
 * - A remaining `-` splits the text and the *last* segment wins, so a price range sorts on
 *   its upper bound. That also means a negative number would be mangled here, which is why
 *   the Return column uses the percent key instead.
 */
export function ipoNumericSortValue(value: unknown): number {
  let text = String(value ?? '')
    .toUpperCase()
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .trim()
  if (!text || text === DASH || text === '-') return Number.NEGATIVE_INFINITY

  let multiplier = 1
  if (text.endsWith('B')) {
    multiplier = 1_000_000_000
    text = text.slice(0, -1)
  } else if (text.endsWith('M')) {
    multiplier = 1_000_000
    text = text.slice(0, -1)
  } else if (text.endsWith('K')) {
    multiplier = 1_000
    text = text.slice(0, -1)
  }

  if (text.includes('-')) text = (text.split('-').pop() ?? '').trim()

  const numeric = Number(text)
  if (text === '' || !Number.isFinite(numeric)) return Number.NEGATIVE_INFINITY
  return numeric * multiplier
}

/** `_p21_percent_sort_value`: signs survive, because there is no range to split here. */
export function ipoPercentSortValue(value: unknown): number {
  const text = String(value ?? '')
    .replace(/%/g, '')
    .replace(/,/g, '')
    .trim()
  if (!text || text === DASH || text === '-') return Number.NEGATIVE_INFINITY
  const numeric = Number(text)
  return Number.isFinite(numeric) ? numeric : Number.NEGATIVE_INFINITY
}

/* ------------------------------------------------------------------ display */

/** `_p21_format_timestamp`, `%Y-%m-%d %H:%M`. Empty when there is no usable stamp. */
export function ipoTimestamp(fetchedAt: number): string {
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return ''
  const when = new Date(fetchedAt)
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ` +
    `${pad(when.getHours())}:${pad(when.getMinutes())}`
  )
}

/** `_p21_format_age`: minutes under an hour, hours under two days, then days. */
export function formatCacheAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return ''
  const minutes = Math.max(seconds / 60, 0)
  if (minutes < 60) return `${minutes.toFixed(0)}m`
  const hours = minutes / 60
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

/** `_p21_cache_status_text`. */
export function cacheStatusText(cacheAgeSeconds: number | null, fetchedAt: number): string {
  const age = formatCacheAge(cacheAgeSeconds)
  if (age) {
    const fresh = (cacheAgeSeconds ?? 0) * 1000 <= IPO_CALENDAR_TTL_MS
    return `Cache ${fresh ? 'fresh' : 'stale'}: ${age} old`
  }
  const fetched = ipoTimestamp(fetchedAt)
  return fetched ? `Cached at ${fetched}` : 'Cache status unavailable'
}

/* ------------------------------------------------------------------- status */

export type IpoStatusTone = 'muted' | 'positive' | 'warning' | 'negative'

export interface IpoStatus {
  text: string
  tone: IpoStatusTone
}

export interface IpoStatusInput {
  rowCount: number
  source: string
  fetchedAt: number
  fromCache: boolean
  stale: boolean
}

function statusSuffixes(base: string, input: IpoStatusInput): string {
  let text = base
  const fetched = ipoTimestamp(input.fetchedAt)
  if (fetched) text = `${text}; fetched ${fetched}`
  if (input.fromCache) text = `${text}; cache loaded`
  if (input.stale) text = `${text}; refresh failed, stale cache shown`
  return text
}

/** `_p21_apply_ipo_payload`'s status line, string for string. */
export function upcomingIpoStatus(input: IpoStatusInput, today: string): IpoStatus {
  const yearEnd = upcomingEndDate(today)
  const source = input.source || IPO_UPCOMING_SOURCE_NAME
  if (!input.rowCount) {
    return {
      text: `No upcoming IPO rows available through ${yearEnd}. Dates are estimated and may change.`,
      tone: 'warning',
    }
  }
  const text = statusSuffixes(
    `${input.rowCount} upcoming IPO(s) through ${yearEnd} from ${source}`,
    input,
  )
  return { text, tone: input.stale ? 'warning' : 'positive' }
}

/** `_p21_apply_completed_payload`'s status line. */
export function completedIpoStatus(input: IpoStatusInput, year: number): IpoStatus {
  const source = input.source || IPO_COMPLETED_SOURCE_NAME
  if (!input.rowCount) {
    return { text: `No completed IPO rows available for ${year}.`, tone: 'warning' }
  }
  const text = statusSuffixes(`${input.rowCount} completed IPO(s) in ${year} from ${source}`, input)
  return { text, tone: input.stale ? 'warning' : 'positive' }
}

/* ---------------------------------------------------------------- clipboard */

const UPCOMING_HEADERS = [
  'IPO Date',
  'Symbol',
  'Company',
  'Exchange',
  'Price Range',
  'Shares',
  'Deal Size',
  'Market Cap',
  'Revenue',
]

const COMPLETED_HEADERS = ['IPO Date', 'Symbol', 'Company', 'IPO Price', 'Current', 'Return']

export function upcomingIpoClipboard(rows: UpcomingIpoRow[]): string {
  const lines = [UPCOMING_HEADERS.join('\t')]
  for (const row of rows) {
    lines.push(
      [
        row.dateDisplay,
        row.symbol,
        row.company,
        row.exchange,
        row.priceRange,
        row.sharesOffered,
        row.dealSize,
        row.marketCap,
        row.revenue,
      ].join('\t'),
    )
  }
  return lines.join('\n')
}

export function completedIpoClipboard(rows: CompletedIpoRow[]): string {
  const lines = [COMPLETED_HEADERS.join('\t')]
  for (const row of rows) {
    lines.push(
      [
        row.dateDisplay,
        row.symbol,
        row.company,
        row.ipoPrice,
        row.currentPrice,
        row.returnPct,
      ].join('\t'),
    )
  }
  return lines.join('\n')
}
