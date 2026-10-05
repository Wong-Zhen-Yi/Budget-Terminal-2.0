import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { HIMS_CIK, himsEarningsFilings, himsExhibitUrl, himsGrowth, himsMargin, himsNumber, himsRevenueMix, parseHimsReport } from '../electron/shared/hims.js'
import { himsFixtureHtml } from './fixtures/hims.js'
import type { SecFiling } from '../electron/shared/contract.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-hims-'))
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
try {
  const { fetchHimsEarnings, getHims } = await import('../electron/services/hims.js')
  const { TtlCache } = await import('../electron/services/cache.js')
  const storage = new TtlCache()
  const url = `https://www.sec.gov/Archives/edgar/data/${HIMS_CIK}/fixture/hims-earnings.htm`
  const current = parseHimsReport(himsFixtureHtml(), url, '2026-08-10')
  assert.equal(current.period, '2026 Q2')
  assert.equal(current.metrics.revenue.value, 750e6, 'Revenue must be quarterly, not year-to-date')
  assert.equal(current.metrics.revenue.yearAgo, 500e6)
  assert.equal(current.metrics.subscribers.value, 2.9e6)
  assert.equal(current.metrics.arpu.value, 92)
  assert.equal(current.metrics.eps.value, -0.37)
  assert.equal(current.metrics.operatingIncome.value, -90e6)
  assert.equal(current.metrics.freeCashFlow.value, -68e6)
  assert.equal(current.warnings.length, 0)
  assert.deepEqual(current.guidance[0], { period: '2026 Q3', revenueLow: 880e6, revenueHigh: 900e6, ebitdaLow: 75e6, ebitdaHigh: 95e6 })
  assert.equal(current.guidance[1].revenueLow, 3.1e9)
  const old = parseHimsReport(himsFixtureHtml(2025, true), url, '2025-08-04')
  assert.equal(old.metrics.revenue.value, 750e6, 'Year order must not reverse comparisons')
  assert.equal(old.metrics.onlineArpu.value, 92)
  assert.equal(old.metrics.arpu.value, null, 'Do not substitute online-only ARPU for total revenue ARPU')
  assert.equal(himsRevenueMix(current).reduce((sum, row) => sum + row.value, 0), 750e6)
  assert.equal(himsRevenueMix(old)[0].label, 'Online')
  const incomplete = structuredClone(current)
  incomplete.metrics.internationalRevenue.value = null
  assert.deepEqual(himsRevenueMix(incomplete), [], 'Incomplete composition must not imply 100% coverage')
  assert.equal(himsGrowth(150, 100), 50)
  assert.equal(himsGrowth(50, -100), null)
  assert.equal(himsMargin(60, 750), 8)
  assert.equal(himsMargin(60, 0), null)
  assert.equal(himsNumber('N/A'), null)
  assert.equal(himsNumber(''), null)
  assert.equal(himsNumber('—'), 0)
  assert.throws(() => parseHimsReport(himsFixtureHtml().replace('June 30', 'June 31'), url, '2026-08-10'), /valid quarterly period/)
  assert.throws(() => parseHimsReport('<p>HIMS news article</p>', url, ''), /valid quarterly period/)
  assert.equal(himsExhibitUrl('<a href="hims-earnings.htm">Release</a>', url), url)
  assert.throws(() => himsExhibitUrl('<a href="https://evil.example/ex99.htm">Release</a>', url), /not found/)
  const filing = { form: '8-K', filedDate: '2026-08-10', reportPeriod: '', description: '', items: '2.02,9.01', accessionNumber: 'fixture', documentUrl: url } satisfies SecFiling
  assert.deepEqual(himsEarningsFilings([filing, { ...filing, items: '1.01' }, { ...filing, form: '10-Q' }]), [filing])
  const earnings = await fetchHimsEarnings(true, { filings: async () => ({ filings: [filing], warnings: [] }) as never,
    text: async target => target.endsWith('cover.htm') ? '' : himsFixtureHtml(), ir: async () => ({ html: himsFixtureHtml(), url }) }, storage)
  assert.equal(earnings.reports[0].period, '2026 Q2')
  storage.clear()
  const statement = { ...filing, form: '10-Q', accessionNumber: 'statement', reportPeriod: '2026-06-30', documentUrl: url.replace('hims-earnings.htm', 'statement.htm') }
  const malformedKpis = himsFixtureHtml().replace('Subscribers (end of period)', 'Unreadable KPI label').replace('Monthly Revenue per Average Subscriber', 'Unreadable ARPU label')
  const supplemented = await fetchHimsEarnings(true, { filings: async () => ({ filings: [filing, statement], warnings: [] }) as never,
    text: async target => target === statement.documentUrl ? himsFixtureHtml() : target === url ? '<a href="ex99.htm">Earnings</a>' : malformedKpis,
    ir: async () => { throw new Error('IR offline') } }, storage)
  assert.equal(supplemented.reports[0].metrics.subscribers.value, 2.9e6)
  assert.equal(supplemented.reports[0].metrics.arpu.value, 92)
  assert.equal(supplemented.reports[0].supplementalSourceUrl, statement.documentUrl, 'Supplemented metrics must expose their source')
  assert.deepEqual(supplemented.reports[0].warnings, [])
  const inline = parseHimsReport(himsFixtureHtml().replace('the second', 'th<span>e</span> second'), url, '')
  assert.equal(inline.period, '2026 Q2', 'Inline formatting must preserve split words')
  const fail = async (): Promise<never> => { throw new Error('Fixture offline') }
  const first = await getHims({ force: true }, { market: fail, financials: fail, earnings: async () => ({ reports: [current], warnings: [] }) }, storage)
  assert.equal(first.meta.freshness, 'partial')
  assert.equal(first.data.progress.earnings, 'loaded')
  const stale = await getHims({ force: true }, { market: fail, financials: fail, earnings: fail }, storage)
  assert.equal(stale.meta.freshness, 'stale')
  assert.equal(stale.data.progress.earnings, 'stale')
  assert.deepEqual(stale.data.earnings?.reports[0], current)
  assert.equal(stale.data.laneFetchedAt.earnings, first.data.laneFetchedAt.earnings, 'Stale data must retain its original retrieval time')
  storage.clear()
  const failed = await getHims({}, { market: fail, financials: fail, earnings: fail }, storage)
  assert.equal(failed.meta.freshness, 'failed')
  if (process.argv.includes('--reports') || process.argv.includes('--live')) {
    const live = process.argv.includes('--live') ? await getHims({ force: true }) : null
    const reports = live?.data.earnings ?? await fetchHimsEarnings(true)
    console.log(JSON.stringify({ meta: live?.meta, progress: live?.data.progress, chartRows: live?.data.market?.chart.candles.length, financialQuarters: live?.data.financials?.quarterly.revenue.length,
      reports: reports.reports.map(report => ({ period: report.period, sourceUrl: report.sourceUrl, revenue: report.metrics.revenue.value, subscribers: report.metrics.subscribers.value, arpu: report.metrics.arpu.value, onlineArpu: report.metrics.onlineArpu.value, guidance: report.guidance, warnings: report.warnings })), warnings: reports.warnings, errors: live?.errors }, null, 2))
    assert(reports.reports.length >= 4, 'Live earnings history unavailable')
    assert(reports.reports[0].metrics.subscribers.value, 'Live subscribers unavailable')
    if (live) {
      assert(live.data.market?.chart.candles.length, 'Live HIMS price history unavailable')
      assert(live.data.financials?.quarterly.revenue.length, 'Live HIMS statements unavailable')
    }
  }
  console.log('HIMS checks passed: quarterly units, year order, metric transitions, guidance, composition, document hosts, partial failures and stale timestamps.')
} finally {
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
