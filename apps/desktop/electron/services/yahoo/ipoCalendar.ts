import { paced, yahoo } from './client.js'

import type { CompletedIpoRow, UpcomingIpoRow } from '../../shared/contract.js'
import {
  formatIpoDate,
  formatIpoPrice,
  formatIpoPriceRange,
  formatIpoQuantity,
  parseIpoDate,
} from '../../shared/ipo.js'

/**
 * Yahoo's IPO calendar, as `IpoCalendarWorker._fetch_yfinance_rows` reaches it.
 *
 * The reference calls `yf.Calendars(...).get_ipo_info_calendar(limit, offset, force)`.
 * `yahoo-finance2` has no calendars module at all, so this posts the same body yfinance's
 * `Calendars._get_data` sends — `entityIdType: 'ipo_info'` against
 * `v1/finance/visualization` — through the client's own `_fetch`, so the cookie jar, the
 * crumb and the queue are still Yahoo's. Exactly the trade `yahoo/screener.ts` already
 * makes for the equity screen, and for the same reason.
 *
 * This is a *fallback*. StockAnalysis is the primary source for both feeds, and Yahoo's
 * calendar is much thinner: it carries the listing date, the exchange and sometimes a
 * price and a share count, and nothing else. A completed row from here therefore has an
 * IPO price at best and no current quote or return — `parse_yfinance_frame` hard-codes
 * both to `'--'`, and so does this.
 *
 * Still behind `paced()`, like every other Yahoo call in the app.
 */

const CALENDAR_URL = 'https://query1.finance.yahoo.com/v1/finance/visualization'

/** `_YFINANCE_IPO_PAGE_SIZE`. Yahoo caps a visualization page at 100 whatever is asked. */
const PAGE_SIZE = 100

/** `_YFINANCE_IPO_MAX_PAGES`: 2,000 rows is far past any real year, and bounds a loop. */
const MAX_PAGES = 20

/** `PREDEFINED_CALENDARS['ipo_info']['includeFields']`, in yfinance's own order. */
const INCLUDE_FIELDS = [
  'ticker',
  'companyshortname',
  'exchange_short_name',
  'filingdate',
  'startdatetime',
  'amendeddate',
  'pricefrom',
  'priceto',
  'offerprice',
  'currencyname',
  'shares',
  'dealtype',
]

interface VisualizationDocument {
  columns?: Array<{ id?: string; label?: string; type?: string }>
  rows?: unknown[][]
}

interface VisualizationResponse {
  finance?: { result?: Array<{ documents?: VisualizationDocument[] }> }
}

/**
 * The crumb this POST needs fails against a cold cookie jar, exactly as the screener's
 * does. One cheap predefined screen goes through the library's own crumb path first and
 * leaves the jar warm. Memoised per process, and a failed warm-up clears the memo rather
 * than poisoning every later call.
 */
let warmed: Promise<void> | null = null

function warmCrumb(): Promise<void> {
  if (!warmed) {
    warmed = paced(() => yahoo.screener({ scrIds: 'most_actives', count: 5 }))
      .then(() => undefined)
      .catch(() => {
        warmed = null
      })
  }
  return warmed
}

/**
 * `Calendars._get_data`, and `get_ipo_info_calendar`'s three-way `OR`: Yahoo is asked for
 * anything whose listing, filing *or* amendment date lands in the window, and the row's
 * own listing date is filtered afterwards. Widening the query and narrowing the rows is
 * what catches an IPO whose date moved.
 */
async function fetchPage(start: string, end: string, offset: number): Promise<VisualizationDocument> {
  await warmCrumb()
  const body = {
    sortType: 'DESC',
    entityIdType: 'ipo_info',
    sortField: 'startdatetime',
    includeFields: INCLUDE_FIELDS,
    size: PAGE_SIZE,
    offset,
    query: {
      operator: 'OR',
      operands: [
        { operator: 'GTELT', operands: ['startdatetime', start, end] },
        { operator: 'GTELT', operands: ['filingdate', start, end] },
        { operator: 'GTELT', operands: ['amendeddate', start, end] },
      ],
    },
  }

  const client = yahoo as unknown as {
    _fetch: (
      url: string,
      queryOptions: unknown,
      moduleOptions: unknown,
      result: unknown,
      needsCrumb: unknown,
    ) => Promise<unknown>
  }

  const response = (await paced(() =>
    client._fetch(
      CALENDAR_URL,
      { lang: 'en-US', region: 'US' },
      {
        fetchOptions: {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        },
      },
      'json',
      true,
    ),
  )) as VisualizationResponse

  return response.finance?.result?.[0]?.documents?.[0] ?? {}
}

/**
 * One row, read by column *label* rather than by position.
 *
 * `Calendars._create_df` builds its frame from the response's own column labels and the
 * reference then reads `row['Date']`, `row['Company']` and so on, so the labels are the
 * contract. `Exchange Short Name` is renamed to `Exchange` there (`predef_cal['renames']`)
 * and here.
 */
function labelled(document: VisualizationDocument, row: unknown[]): Map<string, unknown> {
  const values = new Map<string, unknown>()
  const columns = document.columns ?? []
  for (let index = 0; index < columns.length; index += 1) {
    const label = columns[index]?.label ?? ''
    if (!label) continue
    values.set(label === 'Exchange Short Name' ? 'Exchange' : label, row[index])
  }
  return values
}

/** `_is_missing_value` plus `_clean_yfinance_value`: `null`, `NaN` and the dash set are empty. */
function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && !Number.isFinite(value)) return ''
  const cleaned = String(value).replace(/\s+/g, ' ').trim()
  if (!cleaned || ['--', '-', 'nan', 'NaN', 'NaT', 'None'].includes(cleaned)) return ''
  return cleaned
}

/**
 * `nan_cols`: yfinance replaces a literal `0.0` with NaN on Price From, Price To, Price
 * and Shares before the reference ever sees them, which is the same thing `_to_float`
 * does by refusing anything at or below zero.
 */
function numeric(value: unknown): number | null {
  const parsed = Number(text(value).replace(/\$/g, '').replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** `_format_yfinance_price_range`: the band if there is one, else the single offer price. */
function priceText(row: Map<string, unknown>): string {
  const low = numeric(row.get('Price From'))
  const high = numeric(row.get('Price To'))
  if (low !== null || high !== null) return formatIpoPriceRange(low, high)
  const offer = numeric(row.get('Price'))
  return offer === null ? '--' : formatIpoPrice(offer)
}

interface ParsedRow {
  date: string
  symbol: string
  company: string
  exchange: string
  price: string
  shares: string
}

/** `parse_yfinance_frame`, up to the point the two row shapes diverge. */
function parseDocument(
  document: VisualizationDocument,
  start: string,
  end: string,
): ParsedRow[] {
  const rows: ParsedRow[] = []
  for (const raw of document.rows ?? []) {
    const row = labelled(document, raw)
    // Yahoo dates arrive as `2026-09-01T04:00:00.000Z` — midnight New York, so the
    // leading ten characters are already the session date the reference reads.
    const date = parseIpoDate(text(row.get('Date')))
    if (date === null || date < start || date > end) continue
    const symbol = text(row.get('Symbol')).toUpperCase()
    const company = text(row.get('Company'))
    if (!symbol && !company) continue
    rows.push({
      date,
      symbol,
      company,
      exchange: text(row.get('Exchange')),
      price: priceText(row),
      shares: formatIpoQuantity(numeric(row.get('Shares'))),
    })
  }
  return rows
}

/**
 * `_fetch_yfinance_rows`'s pagination, stop conditions included: an empty page ends the
 * sweep, so does a page whose rows repeat the previous one's (Yahoo answers a past-the-end
 * offset by repeating rather than by returning nothing), and so does a short page.
 */
async function sweep(start: string, end: string): Promise<ParsedRow[]> {
  const collected: ParsedRow[] = []
  const seen = new Set<string>()

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const document = await fetchPage(start, end, page * PAGE_SIZE)
    const rows = parseDocument(document, start, end)
    const key = rows.map((row) => `${row.date}|${row.symbol}|${row.company}`).join('\n')
    if (!rows.length || seen.has(key)) break
    seen.add(key)
    collected.push(...rows)
    if ((document.rows?.length ?? 0) < PAGE_SIZE) break
  }

  return collected
}

/** Upcoming rows, with the five columns Yahoo does not carry left as the em-dash pair. */
export async function fetchYahooUpcomingIpos(
  start: string,
  end: string,
): Promise<UpcomingIpoRow[]> {
  return (await sweep(start, end)).map((row) => ({
    date: row.date,
    dateDisplay: formatIpoDate(row.date),
    symbol: row.symbol || '--',
    company: row.company || '--',
    exchange: row.exchange || '--',
    priceRange: row.price,
    sharesOffered: row.shares,
    dealSize: '--',
    marketCap: '--',
    revenue: '--',
  }))
}

/**
 * Completed rows. `Current` and `Return` are hard-coded `'--'` because Yahoo's calendar
 * carries no quote — the reference does the same, and its own smoke test asserts it. A
 * StockAnalysis outage therefore empties the Return column rather than filling it wrongly.
 */
export async function fetchYahooCompletedIpos(
  start: string,
  end: string,
): Promise<CompletedIpoRow[]> {
  return (await sweep(start, end)).map((row) => ({
    date: row.date,
    dateDisplay: formatIpoDate(row.date),
    symbol: row.symbol || '--',
    company: row.company || '--',
    ipoPrice: row.price,
    currentPrice: '--',
    returnPct: '--',
  }))
}
