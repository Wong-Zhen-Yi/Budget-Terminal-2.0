import { ASSET_CACHE_MAX_BYTES, RENDERER_CACHE_MAX_AGE_MS, RENDERER_CACHE_MAX_BYTES, SERVICE_CACHE_MAX_BYTES } from './freshness.js'

export const MIB = 1024 * 1024

export interface CacheSettings {
  rendererMiB: number
  marketMiB: number
  assetsMiB: number
  retentionDays: number
}

export const DEFAULT_CACHE_SETTINGS: CacheSettings = {
  rendererMiB: RENDERER_CACHE_MAX_BYTES / MIB,
  marketMiB: SERVICE_CACHE_MAX_BYTES / MIB,
  assetsMiB: ASSET_CACHE_MAX_BYTES / MIB,
  retentionDays: RENDERER_CACHE_MAX_AGE_MS / 86_400_000,
}

export const CACHE_SETTING_BOUNDS = {
  rendererMiB: { min: 64, max: 1024 },
  marketMiB: { min: 256, max: 16384 },
  assetsMiB: { min: 64, max: 4096 },
  retentionDays: { min: 7, max: 90 },
} as const

export function validCacheSettings(value: unknown): value is CacheSettings {
  if (!value || typeof value !== 'object') return false
  return (Object.keys(CACHE_SETTING_BOUNDS) as Array<keyof CacheSettings>).every(key => {
    const number = (value as CacheSettings)[key]
    const bounds = CACHE_SETTING_BOUNDS[key]
    return Number.isInteger(number) && number >= bounds.min && number <= bounds.max
  })
}

export interface CachePartitionStats {
  bytes: number
  entries: number
  expiredEntries: number
  evictions: number
}

export interface ServiceCacheStats {
  market: CachePartitionStats
  assets: CachePartitionStats
  hits: number
  misses: number
  expired: number
  loads: number
  forced: number
  errors: number
  lastError?: string
}

export interface CacheStatus {
  settings: CacheSettings
  service: ServiceCacheStats
}
