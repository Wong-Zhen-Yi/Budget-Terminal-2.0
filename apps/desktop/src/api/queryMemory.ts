import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'

const pins = new WeakMap<QueryClient, Set<string>>()
const completed = new WeakSet<QueryClient>()
export const QUERY_IDLE_MS = 15 * 60_000

export function pinStartupQuery(client: QueryClient, queryKey: QueryKey): void {
  let keys = pins.get(client)
  if (!keys) { keys = new Set(); pins.set(client, keys) }
  keys.add(hashKey(queryKey))
  const query = client.getQueryCache().find({ queryKey, exact: true })
  if (query) query.setOptions({ ...query.options, gcTime: Infinity })
}

export function completeStartupRegistration(client: QueryClient): void {
  completed.add(client)
}

/** Payload estimates intentionally exclude protected startup and local-record data. */
export function manageQueryMemory(client: QueryClient, options: {
  maxBytes?: number; maxQueries?: number; idleMs?: number; deferUntilStartup?: boolean
} = {}) {
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024
  const maxQueries = options.maxQueries ?? 1_000
  const accessed = new Map<string, number>()
  const sizes = new WeakMap<object, number>()
  let scheduled: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let sweeping = false
  let again = false
  const estimate = (data: unknown) => {
    if (data && typeof data === 'object') {
      const previous = sizes.get(data)
      if (previous !== undefined) return previous
    }
    let bytes = 0
    try { bytes = new TextEncoder().encode(JSON.stringify(data) ?? '').byteLength } catch { bytes = maxBytes }
    if (data && typeof data === 'object') sizes.set(data, bytes)
    return bytes
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
        if (['browser', 'agents', 'agentImages', 'notifications', 'articles', 'portfolio', 'cards', 'settings', 'personalFinance'].includes(String(query.queryKey[0]))) continue
        const size = estimate(query.state.data)
        bytes += size
        count += 1
        candidates.push({ query, size, accessedAt: accessed.get(query.queryHash) ?? query.state.dataUpdatedAt ?? now })
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
    if (event.type === 'removed') accessed.delete(event.query.queryHash)
    else if (event.type === 'added' || event.type === 'observerAdded' || (event.type === 'updated' && event.action.type === 'success')) accessed.set(event.query.queryHash, Date.now())
    schedule()
  })
  const timer = setInterval(schedule, 30_000)
  schedule()
  return {
    sweep,
    stop: () => { stopped = true; clearTimeout(scheduled); clearInterval(timer); unsubscribe(); accessed.clear() },
  }
}
