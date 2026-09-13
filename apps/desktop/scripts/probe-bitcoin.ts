import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { bitcoinCycle } from '../electron/shared/bitcoin.js'
import { WORKSPACES, workspaceFor } from '../electron/shared/navigation.js'
import { TABS } from '../electron/shared/contract.js'

assert.equal(workspaceFor('bitcoin')?.id, 'focus')
assert.ok(WORKSPACES.find(w => w.id === 'focus')?.pages.includes('bmnr'))
assert.ok(TABS.some(t => t.id === 'bitcoin' && t.implemented))
assert.equal(bitcoinCycle(839999).subsidy, 6.25)
assert.equal(bitcoinCycle(839999).remaining, 1)
assert.equal(bitcoinCycle(840000).subsidy, 3.125)
assert.equal(bitcoinCycle(840000).remaining, 210000)
assert.equal(bitcoinCycle(840000).progress, 0)
assert.equal(bitcoinCycle(2015).nextRetarget, 2016)
assert.equal(bitcoinCycle(2016).nextRetarget, 4032)
assert.equal(bitcoinCycle(6930000).subsidy, 0)
assert.throws(() => bitcoinCycle(-1))

const directory = await mkdtemp(join(tmpdir(), 'budget-bitcoin-'))
const originalEnv = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const originalFetch = globalThis.fetch
const { getBitcoin, bitcoinEndpoints } = await import('../electron/services/bitcoin.js')
const { cache } = await import('../electron/services/cache.js')
try {
  if (process.argv.includes('--live')) {
    const result = await getBitcoin({ force: true })
    assert.equal(result.errors.length, 0, JSON.stringify(result.errors))
    assert.ok(result.data.stats && result.data.blocks.length)
    console.log(`PASS: four free APIs; height ${result.data.blocks[0].height}; 24h blocks ${result.data.stats.n_blocks_mined}`)
  } else {
    const fixtures = {
      stats: { timestamp: Date.now(), market_price_usd: 70000, hash_rate: 900e9, n_btc_mined: 450e8, n_tx: 600000, n_blocks_mined: 144, minutes_between_blocks: 10, totalbc: 20e6 * 1e8, difficulty: 120e12 },
      blocks: [{ id: 'a'.repeat(64), height: 840000, timestamp: 1713571767, tx_count: 3000, size: 1500000, weight: 3999000, difficulty: 120e12 }],
      fees: { fastestFee: 3, halfHourFee: 2, hourFee: 1, economyFee: 1, minimumFee: 1 },
      mempool: { count: 50000, vsize: 35e6, total_fee: 1234567 },
    }
    let calls = 0
    let failedKey = ''
    let malformed = false
    globalThis.fetch = async input => {
      calls++
      const key = (Object.keys(bitcoinEndpoints) as Array<keyof typeof fixtures>).find(k => bitcoinEndpoints[k] === String(input))!
      if (failedKey === key || failedKey === 'all') return new Response('rate limited', { status: 429 })
      return Response.json(malformed && key === 'fees' ? { fastestFee: -1 } : fixtures[key])
    }
    const first = await getBitcoin()
    assert.equal(first.meta.freshness, 'fresh')
    assert.equal(first.data.stats?.n_blocks_mined, 144)
    await getBitcoin()
    assert.equal(calls, 4, 'TTL should prevent repeat requests')
    await getBitcoin({ force: true })
    assert.equal(calls, 8, 'Refresh should bypass TTL')
    cache.clear()
    failedKey = 'stats'
    const partial = await getBitcoin()
    assert.equal(partial.meta.freshness, 'partial')
    assert.equal(partial.data.stats, null)
    assert.equal(partial.data.blocks.length, 1)
    cache.clear()
    failedKey = 'all'
    assert.equal((await getBitcoin()).meta.freshness, 'failed')
    cache.clear()
    failedKey = ''
    malformed = true
    assert.equal((await getBitcoin()).data.fees, null, 'Invalid numbers must not reach the UI')
    cache.clear()
    malformed = false
    fixtures.stats.timestamp -= 3 * 60 * 60_000
    assert.equal((await getBitcoin()).meta.freshness, 'partial', 'Old source statistics must be marked')
    console.log('PASS: Focus navigation, halving boundaries, retarget boundaries, caching, forced refresh, partial/total outages, schema rejection, source freshness')
  }
} finally {
  globalThis.fetch = originalFetch
  cache.close()
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
