import type { Envelope } from '@shared/contract'
import { timestampLabel } from '@/lib/format'
import { effectiveFreshness, errorMessage, useSnapshotClock } from '@/api/snapshotHealth'

/** Snapshot time is distinct from the exchange's quote time or a filing's period. */
export function DataFreshness({ envelope, loading = false, coverage, error, freshnessMs }: {
  envelope: Envelope<unknown> | undefined
  loading?: boolean
  coverage?: string
  error?: unknown
  freshnessMs?: number
}) {
  const now = useSnapshotClock()
  const failure = errorMessage(error)
  if (!envelope) return <p className={`shrink-0 px-2 py-1 text-2xs ${failure ? 'text-down' : 'text-text-muted'}`}>{failure || (loading ? 'Loading data…' : 'No data loaded')}</p>
  const { meta } = envelope
  const freshness = effectiveFreshness(envelope, now, freshnessMs)
  // Retained snapshots keep their provenance without repeating refresh warnings
  // over usable content. Full failures remain recorded in Settings data health.
  return (
    <div aria-label="Data freshness" className="shrink-0 border-b border-border px-2 py-1 text-2xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-text-muted">{loading ? 'Refreshing · ' : ''}{freshness.toUpperCase()}</span>
        <span className="text-text-muted">Source: {meta.source}</span>
        <span className="text-text-muted">Snapshot: {timestampLabel(meta.fetchedAt)}</span>
        {meta.asOf ? <span className="text-text-muted">Observed: {timestampLabel(meta.asOf)}</span> : null}
        <span className="text-text-muted">Snapshot age: {Math.max(0, Math.floor((now - meta.fetchedAt) / 60_000))} min</span>
        {meta.cacheAgeSeconds !== undefined && meta.cacheAgeSeconds > 0
          ? <span className="text-text-muted">Cache age at retrieval: {Math.ceil(meta.cacheAgeSeconds / 60)} min</span> : null}
        {coverage ? <span className="text-text-muted">Coverage: {coverage}</span> : null}
      </div>
      {freshness === 'failed' ? <p role="alert" className="text-down">{failure || meta.failureReason || 'Data unavailable'}</p> : null}
    </div>
  )
}
