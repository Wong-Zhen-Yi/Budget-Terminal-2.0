import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { queryFreshness } from './queryPersistence'

const REQUEST_TIMEOUT_MS = 90_000

/** Bound the renderer wait; IPC already running in main can still fill its disk cache. */
export async function withDeadline<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Background page load timed out')), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function warmQuery<T>(client: QueryClient, options: {
  queryKey: QueryKey
  queryFn: () => Promise<T>
  staleTime: number
}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  // The outer deadline also covers joining an existing foreground fetch or a query
  // paused by React Query while offline. Never cancel a query another page is using.
  return withDeadline(() => client.fetchQuery({
    ...options,
    // Hydrated pages are only skipped when they are still fresh by the shared policy.
    staleTime: Math.min(options.staleTime, queryFreshness(options.queryKey)),
    retry: false,
    networkMode: 'always',
    queryFn: () => withDeadline(async () => {
      const result = await options.queryFn()
      const meta = (result as { meta?: { freshness?: string; failureReason?: string } } | null)?.meta
      // A failed envelope is otherwise cached as success forever by Infinity queries.
      // Keep partial/stale payloads, but let a wholly failed page retry on mount.
      if (meta?.freshness === 'failed') throw new Error(meta.failureReason || 'Background page load failed')
      return result
    }, timeoutMs),
  }), timeoutMs)
}

export async function waitForWarmSlot(options: {
  isHidden: () => boolean
  isForegroundFetching: () => boolean
  isCancelled: () => boolean
  foregroundGraceMs?: number
  pollMs?: number
}): Promise<void> {
  let waitingSince = Date.now()
  while (!options.isCancelled()) {
    if (options.isHidden()) {
      // Give the visible page its grace period again after the window is restored.
      waitingSince = Date.now()
    } else if (!options.isForegroundFetching() ||
      Date.now() - waitingSince >= (options.foregroundGraceMs ?? 5_000)) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 250))
  }
}
