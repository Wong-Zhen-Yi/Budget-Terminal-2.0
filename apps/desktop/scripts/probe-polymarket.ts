import type { PolymarketRequest } from '../electron/shared/polymarket.js'
import assert from 'node:assert/strict'
import { getPolymarket, polymarketUrl } from '../electron/services/polymarket.js'
import { POLYMARKET_ENDPOINTS } from '../electron/shared/polymarket.js'

assert.ok(POLYMARKET_ENDPOINTS.length >= 80)
assert.ok(!POLYMARKET_ENDPOINTS.some(endpoint => /auth|balance-allowance|data\/orders|data\/trades|builder\/trades/.test(endpoint.path)))
assert.throws(() => polymarketUrl({ endpoint: 'https://example.com' }))
assert.throws(() => polymarketUrl({ endpoint: 'gamma:/markets/{id}', params: { id: '..' } }))
assert.throws(() => polymarketUrl({ endpoint: 'gamma:/markets', params: { api_key: 'no' } }))
assert.equal(polymarketUrl({ endpoint: 'gamma:/markets/{id}', params: { id: '123' } }).href, 'https://gamma-api.polymarket.com/markets/123')
if (process.argv.includes('--live')) {
  const markets = await getPolymarket({ endpoint: 'gamma:/markets', params: { closed: 'false', limit: '1' }, force: true })
  assert.equal(markets.meta.freshness, 'fresh', markets.meta.failureReason ?? 'Market request failed')
  const first = (markets.data.value as Array<Record<string, string>>)[0]
  assert.ok(first?.conditionId)
  const token = JSON.parse(first.clobTokenIds)[0] as string
  const requests: PolymarketRequest[] = [
    { endpoint: 'clob:/book', params: { token_id: token } },
    { endpoint: 'data:/v2/prices-history', params: { token_id: token, interval: '1w' } },
    { endpoint: 'data:/v2/trades', params: { condition: first.conditionId, limit: '5' } },
    { endpoint: 'data:/v2/oi', params: { condition: first.conditionId } },
    { endpoint: 'data:/v2/holders', params: { condition: first.conditionId, limit: '5' } },
    { endpoint: 'data:/v2/leaderboard', params: { limit: '5', time_period: 'day' } },
  ]
  for (const request of requests) {
    const result = await getPolymarket({ ...request, force: true })
    assert.equal(result.meta.freshness, 'fresh', `${request.endpoint}: ${result.meta.failureReason}`)
    assert.notEqual(result.data.value, null)
  }
  console.log('PASS: live Gamma market discovery, CLOB depth and Data v2 history, trades, OI, holders and leaderboard')
}
const original = globalThis.fetch
let calls = 0
try {
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify([{ id: 'mock', question: 'Fixture market' }])) }
  const request = { endpoint: 'gamma:/markets', params: { limit: '1' } }
  const fresh = await getPolymarket(request)
  assert.equal(fresh.meta.freshness, 'fresh')
  assert.deepEqual((await getPolymarket(request)).data, fresh.data)
  assert.equal(calls, 1, 'Session cache should avoid duplicate provider reads')
  globalThis.fetch = async () => new Response('upstream failed', { status: 500 })
  const stale = await getPolymarket({ ...request, force: true })
  assert.equal(stale.meta.freshness, 'stale')
  assert.deepEqual(stale.data, fresh.data)
  let largeCalls = 0
  const largeValue = 'x'.repeat(3 * 1024 * 1024)
  globalThis.fetch = async () => { largeCalls++; return new Response(JSON.stringify(largeValue)) }
  const largeRequest = (limit: string) => ({ endpoint: 'gamma:/markets', params: { limit } })
  for (const limit of ['2', '3', '4']) {
    const result = await getPolymarket(largeRequest(limit))
    assert.equal(result.data.value, largeValue, 'Large responses must stay usable in full')
  }
  await getPolymarket(largeRequest('3'))
  assert.equal(largeCalls, 3, 'Reuse the recent result from memory')
  await getPolymarket(largeRequest('2'))
  assert.equal(largeCalls, 4, 'Release the oldest large result when the byte budget is exceeded')
  globalThis.fetch = async () => new Response('upstream failed', { status: 500 })
  assert.equal((await getPolymarket({ endpoint: 'clob:/time', force: true })).meta.freshness, 'failed')
  globalThis.fetch = async () => new Response('rate limited', { status: 429, headers: { 'retry-after': '2' } })
  assert.equal((await getPolymarket({ endpoint: 'clob:/time', force: true })).meta.freshness, 'failed')
  globalThis.fetch = async () => { throw new Error('Cooldown should prevent this request') }
  assert.match((await getPolymarket({ endpoint: 'clob:/time' })).meta.failureReason!, /cooldown/)
} finally { globalThis.fetch = original }
console.log('PASS: public endpoint allowlist, path validation, byte-bounded caching, stale retention, HTTP failures and rate-limit cooldown')
