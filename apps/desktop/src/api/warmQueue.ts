import { trackPageQuery } from './pageProgress'
import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { pinStartupQuery, QUERY_IDLE_MS } from './queryMemory'
import { queryFreshness, recordCacheDecision } from './queryPersistence'
import type { Envelope } from '@shared/contract'
import { effectiveFreshness, registerSnapshot } from './snapshotHealth'
import { retainUsableSnapshot, StartupLoadError } from './snapshotResult'
export { StartupLoadError } from './snapshotResult'

const REQUEST_TIMEOUT_MS = 90_000
// All pages join the provider queue together. Yahoo background requests start at
// most once a second, so a cold startup with large universes can take many minutes.
// Include queue time and 429 cooldowns without falsely failing the slower warm-up.
const STARTUP_TIMEOUT_MS = 1_800_000

export type StartupSnapshotObserver = ((queryKey: QueryKey, result: unknown, error?: unknown, cached?: boolean) => void) & { owner?: object; force?: boolean; reloaded?: Set<string> }

function cacheLifetime(cached: Envelope<unknown> | undefined, updatedAt: number | undefined, requested: number): number {
  // A service can schedule the next useful check at the next market session.
  // Keep explicit zero-time requests and invalidation as refresh overrides.
  const expiry = cached?.meta?.expiresAt
  return requested !== 0 && updatedAt && expiry !== undefined && Number.isFinite(expiry)
    ? Math.max(0, expiry - updatedAt) : requested
}

function startupFailureReason(result: unknown, fallback: string): string {
  const envelope = result as { meta?: { failureReason?: string }; errors?: Array<{ reason?: string }> } | null
  return envelope?.meta?.failureReason || (Array.isArray(envelope?.errors)
    ? envelope.errors.map(error => error.reason).filter(Boolean).join(' · ') : '') || fallback
}

export function assertStartupReady(result: unknown): void {
  const meta = (result as { meta?: { freshness?: string; failureReason?: string } } | null)?.meta
  if (meta?.freshness === 'partial' || meta?.freshness === 'stale') {
    throw new StartupLoadError(startupFailureReason(result, `Startup data is ${meta.freshness}`), 'degraded')
  }
  if (meta?.freshness === 'failed') throw new StartupLoadError(startupFailureReason(result, 'Startup data failed'), 'failed')
}

/** Fetch dependent snapshots before classifying the complete initial page. */
export async function warmStartupSnapshot<T>(client: QueryClient, options: Parameters<typeof warmQuery<T>>[1], observe?: StartupSnapshotObserver): Promise<T> {
  const pinned = pinStartupQuery(client, options.queryKey, observe?.owner)
  const cached = client.getQueryData<Envelope<unknown>>(options.queryKey)
  // Publish restored content before waiting for the provider queue. Readiness still
  // waits for this task's refresh, so expired data is never silently called ready.
  const state = client.getQueryState(options.queryKey)
  const lifetime = cacheLifetime(cached, state?.dataUpdatedAt, Math.min(options.staleTime, queryFreshness(options.queryKey)))
  const freshness = cached?.meta && effectiveFreshness(cached, Date.now(), queryFreshness(options.queryKey))
  const refreshing = state?.isInvalidated || state?.status === 'error' || Date.now() - (state?.dataUpdatedAt ?? 0) >= lifetime
    || freshness === 'stale' || freshness === 'partial'
  if (cached !== undefined && cached?.meta?.freshness !== 'failed' && refreshing) observe?.(options.queryKey, cached, undefined, true)
  try {
    const hash = hashKey(options.queryKey)
    const force = observe?.force && !observe.reloaded?.has(hash)
    const result = await warmQuery(client, { ...options, force, staleTime: force ? 0 : options.staleTime, gcTime: pinned ? Infinity : QUERY_IDLE_MS }, STARTUP_TIMEOUT_MS)
    if (observe?.force) observe.reloaded?.add(hash)
    observe?.(options.queryKey, result)
    return result
  } catch (error) {
    observe?.(options.queryKey, client.getQueryData(options.queryKey), error)
    throw error
  }
}

export async function warmStartupQuery<T>(client: QueryClient, options: Parameters<typeof warmQuery<T>>[1], observe?: StartupSnapshotObserver): Promise<T> {
  const result = await warmStartupSnapshot(client, options, observe)
  assertStartupReady(result)
  return result
}

/** Start every page without letting a slow or failed page block the others. */
export async function runWarmTasks<T>(tasks: readonly T[], options: {
  run: (task: T) => Promise<unknown>
  isCancelled: () => boolean
  onStart: (task: T) => void
  onSettled: (task: T, result: PromiseSettledResult<unknown>) => void
}): Promise<void> {
  await Promise.all(tasks.map(async (task) => {
    if (options.isCancelled()) return
    options.onStart(task)
    let result: PromiseSettledResult<unknown>
    try {
      result = { status: 'fulfilled', value: await options.run(task) }
    } catch (reason) {
      result = { status: 'rejected', reason }
    }
    if (!options.isCancelled()) options.onSettled(task, result)
  }))
}

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
  force?: boolean
  gcTime?: number
}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const cached = client.getQueryData<Envelope<unknown>>(options.queryKey)
  const lifetime = queryFreshness(options.queryKey)
  const freshness = cached?.meta && effectiveFreshness(cached, Date.now(), lifetime)
  const state = client.getQueryState(options.queryKey)
  // Publisher-denied images have an explicit retry deadline. Keep their fallback
  // tile prepared without issuing another IPC/network read on every maintenance pass.
  const imageCooldown = options.queryKey[0] === 'newsThumbnail' && freshness === 'partial'
    && (cached?.meta?.expiresAt ?? 0) > Date.now()
  const needsRecovery = !imageCooldown && (state?.status === 'error' || freshness === 'stale' || freshness === 'partial' || freshness === 'failed')
  const staleTime = cacheLifetime(cached, state?.dataUpdatedAt, Math.min(options.staleTime, lifetime))
  const expired = needsRecovery || !state?.dataUpdatedAt || Date.now() - state.dataUpdatedAt >= staleTime
  recordCacheDecision(String(options.queryKey[0]), cached === undefined ? 'missing'
    : state?.status === 'error' || freshness === 'partial' || freshness === 'failed' ? 'recovery' : expired || state?.isInvalidated ? 'expired' : 'reused')
  // The outer deadline also covers joining an existing foreground fetch or a query
  // paused by React Query while offline. Never cancel a query another page is using.
  const result = await withDeadline(() => client.fetchQuery({
    ...options,
    // A recent partial/failed snapshot is not a successful warm-up. Refetch it on
    // recovery instead of reusing it until its normal (possibly hours-long) TTL.
    staleTime: needsRecovery ? 0 : staleTime,
    retry: false,
    networkMode: 'always',
    queryFn: () => withDeadline(async () => {
      const result = retainUsableSnapshot(client.getQueryData(options.queryKey), await trackPageQuery(options.queryKey, options.queryFn, options.force))
      const meta = (result as { meta?: { freshness?: string; failureReason?: string } } | null)?.meta
      // A failed envelope is otherwise cached as success forever by Infinity queries.
      // Keep partial/stale payloads, but let a wholly failed page retry on mount.
      if (meta?.freshness === 'failed') throw new StartupLoadError(startupFailureReason(result, 'Background page load failed'), 'failed')
      registerSnapshot(result, queryFreshness(options.queryKey))
      return result
    }, timeoutMs),
  }), timeoutMs)
  registerSnapshot(result, lifetime)
  return result
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
