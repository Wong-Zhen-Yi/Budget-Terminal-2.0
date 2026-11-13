import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { HOMEBUILDER_CATALOG } from '../electron/shared/homebuilderCatalog.js'
import { priceReturn, rowReturns, homebuilderComparison, homebuilderNews, homebuilderOverview, homebuilderLaneStatus } from '../electron/shared/homebuilders.js'
import { homebuilderFixture } from './fixtures/homebuilders.js'
import { TABS } from '../electron/shared/contract.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { FRESHNESS } from '../electron/shared/freshness.js'
import { equivalentHomePrice, monthlyMortgage } from '../electron/shared/homebuyerScenario.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-homebuilders-'))
const original = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
try {
  const { TtlCache, cache } = await import('../electron/services/cache.js')
  const { getHomebuilders } = await import('../electron/services/homebuilders.js')
  const { withSourceEnvelope } = await import('../electron/services/sourceHealth.js')
  const { withPageProgress, readPageProgress } = await import('../electron/services/pageProgress.js')
  const companies = HOMEBUILDER_CATALOG
  assert.equal(new Set(companies.map(company => company.symbol)).size, companies.length)
  assert.equal(companies.filter(company => company.kind === 'builder').length, 10)
  assert.deepEqual(companies.filter(company => company.kind === 'benchmark').map(company => company.symbol), ['ITB', 'XHB'])
  for (const company of companies) assert.equal(new URL(company.sourceUrl).protocol, 'https:')
  assert.equal(TABS.find(tab => tab.id === 'homebuilders')?.implemented, true)
  assert.equal(workspaceFor('homebuilders')?.id, 'focus')
  assert(startupPages('dashboard', [], []).includes('homebuilders'))

  assert(Math.abs(monthlyMortgage(100000, 4, 30)! - 477.415295) < .001, 'CFPB worked example')
  assert.equal(monthlyMortgage(360000, 0, 30), 1000)
  assert.equal(monthlyMortgage(0, 7, 30), 0)
  assert.equal(monthlyMortgage(-1, 7, 30), null)
  assert.equal(monthlyMortgage(100000, NaN, 30), null)
  assert.equal(monthlyMortgage(100000, 7, 0), null)
  const sameBudget = equivalentHomePrice(400000, 20, 7, 8, 30)!
  assert(sameBudget < 400000)
  assert(Math.abs(monthlyMortgage(sameBudget * .8, 8, 30)! - monthlyMortgage(320000, 7, 30)!) < 1e-8)
  assert.equal(equivalentHomePrice(400000, 100, 7, 8, 30), null)
  assert.equal(equivalentHomePrice(400000, 20, NaN, 8, 30), null)

  const fixture = homebuilderFixture(Date.parse('2026-10-13T12:00:00Z'))
  const row = fixture.rows[0]
  row.market!.history = [{ date: '2025-12-30', close: 100 }, { date: '2026-09-11', close: 125 }, { date: '2026-10-12', close: 150 }]
  const near = (actual: number | null | undefined, expected: number) => assert(actual !== null && actual !== undefined && Math.abs(actual - expected) < 1e-9)
  near(priceReturn(row.market!.history, '2026-09-13'), 20)
  assert.equal(priceReturn(row.market!.history, '2024-01-01'), null)
  assert.equal(priceReturn([{ date: '2026-01-01', close: 0 }, { date: '2026-01-02', close: 10 }], '2026-01-01'), null)
  near(rowReturns(row, fixture.fetchedAt).month, 20)
  near(rowReturns(row, fixture.fetchedAt).ytd, 50)
  const monthEnd = { ...row, market: { ...row.market!, history: [{ date: '2026-02-27', close: 100 }, { date: '2026-03-01', close: 200 }, { date: '2026-03-31', close: 300 }] } }
  assert.equal(rowReturns(monthEnd, Date.parse('2026-03-31T12:00:00Z')).month, 200)
  const other = { ...fixture.rows[1], market: { ...fixture.rows[1].market!, history: [{ date: '2026-09-11', close: 50 }, { date: '2026-09-15', close: 60 }, { date: '2026-10-12', close: 75 }] } }
  const comparison = homebuilderComparison([row, other], '2026-09-01')
  assert.deepEqual(comparison.dates, ['2026-09-11', '2026-09-15', '2026-10-12'])
  assert.deepEqual(comparison.series[0].values.slice(0, 2), [0, null])
  near(comparison.series[0].values[2], 20)
  near(comparison.series[1].values[1], 20)
  near(comparison.series[1].values[2], 50)
  assert.equal(homebuilderComparison([], '2026-09-01').dates.length, 0)
  const benchmark = fixture.rows.find(entry => entry.company.symbol === 'ITB')!
  const excluded = homebuilderOverview([row, benchmark])
  assert.equal(excluded.count, 1)
  assert.equal(excluded.capCount, 1)
  assert.equal(excluded.marketCap, row.market!.marketCap)
  const missing = { ...row, market: null }
  const summary = homebuilderOverview([row, other, missing])
  assert.equal(summary.quoteCount, 2)
  assert.equal(summary.capCount, 2)
  assert.equal(summary.daily, .25)
  assert.equal(homebuilderOverview([missing]).daily, null)
  assert.equal(homebuilderOverview([{ ...row, market: { ...row.market!, dailyChange: NaN } }]).quoteCount, 0)
  assert.equal(homebuilderOverview([{ ...row, market: { ...row.market!, marketCap: Infinity } }]).capCount, 0)
  assert.equal(homebuilderNews([row, { ...other, news: row.news }]).length, 1)
  assert.equal(homebuilderLaneStatus(row, 'market', fixture.fetchedAt + FRESHNESS.homebuilders - 1), 'loaded')
  assert.equal(homebuilderLaneStatus(row, 'market', fixture.fetchedAt + FRESHNESS.homebuilders + 1), 'stale')
  assert.equal(homebuilderLaneStatus(row, 'profile', fixture.fetchedAt + 300_001), 'loaded')
  assert.equal(homebuilderLaneStatus(row, 'news', fixture.fetchedAt + 600_001), 'stale')

  const targets = companies.filter(company => ['DHI', 'LEN'].includes(company.symbol))
  let calls = 0
  const fetchers = {
    market: async () => { calls++; return { value: row.market!, warnings: [] } },
    profile: async () => { calls++; return row.profile! },
    news: async () => { calls++; return row.news },
  }
  const storage = new TtlCache()
  const first = await getHomebuilders({}, fetchers, storage, targets)
  assert.equal(first.meta.freshness, 'fresh')
  assert.equal(calls, 6)
  await getHomebuilders({}, fetchers, storage, targets)
  assert.equal(calls, 6, 'Fresh per-company cache should avoid provider calls')
  const refreshed = await getHomebuilders({ force: true }, fetchers, storage, targets)
  assert.equal(calls, 12)
  const outage = async (): Promise<never> => { throw new Error('HTTP 503') }
  const cached = await getHomebuilders({ force: true }, { market: outage, profile: outage, news: outage }, storage, targets)
  assert.equal(cached.meta.freshness, 'partial')
  assert(cached.errors.some(error => error.reason.includes('cached')))
  assert(cached.data.rows.every(entry => entry.progress.market === 'stale' && entry.market?.price === row.market!.price))
  assert.equal(cached.data.rows[0].fetchedAt.market, refreshed.data.rows[0].fetchedAt.market, 'Fallback must retain source timestamp')
  const partial = await getHomebuilders({}, { ...fetchers, profile: outage }, new TtlCache(), targets)
  assert.equal(partial.meta.freshness, 'partial')
  assert(partial.data.rows.every(entry => entry.market && entry.profile === null && entry.progress.profile === 'unavailable'))
  const failed = await getHomebuilders({}, { market: outage, profile: outage, news: outage }, new TtlCache(), targets)
  assert.equal(failed.meta.freshness, 'failed')
  assert.equal(failed.data.rows.length, targets.length, 'Outages must retain catalog membership')
  assert(failed.data.rows.every(entry => Object.values(entry.progress).every(state => state === 'unavailable')))
  // A slow news lane cannot hold back later companies' market/profile refreshes.
  // Saved rows must already be visible while those providers remain pending.
  const previewStorage = new TtlCache()
  const previewTargets = companies.slice(0, 6)
  await getHomebuilders({}, fetchers, previewStorage, previewTargets)
  let releaseNews!: () => void
  let releaseMarket!: () => void
  const newsGate = new Promise<void>(resolve => { releaseNews = resolve })
  const marketGate = new Promise<void>(resolve => { releaseMarket = resolve })
  let marketsCompleted = 0
  let profilesCompleted = 0
  const pending = withPageProgress('homebuilders:read:probe', () => getHomebuilders({ force: true }, {
    market: async () => { await marketGate; marketsCompleted++; return { value: row.market!, warnings: [] } },
    profile: async () => { profilesCompleted++; return row.profile! },
    news: async () => { await newsGate; return row.news },
  }, previewStorage, previewTargets))
  try {
    for (let attempt = 0; attempt < 100 && profilesCompleted < previewTargets.length; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    const preview = readPageProgress('homebuilders:read:probe')?.data as typeof first.data | undefined
    assert(preview?.rows.every(entry => entry.market && entry.profile && entry.news.length), 'All saved lanes must be published before pending refreshes complete')
    assert.equal(marketsCompleted, 0)
    assert.equal(profilesCompleted, previewTargets.length, 'Slow news/market requests cannot block the profile lane')
    releaseMarket()
    for (let attempt = 0; attempt < 100 && marketsCompleted < previewTargets.length; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    assert.equal(marketsCompleted, previewTargets.length, 'Slow news cannot block the market lane')
  } finally { releaseMarket(); releaseNews(); await pending }
  // The shared cache protects failed providers with a ten-second retry cooldown,
  // including forced refreshes. Advance time instead of sleeping in the probe.
  const clock = Date.now
  try {
    Date.now = () => clock() + 10_001
    const recovered = await getHomebuilders({ force: true }, fetchers, storage, targets)
    assert.equal(recovered.meta.freshness, 'fresh', JSON.stringify(recovered.errors))
    assert.equal(recovered.errors.length, 0)
  } finally { Date.now = clock }

  const mixed = new TtlCache()
  const laneCalls = { market: 0, profile: 0, news: 0 }
  const mixedFetchers = {
    market: async () => { laneCalls.market++; return { value: row.market!, warnings: [] } },
    profile: async () => { laneCalls.profile++; return row.profile! },
    news: async () => { laneCalls.news++; return row.news },
  }
  const before = await withSourceEnvelope(() => getHomebuilders({}, mixedFetchers, mixed, targets.slice(0, 1)))
  try {
    Date.now = () => clock() + FRESHNESS.homebuilders + 1
    const after = await withSourceEnvelope(() => getHomebuilders({}, mixedFetchers, mixed, targets.slice(0, 1)))
    assert.deepEqual(laneCalls, { market: 2, profile: 1, news: 2 }, 'Hourly market renewal must refresh expired news while retaining the longer-lived profile')
    assert.equal(after.data.rows[0].fetchedAt.profile, before.data.rows[0].fetchedAt.profile)
    assert(after.meta.expiresAt && after.meta.expiresAt > Date.now(), 'An older fresh profile must not expire newly refreshed market data')
  } finally { Date.now = clock }

  let profileCalls = 0
  const etf = await getHomebuilders({}, { ...fetchers, profile: async () => { profileCalls++; throw Error('ETF profile must be skipped') } }, new TtlCache(), companies.filter(company => company.kind === 'benchmark'))
  assert.equal(profileCalls, 0)
  assert.equal(etf.meta.freshness, 'fresh')
  assert(etf.data.rows.every(entry => entry.profile === null && entry.market))

  if (process.argv.includes('--live')) {
    const symbols = ['DHI', 'LEN', 'ITB', 'XHB']
    const live = await getHomebuilders({ force: true }, undefined, cache, process.argv.includes('--all') ? companies : companies.filter(company => symbols.includes(company.symbol)))
    for (const entry of live.data.rows) console.log(entry.company.symbol, entry.progress, 'price', entry.market?.price, 'history', entry.market?.history.length, 'earnings', entry.profile?.earningsDate)
    live.errors.forEach(error => console.log('Provider limitation:', error.symbol, error.operation, error.reason))
    assert(live.data.rows.every(entry => entry.market?.price !== null && entry.market?.price !== undefined && entry.market.history.length), 'Every representative company should have a quote and adjusted history')
    assert(live.data.rows.filter(entry => entry.company.kind === 'builder').every(entry => entry.profile?.description), 'Every representative company should have a profile')
    console.log(`Live result: ${live.meta.freshness}; ${live.errors.length} provider limitations`)
  }
  cache.close()
  console.log('PASS: mortgage scenarios, catalog, ETF exclusions, returns, common-session comparisons, missing observations, news dedupe, cache, forced refresh, partial/total outages and recovery')
} finally {
  for (const name of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (original[name] === undefined) delete process.env[name]
    else process.env[name] = original[name]
  }
  const resolved = relative(tmpdir(), scratch)
  assert(resolved && !resolved.startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
