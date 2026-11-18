import type { FetchQueryOptions, QueryClient, QueryKey } from '@tanstack/react-query'
import type { Envelope, HeatmapPayload } from '@shared/contract'
import { heatmapReplayDates } from '@shared/heatmap'
import { trackPageQuery } from './pageProgress'

export class StartupLoadError extends Error {
  constructor(message: string, readonly state: 'degraded' | 'failed') {
    super(message)
  }
}

interface Snapshot {
  meta?: { freshness?: string; failureReason?: string }
  errors?: Array<{ reason?: string }>
}

/** Failed refreshes must not replace a useful snapshot with empty/default sections. */
export function snapshotNeedsHeatmapReplay(key: QueryKey, snapshot: unknown): boolean {
  if (key[0] !== 'heatmap' || !snapshot) return false
  const { data } = snapshot as Envelope<HeatmapPayload>
  return heatmapReplayDates(data).length < 2
}

export function retainUsableSnapshot<T>(previous: unknown, result: T, key: QueryKey): T {
  const next = result as Snapshot | null
  const freshness = next?.meta?.freshness
  const old = previous as Snapshot | null
  const retained = old?.meta && ['fresh', 'cached', 'stale'].includes(old.meta.freshness ?? '')
  const addsReplay = snapshotNeedsHeatmapReplay(key, previous) && !snapshotNeedsHeatmapReplay(key, result)
  if (freshness === 'failed' || (retained && !addsReplay && (freshness === 'partial' || freshness === 'stale'))) {
    const reason = next?.meta?.failureReason || next?.errors?.map(error => error.reason).filter(Boolean).join(' · ')
      || (freshness === 'failed' ? 'Background page load failed' : `Refresh returned ${freshness} data`)
    throw new StartupLoadError(`${reason}${retained ? ' · Showing previous data' : ''}`, freshness === 'failed' ? 'failed' : 'degraded')
  }
  return result
}

/** Manual refresh shares query activity, error reporting and snapshot retention. */
export function fetchRetainedQuery<T>(client: QueryClient, key: QueryKey, load: () => Promise<T>): Promise<T> {
  return client.fetchQuery({ queryKey: key, staleTime: 0, retry: false,
    queryFn: async () => retainUsableSnapshot(client.getQueryData(key), await trackPageQuery(key, load), key),
  })
}

export function retainedLoader<T>(client: QueryClient, key: QueryKey, load: () => Promise<T>): () => Promise<T> {
  return async () => retainUsableSnapshot(client.getQueryData(key), await trackPageQuery(key, load), key)
}

export function retainedQueryOptions<T>(client: QueryClient, options: FetchQueryOptions<T>): FetchQueryOptions<T> {
  const load = options.queryFn
  return { ...options, ...(typeof load === 'function' ? {
    queryFn: async context => retainUsableSnapshot(client.getQueryData(options.queryKey),
      await trackPageQuery(options.queryKey, () => load(context)), options.queryKey),
  } : {}) }
}
