import type { Envelope, Freshness } from '@shared/contract'
import { timestampLabel } from '@/lib/format'

export interface PanelStatus {
  label: string
  envelope: Envelope<unknown> | undefined
  loading: boolean
}

const severity: Record<Freshness, number> = {
  failed: 3,
  partial: 2,
  stale: 1,
  cached: 0,
  fresh: 0,
}

const toneFor: Record<Freshness, string> = {
  failed: 'text-down',
  partial: 'text-down',
  stale: 'text-text-muted',
  cached: 'text-text-muted',
  fresh: 'text-up',
}

/**
 * The bottom strip. It reports the worst state across the panels rather than the last
 * one to finish, so a single failed feed stays visible while everything else refreshes.
 */
export function StatusBar({
  panels,
  sourcePath,
}: {
  panels: PanelStatus[]
  sourcePath: string
}) {
  const loading = panels.filter((panel) => panel.loading)
  const settled = panels.filter((panel) => panel.envelope)

  const worst = settled
    .filter((panel) => severity[panel.envelope!.meta.freshness] > 0)
    .sort((a, b) => severity[b.envelope!.meta.freshness] - severity[a.envelope!.meta.freshness])[0]

  const latest = settled.reduce(
    (newest, panel) => Math.max(newest, panel.envelope!.meta.fetchedAt),
    0,
  )

  let health = 'Data health: OK'
  let tone = 'text-up'
  if (loading.length) {
    health = `Loading ${loading.map((panel) => panel.label).join(', ')}...`
    tone = 'text-text-muted'
  } else if (worst) {
    const meta = worst.envelope!.meta
    health = `${worst.label}: ${meta.failureReason || meta.freshness}`
    tone = toneFor[meta.freshness]
  }

  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-border bg-surface px-2 text-2xs">
      <span className={tone}>{health}</span>
      <span className="ml-auto truncate text-text-dim" title={sourcePath}>
        {sourcePath || 'no holdings file'}
      </span>
      <span className="text-text-dim">|</span>
      <span className="text-text-muted">Data source: Yahoo Finance</span>
      <span className="text-text-dim">|</span>
      <span className="num text-text-muted">{timestampLabel(latest)}</span>
    </footer>
  )
}
