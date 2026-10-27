import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parentPort, workerData } from 'node:worker_threads'
import { CACHE_SCHEMA_VERSION } from '../shared/freshness.js'

export type CacheWork =
  | { kind: 'get'; key: string }
  | { kind: 'touch'; key: string; now: number }
  | { kind: 'set'; key: string; value: Uint8Array; storedAt: number; ttlMs: number; retention: string }
  | { kind: 'delete'; key: string }
  | { kind: 'clear' | 'flush' | 'close' | 'stats' }

type Request = CacheWork & { id: number }
const port = parentPort!
mkdirSync(dirname(workerData.path), { recursive: true })
const db = new DatabaseSync(workerData.path)
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA auto_vacuum = INCREMENTAL')
db.exec(`CREATE TABLE IF NOT EXISTS cache_entries (
  key TEXT PRIMARY KEY, value BLOB NOT NULL, stored_at INTEGER NOT NULL, ttl_ms INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL, size_bytes INTEGER NOT NULL, retention TEXT NOT NULL, schema_version INTEGER NOT NULL
)`)
db.exec(`DELETE FROM cache_entries WHERE schema_version != ${CACHE_SCHEMA_VERSION}`)
db.exec('CREATE INDEX IF NOT EXISTS cache_entries_size_bytes ON cache_entries(size_bytes)')
const select = db.prepare('SELECT value, stored_at, ttl_ms FROM cache_entries WHERE key = ? AND schema_version = ?')
const size = db.prepare('SELECT size_bytes FROM cache_entries WHERE key = ?')
const sum = () => (db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM cache_entries').get() as { total: number }).total
let total = sum()
let transactions = 0
let pruningRuns = 0
let accessWrites = 0
const upsert = db.prepare(`INSERT INTO cache_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, stored_at=excluded.stored_at,
  ttl_ms=excluded.ttl_ms, last_accessed=excluded.last_accessed, size_bytes=excluded.size_bytes,
  retention=excluded.retention, schema_version=excluded.schema_version`)
const remove = db.prepare('DELETE FROM cache_entries WHERE key = ?')
const touch = db.prepare('UPDATE cache_entries SET last_accessed = ? WHERE key = ?')
const touches = new Map<string, number>()
let batch: Request[] = []
let batchTimer: ReturnType<typeof setTimeout> | undefined
const reply = (id: number, value?: unknown) => port.postMessage({ id, value })
const failure = (id: number, error: unknown) => port.postMessage({ id, error: {
  name: error instanceof Error ? error.name : 'Error', message: String(error),
} })

function prune(): void {
  if (total <= workerData.maxBytes) return
  pruningRuns += 1
  const target = Math.floor(workerData.maxBytes * 0.9)
  const candidates = db.prepare(`SELECT key, size_bytes FROM cache_entries ORDER BY CASE
    WHEN stored_at + ttl_ms < ? AND retention = 'snapshot' THEN 0
    WHEN retention = 'intraday' THEN 1 WHEN retention = 'asset' THEN 2
    WHEN retention = 'snapshot' THEN 3 ELSE 4 END, last_accessed ASC`).all(Date.now()) as Array<{ key: string; size_bytes: number }>
  for (const entry of candidates) {
    if (total <= target) break
    remove.run(entry.key)
    total -= entry.size_bytes
  }
}

function flush(includeTouches = false): void {
  clearTimeout(batchTimer)
  batchTimer = undefined
  const current = batch
  batch = []
  if (!current.length && (!includeTouches || !touches.size) && total <= workerData.maxBytes) return
  let vacuum = false
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const request of current) {
      if (request.kind === 'set') {
        const old = size.get(request.key) as { size_bytes: number } | undefined
        upsert.run(request.key, request.value, request.storedAt, request.ttlMs, request.storedAt,
          request.value.byteLength, request.retention, CACHE_SCHEMA_VERSION)
        total += request.value.byteLength - (old?.size_bytes ?? 0)
      } else if (request.kind === 'delete') {
        const old = size.get(request.key) as { size_bytes: number } | undefined
        remove.run(request.key)
        touches.delete(request.key)
        total -= old?.size_bytes ?? 0
      } else if (request.kind === 'clear') {
        db.exec('DELETE FROM cache_entries')
        total = 0
        touches.clear()
        vacuum = true
      }
    }
    if (includeTouches || total > workerData.maxBytes) {
      for (const [key, now] of touches) { touch.run(now, key); accessWrites += 1 }
      touches.clear()
    }
    const before = total
    prune()
    vacuum ||= total < before
    db.exec('COMMIT')
    transactions += 1
  } catch (error) {
    db.exec('ROLLBACK')
    total = sum()
    for (const request of current) failure(request.id, error)
    throw error
  }
  for (const request of current) reply(request.id)
  if (vacuum) db.exec('PRAGMA incremental_vacuum(256)')
}

const maintenance = setInterval(() => {
  try { flush(true) } catch (error) { console.warn('[cache-worker] Maintenance failed:', error) }
}, 30_000)
maintenance.unref()

port.on('message', (request: Request) => {
  try {
    if (request.kind === 'set' || request.kind === 'delete' || request.kind === 'clear') {
      batch.push(request)
      batchTimer ??= setTimeout(() => { try { flush() } catch { /* callers receive errors */ } }, 25)
      return
    }
    if (request.kind === 'touch') {
      touches.set(request.key, request.now)
      reply(request.id)
      return
    }
    // Reads, flush and close are barriers for all earlier mutations.
    flush(request.kind === 'flush' || request.kind === 'close')
    if (request.kind === 'get') reply(request.id, select.get(request.key, CACHE_SCHEMA_VERSION))
    else if (request.kind === 'stats') reply(request.id, { transactions, pruningRuns, accessWrites, bytes: total })
    else {
      if (request.kind === 'close') { clearInterval(maintenance); db.close() }
      reply(request.id)
      if (request.kind === 'close') port.close()
    }
  } catch (error) { failure(request.id, error) }
})
