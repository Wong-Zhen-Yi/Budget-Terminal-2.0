import { z } from 'zod'
import type { Envelope } from '../shared/contract.js'
import { describeError, err } from '../shared/envelope.js'
import { ETH_DAY_MS, ETH_LIVE_MAX_AGE_MS, ETH_SOURCE, type EthActivityDay, type EthPayload, type EthRequest } from '../shared/eth.js'
import { cache, TTL } from './cache.js'
import { diversifiedHttp } from './diversifiedHttp.js'

export const ethEndpoints = {
  ecosystem: 'https://sse.growthepie.com/api/history',
  mainnet: 'https://sse.growthepie.com/api/chain/ethereum',
  daily: 'https://api.growthepie.com/v1/landing_page.json',
}
const nonnegative = z.number().nonnegative()
const timestamp = z.number().int().min(Date.UTC(2015, 6, 30))
const history = z.object({ history: z.array(z.object({ timestamp_ms: timestamp, tps: nonnegative })).min(1) })
const chain = z.object({ data: z.object({
  chain_name: z.literal('ethereum'), timestamp, tps: nonnegative,
  block_time: z.number().positive().optional().catch(undefined),
  tx_cost_median_usd: nonnegative.optional().catch(undefined),
}) })
const metricSeries = z.object({
  daily: z.object({ types: z.array(z.string()), data: z.array(z.array(z.unknown())) }),
})
const activityEntry = z.object({
  metrics: z.object({
    txcount: metricSeries,
    throughput: metricSeries.optional().catch(undefined),
    fees: metricSeries.optional().catch(undefined),
    stables_mcap: metricSeries.optional().catch(undefined),
  }),
})
const activity = z.object({ data: z.object({ ethereum: activityEntry, all_l2s: activityEntry }) })

function dailySeries(metric: z.infer<typeof metricSeries> | undefined, now: number, column: 'value' | 'usd'): Map<number, number> {
  const series = new Map<number, number>()
  if (!metric) return series
  const { types, data } = metric.daily
  const dateIndex = types.indexOf('unix')
  const valueIndex = types.indexOf(column)
  if (dateIndex < 0 || valueIndex < 0) return series
  const today = Math.floor(now / ETH_DAY_MS) * ETH_DAY_MS
  const firstDay = today - 93 * ETH_DAY_MS
  for (const row of data) {
    const day = row[dateIndex]
    const value = row[valueIndex]
    if (typeof day !== 'number' || day < firstDay || day >= today || day % ETH_DAY_MS !== 0) continue
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) series.set(day, value)
  }
  return series
}

function dailyActivity(value: unknown, now: number): EthActivityDay[] {
  const { ethereum, all_l2s } = activity.parse(value).data
  function pair(metric: keyof typeof ethereum.metrics, column: 'value' | 'usd') {
    const mainnet = dailySeries(ethereum.metrics[metric], now, column)
    const layer2 = dailySeries(all_l2s.metrics[metric], now, column)
    return {
      dates: mainnet.keys(),
      at(day: number) {
        const l1 = mainnet.get(day)
        const l2 = layer2.get(day)
        return l1 === undefined || l2 === undefined ? undefined : { mainnet: l1, layer2: l2 }
      },
    }
  }
  const transactions = pair('txcount', 'value')
  const gas = pair('throughput', 'value')
  const fees = pair('fees', 'usd')
  const stables = pair('stables_mcap', 'usd')
  const secondsInDay = ETH_DAY_MS / 1000
  const matched = [...transactions.dates].sort((a, b) => a - b).flatMap(day => {
    const counts = transactions.at(day)
    return counts ? [{
      day, mainnetTps: counts.mainnet / secondsInDay, layer2Tps: counts.layer2 / secondsInDay,
      gasThroughputMgasPerSecond: gas.at(day), feesPaidUsdPerDay: fees.at(day), stablecoinSupplyUsd: stables.at(day),
    }] : []
  })
  const newest = matched.at(-1)?.day ?? 0
  return matched.filter(point => newest - point.day < 90 * ETH_DAY_MS)
}

export async function getEth({ force = false }: EthRequest = {}): Promise<Envelope<EthPayload>> {
  const now = Date.now()
  async function read<K extends keyof EthPayload>(
    key: K, parse: (value: unknown) => EthPayload[K], ttl: number, timeLimit: number,
    observedAt: (value: EthPayload[K]) => number,
  ) {
    const source = ethEndpoints[key]
    const previousKey = `eth:${key}`
    const cacheKey = key === 'ecosystem' ? previousKey : `${previousKey}:2`
    try {
      const result = await cache.resolveWithStaleFallback(cacheKey, ttl, async () => {
        const value = parse(await diversifiedHttp.get('growthepie', new URL(source), JSON.parse))
        const stamp = observedAt(value)
        if (!stamp || stamp > now + 30_000) throw new Error('No valid source observation')
        if (now - stamp > timeLimit) throw new Error('Source observation is delayed')
        return value
      }, { force })
      const delayed = now - observedAt(result.value) > timeLimit
      const issue = result.snapshot?.failures.join(' · ') || (delayed ? 'Source observation is delayed' : '')
      return { value: result.value, stamp: result.snapshot?.fetchedAt ?? Date.now() - result.ageSeconds * 1000,
        cached: result.fromCache, issue: issue ? err(source, issue, key) : undefined }
    } catch (error) {
      // Older caches still provide TPS if the first expanded fetch fails.
      const previous = cacheKey === previousKey ? null : await cache.get<EthPayload[K]>(previousKey, { allowStale: true })
      return { value: previous?.value, stamp: previous?.snapshot?.fetchedAt, cached: Boolean(previous), issue: err(source, describeError(error), key) }
    }
  }

  const [ecosystem, mainnet, daily] = await Promise.all([
    read('ecosystem', value => {
      const samples = history.parse(value).history.filter(sample => sample.timestamp_ms <= now + 30_000)
      const unique = new Map(samples.map(({ tps, timestamp_ms }) => [timestamp_ms, { asOf: timestamp_ms, tps }]))
      return [...unique.values()].sort((a, b) => a.asOf - b.asOf).slice(-50)
    }, TTL.eth, ETH_LIVE_MAX_AGE_MS, value => value.at(-1)?.asOf ?? 0),
    read('mainnet', value => {
      const { timestamp, tps, block_time, tx_cost_median_usd } = chain.parse(value).data
      return { asOf: timestamp, tps, blockTimeSeconds: block_time, medianTransactionFeeUsd: tx_cost_median_usd }
    }, TTL.eth, ETH_LIVE_MAX_AGE_MS, value => value?.asOf ?? 0),
    read('daily', value => dailyActivity(value, now), TTL.ethDaily, 3 * ETH_DAY_MS, value => value.at(-1)?.day ?? 0),
  ])
  const results = [ecosystem, mainnet, daily]
  const errors = results.flatMap(result => result.issue ? [result.issue] : [])
  const stamps = results.flatMap(result => result.stamp === undefined ? [] : [result.stamp])
  return {
    data: { ecosystem: ecosystem.value ?? [], mainnet: mainnet.value ?? null, daily: daily.value ?? [] },
    meta: {
      source: ETH_SOURCE,
      fetchedAt: stamps.length ? Math.min(...stamps) : now,
      expiresAt: (Math.min(ecosystem.stamp ?? now, mainnet.stamp ?? now)) + TTL.eth,
      freshness: !stamps.length ? 'failed' : errors.length === results.length && stamps.length === results.length ? 'stale' : errors.length ? 'partial'
        : results.every(result => result.cached) ? 'cached' : 'fresh',
      ...(errors.length ? { failureReason: errors.map(error => `${error.operation}: ${error.reason}`).join(' · ') } : {}),
    },
    errors,
  }
}
