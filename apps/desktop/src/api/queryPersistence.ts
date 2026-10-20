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
const LOCAL_ROOTS = new Set(['agents', 'agentImages', 'articles', 'portfolio', 'cards', 'settings', 'personalFinance'])
const LARGE_ROOTS = new Set(['newsThumbnail', 'youtubeThumbnail', 'newsPreview'])

export const RENDERER_CACHE_BUSTER = `budget-terminal-renderer-v${CACHE_SCHEMA_VERSION}`

export function isRemoteQueryKey(queryKey: QueryKey): boolean {
  const root = String(queryKey[0] ?? '')
  return Boolean(root) && !LOCAL_ROOTS.has(root)
}

export function shouldPersistRemoteQuery(query: Query): boolean {
  const root = String(query.queryKey[0] ?? '')
  if (!isRemoteQueryKey(query.queryKey) || LARGE_ROOTS.has(root)) return false
  if (query.state.status !== 'success') return false
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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = run(transaction.objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      transaction.onerror = () => reject(transaction.error)
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

let pendingWrite: ReturnType<typeof setTimeout> | undefined
let latestClient: PersistedClient | undefined
let writing = false
let generation = 0

async function writeLatestClient(): Promise<void> {
  pendingWrite = undefined
  if (writing) return
  const client = latestClient
  latestClient = undefined
  if (!client) return
  writing = true
  const currentGeneration = generation
  try {
    const trimmed = await trimPersistedClientInBackground(client, () => currentGeneration !== generation)
    if (trimmed && currentGeneration === generation) {
      await transact('readwrite', (store) => {
        // Cache clearing can also happen while IndexedDB is opening.
        if (currentGeneration !== generation) throw new Error('Cache write cancelled')
        return store.put(trimmed, CLIENT_KEY)
      })
    }
  } catch (error) {
    if (currentGeneration === generation) console.warn('[query-cache] Could not persist renderer data.', error)
  } finally {
    writing = false
    if (latestClient && !pendingWrite) pendingWrite = setTimeout(() => void writeLatestClient(), 1_000)
  }
}

export const rendererQueryPersister: Persister = {
  persistClient: (client) => {
    // Coalesce cache events before serialization; large page payloads must not block a
    // tab switch merely because several queries settled in the same render pass.
    latestClient = client
    clearTimeout(pendingWrite)
    pendingWrite = setTimeout(() => void writeLatestClient(), 1_000)
  },
  restoreClient: async () => {
    try {
      const restored = await transact('readonly', (store) => store.get(CLIENT_KEY)) as PersistedClient | undefined
      return restored ? markRestored(restored) : undefined
    } catch (error) {
      console.warn('[query-cache] Could not restore renderer data.', error)
      return undefined
    }
  },
  removeClient: async () => {
    generation += 1
    clearTimeout(pendingWrite)
    pendingWrite = undefined
    latestClient = undefined
    try {
      await transact('readwrite', (store) => store.delete(CLIENT_KEY))
    } catch (error) {
      console.warn('[query-cache] Could not clear renderer data.', error)
    }
  },
}

export function removeRendererCache(): PromiseLike<void> | void {
  return rendererQueryPersister.removeClient()
}
