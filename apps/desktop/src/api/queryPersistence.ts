import type { Query, QueryKey } from '@tanstack/react-query'
import type { PersistedClient, Persister } from '@tanstack/query-persist-client-core'

import {
  CACHE_SCHEMA_VERSION,
  FRESHNESS,
  RENDERER_CACHE_MAX_BYTES,
} from '@shared/freshness'

const DATABASE = `budget-terminal-renderer-cache-v${CACHE_SCHEMA_VERSION}`
const STORE = 'clients'
const CLIENT_KEY = 'remote-query-client'

// Local records and private agent state are managed by their own stores.
const LOCAL_ROOTS = new Set(['browser', 'agents', 'agentImages', 'articles', 'portfolio', 'cards', 'settings', 'personalFinance'])
const LARGE_ROOTS = new Set(['newsThumbnail', 'youtubeThumbnail', 'newsPreview'])

export const RENDERER_CACHE_BUSTER = `budget-terminal-renderer-v${CACHE_SCHEMA_VERSION}`

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
  if (root === 'quotes') return FRESHNESS.quotes
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
  if (root === 'defeatbetaTerminal') return 60 * 60_000
  if (root === 'backtest') return FRESHNESS.chartDaily
  if (root === 'priceScreen') return FRESHNESS.marketCap
  if (root === 'discoveryUniverse') return FRESHNESS.chartDaily
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

function* trimClient(client: PersistedClient): Generator<void, PersistedClient> {
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
    if (used + size > RENDERER_CACHE_MAX_BYTES) continue
    queries.push(query)
    used += size
  }
  return { ...client, clientState: { ...client.clientState, queries } }
}

/** Keep the newest successful page snapshots within the explicit renderer budget. */
export function trimPersistedClient(client: PersistedClient): PersistedClient {
  const steps = trimClient(client)
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

/** Yield between page snapshots so cache maintenance cannot monopolize input/paint. */
export async function trimPersistedClientInBackground(
  client: PersistedClient,
  cancelled: () => boolean = () => false,
): Promise<PersistedClient | undefined> {
  const steps = trimClient(client)
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
type ClientHeader = PersistedClient & { incremental?: boolean }

/** Independent instances let restart probes use real IndexedDB, never a user's profile. */
export function createRendererQueryPersister({ database = DATABASE, throttleMs = 1_000 } = {}): Persister & { flush: () => Promise<void> } {
  let pendingWrite: ReturnType<typeof setTimeout> | undefined
  let latestClient: PersistedClient | undefined
  let writing: Promise<void> | undefined
  let generation = 0
  let lastWrite = 0
  let savedQueries = new Map<string, SavedQuery>()
  let initialized = false

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
        const next = new Map(trimmed.clientState.queries.map(query => [query.queryHash, query]))
        const changed = [...next.values()].filter(query => {
          const previous = savedQueries.get(query.queryHash)
          return !previous || previous.state.data !== query.state.data || previous.state.dataUpdatedAt !== query.state.dataUpdatedAt
        })
        const removed = [...savedQueries.keys()].filter(hash => !next.has(hash))
        // Excluded local polling and fetch-status changes do not rewrite histories.
        if (initialized && !changed.length && !removed.length) return
        await transact(database, 'readwrite', transaction => {
          if (currentGeneration !== generation) throw new Error('Cache write cancelled')
          const store = transaction.objectStore(SNAPSHOTS)
          if (!initialized) store.clear()
          for (const hash of removed) store.delete(hash)
          for (const query of changed) {
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
        }
      } catch (error) {
        if (currentGeneration === generation) console.warn('[query-cache] Could not persist renderer data.', error)
      } finally {
        lastWrite = Date.now()
        writing = undefined
        if (latestClient) schedule()
      }
    })()
    return writing
  }

  return {
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
        const marked = markRestored(restored)
        if (!initialized && restored.incremental) {
          // Hydration reuses these data references. Unchanged restored histories
          // should not be serialized and written again on every app launch.
          savedQueries = new Map(marked.clientState.queries.map(query => [query.queryHash, query]))
          initialized = true
        }
        return marked
      } catch (error) {
        console.warn('[query-cache] Could not restore renderer data.', error)
        return undefined
      }
    },
    removeClient: async () => {
      generation += 1
      initialized = false
      savedQueries.clear()
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

export const rendererQueryPersister = createRendererQueryPersister()

export function removeRendererCache(): PromiseLike<void> | void {
  return rendererQueryPersister.removeClient()
}
