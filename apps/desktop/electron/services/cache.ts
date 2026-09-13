/**
 * Process-wide TTL cache with single-flight coalescing and optional persistence.
 * Tests construct an in-memory cache; the application singleton uses SQLite.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { DatabaseSync, type StatementSync } from 'node:sqlite'

import {
  CACHE_SCHEMA_VERSION,
  FRESHNESS,
  SERVICE_CACHE_MAX_BYTES,
} from '../shared/freshness.js'

export const TTL = FRESHNESS

interface Entry<T> {
  value: T
  storedAt: number
  ttlMs: number
}

type RetentionClass = 'snapshot' | 'asset' | 'intraday' | 'history'

interface CacheOptions {
  path?: string
  maxBytes?: number
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
}

const cacheRoot = (): string => {
  const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local')
  return join(local, 'BudgetTerminalElectron')
}

export const persistentCachePath = (): string => join(cacheRoot(), 'market-cache-v2.sqlite')

function retentionClass(key: string): RetentionClass {
  if (/image|thumbnail|preview/.test(key)) return 'asset'
  if (/(?:^|:)(?:1m|2m|5m|15m|30m|60m|90m|1h)(?::|$)/.test(key)) return 'intraday'
  if (/chart|history|closes|volume|spark|return|backtest|series/.test(key)) return 'history'
  return 'snapshot'
}

export class TtlCache {
  private readonly entries = new Map<string, Entry<unknown>>()
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private readonly failures = new Map<string, { error: unknown; retryAt: number }>()
  private readonly maxBytes: number
  private db: DatabaseSync | null = null
  private selectEntry: StatementSync | null = null
  private touchEntry: StatementSync | null = null
  private upsertEntry: StatementSync | null = null
  private deleteEntry: StatementSync | null = null

  constructor(options: CacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? SERVICE_CACHE_MAX_BYTES
    if (options.path) this.open(options.path)
  }

  private open(path: string): void {
    try {
      mkdirSync(dirname(path), { recursive: true })
      const db = new DatabaseSync(path)
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA synchronous = NORMAL')
      db.exec('PRAGMA auto_vacuum = INCREMENTAL')
      db.exec(`
        CREATE TABLE IF NOT EXISTS cache_entries (
          key TEXT PRIMARY KEY,
          value BLOB NOT NULL,
          stored_at INTEGER NOT NULL,
          ttl_ms INTEGER NOT NULL,
          last_accessed INTEGER NOT NULL,
          size_bytes INTEGER NOT NULL,
          retention TEXT NOT NULL,
          schema_version INTEGER NOT NULL
        )
      `)
      db.exec(`DELETE FROM cache_entries WHERE schema_version != ${CACHE_SCHEMA_VERSION}`)
      this.db = db
      this.selectEntry = db.prepare(
        'SELECT value, stored_at, ttl_ms FROM cache_entries WHERE key = ? AND schema_version = ?',
      )
      this.touchEntry = db.prepare('UPDATE cache_entries SET last_accessed = ? WHERE key = ?')
      this.upsertEntry = db.prepare(`
        INSERT INTO cache_entries
          (key, value, stored_at, ttl_ms, last_accessed, size_bytes, retention, schema_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          stored_at = excluded.stored_at,
          ttl_ms = excluded.ttl_ms,
          last_accessed = excluded.last_accessed,
          size_bytes = excluded.size_bytes,
          retention = excluded.retention,
          schema_version = excluded.schema_version
      `)
      this.deleteEntry = db.prepare('DELETE FROM cache_entries WHERE key = ?')
      this.prune()
    } catch (error) {
      console.warn('[cache] Persistent cache unavailable; using memory only.', error)
      this.close()
    }
  }

  get<T>(key: string, { allowStale = false } = {}): CachedResult<T> | null {
    let entry = this.entries.get(key) as Entry<T> | undefined
    if (!entry && this.selectEntry) {
      try {
        const row = this.selectEntry.get(key, CACHE_SCHEMA_VERSION) as unknown as DiskRow | undefined
        if (row) {
          entry = {
            value: deserialize(Buffer.from(row.value)) as T,
            storedAt: row.stored_at,
            ttlMs: row.ttl_ms,
          }
          this.entries.set(key, entry)
        }
      } catch {
        this.delete(key)
        return null
      }
    }
    if (!entry) return null
    const now = Date.now()
    const ageMs = Math.max(0, now - entry.storedAt)
    if (ageMs > entry.ttlMs && !allowStale) return null
    try {
      this.touchEntry?.run(now, key)
    } catch {
      // Access timestamps are advisory; the value remains usable if touching fails.
    }
    return { value: entry.value, ageSeconds: ageMs / 1000, fromCache: true }
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.failures.delete(key)
    const storedAt = Date.now()
    this.entries.set(key, { value, storedAt, ttlMs })
    if (!this.upsertEntry) return
    try {
      const encoded = serialize(value)
      this.upsertEntry.run(
        key,
        encoded,
        storedAt,
        ttlMs,
        storedAt,
        encoded.byteLength,
        retentionClass(key),
        CACHE_SCHEMA_VERSION,
      )
      this.prune()
    } catch (error) {
      // Persistence must never turn a successful provider response into an app failure.
      console.warn(`[cache] Could not persist ${key}.`, error)
    }
  }

  delete(key: string): void {
    this.entries.delete(key)
    this.failures.delete(key)
    try {
      this.deleteEntry?.run(key)
    } catch {
      // Deleting an already-unavailable cache is equivalent to a miss.
    }
  }

  clear(): void {
    this.entries.clear()
    this.failures.clear()
    try {
      this.db?.exec('DELETE FROM cache_entries; PRAGMA incremental_vacuum')
    } catch (error) {
      console.warn('[cache] Could not clear persistent cache.', error)
    }
  }

  close(): void {
    this.selectEntry = null
    this.touchEntry = null
    this.upsertEntry = null
    this.deleteEntry = null
    try {
      this.db?.close()
    } finally {
      this.db = null
    }
  }

  private prune(): void {
    if (!this.db) return
    const row = this.db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM cache_entries').get() as {
      total: number
    }
    if (row.total <= this.maxBytes) return
    const target = Math.floor(this.maxBytes * 0.9)
    const candidates = this.db.prepare(`
      SELECT key, size_bytes FROM cache_entries
      ORDER BY
        CASE
          WHEN stored_at + ttl_ms < ? AND retention = 'snapshot' THEN 0
          WHEN retention = 'intraday' THEN 1
          WHEN retention = 'asset' THEN 2
          WHEN retention = 'snapshot' THEN 3
          ELSE 4
        END,
        last_accessed ASC
    `).all(Date.now()) as unknown as Array<{ key: string; size_bytes: number }>
    let total = row.total
    const remove = this.db.prepare('DELETE FROM cache_entries WHERE key = ?')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const candidate of candidates) {
        if (total <= target) break
        remove.run(candidate.key)
        this.entries.delete(candidate.key)
        total -= candidate.size_bytes
      }
      this.db.exec('COMMIT')
      this.db.exec('PRAGMA incremental_vacuum')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async resolve<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
    { force = false } = {},
  ): Promise<CachedResult<T>> {
    if (!force) {
      const hit = this.get<T>(key)
      if (hit) return hit
    }
    const existing = this.inFlight.get(key) as Promise<T> | undefined
    if (existing) return { value: await existing, ageSeconds: 0, fromCache: false }

    const failure = this.failures.get(key)
    if (failure && Date.now() < failure.retryAt) throw failure.error
    this.failures.delete(key)

    const pending = Promise.resolve().then(loader)
      .then((value) => {
        this.set(key, value, ttlMs)
        return value
      })
      .catch((error: unknown) => {
        if (this.failures.size >= 1000) this.failures.delete(this.failures.keys().next().value!)
        this.failures.set(key, { error, retryAt: Date.now() + 10_000 })
        throw error
      })
      .finally(() => {
        this.inFlight.delete(key)
      })
    this.inFlight.set(key, pending)
    return { value: await pending, ageSeconds: 0, fromCache: false }
  }

  async resolveWithStaleFallback<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
    { force = false } = {},
  ): Promise<CachedResult<T> & { stale: boolean }> {
    try {
      const result = await this.resolve(key, ttlMs, loader, { force })
      return { ...result, stale: false }
    } catch (error) {
      const stale = this.get<T>(key, { allowStale: true })
      if (stale) return { ...stale, stale: true }
      throw error
    }
  }
}

// Probe processes use injected/scratch caches and must never touch a developer's real cache.
const runningProbe = process.argv.some((argument) => /(?:^|[\\/])probe-[^\\/]+\.[cm]?[jt]s$/.test(argument))
export const cache = new TtlCache(runningProbe ? {} : { path: persistentCachePath() })
