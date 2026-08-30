import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  cacheStatusText,
  completedIpoStatus,
  completedWindow,
  dedupeCompleted,
  dedupeUpcoming,
  formatCacheAge,
  formatIpoDate,
  formatIpoPrice,
  formatIpoPriceRange,
  formatIpoQuantity,
  ipoNumericSortValue,
  ipoPercentSortValue,
  normalizeCompletedRows,
  normalizeUpcomingRows,
  parseIpoDate,
  upcomingEndDate,
  upcomingIpoStatus,
  cleanText,
} from '../electron/shared/ipo.js'
import { parseCompletedHtml, parseUpcomingHtml } from '../electron/services/ipo.js'

/**
 * The IPO page's verification story, standing in for
 * `scripts/test_ipo_calendar_cache.py`.
 *
 * `--offline` runs the pure checks alone: every date format, both calendar windows, both
 * dedupe orderings, the cache normalisation and the two sort keys, plus a parse of each
 * StockAnalysis table shape from a fixture. The live run scrapes both pages into a
 * throwaway cache directory and prints the tables for a side-by-side read against the
 * PySide6 page, then repeats the load to prove the disk cache made the second one free.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

/* ------------------------------------------------------------------ fixtures */

/** The upcoming calendar's shape: nine columns, `Company Name`, `Shares Offered`. */
const UPCOMING_HTML = `
<html><body>
<table>
  <thead><tr>
    <th>IPO Date</th><th>Symbol</th><th>Company Name</th><th>Exchange</th>
    <th>Price Range</th><th>Shares Offered</th><th>Deal Size</th><th>Market Cap</th><th>Revenue</th>
  </tr></thead>
  <tbody>
    <tr>
      <td>Mar 14, 2099</td><td>abcd</td><td>Alpha&nbsp;Beta  Corp</td><td>NASDAQ</td>
      <td>$10.00 - $12.00</td><td>5,000,000</td><td>$60.00M</td><td>$1.20B</td><td>$310.00M</td>
    </tr>
    <tr>
      <td>Feb 03, 2099</td><td>EFGH</td><td>Gamma Holdings</td><td>NYSE</td>
      <td>$18.00</td><td>-</td><td></td><td>$4.00B</td><td>-</td>
    </tr>
    <tr>
      <td></td><td>NODATE</td><td>Dropped, no date</td><td>NYSE</td>
      <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
    </tr>
  </tbody>
</table>
<table><thead><tr><th>Unrelated</th></tr></thead><tbody><tr><td>ignored</td></tr></tbody></table>
</body></html>
`

/** The completed page: six columns, and the `IPO Price` header that identifies it. */
const COMPLETED_HTML = `
<html><body>
<table>
  <thead><tr>
    <th>IPO Date</th><th>Symbol</th><th>Company Name</th>
    <th>IPO Price</th><th>Current</th><th>Return</th>
  </tr></thead>
  <tbody>
    <tr><td>Jan 12, 2099</td><td>aaa</td><td>Delta Inc</td><td>$20.00</td><td>$28.40</td><td>42.00%</td></tr>
    <tr><td>Mar 02, 2099</td><td>BBB</td><td>Epsilon Ltd</td><td>$15.00</td><td>$13.14</td><td>-12.40%</td></tr>
  </tbody>
</table>
</body></html>
`

/* -------------------------------------------------------------------- checks */

function checkDates(): void {
  equal(parseIpoDate('2026-03-14'), '2026-03-14', 'ISO')
  equal(parseIpoDate('2026-03-14T09:30:00'), '2026-03-14', 'ISO with a time behind it')
  equal(parseIpoDate('Mar 14, 2026'), '2026-03-14', '%b %d, %Y')
  equal(parseIpoDate('March 14, 2026'), '2026-03-14', '%B %d, %Y')
  equal(parseIpoDate('Mar 4, 2026'), '2026-03-04', 'an unpadded day, which strptime accepts')
  equal(parseIpoDate('03/14/2026'), '2026-03-14', '%m/%d/%Y')
  equal(parseIpoDate('03/14/26'), '2026-03-14', '%m/%d/%y maps 00-68 to the 2000s')
  equal(parseIpoDate('03/14/95'), '1995-03-14', '%m/%d/%y maps 69-99 to the 1900s')
  equal(parseIpoDate('2026-02-30'), null, 'an impossible day is rejected, as strptime does')
  equal(parseIpoDate('Smarch 14, 2026'), null, 'an unknown month name is rejected')
  equal(parseIpoDate(''), null, 'a blank date drops the row')
  equal(parseIpoDate(null), null, 'a missing date drops the row')

  equal(formatIpoDate('2026-03-04'), 'Mar 04, 2026', "%b %d, %Y zero-pads the day")
  equal(formatIpoDate('not a date'), '', 'an unparseable ISO string formats to nothing')

  equal(cleanText('Alpha Beta  Corp'), 'Alpha Beta Corp', 'NBSP and runs of whitespace collapse')

  equal(upcomingEndDate('2026-03-14'), '2026-12-31', 'the window always ends on 31 December')
  const current = completedWindow(2026, '2026-03-14')
  equal(current.start, '2026-01-01', 'the completed window opens on 1 January')
  equal(current.end, '2026-03-14', 'the current year runs only to today')
  equal(completedWindow(2025, '2026-03-14').end, '2025-12-31', 'an earlier year runs to its own end')
}

function checkWindowsAndDedupe(): void {
  const today = '2026-03-14'
  const raw = [
    // Exactly today and exactly the last day of the year both survive.
    { date: '2026-03-14', symbol: 'onday', company: 'On Today' },
    { date: '2026-12-31', symbol: 'EOY', company: 'Year End' },
    // A day either side of the window does not.
    { date: '2026-03-13', symbol: 'PAST', company: 'Yesterday' },
    { date: '2027-01-01', symbol: 'NEXT', company: 'Next Year' },
    // A duplicate on the same date, symbol and company, differing only in case.
    { date: '2026-12-31', symbol: 'eoy', company: 'YEAR END', exchange: 'NYSE' },
  ]
  const rows = normalizeUpcomingRows(raw, today)
  equal(rows.length, 2, 'the window drops the past and the next year, and the dedupe drops the twin')
  equal(rows[0].date, '2026-03-14', 'upcoming rows come back oldest first')
  equal(rows[0].symbol, 'ONDAY', 'the symbol is uppercased')
  equal(rows[1].revenue, '--', 'a missing optional field is the literal em-dash pair')
  // The survivor of a duplicate pair is whichever sorts first, and the sort runs on the
  // company as scraped: 'YEAR END' precedes 'Year End' because upper case sorts first.
  equal(rows[1].exchange, 'NYSE', 'the twin that sorts first is the one kept')
  equal(rows[1].dateDisplay, 'Dec 31, 2026', 'a cached row with no display date gets one')

  const completed = normalizeCompletedRows(
    [
      { date: '2026-01-12', symbol: 'AAA', company: 'Delta', ipoPrice: '$20.00' },
      { date: '2026-03-02', symbol: 'BBB', company: 'Epsilon' },
      { date: '2025-12-31', symbol: 'OLD', company: 'Last Year' },
      { date: '2026-03-15', symbol: 'AHEAD', company: 'Tomorrow' },
    ],
    2026,
    today,
  )
  equal(completed.length, 2, 'the completed window excludes both other years and the future')
  equal(completed[0].date, '2026-03-02', 'completed rows come back newest first')
  equal(completed[1].currentPrice, '--', 'a completed row with no quote reads as the em-dash pair')

  equal(normalizeUpcomingRows('not an array', today).length, 0, 'a corrupt cache reads as empty')
  equal(normalizeUpcomingRows([null, 3, 'x'], today).length, 0, 'non-object cache entries are skipped')

  // The orderings are each other's reverse, which is what puts the next listing at the
  // top of one table and the most recent one at the top of the other.
  const identity = [
    { date: '2026-01-01', symbol: 'A', company: 'A' },
    { date: '2026-06-01', symbol: 'B', company: 'B' },
  ]
  equal(dedupeUpcoming(identity as never)[0].date, '2026-01-01', 'upcoming sorts ascending')
  equal(dedupeCompleted(identity as never)[0].date, '2026-06-01', 'completed sorts descending')
}

/** The Yahoo fallback's formatters; the StockAnalysis scrape needs none of them. */
function checkYahooFormatters(): void {
  equal(formatIpoPrice(18), '$18.00', 'a price always carries two decimals')
  equal(formatIpoPrice(1234.5), '$1,234.50', 'a price carries thousands separators')
  equal(formatIpoPrice(0), '--', 'a zero price is missing, not free')
  equal(formatIpoPrice(null), '--', 'an absent price prints the em-dash pair')

  equal(formatIpoPriceRange(10, 12), '$10.00 - $12.00', 'a band prints both ends')
  equal(formatIpoPriceRange(10, null), '$10.00', 'a band with no top prints the bottom')
  equal(formatIpoPriceRange(null, 12), '$12.00', 'a band with no bottom prints the top')
  equal(
    formatIpoPriceRange(10, 10.004),
    '$10.00',
    'ends within half a cent collapse to one price, as a fixed-price deal should',
  )
  equal(formatIpoPriceRange(null, null), '--', 'an empty band prints the em-dash pair')

  equal(formatIpoQuantity(5_000_000), '5,000,000', 'a share count carries separators and no decimals')
  equal(formatIpoQuantity(null), '--', 'an absent share count prints the em-dash pair')
}

function checkSortKeys(): void {
  equal(ipoNumericSortValue('$1.20B'), 1_200_000_000, 'a B suffix multiplies by a billion')
  equal(ipoNumericSortValue('$60.00M'), 60_000_000, 'an M suffix multiplies by a million')
  equal(ipoNumericSortValue('5,000K'), 5_000_000, 'a K suffix multiplies by a thousand, commas ignored')
  equal(ipoNumericSortValue('5,000,000'), 5_000_000, 'a plain share count reads as itself')
  equal(ipoNumericSortValue('$10.00 - $12.00'), 12, 'a price range sorts on its upper bound')
  equal(
    ipoNumericSortValue('$1.2B - $2.4B'),
    2_400_000_000,
    'the suffix is stripped before the range split, so the upper bound keeps its scale',
  )
  equal(ipoNumericSortValue('--'), Number.NEGATIVE_INFINITY, 'a missing value sorts to the bottom')
  equal(ipoNumericSortValue('-'), Number.NEGATIVE_INFINITY, 'a bare dash sorts to the bottom')
  equal(ipoNumericSortValue(''), Number.NEGATIVE_INFINITY, 'an empty cell sorts to the bottom')
  equal(ipoNumericSortValue('n/a'), Number.NEGATIVE_INFINITY, 'unparseable text sorts to the bottom')

  equal(ipoPercentSortValue('42.00%'), 42, 'a percentage reads as its number')
  equal(ipoPercentSortValue('-12.40%'), -12.4, 'the percent key keeps a negative sign')
  equal(ipoPercentSortValue('--'), Number.NEGATIVE_INFINITY, 'a missing return sorts to the bottom')
}

function checkCacheText(): void {
  equal(formatCacheAge(59 * 60), '59m', 'under an hour prints whole minutes')
  equal(formatCacheAge(3.5 * 3600), '3.5h', 'under two days prints hours to one decimal')
  equal(formatCacheAge(2.1 * 24 * 3600), '2.1d', 'past two days prints days')
  equal(formatCacheAge(null), '', 'an unknown age prints nothing')
  equal(formatCacheAge(Number.NaN), '', 'a non-finite age prints nothing')

  equal(cacheStatusText(3600, 0), 'Cache fresh: 1.0h old', 'inside the TTL the cache reads fresh')
  equal(
    cacheStatusText(48 * 3600, 0),
    'Cache stale: 2.0d old',
    'past the 24h TTL the cache reads stale',
  )
  equal(
    cacheStatusText(null, 0),
    'Cache status unavailable',
    'no age and no timestamp leaves nothing to say',
  )
}

function checkStatusStrings(): void {
  const today = '2026-03-14'
  const base = { source: 'StockAnalysis IPO Calendar', fetchedAt: 0, fromCache: false, stale: false }

  equal(
    upcomingIpoStatus({ ...base, rowCount: 12 }, today).text,
    '12 upcoming IPO(s) through 2026-12-31 from StockAnalysis IPO Calendar',
    'the upcoming status names the count, the window and the source',
  )
  equal(
    upcomingIpoStatus({ ...base, rowCount: 12, fromCache: true, stale: true }, today).text,
    '12 upcoming IPO(s) through 2026-12-31 from StockAnalysis IPO Calendar; cache loaded; refresh failed, stale cache shown',
    'the cache and stale suffixes append in the reference order',
  )
  equal(
    upcomingIpoStatus({ ...base, rowCount: 0 }, today).text,
    'No upcoming IPO rows available through 2026-12-31. Dates are estimated and may change.',
    'an empty calendar replaces the line rather than appending to it',
  )
  equal(upcomingIpoStatus({ ...base, rowCount: 0 }, today).tone, 'warning', 'an empty calendar warns')

  equal(
    completedIpoStatus({ ...base, source: 'StockAnalysis Completed IPOs', rowCount: 5 }, 2026).text,
    '5 completed IPO(s) in 2026 from StockAnalysis Completed IPOs',
    'the completed status names its year',
  )
  equal(
    completedIpoStatus({ ...base, rowCount: 0 }, 2026).text,
    'No completed IPO rows available for 2026.',
    'an empty completed year has its own line',
  )
}

function checkParsers(): void {
  // The fixtures are dated in 2099 so the window can never age them out.
  const upcoming = parseUpcomingHtml(UPCOMING_HTML, '2099-01-01')
  equal(upcoming.length, 2, 'the undated row is dropped and the unrelated table is ignored')
  equal(upcoming[0].symbol, 'EFGH', 'rows come back oldest first')
  equal(upcoming[0].dealSize, '--', 'an empty cell becomes the em-dash pair')
  // A dash the page itself printed is passed through as scraped — only an *empty* cell
  // becomes the em-dash pair. Both sort to the bottom, so the distinction is cosmetic
  // and matches what the reference renders.
  equal(upcoming[0].sharesOffered, '-', 'a scraped bare dash is passed through unchanged')
  equal(upcoming[1].company, 'Alpha Beta Corp', 'the NBSP in a company name is cleaned')
  equal(upcoming[1].symbol, 'ABCD', 'a lower-case symbol is uppercased')
  equal(upcoming[1].priceRange, '$10.00 - $12.00', 'the price range is passed through as scraped')
  equal(upcoming[1].date, '2099-03-14', 'the display date is parsed to ISO for sorting')

  const completed = parseCompletedHtml(COMPLETED_HTML, 2099, '2099-12-31')
  equal(completed.length, 2, 'both completed rows survive')
  equal(completed[0].symbol, 'BBB', 'completed rows come back newest first')
  equal(completed[0].returnPct, '-12.40%', 'the return is passed through with its sign')
  equal(completed[1].ipoPrice, '$20.00', 'the IPO price is passed through as scraped')

  // Each parser must refuse the other's page: the upcoming table has no `IPO Price`
  // header, and the completed one has no `Price Range`.
  equal(
    parseCompletedHtml(UPCOMING_HTML, 2099, '2099-12-31').length,
    0,
    'the completed parser refuses a table with no IPO Price column',
  )
  equal(
    parseUpcomingHtml('<html><body><p>no tables here</p></body></html>', '2099-01-01').length,
    0,
    'a page with no table parses to nothing rather than throwing',
  )
}

function runOffline(): void {
  checkDates()
  checkWindowsAndDedupe()
  checkYahooFormatters()
  checkSortKeys()
  checkCacheText()
  checkStatusStrings()
  checkParsers()
  console.log(
    'offline checks passed: dates, windows, dedupe, Yahoo formatters, sort keys, cache text, ' +
      'status, parsers',
  )
}

/* ---------------------------------------------------------------------- live */

function table(headers: string[], rows: string[][], limit: number): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.slice(0, limit).map((row) => row[index]?.length ?? 0)),
  )
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join('  ')
  console.log(line(headers))
  console.log(widths.map((width) => '-'.repeat(width)).join('  '))
  for (const row of rows.slice(0, limit)) console.log(line(row))
  if (rows.length > limit) console.log(`... ${rows.length - limit} more row(s)`)
}

async function runLive(year: number): Promise<void> {
  // Never write the real cache: the probe must not change what the app opens on.
  const temporary = await mkdtemp(join(tmpdir(), 'budget-terminal-ipo-'))
  const previousAppData = process.env.APPDATA
  process.env.APPDATA = temporary
  try {
    const { getCompletedIpos, getUpcomingIpos } = await import('../electron/services/ipo.js')

    const startedUpcoming = Date.now()
    const upcoming = await getUpcomingIpos(true)
    console.log(
      `\nUpcoming: ${upcoming.payload.rows.length} row(s) through ${upcoming.payload.endDate} ` +
        `in ${((Date.now() - startedUpcoming) / 1000).toFixed(1)}s from ${upcoming.payload.source}`,
    )
    for (const failure of upcoming.errors) console.log(`! ${failure.source}: ${failure.reason}`)
    table(
      ['IPO Date', 'Symbol', 'Company', 'Exchange', 'Price Range', 'Shares', 'Deal', 'Mkt Cap', 'Revenue'],
      upcoming.payload.rows.map((row) => [
        row.dateDisplay,
        row.symbol,
        row.company,
        row.exchange,
        row.priceRange,
        row.sharesOffered,
        row.dealSize,
        row.marketCap,
        row.revenue,
      ]),
      20,
    )

    const startedCompleted = Date.now()
    const completed = await getCompletedIpos(year, true)
    console.log(
      `\nCompleted ${completed.payload.year}: ${completed.payload.rows.length} row(s) ` +
        `in ${((Date.now() - startedCompleted) / 1000).toFixed(1)}s from ${completed.payload.source}`,
    )
    for (const failure of completed.errors) console.log(`! ${failure.source}: ${failure.reason}`)
    table(
      ['IPO Date', 'Symbol', 'Company', 'IPO Price', 'Current', 'Return'],
      completed.payload.rows.map((row) => [
        row.dateDisplay,
        row.symbol,
        row.company,
        row.ipoPrice,
        row.currentPrice,
        row.returnPct,
      ]),
      20,
    )

    // Whatever came back has to survive the window and the dedupe unchanged, or the
    // table would shrink the first time the page repainted from its own cache.
    const today = new Date().toISOString().slice(0, 10)
    assert(
      normalizeUpcomingRows(upcoming.payload.rows, today).length === upcoming.payload.rows.length,
      'a live upcoming row must survive the cache normalisation it was written through',
    )
    assert(
      normalizeCompletedRows(completed.payload.rows, year, today).length ===
        completed.payload.rows.length,
      'a live completed row must survive the cache normalisation it was written through',
    )

    // The second load must come off disk, which is what makes opening the page free.
    const cachedStart = Date.now()
    const cached = await getUpcomingIpos(false)
    assert(cached.payload.fromCache, 'the second unforced load must come from the disk cache')
    console.log(
      `\nSecond upcoming load in ${((Date.now() - cachedStart) / 1000).toFixed(1)}s ` +
        `(cache age ${(cached.payload.cacheAgeSeconds ?? 0).toFixed(1)}s)`,
    )
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousAppData
    await rm(temporary, { recursive: true, force: true })
  }
}

const args = process.argv.slice(2)
runOffline()
if (!args.includes('--offline')) {
  const positional = args.find((argument) => !argument.startsWith('--'))
  await runLive(Number(positional) || new Date().getFullYear())
}
