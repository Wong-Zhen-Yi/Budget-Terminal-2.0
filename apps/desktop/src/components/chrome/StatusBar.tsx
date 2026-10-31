import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { ApiProviderUsage, ApiUsageSnapshot, Envelope, Freshness } from '@shared/contract'
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

const EMPTY_USAGE: ApiUsageSnapshot = { providers: [], sampledAt: 0 }

function usageTone(provider: ApiProviderUsage): string {
  if (provider.throttled || provider.percent >= 90) return 'bg-down'
  if (provider.percent >= 60) return 'bg-warn'
  return 'bg-up'
}

function ApiLimitBars() {
  const [usage, setUsage] = useState<ApiUsageSnapshot>(EMPTY_USAGE)

  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      try {
        const next = await window.api.apiUsage()
        if (mounted) setUsage(next)
      } catch {
        // The footer is diagnostic chrome; a closing/reloading main process should not
        // turn a missed poll into a renderer error.
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1_000)
    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div
      className="flex min-w-0 max-w-[48vw] shrink-0 flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="API request pressure"
    >
      <span className="shrink-0 tracking-wide text-text-dim">API USAGE</span>
      {usage.providers.length ? usage.providers.map((provider) => {
        const title = [
          `${provider.label}: ${provider.requestCount}/${provider.softLimit} requests in the last ${provider.windowSeconds}s`,
          `${provider.inFlight} active`,
          ...(provider.queued !== undefined ? [`${provider.queued} queued (not yet sent)`] : []),
          ...(provider.throttled ? [`Rate limited; cooldown ${Math.ceil(provider.cooldownMs / 1000)}s`] : []),
          ...(provider.backgroundRequestsPerSecond !== undefined ? [
            `Startup paced at ${provider.backgroundRequestsPerSecond} requests/s (~${Math.round(provider.backgroundRequestsPerSecond * provider.windowSeconds / provider.softLimit * 100)}% of the app budget when busy)`,
          ] : []),
        ].join(' · ')
        return (
          <div
            key={provider.id}
            className="flex shrink-0 items-center gap-1"
            title={`${title}. Rolling app-side usage, not a provider-reported quota or loading progress. It falls as requests leave the time window.`}
          >
            <span className="text-text-muted">{provider.label.toUpperCase()}</span>
            <span className="num w-8 text-right text-text-muted">{provider.percent}%</span>
            {provider.queued !== undefined ? (
              <span className="num text-text-muted">
                {provider.requestCount}/{provider.softLimit} · {provider.inFlight} active · {provider.queued} queued
              </span>
            ) : null}
            <span className="h-2 w-12 border border-border-strong bg-bg" aria-hidden="true">
              <span
                className={`block h-full transition-[width] duration-300 ${usageTone(provider)}`}
                style={{ width: `${provider.percent}%` }}
              />
            </span>
          </div>
        )
      }) : (
        <span className="text-text-dim">IDLE</span>
      )}
    </div>
  )
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
      <span className="text-text-dim">|</span>
      <ApiLimitBars />
    </footer>
  )
}
