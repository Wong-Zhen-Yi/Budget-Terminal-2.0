import type { QueryClient } from '@tanstack/react-query'
import type { LiveStatusChanged, LiveStatusKind } from '@shared/liveStatus'

/** Dirty revisions received during a read cause one follow-up read, never cancellation. */
export function subscribeLiveStatus(client: QueryClient, subscribe: (listener: (event: LiveStatusChanged) => void) => () => void) {
  const dirty = new Set<LiveStatusKind>()
  const running = new Map<LiveStatusKind, Promise<void>>()
  let stopped = false
  const stop = subscribe(event => {
    if (stopped) return
    dirty.add(event.kind)
    if (running.has(event.kind)) return
    const run = async () => {
      while (!stopped && dirty.delete(event.kind)) {
        const query = client.getQueryCache().find({ queryKey: [event.kind], exact: true })
        if (!query) continue // Startup's initial snapshot will read current state.
        try { await query.promise } catch { /* A push can recover a failed initial read. */ }
        if (!stopped) await client.invalidateQueries({ queryKey: [event.kind], exact: true, refetchType: 'all' }, { cancelRefetch: false })
      }
    }
    const task = run().catch(() => {}).finally(() => running.delete(event.kind))
    running.set(event.kind, task)
  })
  return () => { stopped = true; dirty.clear(); stop() }
}
