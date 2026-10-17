import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { amznEarningsFilings, amznExhibitUrl, amznIrUrl, amznNumber, amznPeriodBeforePublication, parseAmznReport } from '../electron/shared/amzn.js'
import { CHANNELS, TABS } from '../electron/shared/contract.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { createApi } from '../electron/shared/createApi.js'
import { amznFixture } from './fixtures/amzn.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-amzn-'))
const savedAppData = process.env.APPDATA
const savedLocalData = process.env.LOCALAPPDATA
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
try {
  const { getAmzn, fetchAmznEarnings } = await import('../electron/services/amzn.js')
  const { TtlCache, cache } = await import('../electron/services/cache.js')
  const html = await readFile(new URL('./fixtures/amzn-2026-q2.html', import.meta.url), 'utf8')
  const sourceUrl = 'https://www.sec.gov/Archives/edgar/data/1018724/000101872426000024/amzn-20260630xex991.htm'
  const report = parseAmznReport(html, sourceUrl, '2026-07-30', '2026 Q2')
  assert.equal(report.revenue, 200606e6)
  assert.equal(report.operatingIncome, 27461e6)
  assert.equal(report.dilutedEps, 5.75)
  assert.equal(report.netIncome, 62647e6)
  assert.equal(report.operatingCashFlow, 45387e6)
  assert.equal(report.capex, 54208e6)
  assert.equal(report.capexProceeds, 1132e6)
  assert.equal(report.freeCashFlow, -7689e6)
  assert.equal(report.ttmOperatingCashFlow, 161403e6)
  assert.equal(report.ttmNetCapex, 169007e6)
  assert.equal(report.ttmFreeCashFlow, -7604e6)
  assert.equal(report.segments[2].revenue, 42232e6)
  assert.equal(report.segments[2].yearAgoRevenue, 30873e6)
  assert(Math.abs(report.segments[2].operatingMargin! - 39.3564) < 0.001)
  assert(Math.abs(report.segments[2].revenueGrowth! - 36.7927) < 0.001)
  assert.equal(report.revenueCategories.length, 7)
  assert.equal(report.revenueCategories.reduce((sum, category) => sum + category.revenue!, 0), report.revenue)
  assert.equal(report.guidance.period, 'Third Quarter 2026')
  assert.equal(report.guidance.revenueLow, 197e9)
  assert.equal(report.guidance.operatingIncomeHigh, 26.5e9)
  assert.deepEqual(report.warnings, [])
  for (const [name, period, revenue, cashFlow] of [
    ['2025-q4', '2025 Q4', 213386e6, 54459e6], ['2026-q1', '2026 Q1', 181519e6, 26032e6],
  ] as const) {
    const parsed = parseAmznReport(await readFile(new URL(`./fixtures/amzn-${name}.html`, import.meta.url), 'utf8'), sourceUrl, '', period)
    assert.equal(parsed.revenue, revenue, 'Q4 must use quarterly rather than annual figures')
    assert.equal(parsed.operatingCashFlow, cashFlow)
    assert.deepEqual(parsed.warnings, [])
  }
  assert.equal(amznNumber('($1,234.5)', 1e6), -1234.5e6)
  assert.equal(amznNumber('—'), 0)
  assert.equal(amznNumber('N/A'), null)
  assert.throws(() => parseAmznReport(html, sourceUrl, '', '2026 Q1'), /expected/)
  assert.throws(() => parseAmznReport(html.replaceAll('Three Months Ended', 'Six Months Ended'), sourceUrl, ''), /columns changed/)
  assert.throws(() => parseAmznReport(html.replaceAll('in millions', 'in billions'), sourceUrl, ''), /monetary units changed/)
  assert.throws(() => parseAmznReport('<h1>Unsupported earnings layout</h1>', sourceUrl, ''), /reporting period/)
  assert.equal(parseAmznReport(html.replaceAll('<td>', '<td><span>').replaceAll('</td>', '</span></td>'), sourceUrl, '').revenue, report.revenue)
  const missing = parseAmznReport(html.replaceAll('Advertising services', 'Unknown category'), sourceUrl, '')
  assert.equal(missing.revenueCategories.find(category => category.name === 'Advertising services')?.revenue, null)
  assert(missing.warnings.some(warning => /categories unavailable/.test(warning)))
  assert.equal(amznExhibitUrl('<a href="amzn-20260630xex991.htm">99.1</a>', sourceUrl), sourceUrl)
  assert.throws(() => amznExhibitUrl('<a href="https://example.com/ex991.htm">99.1</a>', sourceUrl), /not found/)
  assert.equal(amznPeriodBeforePublication('2026-02-05'), '2025 Q4')
  assert(amznIrUrl('2025 Q4').includes('/2026/'))
  const fixture = amznFixture()
  const filing = fixture.financials!.sec.filings[0]
  assert.equal(amznEarningsFilings([{ ...filing, items: '1.01' }, filing]).length, 1)
  assert(TABS.some(tab => tab.id === 'amzn' && tab.label === 'AMZN' && tab.implemented))
  assert.equal(workspaceFor('amzn')?.id, 'focus')
  assert(startupPages('dashboard', [], []).includes('amzn'))
  let invoked: unknown[] = []
  const api = createApi(async <T>(...args: unknown[]) => { invoked = args; return undefined as T }, () => () => {}, 'win32')
  await api.amzn({ force: true })
  assert.deepEqual(invoked, [CHANNELS.amzn, { force: true }])

  const storage = new TtlCache()
  let calls = 0
  const fetchers = {
    market: async (symbol: string, force = false) => { assert.equal(symbol, 'AMZN'); assert(force); calls++; return { payload: fixture.market!, failures: [] } },
    financials: async () => ({ payload: fixture.financials!, failures: [], stale: false }),
    earnings: async () => fixture.earnings!,
  }
  const fresh = await getAmzn({ force: true }, fetchers, storage)
  assert.equal(fresh.meta.freshness, 'fresh')
  assert.equal(fresh.data.earnings?.reports.length, 8)
  const cached = await getAmzn({ background: true, backgroundOrder: 9 }, fetchers, storage)
  assert.equal(cached.meta.freshness, 'cached')
  assert.equal(calls, 1, 'Background scheduling must not change cache identity')
  const bad = async () => { throw new Error('HTTP 503') }
  const stale = await getAmzn({ force: true }, { ...fetchers, earnings: bad }, storage)
  assert.equal(stale.meta.freshness, 'stale')
  assert.equal(stale.data.progress.earnings, 'stale')
  assert.equal(stale.data.laneFetchedAt.earnings, fresh.data.laneFetchedAt.earnings)
  assert.equal(stale.data.earnings?.reports.length, 8)
  const partial = await getAmzn({ force: true }, { ...fetchers, earnings: bad }, new TtlCache())
  assert.equal(partial.meta.freshness, 'partial')
  assert(partial.data.market && partial.data.financials)
  assert.equal(partial.data.progress.earnings, 'unavailable')
  const failed = await getAmzn({ force: true }, { market: bad, financials: bad, earnings: bad }, new TtlCache())
  assert.equal(failed.meta.freshness, 'failed')
  assert.equal(failed.errors.length, 3)
  const clock = Date.now
  try {
    Date.now = () => clock() + 11_000
    assert.equal((await getAmzn({ force: true }, fetchers, storage)).meta.freshness, 'fresh')
  } finally { Date.now = clock }
  const sources = {
    filings: async () => ({ filings: [filing], freshness: 'fresh' as const, warnings: [] }),
    text: async (url: string) => url === filing.documentUrl ? '<a href="amzn-20260630xex991.htm">99.1</a>' : html,
    ir: async () => ({ html, url: amznIrUrl('2026 Q2') }),
  }
  const primary = await fetchAmznEarnings(true, sources, new TtlCache())
  assert.equal(primary.reports[0].sourceUrl, sourceUrl)
  assert(primary.warnings.some(warning => /Only 1/.test(warning)))
  await assert.rejects(() => fetchAmznEarnings(true, { ...sources, text: bad }, new TtlCache()), /HTTP 503/)
  await assert.rejects(() => fetchAmznEarnings(true, { ...sources, filings: bad }, new TtlCache()), /HTTP 503/)
  console.log('PASS: AMZN real releases, quarterly/annual/TTM selection, units, margins, categories, guidance, discovery, SEC-only failure handling, API, cache, outages and recovery')

  if (process.argv.includes('--live')) {
    const live = await getAmzn({ force: true })
    assert(live.data.market?.chart.candles.length, live.meta.failureReason ?? 'Market unavailable')
    assert(live.data.financials?.quarterly.revenue.length, live.meta.failureReason ?? 'Financials unavailable')
    assert.equal(live.data.earnings?.reports.length, 8, live.meta.failureReason ?? 'Earnings history incomplete')
    assert(live.data.earnings?.reports[0].segments.every(segment => segment.revenue !== null && segment.operatingIncome !== null), live.meta.failureReason ?? 'Segments unavailable')
    assert(live.data.earnings?.reports[0].revenueCategories.every(category => category.revenue !== null), live.meta.failureReason ?? 'Categories unavailable')
    console.log(`PASS: live AMZN · ${live.meta.freshness} · ${live.data.earnings?.reports[0].period} · ${live.meta.failureReason ?? 'all sources loaded'}`)
  }
  storage.close()
  cache.close()
} finally {
  if (savedAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = savedAppData
  if (savedLocalData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = savedLocalData
  assert(!relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
