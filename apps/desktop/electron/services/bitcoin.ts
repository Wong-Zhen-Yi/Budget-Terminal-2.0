import { z } from 'zod'
import type { Envelope, EnvelopeError } from '../shared/contract.js'
import type { BitcoinPayload, BitcoinRequest } from '../shared/bitcoin.js'
import { cache, TTL } from './cache.js'

const positive = z.number().finite().nonnegative()
const count = positive.int()
const schemas = {
  stats: z.object({ timestamp: positive, market_price_usd: positive, hash_rate: positive, n_btc_mined: positive, n_tx: count, n_blocks_mined: count, minutes_between_blocks: positive, totalbc: positive, difficulty: positive }),
  blocks: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), height: count, timestamp: positive, tx_count: count, size: count, weight: count, difficulty: positive })).min(1),
  fees: z.object({ fastestFee: positive, halfHourFee: positive, hourFee: positive, economyFee: positive, minimumFee: positive }),
  mempool: z.object({ count, vsize: positive, total_fee: positive }),
}
export const bitcoinEndpoints = {
  stats: 'https://api.blockchain.info/stats',
  blocks: 'https://mempool.space/api/blocks',
  fees: 'https://mempool.space/api/v1/fees/recommended',
  mempool: 'https://mempool.space/api/mempool',
}

export async function getBitcoin({ force = false }: BitcoinRequest = {}): Promise<Envelope<BitcoinPayload>> {
  const data: BitcoinPayload = { stats: null, blocks: [], fees: null, mempool: null }
  const errors: EnvelopeError[] = []
  const stamps: number[] = []
  let cached = false
  await Promise.all((Object.keys(bitcoinEndpoints) as Array<keyof BitcoinPayload>).map(async key => {
    const source = bitcoinEndpoints[key]
    try {
      const result = await cache.resolve(`bitcoin:${key}`, TTL.bitcoin, async () => {
        const response = await fetch(source, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return schemas[key].parse(await response.json())
      }, { force })
      Object.assign(data, { [key]: result.value })
      stamps.push(Date.now() - result.ageSeconds * 1000)
      cached ||= result.fromCache
    } catch (error) {
      errors.push({ source, symbol: key, operation: 'bitcoin', reason: error instanceof Error ? error.message : String(error) })
    }
  }))
  const staleStats = data.stats !== null && Date.now() - data.stats.timestamp > 2 * 60 * 60_000
  if (staleStats) errors.push({ source: bitcoinEndpoints.stats, symbol: 'stats', operation: 'bitcoin', reason: 'Mining statistics are more than two hours old; source timestamp shown.' })
  return {
    data,
    meta: { source: 'Blockchain.com · mempool.space', fetchedAt: stamps.length ? Math.min(...stamps) : Date.now(), freshness: stamps.length === 0 ? 'failed' : errors.length ? 'partial' : cached ? 'cached' : 'fresh', failureReason: errors.length ? errors.map(e => `${e.symbol}: ${e.reason}`).join(' · ') : undefined },
    errors,
  }
}
