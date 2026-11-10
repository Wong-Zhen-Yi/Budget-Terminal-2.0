import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'

const pins = new WeakMap<QueryClient, Map<string, Set<object | undefined>>>()
const retiredOwners = new WeakSet<object>()
const completed = new WeakSet<QueryClient>()
const maintenance = new WeakMap<QueryClient, Set<() => void>>()
export const QUERY_IDLE_MS = 15 * 60_000
const localRoots = new Set(['browser', 'agents', 'agentImages', 'notifications', 'articles', 'portfolio', 'cards', 'settings', 'personalFinance', 'cloudSyncStatus', 'marketApiKeys', 'mcpStatus', 'appMetrics', 'apiUsage', 'cacheStatus'])
const payloadSizes = new WeakMap<object, number>()

function payloadBytes(data: unknown): number {
  if (data && typeof data === 'object') {
    const previous = payloadSizes.get(data)
    if (previous !== undefined) return previous
  }
  const bytes = new TextEncoder().encode(JSON.stringify(data) ?? '').byteLength
  if (data && typeof data === 'object') payloadSizes.set(data, bytes)
  return bytes
}

export interface QueryMemoryStats {
  pinnedBytes: number; pinnedQueries: number
  additionalBytes: number; additionalQueries: number
  localBytes: number; localQueries: number
  unmeasuredQueries: number
}

/** Settings-only estimates include protected snapshots without making them eviction candidates. */
export async function readQueryMemoryStats(client: QueryClient): Promise<QueryMemoryStats> {
  const result: QueryMemoryStats = { pinnedBytes: 0, pinnedQueries: 0, additionalBytes: 0, additionalQueries: 0,
    localBytes: 0, localQueries: 0, unmeasuredQueries: 0 }
  let slice = performance.now()
  for (const query of client.getQueryCache().getAll()) {
    const category = localRoots.has(String(query.queryKey[0])) ? 'local' : pins.get(client)?.has(query.queryHash) ? 'pinned' : 'additional'
    result[`${category}Queries`]++
    try { result[`${category}Bytes`] += payloadBytes(query.state.data) } catch { result.unmeasuredQueries++ }
    if (performance.now() - slice >= 4) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      slice = performance.now()
    }
  }
  return result
}

export function pinStartupQuery(client: QueryClient, queryKey: QueryKey, owner?: object): boolean {
  if (owner && retiredOwners.has(owner)) return false
  let keys = pins.get(client)
  if (!keys) { keys = new Map(); pins.set(client, keys) }
  const hash = hashKey(queryKey)
  let owners = keys.get(hash)
  if (!owners) { owners = new Set(); keys.set(hash, owners) }
  owners.add(owner)
  const query = client.getQueryCache().find({ queryKey, exact: true })
  if (query) query.setOptions({ ...query.options, gcTime: Infinity })
  return true
}

/** Release superseded selections while retaining keys shared by current pages. */
export function releaseStartupQueries(client: QueryClient, owner: object): void {
  retiredOwners.add(owner)
  for (const [hash, owners] of pins.get(client) ?? []) {
    owners.delete(owner)
    if (!owners.size) pins.get(client)!.delete(hash)
  }
  maintenance.get(client)?.forEach(schedule => schedule())
}

export function completeStartupRegistration(client: QueryClient): void {
  completed.add(client)
  maintenance.get(client)?.forEach(schedule => schedule())
}

/** Payload estimates intentionally exclude protected startup and local-record data. */
export function manageQueryMemory(client: QueryClient, options: {
  maxBytes?: number; maxQueries?: number; idleMs?: number; deferUntilStartup?: boolean
} = {}) {
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024
  const maxQueries = options.maxQueries ?? 1_000
  const accessed = new Map<string, number>()
  let scheduled: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let sweeping = false
  let again = false
  const estimate = (data: unknown) => {
    try { return payloadBytes(data) } catch { return maxBytes }
  }
  async function sweep(): Promise<void> {
    if (stopped || (options.deferUntilStartup && !completed.has(client))) return
    if (sweeping) { again = true; return }
    sweeping = true
    try {
      const now = Date.now()
      const candidates = []
      let bytes = 0
      let count = 0
      let slice = performance.now()
      for (const query of client.getQueryCache().getAll()) {
        if (pins.get(client)?.has(query.queryHash)) continue
        // Saved records and live sessions have separate owners and lifetimes.
        if (localRoots.has(String(query.queryKey[0]))) continue
        const size = estimate(query.state.data)
        bytes += size
        count += 1
        candidates.push({ query, data: query.state.data, updatedAt: query.state.dataUpdatedAt,
          size, accessedAt: accessed.get(query.queryHash) ?? query.state.dataUpdatedAt ?? now })
        if (performance.now() - slice >= 4) {
          await new Promise<void>(resolve => setTimeout(resolve, 0))
          if (stopped) return
          slice = performance.now()
        }
      }
      candidates.sort((a, b) => a.accessedAt - b.accessedAt)
      for (const entry of candidates) {
        const { query } = entry
        if (pins.get(client)?.has(query.queryHash) || query.getObserversCount() || query.state.fetchStatus !== 'idle') continue
        if (bytes <= maxBytes && count <= maxQueries && now - entry.accessedAt < (options.idleMs ?? QUERY_IDLE_MS)) continue
        // A query can have been refreshed/replaced while size estimation yielded.
        if (client.getQueryCache().get(query.queryHash) !== query) continue
        if (query.state.data !== entry.data || query.state.dataUpdatedAt !== entry.updatedAt) continue
        client.removeQueries({ queryKey: query.queryKey, exact: true })
        bytes -= entry.size
        count -= 1
      }
    } finally {
      sweeping = false
      if (again && !stopped) { again = false; schedule() }
    }
  }
  function schedule() {
    if (!scheduled && !stopped) scheduled = setTimeout(() => { scheduled = undefined; void sweep() }, 250)
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (localRoots.has(String(event.query.queryKey[0]))) return
    if (event.type === 'removed') accessed.delete(event.query.queryHash)
    else if (event.type === 'added' || event.type === 'observerAdded' || (event.type === 'updated' && event.action.type === 'success')) accessed.set(event.query.queryHash, Date.now())
    if (pins.get(client)?.has(event.query.queryHash)) return
    const settled = event.type === 'updated' && (event.action.type === 'success' || event.action.type === 'error'
      || (event.action.type === 'setState' && ('data' in event.action.state || event.action.state.fetchStatus === 'idle')))
    if (event.type === 'added' || event.type === 'removed' || event.type === 'observerAdded' || event.type === 'observerRemoved' || settled) schedule()
  })
  const schedulers = maintenance.get(client) ?? new Set<() => void>()
  maintenance.set(client, schedulers)
  schedulers.add(schedule)
  const timer = setInterval(schedule, 30_000)
  schedule()
  return {
    sweep,
    stop: () => { stopped = true; clearTimeout(scheduled); clearInterval(timer); unsubscribe(); schedulers.delete(schedule); accessed.clear() },
  }
}
