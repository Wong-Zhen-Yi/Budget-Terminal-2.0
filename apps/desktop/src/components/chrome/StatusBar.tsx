import { useEffect, useState } from 'react'

import type { ApiProviderUsage, ApiUsageSnapshot, Envelope, Freshness } from '@shared/contract'
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
      className="flex min-w-0 max-w-[48vw] shrink-0 items-center gap-2 overflow-hidden"
      aria-label="API request pressure"
    >
      <span className="shrink-0 tracking-wide text-text-dim">API LIMITS</span>
      {usage.providers.length ? usage.providers.map((provider) => {
        const title = provider.throttled
          ? `${provider.label} rate limited; cooldown ${Math.ceil(provider.cooldownMs / 1000)}s`
          : `${provider.label}: ${provider.requestCount}/${provider.softLimit} requests in ${provider.windowSeconds}s${provider.inFlight ? ` · ${provider.inFlight} active` : ''}`
        return (
          <div
            key={provider.id}
            className="flex shrink-0 items-center gap-1"
            title={`${title}. Soft app-side budget, not a provider-reported quota.`}
          >
            <span className="text-text-muted">{provider.label.toUpperCase()}</span>
            <span className="num w-8 text-right text-text-muted">{provider.percent}%</span>
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
 * The bottom strip. It reports the worst state across the panels rather than the last
 * one to finish, so a single failed feed stays visible while everything else refreshes.
 */
export function StatusBar({
  panels,
  sourcePath,
  notice = '',
  warming = '',
}: {
  panels: PanelStatus[]
  sourcePath: string
  /**
   * A shell-level message that outranks the health line — what the reference writes
   * straight into `status_bar`, such as the result of toggling Obscure.
   */
  notice?: string
  /**
   * The startup warm-up's progress. It sits below the current page's own loading line:
   * what is on screen matters more than what is being loaded for later.
   */
  warming?: string
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
  if (notice) {
    health = notice
    tone = 'text-text-muted'
  } else if (loading.length) {
    health = `Loading ${loading.map((panel) => panel.label).join(', ')}...`
    tone = 'text-text-muted'
  } else if (warming) {
    health = warming
    tone = 'text-text-muted'
  } else if (worst) {
    const meta = worst.envelope!.meta
    health = `${worst.label}: ${meta.failureReason || meta.freshness}`
    tone = toneFor[meta.freshness]
  }

  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-border bg-surface px-2 text-2xs whitespace-nowrap">
      <span className={`min-w-0 truncate ${tone}`}>{health}</span>
      <span className="ml-auto min-w-0 truncate text-text-dim" title={sourcePath}>
        {sourcePath || 'no holdings file'}
      </span>
      <span className="text-text-dim">|</span>
      <ApiLimitBars />
      <span className="text-text-dim">|</span>
      <span className="num shrink-0 text-text-muted">{timestampLabel(latest)}</span>
    </footer>
  )
}
