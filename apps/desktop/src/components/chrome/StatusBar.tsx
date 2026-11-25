import type { ReactNode } from 'react'

import type { Envelope, Freshness } from '@shared/contract'
import { effectiveFreshness, errorMessage, useSnapshotClock } from '@/api/snapshotHealth'

export interface PanelStatus {
  label: string
  envelope: Envelope<unknown> | undefined
  loading: boolean
  error?: unknown
  /** False denotes an optional view awaiting user input, rather than missing data. */
  enabled?: boolean
  freshnessMs?: number
}

const severity: Record<Freshness, number> = {
  failed: 3,
  partial: 2,
  stale: 1,
  cached: 0,
  fresh: 0,
}

/**
 * The bottom strip shows loading and action results. Snapshot health details live in
 * Settings; retained data must not be described as healthy merely to hide diagnostics.
 */
export function StatusBar({
  panels,
  sourcePath,
  notice = '',
  warming = '',
  portfolioCharts,
}: {
  panels: PanelStatus[]
  sourcePath: string
  /**
   * A shell-level message that outranks the health line — what the reference writes
   * straight into `status_bar`, such as the result of toggling Obscure.
   */
  notice?: string
  /**
   * The startup warm-up's progress. It sits beside the current page's own loading line:
   * what is on screen matters more than what is being loaded for later.
   */
  warming?: string
  portfolioCharts?: ReactNode
}) {
  const now = useSnapshotClock()
  const expected = panels.filter((panel) => panel.enabled !== false)
  const loading = expected.filter((panel) => panel.loading)
  const failed = expected.find((panel) => errorMessage(panel.error))
  const settled = expected.filter((panel) => panel.envelope)
  const freshness = (panel: PanelStatus) => effectiveFreshness(panel.envelope!, now, panel.freshnessMs)

  const worst = settled
    .filter((panel) => severity[freshness(panel)] > 0)
    .sort((a, b) => severity[freshness(b)] - severity[freshness(a)])[0]

  let health = 'Current page data: OK'
  let tone = 'text-up'
  if (notice) {
    health = notice
    tone = 'text-text-muted'
  } else if (failed) {
    health = `${failed.label}: ${errorMessage(failed.error)}`
    tone = 'text-down'
  } else if (loading.length) {
    health = `Loading ${loading.map((panel) => panel.label).join(', ')}...`
    tone = 'text-text-muted'
  } else if (worst) {
    health = 'Current page data loaded'
    tone = 'text-text-muted'
  } else if (expected.some((panel) => panel.enabled === true && !panel.envelope)) {
    health = 'Data health: awaiting required data'
    tone = 'text-warn'
  } else if (!settled.length) {
    health = expected.length ? 'Data health: no data loaded' : 'No remote data required'
    tone = 'text-text-muted'
  }

  return (
    <footer className="flex h-8 min-w-0 shrink-0 flex-nowrap items-center gap-x-3 overflow-hidden whitespace-nowrap border-t border-border bg-surface px-2 py-1 text-2xs">
      <span className={`min-w-0 truncate ${tone}`} title={health}>{health}</span>
      {warming ? <span role="status" className="min-w-0 truncate text-text-muted" title={warming}>{warming}</span> : null}
      {portfolioCharts}
      <span className="ml-auto min-w-0 truncate text-text-dim" title={sourcePath}>
        {sourcePath || 'no holdings file'}
      </span>
    </footer>
  )
}
