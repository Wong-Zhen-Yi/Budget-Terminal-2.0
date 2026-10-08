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
  const { meta, errors } = envelope
  const freshness = effectiveFreshness(envelope, now, freshnessMs)
  const issues = [...new Set([failure, meta.failureReason, ...errors.map((entry) =>
    [entry.source, entry.operation, entry.symbol, entry.reason].filter(Boolean).join(' · '),
  )].filter((value): value is string => Boolean(value)))]
  const tone = failure || freshness === 'failed' ? 'text-down'
    : freshness === 'stale' || freshness === 'partial' ? 'text-warn' : 'text-text-muted'
  return (
    <div aria-label="Data freshness" className="shrink-0 border-b border-border px-2 py-1 text-2xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={tone}>{loading ? 'Refreshing · ' : ''}{failure ? 'REFRESH FAILED · ' : ''}{freshness.toUpperCase()}</span>
        <span className="text-text-muted">Source: {meta.source}</span>
        <span className="text-text-muted">Snapshot: {timestampLabel(meta.fetchedAt)}</span>
        {meta.asOf ? <span className="text-text-muted">Observed: {timestampLabel(meta.asOf)}</span> : null}
        <span className="text-text-muted">Snapshot age: {Math.max(0, Math.floor((now - meta.fetchedAt) / 60_000))} min</span>
        {meta.cacheAgeSeconds !== undefined && meta.cacheAgeSeconds > 0
          ? <span className="text-text-muted">Cache age at retrieval: {Math.ceil(meta.cacheAgeSeconds / 60)} min</span> : null}
        {coverage ? <span className="text-text-muted">Coverage: {coverage}</span> : null}
      </div>
      {issues.length ? <details className="mt-1 text-warn">
        <summary className="cursor-pointer">{issues.length} data issue{issues.length === 1 ? '' : 's'}</summary>
        <ul className="list-disc space-y-1 pl-5 pt-1">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      </details> : null}
    </div>
  )
}
