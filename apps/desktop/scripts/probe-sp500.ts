import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { parseConstituents } from '../electron/services/sp500Constituents.js'
import { completedPoints, getSp500, parseSp500Valuation, Sp500BreadthScanner } from '../electron/services/sp500.js'
import { addBreadth, alignedComparison, diversification, emptyBreadth, movingAverage, newestFirst, riskStats, windowPoints,
  type Sp500Constituent } from '../electron/shared/sp500.js'
import { TtlCache, cache, TTL } from '../electron/services/cache.js'
import type { EtfHoldingsResult } from '../electron/services/etf/holdings.js'
import { withSourceEnvelope } from '../electron/services/sourceHealth.js'

const fixture = `<table id='constituents'><tr>${['Symbol', 'Security', 'GICS Sector', 'GICS Sub-Industry', 'Headquarters Location', 'Date added', 'CIK', 'Founded'].map((x) => `<th>${x}</th>`).join('')}</tr>
<tr><td>BRK.B</td><td>Berkshire &amp; Company<sup>[2]</sup></td><td>Financials</td><td>Insurance</td><td>Omaha</td><td>2010-02-16</td><td>0001067983</td><td>1839 (1955)</td></tr>
<tr><td>AAA</td><td>Alpha</td><td>Technology</td><td>Software</td><td>NY</td><td></td><td>0001</td><td>2000</td></tr>
<tr><td>AAB</td><td>Alpha Class B</td><td>Technology</td><td>Software</td><td>NY</td><td>2025-01-02</td><td>0001</td><td>2000</td></tr></table>`
const rows = parseConstituents(fixture)
assert.deepEqual(rows.map((row) => row.symbol), ['AAB', 'BRK.B', 'AAA'])
assert.equal(rows[1].security, 'Berkshire & Company')
assert.equal(rows[1].cik, '0001067983')
assert.throws(() => parseConstituents(fixture.replace('GICS Sector', 'Changed')))
assert.equal(newestFirst([{ ...rows[0], symbol: 'Z' }, { ...rows[0], symbol: 'A' }])[0].symbol, 'A')
const holdings = [{ symbol: 'BRK-B', name: 'Berkshire', sector: '', weight: 0.5 }, { symbol: 'AAA', name: 'Alpha', sector: '', weight: 0.3 }, { symbol: 'AAB', name: 'Alpha B', sector: '', weight: 0.2 }]
const mix = diversification(rows, holdings, false)
assert.equal(mix.companies, 2)
assert.equal(mix.matched, 3)
assert.equal(mix.concentration[0], 100)
assert.ok(Math.abs(mix.sectors.reduce((sum, row) => sum + row.countPct, 0) - 100) < 1e-10)
assert.equal(diversification(rows, holdings, true).concentration[0], null)
const missing = diversification(rows, holdings.slice(0, 1), false)
assert.equal(missing.coveredWeight, 50)
assert.equal(missing.concentration[0], null)
const points = [100, 120, 90, 99].map((close, i) => ({ date: `2026-01-0${i + 1}`, close }))
assert.deepEqual(movingAverage(points, 3), [null, null, 310 / 3, 103])
assert.equal(riskStats(points).drawdown, -25)
assert.ok(Math.abs(riskStats(points).returnPct! + 1) < 1e-10)
const daily = [0.2, -0.25, 0.1]
const mean = daily.reduce((a, b) => a + b) / 3
assert.ok(Math.abs(riskStats(points).volatility! - Math.sqrt(daily.reduce((s, x) => s + (x - mean) ** 2, 0) / 2 * 252) * 100) < 1e-10)
assert.equal(riskStats(points.slice(0, 1)).returnPct, null)
const aligned = alignedComparison(points, [points[0], points[2], points[3]].map((row) => ({ ...row, close: row.close * 2 })), '1M')
assert.deepEqual(aligned.a, aligned.b)
assert.equal(aligned.dates.length, 3)
assert.deepEqual(alignedComparison([], [], '1Y').a, [])
assert.equal(windowPoints([{ date: '2025-12-31', close: 100 }, ...points], 'YTD')[0].date, '2025-12-31')
assert.equal(windowPoints([{ date: '2025-12-03', close: 95 }, { date: '2025-12-04', close: 100 }, ...points], '1M')[0].date, '2025-12-04')
const dates = Array.from({ length: 252 }, (_, i) => new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10))
const rising = dates.map((date, i) => ({ date, close: 100 + i }))
const breadth = emptyBreadth(dates.at(-1)!, 4)
addBreadth(breadth, rising, dates)
addBreadth(breadth, rising.slice(0, -1), dates)
addBreadth(breadth, rising.slice(-50), dates)
addBreadth(breadth, rising.filter((_, i) => i !== 245), dates)
assert.equal(breadth.valid, 3)
assert.equal(breadth.eligible50, 2)
assert.equal(breadth.eligible200, 1)
assert.equal(breadth.highs, 1)
assert.equal(breadth.lows, 0)
const raw = [{ date: new Date('2026-09-08T13:30:00Z'), close: 100, adjclose: 99 }]
assert.equal(completedPoints(raw, false, new Date('2026-09-08T18:00:00Z')).length, 0)
assert.equal(completedPoints(raw, true, new Date('2026-09-08T22:00:00Z'))[0].close, 99)
assert.equal(completedPoints(raw, false, new Date('2026-09-08T22:00:00Z'))[0].close, 100)
assert.equal(completedPoints(raw, true, new Date('2026-09-08T18:00:00Z'), Date.parse('2026-09-08T17:00:00Z') / 1000).length, 1)
const valuation = parseSp500Valuation(`<h2>Fund Characteristics <span>as of Sep 04 2026</span></h2><table><tr><th>Price/Earnings Ratio FY1</th><td>20.00</td></tr><tr><th>Price/Book Ratio</th><td>5.2</td></tr></table><h2>Yields <span>as of Sep 03 2026</span></h2><table><tr><th>30 Day SEC Yield</th><td>2%</td></tr><tr><th>Index Dividend Yield</th><td>1.09%</td></tr></table>`)
assert.equal(valuation[0].value, 20)
assert.equal(valuation[2].value, 1.09)
assert.equal(valuation[2].asOf, 'Sep 03 2026')
assert.equal(valuation[2].basis, 'Index characteristics')

const localCache = new TtlCache()
localCache.set('x', 42, -1)
assert.equal((await localCache.resolveWithStaleFallback('x', 1000, async () => { throw new Error('offline') })).stale, true)
const wrapped = <T>(value: T) => ({ value, stale: false, fromCache: false, ageSeconds: 0 })
let calls = 0
const members = Array.from({ length: 8 }, (_, i): Sp500Constituent => ({ ...rows[0], symbol: String(i) }))
const scanner = new Sp500BreadthScanner(async () => wrapped({ rows: members, asOf: '' }), async (symbol) => {
  calls++
  await delay(5)
  if (symbol === '2') throw new Error('missing provider')
  return wrapped(rising)
})
const started = scanner.read({ action: 'start' })
assert.equal(scanner.read({ action: 'start', force: true }).id, started.id)
while (scanner.read({ action: 'status' }).state === 'running') await delay(5)
const done = scanner.read({ action: 'status' })
assert.equal(done.completed, 8)
assert.equal(done.failed, 1)
assert.equal(done.result?.valid, 7)
assert.equal(scanner.read({ action: 'start' }).id, done.id)
const cancel = scanner.read({ action: 'start', force: true })
await delay(8)
scanner.read({ action: 'cancel', id: 'wrong-id' })
assert.equal(scanner.read({ action: 'status' }).state, 'running')
scanner.read({ action: 'cancel', id: cancel.id })
const afterCancel = calls
await delay(30)
assert.equal(calls, afterCancel)
assert.equal(scanner.read({ action: 'status' }).state, 'cancelled')
const badScanner = new Sp500BreadthScanner(async () => { throw new Error('offline') }, async () => wrapped(rising))
badScanner.read({ action: 'start' })
await delay(1)
assert.equal(badScanner.read({ action: 'status' }).state, 'failed')

// Service panels are independent: a failed valuation read must not invalidate a successful list.
cache.set('sp500:constituents', { rows, asOf: 'fixture' }, 10000)
cache.set('sp500:valuation', valuation, 10000)
assert.equal((await getSp500({ part: 'constituents' })).data.constituents?.length, 3)
assert.equal((await getSp500({ part: 'valuation' })).data.valuation?.[2].value, 1.09)
const realFetch = globalThis.fetch
const realNow = Date.now
try {
  const fund: EtfHoldingsResult = {
    ticker: 'SPY', fundName: 'SPDR S&P 500 ETF Trust', issuer: 'SPDR / State Street',
    asOfDate: '2026-10-23', expenseRatio: '--', netAssets: '--', sourceUrl: 'https://www.ssga.com/',
    holdings, sectorBreakdown: [], isPartial: false, coverageNote: '',
  }
  Date.now = () => realNow() - 8 * 60 * 60_000
  cache.set('etf-holdings:SPY', fund, TTL.etfHoldings)
  cache.set('etf-fund:v2:SPY:basic', fund, TTL.etfHoldings)
  Date.now = realNow
  const freshHoldings = await withSourceEnvelope(() => getSp500({ part: 'holdings' }))
  assert.equal(freshHoldings.meta.freshness, 'cached', 'Eight-hour holdings are fresh within the shared daily TTL')
  assert.deepEqual(freshHoldings.data.warnings, [], 'An obsolete cache entry must not degrade the current holdings')
  assert.equal(freshHoldings.data.holdings?.rows.length, holdings.length)
  cache.set('etf-fund:v2:SPY:basic', { ...fund, isPartial: true, coverageNote: 'Only top holdings available.' }, TTL.etfHoldings)
  assert.equal((await getSp500({ part: 'holdings' })).meta.freshness, 'partial', 'Genuine partial coverage must remain visible')
  Date.now = () => realNow() - 8 * 60 * 60_000
  cache.set('etf-fund:v2:SPY:basic', fund, TTL.etfHoldings)
  Date.now = realNow
  globalThis.fetch = async () => { throw new Error('Fixture provider outage') }
  const staleHoldings = await withSourceEnvelope(() => getSp500({ part: 'holdings', force: true }))
  assert.equal(staleHoldings.meta.freshness, 'stale', 'An actual refresh outage must still degrade holdings')
  assert(staleHoldings.data.warnings.includes('Holdings refresh failed; showing stale holdings.'))
  assert.equal(staleHoldings.data.holdings?.rows.length, holdings.length, 'Retain the complete last-good basket')
  assert(staleHoldings.meta.failureReason?.includes('Retaining the last complete holdings snapshot'))
  assert.equal((await getSp500({ part: 'valuation', force: true })).meta.freshness, 'partial')
  cache.delete('sp500:valuation')
  assert.equal((await getSp500({ part: 'valuation', force: true })).meta.freshness, 'failed')
  assert.equal((await getSp500({ part: 'constituents' })).data.constituents?.length, 3)
} finally { globalThis.fetch = realFetch; Date.now = realNow }
cache.clear()
console.log('PASS: S&P500 parsing, dates, weights, risk, alignment, completed sessions, breadth coverage, cache, scan deduplication/cancellation/failure')
if (process.argv.includes('--live')) {
  for (const part of ['constituents', 'holdings', 'valuation', 'market', 'history'] as const) {
    const envelope = await getSp500({ part })
    console.log(JSON.stringify({ part, freshness: envelope.meta.freshness, asOf: envelope.data.asOf,
      count: envelope.data.constituents?.length ?? envelope.data.holdings?.rows.length,
      history: envelope.data.history && Object.fromEntries(Object.entries(envelope.data.history).map(([symbol, points]) => [symbol, { count: points.length, last: points.at(-1)?.date }])),
      valuation: envelope.data.valuation, errors: envelope.errors }))
    assert.notEqual(envelope.meta.freshness, 'failed', `${part} failed`)
  }
}
