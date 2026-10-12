import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { SEMICONDUCTOR_CATALOG } from '../electron/shared/semiconductorCatalog.js'
import { SEMICONDUCTOR_GROUPS, priceReturn, rowReturns, semiconductorComparison, semiconductorNews, semiconductorOverview, semiconductorLaneStatus } from '../electron/shared/semiconductors.js'
import { semiconductorFixture } from './fixtures/semiconductors.js'
import { TABS } from '../electron/shared/contract.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-semiconductors-'))
const original = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
try {
  const { TtlCache, cache } = await import('../electron/services/cache.js')
  const { getSemiconductors } = await import('../electron/services/semiconductors.js')
  const { withSourceEnvelope } = await import('../electron/services/sourceHealth.js')
  const companies = SEMICONDUCTOR_CATALOG
  assert.equal(new Set(companies.map(company => company.symbol)).size, companies.length)
  for (const company of companies) {
    assert.equal(company.country, 'United States')
    assert(['Nasdaq', 'NYSE', 'NYSE American'].includes(company.exchange))
    assert(SEMICONDUCTOR_GROUPS.some(group => group.id === company.group))
    assert(company.rationale && company.headquarters && /^\d{10}$/.test(company.cik))
    assert(company.sourceUrls.some(url => url.startsWith('https://www.sec.gov/Archives/edgar/')))
    assert(company.sourceUrls.every(url => new URL(url).protocol === 'https:'))
    assert.equal(company.reviewedAt, '2026-10-13')
  }
  for (const excluded of ['TSM', 'ASML', 'ARM', 'UMC', 'NXPI', 'QRVO', 'SKYT', 'SOXX', 'SMH', 'NLST']) assert(!companies.some(company => company.symbol === excluded), excluded)
  assert(companies.find(company => company.symbol === 'GFS')?.headquarters.includes('NY'))
  assert(companies.find(company => company.symbol === 'IONQ')?.diversified)
  assert(companies.find(company => company.symbol === 'CRDO')?.headquarters.includes('San Jose'))
  assert(companies.some(company => company.symbol === 'Q'))
  assert.equal(workspaceFor('semiconductors')?.id, 'focus')
  assert(startupPages('dashboard', [], []).includes('semiconductors'))
  assert(TABS.some(tab => tab.id === 'semiconductors' && tab.implemented))
  assert(SEMICONDUCTOR_GROUPS.every(group => companies.some(company => company.group === group.id)))

  const fixture = semiconductorFixture(Date.parse('2026-10-13T12:00:00Z'))
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
  const comparison = semiconductorComparison([row, other], '2026-09-01')
  assert.deepEqual(comparison.dates, ['2026-09-11', '2026-09-15', '2026-10-12'])
  assert.deepEqual(comparison.series[0].values.slice(0, 2), [0, null])
  near(comparison.series[0].values[2], 20)
  near(comparison.series[1].values[1], 20)
  near(comparison.series[1].values[2], 50)
  assert.equal(semiconductorComparison([], '2026-09-01').dates.length, 0)
  const missing = { ...row, market: null }
  const summary = semiconductorOverview([row, other, missing])
  assert.equal(summary.quoteCount, 2)
  assert.equal(summary.capCount, 2)
  assert.equal(summary.daily, .25)
  assert.equal(semiconductorOverview([missing]).daily, null)
  assert.equal(semiconductorOverview([{ ...row, market: { ...row.market!, dailyChange: NaN } }]).quoteCount, 0)
  assert.equal(semiconductorOverview([{ ...row, market: { ...row.market!, marketCap: Infinity } }]).capCount, 0)
  assert.equal(semiconductorNews([row, { ...other, news: row.news }]).length, 1)
  assert.equal(semiconductorLaneStatus(row, 'market', fixture.fetchedAt + 300_001), 'stale')
  assert.equal(semiconductorLaneStatus(row, 'profile', fixture.fetchedAt + 300_001), 'loaded')
  assert.equal(semiconductorLaneStatus(row, 'news', fixture.fetchedAt + 600_001), 'stale')

  const targets = companies.filter(company => ['NVDA', 'AMD'].includes(company.symbol))
  let calls = 0
  const fetchers = {
    market: async () => { calls++; return { value: row.market!, warnings: [] } },
    profile: async () => { calls++; return row.profile! },
    news: async () => { calls++; return row.news },
  }
  const storage = new TtlCache()
  const first = await getSemiconductors({}, fetchers, storage, targets)
  assert.equal(first.meta.freshness, 'fresh')
  assert.equal(calls, 6)
  await getSemiconductors({}, fetchers, storage, targets)
  assert.equal(calls, 6, 'Fresh per-company cache should avoid provider calls')
  const refreshed = await getSemiconductors({ force: true }, fetchers, storage, targets)
  assert.equal(calls, 12)
  const outage = async (): Promise<never> => { throw new Error('HTTP 503') }
  const cached = await getSemiconductors({ force: true }, { market: outage, profile: outage, news: outage }, storage, targets)
  assert.equal(cached.meta.freshness, 'partial')
  assert(cached.errors.some(error => error.reason.includes('cached')))
  assert(cached.data.rows.every(entry => entry.progress.market === 'stale' && entry.market?.price === row.market!.price))
  assert.equal(cached.data.rows[0].fetchedAt.market, refreshed.data.rows[0].fetchedAt.market, 'Fallback must retain source timestamp')
  const partial = await getSemiconductors({}, { ...fetchers, profile: outage }, new TtlCache(), targets)
  assert.equal(partial.meta.freshness, 'partial')
  assert(partial.data.rows.every(entry => entry.market && entry.profile === null && entry.progress.profile === 'unavailable'))
  const failed = await getSemiconductors({}, { market: outage, profile: outage, news: outage }, new TtlCache(), targets)
  assert.equal(failed.meta.freshness, 'failed')
  assert.equal(failed.data.rows.length, targets.length, 'Outages must retain catalog membership')
  assert(failed.data.rows.every(entry => Object.values(entry.progress).every(state => state === 'unavailable')))
  // The shared cache protects failed providers with a ten-second retry cooldown,
  // including forced refreshes. Advance time instead of sleeping in the probe.
  const clock = Date.now
  try {
    Date.now = () => clock() + 10_001
    const recovered = await getSemiconductors({ force: true }, fetchers, storage, targets)
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
  const before = await withSourceEnvelope(() => getSemiconductors({}, mixedFetchers, mixed, targets.slice(0, 1)))
  try {
    Date.now = () => clock() + 300_001
    const after = await withSourceEnvelope(() => getSemiconductors({}, mixedFetchers, mixed, targets.slice(0, 1)))
    assert.deepEqual(laneCalls, { market: 2, profile: 1, news: 1 }, 'Automatic renewal must respect the separate profile/news TTLs')
    assert.equal(after.data.rows[0].fetchedAt.profile, before.data.rows[0].fetchedAt.profile)
    assert(after.meta.expiresAt && after.meta.expiresAt > Date.now(), 'An older fresh profile must not expire newly refreshed market data')
  } finally { Date.now = clock }

  if (process.argv.includes('--live')) {
    const symbols = ['NVDA', 'TXN', 'GFS', 'MU', 'AMAT', 'AMKR', 'CDNS', 'ENTG']
    const live = await getSemiconductors({ force: true }, undefined, cache, process.argv.includes('--all') ? companies : companies.filter(company => symbols.includes(company.symbol)))
    for (const entry of live.data.rows) console.log(entry.company.symbol, entry.progress, 'price', entry.market?.price, 'history', entry.market?.history.length, 'earnings', entry.profile?.earningsDate)
    live.errors.forEach(error => console.log('Provider limitation:', error.symbol, error.operation, error.reason))
    assert(live.data.rows.every(entry => entry.market?.price !== null && entry.market?.price !== undefined && entry.market.history.length), 'Every representative company should have a quote and adjusted history')
    assert(live.data.rows.every(entry => entry.profile?.description), 'Every representative company should have a profile')
    console.log(`Live result: ${live.meta.freshness}; ${live.errors.length} provider limitations`)
  }
  cache.close()
  console.log('PASS: catalog, geography/listings, subsectors, returns, common-session comparisons, missing observations, news dedupe, cache, forced refresh, partial/total outages and recovery')
} finally {
  for (const name of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (original[name] === undefined) delete process.env[name]
    else process.env[name] = original[name]
  }
  const resolved = relative(tmpdir(), scratch)
  assert(resolved && !resolved.startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
