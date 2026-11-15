import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { googlExhibitUrl, parseGooglReport } from '../electron/shared/googl.js'
import { googlFixture } from './fixtures/googl.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { createApi } from '../electron/shared/createApi.js'
import { CHANNELS } from '../electron/shared/contract.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-googl-'))
const saved = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, BUDGET_TERMINAL_DATA_DIR: process.env.BUDGET_TERMINAL_DATA_DIR }
Object.assign(process.env, { APPDATA: scratch, LOCALAPPDATA: scratch, BUDGET_TERMINAL_DATA_DIR: scratch })
const { getGoogl, fetchGooglEarnings } = await import('../electron/services/googl.js')
const { TtlCache, cache } = await import('../electron/services/cache.js')
const storage = new TtlCache()
try {
  const html = await readFile(new URL('./fixtures/googl-2026-q3.html', import.meta.url), 'utf8')
  const url = googlFixture().earnings!.reports[0].sourceUrl
  const report = parseGooglReport(html, url, '2026-10-28')
  assert.equal(report.revenue, 127577e6)
  assert.equal(report.operatingIncome, 40576e6)
  assert.equal(report.dilutedEps, 2.12)
  assert.equal(report.businesses[0].revenue, 63350e6)
  assert.equal(report.businesses[4].revenue, 30709e6)
  assert.equal(report.cloudOperatingIncome, 11121e6)
  assert.equal(report.otherBetsOperatingIncome, -2047e6)
  assert.equal(report.alphabetLevelIncome, -7655e6)
  assert.equal(report.operatingCashFlow, 42290e6)
  assert.equal(report.capex, 51355e6)
  assert.equal(report.freeCashFlow, -9065e6)
  assert.equal(report.buybacks, 0)
  assert.equal(report.dividends, 2936e6)
  assert(Math.abs(report.tacRate! - 19.9556) < 0.001)
  assert.deepEqual(report.warnings, [])
  const q4 = parseGooglReport(await readFile(new URL('./fixtures/googl-2025-q4.html', import.meta.url), 'utf8'), url, '2026-02-04')
  assert.equal(q4.period, '2025 Q4')
  assert.equal(q4.revenue, 113828e6, 'Use fourth-quarter revenue, not the annual total')
  assert.equal(q4.operatingCashFlow, 52402e6, 'Q4 cash flow must not use annual cash flow')
  assert.equal(q4.capex, 27851e6)
  assert.deepEqual(q4.warnings, [])
  assert.throws(() => parseGooglReport(html.replaceAll('Quarter Ended', 'Nine Months Ended'), url, ''), /columns unavailable/)
  assert.throws(() => parseGooglReport(html.replaceAll('millions', 'billions'), url, ''), /units changed/)
  assert.throws(() => parseGooglReport('<p>Alphabet</p>', url, ''), /period/)
  const missing = parseGooglReport(html.replaceAll('YouTube ads', 'Unknown category'), url, '')
  assert.equal(missing.businesses[1].revenue, null)
  assert(missing.warnings.length)
  assert.equal(googlExhibitUrl('<a href="googexhibit991q32026.htm">99.1</a>', url), url)
  assert.throws(() => googlExhibitUrl('<a href="https://evil.example/exhibit991.htm">99.1</a>', url), /not found/)
  assert.throws(() => googlExhibitUrl('<a href="https://www.sec.gov/Archives/edgar/data/123/googexhibit991.htm">99.1</a>', url), /not found/)
  assert.equal(workspaceFor('googl')?.id, 'focus')
  assert(startupPages('dashboard', [], []).includes('googl'))
  let channel = ''
  await createApi(async next => { channel = next; return undefined as never }, () => () => {}, 'win32').googl({})
  assert.equal(channel, CHANNELS.googl)
  let calls = 0, outage = false
  const fixture = googlFixture()
  const bad = async (): Promise<never> => { throw Error('HTTP 503') }
  const fetchers = {
    market: async () => { calls++; if (outage) return bad(); return { payload: fixture.market!, failures: [] } },
    earnings: async () => { if (outage) return bad(); return fixture.earnings! },
  }
  assert.equal((await getGoogl({}, fetchers, storage)).meta.freshness, 'fresh')
  assert.equal((await getGoogl({}, fetchers, storage)).meta.freshness, 'cached')
  assert.equal(calls, 1)
  outage = true
  const stale = await getGoogl({ force: true }, fetchers, storage)
  assert.equal(stale.meta.freshness, 'stale')
  assert.equal(stale.data.earnings?.reports[0].revenue, report.revenue)
  const failed = await getGoogl({}, fetchers, new TtlCache())
  assert.equal(failed.meta.freshness, 'failed')
  assert.equal(failed.errors.length, 2)
  const partial = await getGoogl({}, { ...fetchers, earnings: async () => fixture.earnings! }, new TtlCache())
  assert.equal(partial.meta.freshness, 'partial')
  assert.equal(partial.data.progress.earnings, 'loaded')
  const retryStorage = new TtlCache()
  let incomplete = true
  const recoverable = { ...fetchers, market: async () => ({ payload: fixture.market!, failures: [] }),
    earnings: async () => ({ reports: fixture.earnings!.reports, warnings: incomplete ? ['Incomplete revenue table'] : [] }) }
  assert.equal((await getGoogl({}, recoverable, retryStorage)).meta.freshness, 'partial')
  incomplete = false
  const clock = Date.now
  try {
    Date.now = () => clock() + 11_000
    const recovered = await getGoogl({}, recoverable, retryStorage)
    assert.equal(recovered.data.progress.earnings, 'loaded', 'Incomplete reports must retry before the normal six-hour TTL')
  } finally { Date.now = clock; await retryStorage.close() }
  console.log('PASS: SEC quarterly/yearly column selection, signed cash flow, nulls, sources, navigation, API, caching, partial and total outages')
  if (process.argv.includes('--live')) {
    const live = await getGoogl({ force: true })
    assert.equal(live.data.earnings?.reports.length, 8, live.meta.failureReason ?? 'Quarter history unavailable')
    assert(live.data.market?.chart.candles.length, live.meta.failureReason ?? 'Price history unavailable')
    assert.equal(live.meta.freshness, 'fresh', live.meta.failureReason ?? 'Incomplete live response')
    const earnings = await fetchGooglEarnings(false)
    assert.equal(earnings.warnings.length, 0, earnings.warnings.join('; '))
    console.log(`PASS: live GOOGL ${live.data.earnings?.reports[0].period}; eight releases and ${live.data.market?.chart.candles.length} candles`)
  }
} finally {
  await storage.close()
  await cache.close()
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  assert(relative(tmpdir(), scratch) && !relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
