import assert from 'node:assert/strict'

import { cache, TtlCache } from '../electron/services/cache.js'
import { yahoo } from '../electron/services/yahoo/client.js'
import { fetchSparkCloses } from '../electron/services/yahoo/spark.js'

// Entirely offline: measure provider calls without spending a real data allowance.
const local = new TtlCache()
let calls = 0
const loader = async () => { calls += 1; return 42 }
await Promise.all(Array.from({ length: 20 }, () => local.resolve('same', 1000, loader)))
assert.equal(calls, 1)
await local.resolve('same', 1000, loader)
assert.equal(calls, 1)
await local.resolve('same', 1000, loader, { force: true })
assert.equal(calls, 2)

let failures = 0
const fail = async () => { failures += 1; throw new Error('provider unavailable') }
local.set('stale', 7, -1)
for (let index = 0; index < 5; index += 1) {
  const fallback = await local.resolveWithStaleFallback('stale', 1000, fail, { force: true })
  assert.equal(fallback.value, 7)
  assert.equal(fallback.stale, true)
}
assert.equal(failures, 1)
const realNow = Date.now
const afterCooldown = realNow() + 10_001
try {
  Date.now = () => afterCooldown
  await local.resolveWithStaleFallback('stale', 1000, fail)
  assert.equal(failures, 2)
} finally {
  Date.now = realNow
}
local.delete('stale')
await assert.rejects(local.resolve('stale', 1000, fail), /provider unavailable/)
assert.equal(failures, 3)
local.set('stale', 9, 1000)
assert.equal((await local.resolve('stale', 1000, loader)).value, 9)

const originalFetch = yahoo._fetch
const batches: string[][] = []
Object.defineProperty(yahoo, '_fetch', { configurable: true, value: async (
  _url: string, params: { symbols: string },
) => {
  const symbols = params.symbols.split(',')
  batches.push(symbols)
  return Object.fromEntries(symbols.map((symbol) => [symbol, {
    symbol, timestamp: [1_700_000_000, 1_700_086_400], close: [100, 101],
  }]))
} })
try {
  cache.clear()
  await Promise.all([
    fetchSparkCloses(['AAPL', 'MSFT']),
    fetchSparkCloses(['MSFT', 'AAPL']),
  ])
  assert.equal(batches.length, 1)
  const overlap = await fetchSparkCloses(['MSFT', 'NVDA'])
  assert.deepEqual(batches[1], ['NVDA'])
  assert.deepEqual(overlap.missing, [])
  await fetchSparkCloses(['MSFT'])
  assert.equal(batches.length, 2)
  await fetchSparkCloses(['MSFT'], '1y', true)
  assert.equal(batches.length, 3)
  await fetchSparkCloses(['MSFT'], '1mo')
  assert.equal(batches.length, 4)
} finally {
  Object.defineProperty(yahoo, '_fetch', { configurable: true, value: originalFetch })
  cache.clear()
}
console.log('Loading checks passed: single-flight, cache reuse, force refresh, failure cooldown, stale fallback, overlapping ETF histories.')
