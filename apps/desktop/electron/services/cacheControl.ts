import type { Envelope } from '../shared/contract.js'
import { describeError, ok } from '../shared/envelope.js'
import type { CacheSettings, CacheStatus } from '../shared/cachePolicy.js'
import { MIB } from '../shared/cachePolicy.js'
import { cache } from './cache.js'
import { readCacheSettings, saveCacheSettings } from './cacheSettings.js'

export async function getCacheStatus(): Promise<Envelope<CacheStatus>> {
  return ok({ settings: readCacheSettings(), service: await cache.stats() }, 'Local cache')
}

let configuring = Promise.resolve()

export function configureCache(value: CacheSettings): Promise<Envelope<CacheStatus>> {
  const operation = configuring.then(async () => {
    try {
      const settings = await saveCacheSettings(value)
      await cache.configureLimits(settings.marketMiB * MIB, settings.assetsMiB * MIB)
      return getCacheStatus()
    } catch (error) {
      const result = await getCacheStatus()
      return { ...result, meta: { ...result.meta, freshness: 'partial' as const, failureReason: describeError(error) } }
    }
  })
  configuring = operation.then(() => undefined, () => undefined)
  return operation
}
