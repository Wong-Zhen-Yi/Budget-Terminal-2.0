import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  addDays,
  buildCalendarExport,
  buildEarningsExport,
  buildMarketHolidays,
  calendarToday,
  earningsWeekRows,
  mergeEarningsRows,
  monthCells,
  parseBeaSchedule,
  parseBlsSchedule,
  parseCensusSchedule,
  parseEarningsVisualization,
  parseFomcSchedule,
  parseFredRelease,
  parseNasdaqCompanySymbols,
  startOfWeek,
} from '../electron/shared/calendar.js'
import { getCalendarMonth, getEarningsCalendar } from '../electron/services/calendar.js'

const earningsColumns = [
  'ticker',
  'companyshortname',
  'intradaymarketcap',
  'eventname',
  'startdatetime',
  'startdatetimetype',
  'epsestimate',
  'epsactual',
  'epssurprisepct',
].map((id) => ({ id }))

function runOffline(): void {
  const cells = monthCells(2026, 8)
  assert.equal(cells.length, 42)
  assert.deepEqual(cells.slice(0, 7), [null, null, null, null, null, 1, 2])
  assert.equal(cells.at(-1), null)
  assert.equal(startOfWeek('2026-08-27'), '2026-08-24')
  assert.equal(calendarToday('pst', new Date('2026-01-01T00:30:00Z')), '2025-12-31')
  assert.equal(calendarToday('sgt', new Date('2026-01-01T00:30:00Z')), '2026-01-01')

  const holidays = buildMarketHolidays(2026)
  assert.ok(holidays.some((event) => event.date === '2026-11-26' && event.event === 'Thanksgiving'))
  assert.ok(holidays.some((event) => event.date === '2026-11-27' && event.detail === '1:00 PM ET close'))
  assert.ok(holidays.some((event) => event.date === '2026-07-03' && event.event.includes('observed')))

  assert.deepEqual(
    parseFomcSchedule('<div>2026 FOMC Meetings</div><div>January</div><div>27-28*</div><div>2027 FOMC Meetings</div>', 2026),
    [{ date: '2026-01-28', name: 'FOMC Decision', importance: 'high' }],
  )
  const bea = parseBeaSchedule('<div>Year 2026</div><div>August 27</div><div>GDP (Second Estimate)</div><div>August 28</div><div>Personal Income and Outlays, July 2026</div><div>Year 2027</div>', 2026)
  assert.deepEqual(bea.map((event) => event.name), ['GDP Report', 'PCE Inflation'])
  const bls = parseBlsSchedule('<div>Friday, August 7, 2026</div><div>Employment Situation for July 2026</div><div>Wednesday, August 12, 2026</div><div>Consumer Price Index for July 2026</div>', 2026)
  assert.deepEqual(bls.map((event) => event.name), ['Jobs Report', 'CPI Release'])
  const fred = parseFredRelease('<table><tr><td>Tuesday, August 18, 2026</td></tr><tr><td>Producer Price Index</td></tr></table>', 2026, 'Producer Price Index', 'PPI Release', 'medium')
  assert.equal(fred[0]?.date, '2026-08-18')
  const census = parseCensusSchedule('<table><tr><td>Advance Monthly Sales for Retail and Food Services</td><td>August 14, 2026</td></tr><tr><td>New Residential Sales</td><td>August 25, 2026</td></tr></table>', 2026)
  assert.deepEqual(census.map((event) => event.name), ['Retail Sales', 'New Home Sales'])

  const symbols = parseNasdaqCompanySymbols([
    'Nasdaq Traded|Symbol|Security Name|Test Issue|Financial Status|Round Lot Size|ETF|NextShares',
    'Y|AAPL|Apple Inc. - Common Stock|N|N|100|N|N',
    'Y|BABA|Alibaba Group Holding Limited - American Depositary Shares|N|N|100|N|N',
    'Y|SPY|SPDR S&P 500 ETF Trust|N|N|100|Y|N',
    'Y|TEST|Example Corp - Common Stock|Y|N|100|N|N',
    'Y|ACMEW|Acme Corp - Warrant|N|N|100|N|N',
    'File Creation Time: 0827202621:30|||||||',
  ].join('\n'))
  assert.deepEqual([...symbols], ['AAPL', 'BABA'])

  const parsed = parseEarningsVisualization(
    {
      columns: earningsColumns,
      rows: [
        ['AAPL', 'Apple Inc.', 3_500_000_000_000, 'Q3 2026 Earnings', '2026-08-25T20:05:00Z', 'AMC', 1.25, null, null],
        ['SPY', 'SPDR', 500_000_000_000, 'Distribution', '2026-08-25T20:05:00Z', 'AMC', null, null, null],
      ],
    },
    '2026-08-24',
    '2026-08-28',
    symbols,
    '2026-08-24',
  )
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].symbol, 'AAPL')
  assert.equal(parsed[0].marketCap, '$3.50T')
  assert.equal(parsed[0].status, 'Upcoming')

  const moved = parseEarningsVisualization(
    { columns: earningsColumns, rows: [['AAPL', 'Apple Inc.', 3_500_000_000_000, 'Q3 2026 Earnings', '2026-08-26T12:00:00Z', 'BMO', 1.25, 1.3, 4]] },
    '2026-08-24',
    '2026-08-28',
    symbols,
    '2026-08-27',
  )
  const merged = mergeEarningsRows(moved, parsed, '2026-08-27')
  assert.equal(merged[0].changedDate, true)
  assert.equal(merged[0].previousDate, 'Aug 25, 2026')
  assert.equal(earningsWeekRows(merged, '2026-08-24')[2][0].symbol, 'AAPL')

  const calendarExport = buildCalendarExport({
    year: 2026,
    month: 8,
    today: '2026-08-24',
    includeEconomic: true,
    includeCompany: true,
    includeOptions: false,
    includeMarketHolidays: true,
    economicEvents: bls,
    companyEvents: [{ date: '2026-08-26', ticker: 'AAPL', event: 'Earnings' }],
    marketHolidays: [],
    options: [],
  })
  assert.match(calendarExport, /\[ECON\]/)
  assert.match(calendarExport, /2026-08-26  AAPL  Earnings/)

  const earningsExport = buildEarningsExport({
    payload: {
      rows: merged,
      source: 'fixture',
      sourceUrl: 'https://example.test',
      fetchedAt: '2026-08-27T00:00:00Z',
      startDate: '2026-08-24',
      endDate: '2026-08-28',
      rangeKey: 'fixture',
      symbolUniverseCount: 2,
    },
    rows: merged,
    weekStart: '2026-08-24',
    rangeLabel: 'Fixture week',
    search: '',
    timing: 'all',
    changedOnly: false,
    exportedAt: '2026-08-27',
  })
  assert.match(earningsExport, /Monday-Friday/)
  assert.match(earningsExport, /DATE CHANGED from Aug 25, 2026/)
  assert.doesNotMatch(earningsExport, /Sat 2026-08-29/)

  console.log('Calendar offline checks passed: dates, official-source parsers, symbol filtering, earnings changes, and exports.')
}

async function runLive(ticker: string): Promise<void> {
  const probeRoot = await mkdtemp(join(tmpdir(), 'budget-terminal-calendar-probe-'))
  const previousAppData = process.env.APPDATA
  process.env.APPDATA = probeRoot
  const today = new Date().toISOString().slice(0, 10)
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  try {
    const [calendar, earnings] = await Promise.all([
      getCalendarMonth({ tickers: [ticker], year, month, force: true }),
      getEarningsCalendar({
        startDate: startOfWeek(today),
        endDate: addDays(startOfWeek(today), 4),
        rangeKey: `probe_${startOfWeek(today)}`,
        force: true,
      }),
    ])
    assert.ok(calendar.payload.marketHolidays.length > 0)
    assert.ok(calendar.payload.generatedAt > 0)
    assert.ok(earnings.payload.symbolUniverseCount > 1_000)
    assert.equal(earnings.payload.startDate, startOfWeek(today))
    console.log(JSON.stringify({
      ticker,
      companyEvents: calendar.payload.companyEvents.length,
      economicEvents: calendar.payload.economicEvents.length,
      marketHolidays: calendar.payload.marketHolidays.length,
      calendarErrors: calendar.errors.map((error) => `${error.source}: ${error.reason}`),
      earningsRows: earnings.payload.rows.length,
      earningsUniverse: earnings.payload.symbolUniverseCount,
      earningsErrors: earnings.errors.map((error) => `${error.source}: ${error.reason}`),
    }, null, 2))
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousAppData
    await rm(probeRoot, { recursive: true, force: true })
  }
}

const args = process.argv.slice(2)
runOffline()
if (!args.includes('--offline')) {
  const ticker = args.find((argument) => !argument.startsWith('--'))?.trim().toUpperCase() || 'AAPL'
  await runLive(ticker)
}
