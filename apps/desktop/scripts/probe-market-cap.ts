import { priceToSalesValue, getMarketCapSales } from '../electron/services/yahoo/marketCapSales.js'
import assert from 'node:assert/strict'
import { marketCapRowFromQuote, rankMarketCapRows, MARKET_CAP_TTL, MARKET_CAP_TIERS, marketCapInTier } from '../electron/shared/marketCap.js'
import { getMarketCap, marketCapEnvelope } from '../electron/services/yahoo/marketCap.js'
import { TtlCache } from '../electron/services/cache.js'
import type { ScreenerQuote } from '../electron/services/yahoo/screener.js'

assert.equal(priceToSalesValue(5.25), 5.25)
for (const value of [null, undefined, NaN, Infinity, 0, -2, '5.25']) assert.equal(priceToSalesValue(value), null)

const quote = (symbol: string, marketCap: number): ScreenerQuote => ({ symbol, marketCap, quoteType: 'EQUITY', exchange: 'NMS', regularMarketPrice: 10, longName: `${symbol} Company` })
for (const patch of [{ marketCap: 0 }, { marketCap: -1 }, { marketCap: NaN }, { marketCap: Infinity }, { quoteType: 'ETF' }, { exchange: 'LSE' }, { symbol: '' }]) {
  assert.equal(marketCapRowFromQuote({ ...quote('A', 100), ...patch }), null)
}
assert.equal(marketCapRowFromQuote({ ...quote('A', 100), regularMarketPrice: undefined })?.price, null)
assert.equal(marketCapRowFromQuote({ ...quote('A', 100), regularMarketPrice: 0.001 })?.price, 0.001)
assert.deepEqual(rankMarketCapRows(['Z', 'A'].map((ticker) => marketCapRowFromQuote(quote(ticker, 100))!)).map((r) => r.ticker), ['A', 'Z'])
const offsets: number[] = []
const payload = await getMarketCap({ limit: 3, pageSize: 3, fetchPage: async (offset) => {
  offsets.push(offset)
  return { total: 6, quotes: offset === 0 ? [quote('B', 20e9), quote('B', 30e9), { ...quote('FUND', 25e9), quoteType: 'ETF' }] : [quote('A', 10e9), quote('C', 9e9), quote('D', 8e9)] }
} })
assert.deepEqual(offsets, [0, 3])
assert.deepEqual(payload.rows.map((r) => [r.ticker, r.rank, r.marketCap]), [['B', 1, 30e9], ['A', 2, 10e9], ['C', 3, 9e9]])
assert.equal((await getMarketCap({ fetchPage: async () => ({ total: 1, quotes: [quote('A', 10)] }) })).rows.length, 1)
assert.equal((await getMarketCap({ fetchPage: async () => ({ total: 0, quotes: [] }) })).rows.length, 0)
await assert.rejects(getMarketCap({ pageSize: 1, fetchPage: async () => ({ total: 200, quotes: [quote('A', 10)] }) }), /repeated/)
const store = new TtlCache()
let calls = 0
const loader = async () => { calls++; return payload }
assert.equal((await marketCapEnvelope(false, store, loader)).meta.freshness, 'fresh')
assert.equal((await marketCapEnvelope(false, store, loader)).meta.freshness, 'cached')
assert.equal(calls, 1)
await marketCapEnvelope(true, store, loader)
assert.equal(calls, 2)
const stale = await marketCapEnvelope(true, store, async () => { throw new Error('offline') })
assert.equal(stale.meta.freshness, 'stale')
assert.deepEqual(stale.data, payload)
assert.ok(stale.errors.length)
assert.equal((await marketCapEnvelope(false, new TtlCache(), async () => { throw new Error('offline') })).meta.freshness, 'failed')
assert.equal(MARKET_CAP_TTL, 300_000)
const metrics = marketCapRowFromQuote({ ...quote('METRICS', 1e9), epsTrailingTwelveMonths: -2.34, trailingPE: -15, forwardPE: 12.5 })!
assert.equal(metrics.trailingEps, -2.34)
assert.equal(metrics.trailingPe, null)
assert.equal(metrics.forwardPe, 12.5)
assert.equal(marketCapRowFromQuote({ ...quote('ZERO', 1e9), epsTrailingTwelveMonths: 0 })!.trailingEps, 0)
for (const missing of [null, undefined, NaN, Infinity, '12.3']) {
  const row = marketCapRowFromQuote({ ...quote('EMPTY', 1e9), epsTrailingTwelveMonths: missing, trailingPE: missing, forwardPE: missing })!
  assert.equal(row.trailingEps, null)
  assert.equal(row.trailingPe, null)
  assert.equal(row.forwardPe, null)
}
const positiveMetrics = marketCapRowFromQuote({ ...quote('POSITIVE', 1e9), epsTrailingTwelveMonths: 4, trailingPE: 20, forwardPE: 15 })!
assert.deepEqual([positiveMetrics.trailingEps, positiveMetrics.trailingPe, positiveMetrics.forwardPe], [4, 20, 15])
console.log('PASS: EPS and P/E mapping, negative/zero EPS, invalid and missing metrics')

for (const range of MARKET_CAP_TIERS.filter((r) => r.id !== 'all')) {
  const lower = range.minimum || 1
  assert.ok(marketCapInTier(lower, range.id))
  if (range.minimum) assert.ok(!marketCapInTier(lower - 1, range.id))
  if (range.maximum) {
    assert.ok(marketCapInTier(range.maximum - 1, range.id))
    assert.ok(!marketCapInTier(range.maximum, range.id))
  }
}
const small = await getMarketCap({ tier: 'small', fetchPage: async () => ({ total: 3, quotes: [quote('MEGA', 500e9), quote('SMALL', 1e9), quote('MICRO', 100e6)] }) })
assert.deepEqual(small.rows.map((row) => row.ticker), ['SMALL'])
const tierStore = new TtlCache()
await marketCapEnvelope(false, tierStore, loader, 'all')
const smallResult = await marketCapEnvelope(false, tierStore, async () => small, 'small')
assert.deepEqual(smallResult.data.rows.map((row) => row.ticker), ['SMALL'])
const failedMid = await marketCapEnvelope(false, tierStore, async () => { throw new Error('offline') }, 'mid')
assert.equal(failedMid.meta.freshness, 'failed')
assert.equal(failedMid.data.rows.length, 0)
console.log('PASS: tier boundaries, provider filtering, and per-tier cache isolation')
console.log('PASS: market-cap filtering, ranking, pagination, cache, force refresh, and stale fallback')
if (!process.argv.includes('--offline')) {
  const sales = await getMarketCapSales(['NVDA', 'AAPL', 'GOOGL'])
  assert.equal(sales.errors.length, 0)
  assert.ok(Object.values(sales.data).every((value) => value !== null && value > 0))
  console.log('PASS: live P/S ratios for NVDA, AAPL and GOOGL')
  for (const range of MARKET_CAP_TIERS) {
  const live = await getMarketCap({ tier: range.id })
  assert.ok(live.rows.length > 0 && live.rows.length <= 100)
  assert.ok(live.rows.every((row) => marketCapInTier(row.marketCap, range.id)))
  assert.equal(new Set(live.rows.map((r) => r.ticker)).size, live.rows.length)
  for (let i = 1; i < live.rows.length; i++) assert.ok(live.rows[i - 1].marketCap >= live.rows[i].marketCap)
  console.log(`PASS: live Yahoo ${range.id} ranking returned ${live.rows.length} stocks; first ${live.rows[0].ticker}`)
  }
}
