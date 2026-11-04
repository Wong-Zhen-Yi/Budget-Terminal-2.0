import type { Query, QueryKey } from '@tanstack/react-query'
import type { PersistedClient, Persister } from '@tanstack/query-persist-client-core'

import {
  CACHE_SCHEMA_VERSION,
  FRESHNESS,
} from '@shared/freshness'
import { DEFAULT_CACHE_SETTINGS, MIB, validCacheSettings, type CacheSettings } from '@shared/cachePolicy'

let cacheSettings = { ...DEFAULT_CACHE_SETTINGS }
export function configureRendererCache(settings: CacheSettings): void {
  if (validCacheSettings(settings)) cacheSettings = { ...settings }
}
export const rendererCacheSettings = (): CacheSettings => ({ ...cacheSettings })
const retentionMs = () => cacheSettings.retentionDays * 86_400_000

const DATABASE = `budget-terminal-renderer-cache-v${CACHE_SCHEMA_VERSION}`
const STORE = 'clients'
const CLIENT_KEY = 'remote-query-client'

// Local records and private agent state are managed by their own stores.
const LOCAL_ROOTS = new Set(['browser', 'agents', 'agentImages', 'notifications', 'articles', 'portfolio', 'cards', 'settings', 'personalFinance', 'mcpStatus', 'appMetrics'])
const LARGE_ROOTS = new Set(['newsThumbnail', 'youtubeThumbnail', 'newsPreview', 'apiUsage', 'cacheStatus'])

export const RENDERER_CACHE_BUSTER = `budget-terminal-renderer-v${CACHE_SCHEMA_VERSION}-equity-perps-v2`

export function isRemoteQueryKey(queryKey: QueryKey): boolean {
  const root = String(queryKey[0] ?? '')
  return Boolean(root) && !LOCAL_ROOTS.has(root)
}

export function shouldPersistRemoteQuery(query: Query): boolean {
  const root = String(query.queryKey[0] ?? '')
  if (!isRemoteQueryKey(query.queryKey) || LARGE_ROOTS.has(root)) return false
  // A failed refresh can have perfectly usable previous data. Do not erase that
  // snapshot from disk just because the latest IPC request failed.
  if (query.state.data === undefined || query.state.dataUpdatedAt <= 0) return false
  const freshness = (query.state.data as { meta?: { freshness?: string } } | undefined)?.meta?.freshness
  return freshness !== 'failed'
}

/** Renderer freshness mirrors the main-process provider TTL for each query family. */
export function queryFreshness(queryKey: QueryKey): number {
  const root = String(queryKey[0] ?? '')
  if (LOCAL_ROOTS.has(root)) return Infinity
  if (root === 'quotes' || root === 'backtestQuotes') return FRESHNESS.quotes
  if (root === 'chart' || root.startsWith('charts') || root === 'forexHistory') {
    const interval = String(queryKey[2] ?? queryKey[1] ?? '')
    return /Minute|Hour|1m|5m|15m|1h/.test(interval) ? FRESHNESS.chartIntraday : FRESHNESS.chartDaily
  }
  if (root === 'options' || root.startsWith('options') || root === 'optionQuotes' || root === 'projections') return FRESHNESS.options
  if (root === 'targets') return FRESHNESS.targets
  if (root === 'news') return FRESHNESS.news
  if (root === 'newsPreview') return FRESHNESS.newsPreview
  if (root === 'newsThumbnail') return FRESHNESS.newsImage
  if (root.startsWith('news')) return FRESHNESS.newsPage
  if (root === 'stocks') return FRESHNESS.chartDaily
  if (root === 'defeatbetaTerminal') return FRESHNESS.publishedData
  if (root === 'backtest') return FRESHNESS.chartDaily
  if (root === 'priceScreen') return FRESHNESS.marketCap
  if (root === 'discoveryUniverse') return FRESHNESS.directory
  if (root === 'discoveryStartup') return FRESHNESS.quotes
  if (root === 'fundamentals' || root === 'fundamentalsPage' || root === 'valuation') return FRESHNESS.profile
  if (root === 'fx') return FRESHNESS.fx
  if (root === 'globalMarkets') return FRESHNESS.chartDaily
  if (root === 'preMarket') return FRESHNESS.preMarket
  if (root === 'forexQuotes') return FRESHNESS.quotes
  if (root === 'forexNews') return FRESHNESS.forexNews
  if (root === 'tradingVolumes') return FRESHNESS.tradingVolumes
  if (root === 'crypto') return FRESHNESS.crypto
  if (root === 'bitcoin') return FRESHNESS.bitcoin
  if (root === 'bmnr') return FRESHNESS.bmnr
  if (root === 'sofi') return FRESHNESS.sofi
  if (root === 'mu') return FRESHNESS.mu
  if (root === 'amzn') return FRESHNESS.amzn
  if (root === 'avgo') return FRESHNESS.avgo
  if (root === 'semiconductors') return FRESHNESS.semiconductors
  if (root === 'vst') return FRESHNESS.vst
  if (root === 'hood') return FRESHNESS.hood
  if (root === 'hims') return FRESHNESS.hims
  if (root === 'gold') return FRESHNESS.goldMarket
  if (root === 'oil') return FRESHNESS.oilMarket
  if (root === 'calendarMonth' || root === 'earningsCalendar') return FRESHNESS.calendar
  if (root === 'economic' || root === 'money') return FRESHNESS.economic
  if (root === 'institutions') return FRESHNESS.institutions
  if (root.startsWith('ipo')) return FRESHNESS.ipo
  if (root === 'politicsPage') return FRESHNESS.politics
  if (root === 'etfAum') return FRESHNESS.etfAum
  if (root === 'etfHoldings') return FRESHNESS.etfHoldings
  if (root === 'etfArbitrage') return FRESHNESS.etfArbitrage
  if (root === 'heatmap') return FRESHNESS.heatmap
  if (root === 'upDown') return FRESHNESS.upDown
  if (root === 'upDownTargets') return 24 * 60 * 60_000
  if (root === 'marketCap' || root === 'marketCapSales') return FRESHNESS.marketCap
  if (root === 'sp500') {
    const part = String(queryKey[1] ?? '')
    if (part === 'market') return FRESHNESS.sp500Market
    if (part === 'constituents' || part === 'valuation') return FRESHNESS.sp500Reference
    return FRESHNESS.sp500History
  }
  if (root === 'returns' || root === 'momentum' || root === 'analytics' || root === 'cardsPerformance') return FRESHNESS.chartDaily
  if (root === 'signals') return FRESHNESS.institutions
  if (root === 'quant') return 12 * 60 * 60_000
  if (root === 'technicalScreen') return 12 * 60 * 60_000
  if (root === 'youtube') return FRESHNESS.youtube
  return 15 * 60_000
}

const SNAPSHOTS = 'queries'

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Upgrade in place: retain the previous monolithic client until the first
    // incremental write commits successfully.
    const request = indexedDB.open(name, 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      if (!request.result.objectStoreNames.contains(SNAPSHOTS)) request.result.createObjectStore(SNAPSHOTS)
    }
    let blocked = false
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('Another window is blocking the cache upgrade'))
    }
  })
}

async function transact<T>(
  name: string,
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => () => T,
): Promise<T> {
  const db = await openDatabase(name)
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction([STORE, SNAPSHOTS], mode)
      // A request succeeding does NOT mean the transaction committed. Quota or
      // shutdown errors must not be mistaken for a durable save.
      transaction.onabort = () => reject(transaction.error ?? new Error('Cache transaction aborted'))
      transaction.onerror = () => reject(transaction.error)
      try {
        const result = run(transaction)
        transaction.oncomplete = () => resolve(result())
      } catch (error) {
        transaction.abort()
        reject(error)
      }
    })
  } finally {
    db.close()
  }
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

// React Query retains immutable state objects between updates. Reuse their sizes so
// each startup result does not serialize all previously loaded histories again.
const querySizes = new WeakMap<object, number>()

function* trimClient(client: PersistedClient, maxBytes = cacheSettings.rendererMiB * MIB): Generator<void, PersistedClient> {
  const candidates = [...client.clientState.queries]
    .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)
  const empty = { ...client, clientState: { ...client.clientState, queries: [] } }
  const queries: PersistedClient['clientState']['queries'] = []
  let used = jsonBytes(empty)
  for (const query of candidates) {
    let size = querySizes.get(query.state)
    if (size === undefined) {
      size = jsonBytes(query)
      querySizes.set(query.state, size)
    }
    yield
    if (used + size > maxBytes) continue
    queries.push(query)
    used += size
  }
  return { ...client, clientState: { ...client.clientState, queries } }
}

/** Keep the newest successful page snapshots within the explicit renderer budget. */
export function trimPersistedClient(client: PersistedClient, maxBytes?: number): PersistedClient {
  const steps = trimClient(client, maxBytes)
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

/** Yield between page snapshots so cache maintenance cannot monopolize input/paint. */
export async function trimPersistedClientInBackground(
  client: PersistedClient,
  cancelled: () => boolean = () => false,
  maxBytes?: number,
): Promise<PersistedClient | undefined> {
  const steps = trimClient(client, maxBytes)
  let sliceStarted = performance.now()
  while (!cancelled()) {
    const step = steps.next()
    if (step.done) return step.value
    if (performance.now() - sliceStarted >= 4) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      sliceStarted = performance.now()
    }
  }
  return undefined
}

function markRestored(client: PersistedClient): PersistedClient {
  const queries = client.clientState.queries.map((query) => {
    const data = query.state.data as { meta?: { freshness?: string; fetchedAt?: number } } | undefined
    if (!data?.meta) return query
    const fetchedAt = data.meta.fetchedAt ?? query.state.dataUpdatedAt
    return {
      ...query,
      state: {
        ...query.state,
        data: {
          ...data,
          meta: {
            ...data.meta,
            freshness: data.meta.freshness === 'fresh' ? 'cached' : data.meta.freshness,
            cacheAgeSeconds: Math.max(0, (Date.now() - fetchedAt) / 1000),
          },
        },
      },
    }
  })
  return { ...client, clientState: { ...client.clientState, queries } }
}

type SavedQuery = PersistedClient['clientState']['queries'][number]
interface SavedMetadata { reference?: WeakRef<object>; updatedAt: number; size: number }

function savedMetadata(query: SavedQuery): SavedMetadata {
  const data = query.state.data
  return { reference: data && typeof data === 'object' ? new WeakRef(data) : undefined,
    updatedAt: query.state.dataUpdatedAt, size: jsonBytes(query) }
}

type ClientHeader = PersistedClient & { incremental?: boolean }

export interface RendererCacheStats {
  bytes: number
  saved: number
  restored: number
  expiredOnRestore: number
  evictions: number
  lastSavedAt?: number
  lastRestoredAt?: number
  error?: string
  refreshes: Record<string, { reused: number; missing: number; expired: number; recovery: number }>
}

const refreshes: RendererCacheStats['refreshes'] = {}
export function recordCacheDecision(root: string, reason: 'reused' | 'missing' | 'expired' | 'recovery'): void {
  const counters = refreshes[root] ??= { reused: 0, missing: 0, expired: 0, recovery: 0 }
  counters[reason] += 1
}

/** Independent instances let restart probes use real IndexedDB, never a user's profile. */
export function createRendererQueryPersister({ database = DATABASE, throttleMs = 1_000, loadSettings }: {
  database?: string; throttleMs?: number; loadSettings?: () => Promise<void>
} = {}): Persister & { flush: () => Promise<void>; stats: () => RendererCacheStats } {
  let pendingWrite: ReturnType<typeof setTimeout> | undefined
  let latestClient: PersistedClient | undefined
  let writing: Promise<void> | undefined
  let generation = 0
  let lastWrite = 0
  let savedQueries = new Map<string, SavedMetadata>()
  let initialized = false
  const stats: Omit<RendererCacheStats, 'refreshes'> = { bytes: 0, saved: 0, restored: 0, expiredOnRestore: 0, evictions: 0 }
  const summarize = () => {
    stats.saved = savedQueries.size
    stats.bytes = [...savedQueries.values()].reduce((sum, query) => sum + query.size, 0)
  }

  function schedule(): void {
    // Throttle, never debounce: Browser/Agent polling can emit cache events faster
    // than once a second indefinitely. Those events must not postpone disk saves.
    if (!pendingWrite && !writing) {
      pendingWrite = setTimeout(() => {
        pendingWrite = undefined
        void writeLatestClient()
      }, Math.max(0, lastWrite + throttleMs - Date.now()))
    }
  }

  function writeLatestClient(): Promise<void> {
    if (writing) return writing
    const client = latestClient
    latestClient = undefined
    if (!client) return Promise.resolve()
    const currentGeneration = generation
    writing = (async () => {
      try {
        const trimmed = await trimPersistedClientInBackground(client, () => currentGeneration !== generation)
        if (!trimmed || currentGeneration !== generation) return
        // Memory GC is independent of disk retention. Only hold weak identities and
        // scalar bookkeeping here, never full snapshots that defeat memory eviction.
        const next = new Map(savedQueries)
        const changed: SavedQuery[] = []
        for (const query of trimmed.clientState.queries) {
          const previous = savedQueries.get(query.queryHash)
          if (!previous || previous.reference?.deref() !== query.state.data || previous.updatedAt !== query.state.dataUpdatedAt) {
            changed.push(query)
            next.set(query.queryHash, savedMetadata(query))
          }
        }
        let used = jsonBytes({ ...trimmed, clientState: { ...trimmed.clientState, queries: [] } })
        for (const [hash, entry] of [...next].sort((a, b) => b[1].updatedAt - a[1].updatedAt)) {
          if (Date.now() - entry.updatedAt > retentionMs() || used + entry.size > cacheSettings.rendererMiB * MIB) next.delete(hash)
          else used += entry.size
        }
        const removed = [...savedQueries.keys()].filter(hash => !next.has(hash))
        // Excluded local polling and fetch-status changes do not rewrite histories.
        if (initialized && !changed.length && !removed.length) return
        await transact(database, 'readwrite', transaction => {
          if (currentGeneration !== generation) throw new Error('Cache write cancelled')
          const store = transaction.objectStore(SNAPSHOTS)
          if (!initialized) store.clear()
          for (const hash of removed) store.delete(hash)
          for (const query of changed) {
            if (!next.has(query.queryHash)) continue
            store.put({ ...query, state: { ...query.state, status: 'success', fetchStatus: 'idle',
              isInvalidated: query.state.status === 'error' ? false : query.state.isInvalidated,
              error: null, fetchFailureCount: 0, fetchFailureReason: null } }, query.queryHash)
          }
          // Header and changed snapshots commit atomically; never mix generations.
          transaction.objectStore(STORE).put({ ...trimmed, incremental: true,
            clientState: { ...trimmed.clientState, queries: [] } } satisfies ClientHeader, CLIENT_KEY)
          return () => undefined
        })
        if (currentGeneration === generation) {
          initialized = true
          savedQueries = next
          stats.evictions += removed.length + changed.filter(query => !next.has(query.queryHash)).length
          stats.lastSavedAt = Date.now()
          stats.error = undefined
          summarize()
        }
      } catch (error) {
        if (currentGeneration === generation) {
          stats.error = error instanceof Error ? error.message : String(error)
          console.warn('[query-cache] Could not persist renderer data.', error)
        }
      } finally {
        lastWrite = Date.now()
        writing = undefined
        if (latestClient) schedule()
      }
    })()
    return writing
  }

  return {
    stats: () => ({ ...stats, refreshes: structuredClone(refreshes) }),
    persistClient: client => {
      latestClient = client
      schedule()
    },
    // Used during orderly shutdown; also drains updates arriving during a save.
    flush: async () => {
      do {
        clearTimeout(pendingWrite)
        pendingWrite = undefined
        await (writing ?? writeLatestClient())
      } while (latestClient || writing)
    },
    restoreClient: async () => {
      const currentGeneration = generation
      try {
        await loadSettings?.()
        const restored = await transact(database, 'readonly', transaction => {
          const header = transaction.objectStore(STORE).get(CLIENT_KEY)
          const snapshots = transaction.objectStore(SNAPSHOTS).getAll()
          return () => {
            const client = header.result as ClientHeader | undefined
            if (!client) return undefined
            return client.incremental ? { ...client, clientState: { ...client.clientState, queries: snapshots.result as SavedQuery[] } } : client
          }
        })
        if (!restored || currentGeneration !== generation) return undefined
        const marked = markRestored({ ...restored, clientState: { ...restored.clientState, queries: restored.clientState.queries.filter(query => Date.now() - query.state.dataUpdatedAt <= retentionMs()) } })
        stats.restored = marked.clientState.queries.length
        stats.expiredOnRestore = restored.clientState.queries.length - stats.restored
        stats.lastRestoredAt = Date.now()
        if (!initialized && restored.incremental) {
          // Hydration reuses the weak data identities without retaining evicted histories.
          savedQueries = new Map([
            ...restored.clientState.queries.filter(query => Date.now() - query.state.dataUpdatedAt > retentionMs()),
            ...marked.clientState.queries,
          ].map(query => [query.queryHash, savedMetadata(query)]))
          initialized = true
          summarize()
        }
        return marked
      } catch (error) {
        stats.error = error instanceof Error ? error.message : String(error)
        console.warn('[query-cache] Could not restore renderer data.', error)
        return undefined
      }
    },
    removeClient: async () => {
      generation += 1
      initialized = false
      savedQueries.clear()
      summarize()
      clearTimeout(pendingWrite)
      pendingWrite = undefined
      latestClient = undefined
      try {
        await transact(database, 'readwrite', transaction => {
          transaction.objectStore(STORE).delete(CLIENT_KEY)
          transaction.objectStore(SNAPSHOTS).clear()
          return () => undefined
        })
      } catch (error) {
        console.warn('[query-cache] Could not clear renderer data.', error)
      }
    },
  }
}

export const rendererQueryPersister = createRendererQueryPersister({
  loadSettings: async () => {
    // The preload is optional in isolated probes; production always supplies it.
    if (typeof window !== 'undefined' && typeof window.api?.cacheStatus === 'function') {
      try {
        const result = await window.api.cacheStatus()
        if (result?.data?.settings) configureRendererCache(result.data.settings)
      } catch (error) { console.warn('[query-cache] Cache preferences unavailable; using defaults.', error) }
    }
  },
})

export function removeRendererCache(): PromiseLike<void> | void {
  return rendererQueryPersister.removeClient()
}
