import { AsyncLocalStorage } from 'node:async_hooks'
import type { Envelope } from '../shared/contract.js'

/** Retrieval time and source observation time are distinct, especially for daily releases. */
export interface SourceSnapshot {
  fetchedAt: number
  /** Additional feeds consumed by a fallback, retained through derived caches. */
  sources?: string[]
  asOf?: number
  /** Earliest dependency expiry; derived caches cannot extend a quote's lifetime. */
  expiresAt?: number
  stale: boolean
  fromCache: boolean
  failures: string[]
}

const observations = new AsyncLocalStorage<SourceSnapshot[]>()

export function observeSource(snapshot: SourceSnapshot): void {
  observations.getStore()?.push(snapshot)
}

export function sourceSnapshot(): SourceSnapshot | undefined {
  const sources = observations.getStore()
  if (!sources?.length) return undefined
  const dates = sources.flatMap(source => source.asOf === undefined ? [] : [source.asOf])
  const expirations = sources.flatMap(source => source.expiresAt === undefined ? [] : [source.expiresAt])
  return {
    fetchedAt: Math.min(...sources.map(source => source.fetchedAt)),
    ...(dates.length ? { asOf: Math.min(...dates) } : {}),
    ...(expirations.length ? { expiresAt: Math.min(...expirations) } : {}),
    stale: sources.some(source => source.stale),
    fromCache: sources.every(source => source.fromCache),
    failures: [...new Set(sources.flatMap(source => source.failures))],
    sources: [...new Set(sources.flatMap(source => source.sources ?? []))],
  }
}

export async function captureSources<T>(loader: () => Promise<T>): Promise<{ value: T; snapshot?: SourceSnapshot }> {
  return observations.run([], async () => {
    const value = await loader()
    return { value, snapshot: sourceSnapshot() }
  })
}

/** A completed child envelope is a consumed dependency of its caller's source context. */
function observeEnvelope(value: Envelope<unknown>, fromCache = false): void {
  const failures = [...new Set([value.meta.failureReason, ...value.errors.map(error => error.reason)].filter((reason): reason is string => Boolean(reason)))]
  if (!failures.length && (value.meta.freshness === 'partial' || value.meta.freshness === 'failed')) {
    failures.push(`${value.meta.source}: ${value.meta.freshness} source result`)
  }
  observeSource({ fetchedAt: value.meta.fetchedAt, asOf: value.meta.asOf, expiresAt: value.meta.expiresAt,
    stale: value.meta.freshness === 'stale', fromCache: fromCache || value.meta.freshness === 'cached', failures,
    sources: value.meta.source.match(/DefeatBeta \([^)]+\)/g) ?? undefined })
}

export async function withSourceEnvelope<T>(loader: () => Promise<Envelope<T>>): Promise<Envelope<T>> {
  const { value, snapshot } = await captureSources(loader)
  if (!snapshot) { observeEnvelope(value); return value }
  const freshness = value.meta.freshness === 'failed' ? 'failed'
    : value.meta.freshness === 'stale' || snapshot.stale ? 'stale'
    : value.errors.length || snapshot.failures.length || value.meta.freshness === 'partial' ? 'partial'
    : snapshot.fromCache ? 'cached' : value.meta.freshness
  const fetchedAt = Math.min(value.meta.fetchedAt, snapshot.fetchedAt)
  const failureReason = [...new Set([value.meta.failureReason, ...snapshot.failures].filter(Boolean))].join(' · ')
  const errors = [...value.errors, ...snapshot.failures.filter(reason => !value.errors.some(error => error.reason === reason))
    .map(reason => ({ source: value.meta.source, operation: 'source refresh', reason }))]
  const result: Envelope<T> = { ...value, errors, meta: { ...value.meta, freshness, fetchedAt,
    source: [value.meta.source, ...(snapshot.sources ?? []).filter(source => !value.meta.source.includes(source))].join(' + '),
    ...(snapshot.asOf === undefined ? {} : { asOf: Math.min(value.meta.asOf ?? Infinity, snapshot.asOf) }),
    ...(snapshot.expiresAt === undefined ? {} : { expiresAt: Math.min(value.meta.expiresAt ?? Infinity, snapshot.expiresAt) }),
    cacheAgeSeconds: Math.max(0, (Date.now() - fetchedAt) / 1000),
    ...(failureReason ? { failureReason } : {}),
  } }
  observeEnvelope(result, snapshot.fromCache)
  return result
}
