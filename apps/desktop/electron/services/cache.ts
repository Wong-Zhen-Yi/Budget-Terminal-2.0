/**
 * Process-wide TTL cache with single-flight coalescing and optional persistence.
 * Tests construct an in-memory cache; the application singleton uses SQLite.
 */
import { join } from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { createWorkerRpc, serviceWorker } from './workerRpc.js'
import type { CacheWork } from '../workers/cacheWorker.js'
import { captureSources, observeSource, type SourceSnapshot } from './sourceHealth.js'

import {
  FRESHNESS,
  SERVICE_CACHE_MAX_BYTES,
} from '../shared/freshness.js'

export const TTL = FRESHNESS

interface Entry<T> {
  value: T
  storedAt: number
  ttlMs: number
  snapshot?: SourceSnapshot
  sizeBytes: number
}

type RetentionClass = 'snapshot' | 'asset' | 'intraday' | 'history'

// Incomplete derived results must not pin a brief outage for a normal multi-hour
// TTL. A short negative-cache window still coalesces concurrent failed fan-outs.
const DEGRADED_RETRY_MS = 10_000

interface CacheOptions {
  path?: string
  maxBytes?: number
  memoryMaxBytes?: number
  memoryMaxEntries?: number
}

interface DiskRow {
  value: Uint8Array
  stored_at: number
  ttl_ms: number
}

export interface CachedResult<T> {
  value: T
  /** Age of the returned value in seconds; 0 when it was fetched just now. */
  ageSeconds: number
  fromCache: boolean
  snapshot?: SourceSnapshot
}

const cacheRoot = (): string => {
  const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local')
  return join(local, 'BudgetTerminalElectron')
}

export const persistentCachePath = (): string => join(cacheRoot(), 'market-cache-v2.sqlite')

/** Discard derivatives produced by the repaired legacy cache decoder fault. */
export function repairedSeriesCacheFailure(reason: string): boolean {
  return /Cannot read properties of (?:undefined|null) \(reading ['"](?:coveredFrom|rows)['"]\)/i.test(reason)
}

function usableSnapshot(value: unknown): value is SourceSnapshot {
  if (!value || typeof value !== 'object') return false
  const source = value as Partial<SourceSnapshot>
  return Number.isFinite(source.fetchedAt)
    && (source.asOf === undefined || Number.isFinite(source.asOf))
    && (source.expiresAt === undefined || Number.isFinite(source.expiresAt))
    && typeof source.stale === 'boolean' && typeof source.fromCache === 'boolean'
    && Array.isArray(source.failures) && source.failures.every(reason => typeof reason === 'string')
    && (source.sources === undefined || (Array.isArray(source.sources) && source.sources.every(name => typeof name === 'string')))
}

function usableDiskDocument(value: unknown): value is { value: unknown; snapshot?: SourceSnapshot } {
  if (!value || typeof value !== 'object') return false
  const document = value as { value?: unknown; snapshot?: unknown }
  // Bare legacy blobs may share the schema number but cannot be decoded as wrapped values.
  return Object.hasOwn(document, 'value') && Object.hasOwn(document, 'snapshot')
    && Object.keys(document).every(key => key === 'value' || key === 'snapshot')
    && document.value !== undefined
    && (document.snapshot === undefined || usableSnapshot(document.snapshot))
}

function retentionClass(key: string): RetentionClass {
  if (/image|thumbnail|preview/.test(key)) return 'asset'
  if (/(?:^|:)(?:1m|2m|5m|15m|30m|60m|90m|1h)(?::|$)/.test(key)) return 'intraday'
  if (/chart|history|closes|volume|spark|return|backtest|series/.test(key)) return 'history'
  return 'snapshot'
}

export class TtlCache {
  private readonly entries = new Map<string, Entry<unknown>>()
  private readonly inFlight = new Map<string, Promise<CachedResult<unknown>>>()
  private readonly failures = new Map<string, { error: unknown; retryAt: number }>()
  private readonly disk
  private readonly memoryMaxBytes: number
  private readonly memoryMaxEntries: number
  private memoryBytes = 0
  private pendingBytes = 0
  private readonly pending = new Set<Promise<unknown>>()
  private epoch = 0
  private readonly reads = new Map<string, { revision: number; count: number }>()
  private readonly versions = new Map<string, object>()
  private closed = false
  private closing?: Promise<void>
  private readonly writes = new Set<Promise<void>>()
  private readonly loads = new Map<string, object>()

  constructor(options: CacheOptions = {}) {
    this.memoryMaxBytes = options.memoryMaxBytes ?? 128 * 1024 * 1024
    this.memoryMaxEntries = options.memoryMaxEntries ?? 5_000
    this.disk = options.path ? createWorkerRpc(() => serviceWorker('cacheWorker', {
      path: options.path, maxBytes: options.maxBytes ?? SERVICE_CACHE_MAX_BYTES,
    })) : undefined
  }

  get memoryUsage(): { bytes: number; entries: number; pendingBytes: number } {
    return { bytes: this.memoryBytes, entries: this.entries.size, pendingBytes: this.pendingBytes }
  }

  private remember(key: string, entry: Entry<unknown>): void {
    this.forget(key)
    if (entry.sizeBytes > this.memoryMaxBytes || this.memoryMaxEntries <= 0) return
    this.entries.set(key, entry)
    this.memoryBytes += entry.sizeBytes
    while (this.memoryBytes > this.memoryMaxBytes || this.entries.size > this.memoryMaxEntries) {
      this.forget(this.entries.keys().next().value!)
    }
  }

  private forget(key: string): void {
    this.memoryBytes -= this.entries.get(key)?.sizeBytes ?? 0
    this.entries.delete(key)
  }

  private persist(request: CacheWork): Promise<void> {
    if (!this.disk || this.closed) return Promise.resolve()
    const pending = this.disk.call<void>(request).catch(error => {
      console.warn('[cache] Persistence unavailable; cached memory remains usable.', error)
    })
    this.pending.add(pending)
    void pending.finally(() => this.pending.delete(pending))
    return pending
  }

  async get<T>(key: string, { allowStale = false, observe = !allowStale }: { allowStale?: boolean; observe?: boolean } = {}): Promise<CachedResult<T> | null> {
    let entry = this.entries.get(key) as Entry<T> | undefined
    if (!entry && this.disk && !this.closed) {
      const reads = this.reads.get(key) ?? { revision: 0, count: 0 }
      this.reads.set(key, reads)
      reads.count += 1
      const revision = reads.revision
      try {
        const row = await this.disk.call<DiskRow | undefined>({ kind: 'get', key })
        if (revision !== reads.revision) return this.get<T>(key, { allowStale, observe })
        if (row) {
          let document: unknown
          try { document = deserialize(Buffer.from(row.value)) } catch {
            await this.delete(key)
            return null
          }
          if (!usableDiskDocument(document)) { await this.delete(key); return null }
          entry = {
            value: document.value as T,
            snapshot: document.snapshot,
            storedAt: row.stored_at,
            ttlMs: row.ttl_ms,
            sizeBytes: row.value.byteLength,
          }
          this.remember(key, entry)
        }
      } catch (error) {
        console.warn('[cache] Could not restore cached data.', error)
        return null
      } finally {
        reads.count -= 1
        if (!reads.count) this.reads.delete(key)
      }
    }
    if (!entry) return null
    if (entry.value === undefined || (entry.snapshot !== undefined
      && (!usableSnapshot(entry.snapshot) || entry.snapshot.failures.some(repairedSeriesCacheFailure)))) {
      await this.delete(key)
      return null
    }
    const now = Date.now()
    const degraded = entry.snapshot?.stale || Boolean(entry.snapshot?.failures.length)
    const expiresAt = Math.min(entry.storedAt + entry.ttlMs, entry.snapshot?.expiresAt ?? Infinity,
      degraded ? entry.storedAt + DEGRADED_RETRY_MS : Infinity)
    if (now > expiresAt && !allowStale) return null
    if (this.entries.has(key)) {
      this.entries.delete(key)
      this.entries.set(key, entry)
    }
    void this.persist({ kind: 'touch', key, now })
    const snapshot: SourceSnapshot = {
      fetchedAt: Math.min(entry.storedAt, entry.snapshot?.fetchedAt ?? entry.storedAt),
      asOf: entry.snapshot?.asOf,
      expiresAt: entry.ttlMs > 0 ? expiresAt : entry.snapshot?.expiresAt,
      stale: Boolean(entry.snapshot?.stale || (observe && now > expiresAt) || (entry.snapshot?.expiresAt !== undefined && now > entry.snapshot.expiresAt)),
      fromCache: true,
      failures: entry.snapshot?.failures ?? [],
      sources: entry.snapshot?.sources,
    }
    if (observe) observeSource(snapshot)
    return { value: entry.value, ageSeconds: Math.max(0, now - snapshot.fetchedAt) / 1000, fromCache: true, snapshot }
  }

  set<T>(key: string, value: T, ttlMs: number, snapshot?: SourceSnapshot): Promise<void> {
    if (this.closed || this.closing) return Promise.resolve()
    const operation = this.write(key, value, ttlMs, snapshot)
    this.writes.add(operation)
    void operation.finally(() => this.writes.delete(operation))
    return operation
  }

  private async write<T>(key: string, value: T, ttlMs: number, snapshot?: SourceSnapshot): Promise<void> {
    this.failures.delete(key)
    const storedAt = Date.now()
    if (snapshot?.stale || snapshot?.failures.length) ttlMs = Math.min(ttlMs, DEGRADED_RETRY_MS)
    const version = {}
    this.versions.set(key, version)
    const reading = this.reads.get(key)
    if (reading) reading.revision += 1
    const epoch = this.epoch
    // One encoding supplies both payload accounting and the compatible disk blob.
    let encoded: Buffer
    try { encoded = serialize({ value, snapshot }) } catch (error) {
      this.remember(key, { value, storedAt, ttlMs, snapshot, sizeBytes: this.memoryMaxBytes })
      console.warn('[cache] Could not encode cache entry.', error)
      this.versions.delete(key)
      return
    }
    this.remember(key, { value, storedAt, ttlMs, snapshot, sizeBytes: encoded.byteLength })
    try {
      const sizeBytes = encoded.byteLength
      const waiting = this.pendingBytes > 0 && this.pendingBytes + sizeBytes > 8 * 1024 * 1024
      if (waiting) encoded = Buffer.alloc(0)
      while (this.pendingBytes > 0 && this.pendingBytes + sizeBytes > 8 * 1024 * 1024) {
        await Promise.race(this.pending)
      }
      if (this.epoch !== epoch || this.versions.get(key) !== version) return
      if (waiting) encoded = serialize({ value, snapshot })
      this.pendingBytes += encoded.byteLength
      try { await this.persist({ kind: 'set', key, value: encoded, storedAt, ttlMs, retention: retentionClass(key) }) }
      finally { this.pendingBytes -= encoded.byteLength }
    } catch (error) {
      console.warn('[cache] Could not encode pending cache entry.', error)
    } finally {
      if (this.versions.get(key) === version) this.versions.delete(key)
    }
  }

  async delete(key: string): Promise<void> {
    this.forget(key)
    this.loads.delete(key)
    this.failures.delete(key)
    const reading = this.reads.get(key)
    if (reading) reading.revision += 1
    this.versions.delete(key)
    await this.persist({ kind: 'delete', key })
  }

  async clear(): Promise<void> {
    this.epoch += 1
    for (const reading of this.reads.values()) reading.revision += 1
    this.entries.clear()
    this.memoryBytes = 0
    this.failures.clear()
    this.versions.clear()
    this.loads.clear()
    await this.persist({ kind: 'clear' })
  }

  async flush(): Promise<void> {
    while (this.writes.size || this.pending.size) await Promise.all([...this.writes, ...this.pending])
    await this.persist({ kind: 'flush' })
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closing = (async () => {
      await this.flush()
      await this.persist({ kind: 'close' })
      this.closed = true
      this.disk?.close()
    })()
    return this.closing
  }

  async resolve<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
    { force = false } = {},
  ): Promise<CachedResult<T>> {
    if (!force) {
      const hit = await this.get<T>(key)
      if (hit) { if (hit.snapshot) observeSource(hit.snapshot); return hit }
    }
    const existing = this.inFlight.get(key) as Promise<CachedResult<T>> | undefined
    if (existing) {
      const result = await existing
      if (result.snapshot) observeSource(result.snapshot)
      return result
    }

    const failure = this.failures.get(key)
    if (failure && Date.now() < failure.retryAt) {
      observeSource({ fetchedAt: Date.now(), stale: false, fromCache: false,
        failures: [`${key}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}`] })
      throw failure.error
    }
    this.failures.delete(key)

    const token = {}
    this.loads.set(key, token)
    const pending = captureSources(loader)
      .then(async ({ value, snapshot }) => {
        const storedAt = Date.now()
        if (this.loads.get(key) === token) await this.set(key, value, ttlMs, snapshot)
        const fetchedAt = Math.min(storedAt, snapshot?.fetchedAt ?? storedAt)
        return { value, ageSeconds: Math.max(0, Date.now() - fetchedAt) / 1000, fromCache: false,
          snapshot: { ...snapshot, fetchedAt, fromCache: false, stale: snapshot?.stale ?? false,
            expiresAt: ttlMs > 0 ? Math.min(storedAt + ttlMs, snapshot?.expiresAt ?? Infinity,
              snapshot?.stale || snapshot?.failures.length ? storedAt + DEGRADED_RETRY_MS : Infinity) : snapshot?.expiresAt,
            failures: snapshot?.failures ?? [] } }
      })
      .catch((error: unknown) => {
        observeSource({ fetchedAt: Date.now(), stale: false, fromCache: false,
          failures: [`${key}: ${error instanceof Error ? error.message : String(error)}`] })
        if (this.failures.size >= 1000) this.failures.delete(this.failures.keys().next().value!)
        this.failures.set(key, { error, retryAt: Date.now() + 10_000 })
        throw error
      })
      .finally(() => {
        this.inFlight.delete(key)
        if (this.loads.get(key) === token) this.loads.delete(key)
      })
    this.inFlight.set(key, pending)
    const result = await pending
    if (result.snapshot) observeSource(result.snapshot)
    return result
  }

  async resolveWithStaleFallback<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
    { force = false } = {},
  ): Promise<CachedResult<T> & { stale: boolean }> {
    try {
      const result = await this.resolve(key, ttlMs, loader, { force })
      return { ...result, stale: result.snapshot?.stale ?? false }
    } catch (error) {
      const stale = await this.get<T>(key, { allowStale: true })
      if (stale) {
        const reason = error instanceof Error ? error.message : String(error)
        const snapshot: SourceSnapshot = { ...stale.snapshot!, stale: true,
          failures: [...new Set([...(stale.snapshot?.failures ?? []), `${key}: ${reason}`])] }
        observeSource(snapshot)
        return { ...stale, snapshot, stale: true }
      }
      throw error
    }
  }
}

// Probe processes use injected/scratch caches and must never touch a developer's real cache.
const runningProbe = process.argv.some((argument) => /(?:^|[\\/])probe-[^\\/]+\.[cm]?[jt]s$/.test(argument))
export const cache = new TtlCache(runningProbe ? {} : { path: persistentCachePath() })
