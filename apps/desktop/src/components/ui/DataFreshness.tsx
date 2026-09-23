import type { Envelope } from '@shared/contract'
import { timestampLabel } from '@/lib/format'

/** Snapshot time is distinct from the exchange's quote time or a filing's period. */
export function DataFreshness({ envelope, loading = false, coverage }: {
  envelope: Envelope<unknown> | undefined
  loading?: boolean
  coverage?: string
}) {
  if (!envelope) return <p className="shrink-0 px-2 py-1 text-2xs text-text-muted">{loading ? 'Loading data…' : 'No data loaded'}</p>
  const { meta, errors } = envelope
  const issues = [...new Set([meta.failureReason, ...errors.map((entry) =>
    [entry.source, entry.operation, entry.symbol, entry.reason].filter(Boolean).join(' · '),
  )].filter((value): value is string => Boolean(value)))]
  const tone = meta.freshness === 'failed' ? 'text-down'
    : meta.freshness === 'stale' || meta.freshness === 'partial' ? 'text-warn' : 'text-text-muted'
  return (
    <div aria-label="Data freshness" className="shrink-0 border-b border-border px-2 py-1 text-2xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={tone}>{loading ? 'Refreshing · ' : ''}{meta.freshness.toUpperCase()}</span>
        <span className="text-text-muted">Source: {meta.source}</span>
        <span className="text-text-muted">Snapshot: {timestampLabel(meta.fetchedAt)}</span>
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
