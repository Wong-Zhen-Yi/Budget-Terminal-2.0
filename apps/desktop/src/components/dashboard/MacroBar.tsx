import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import type { ChartPayload, Envelope, MacroQuotes } from '@shared/contract'
import { MACRO_SYMBOLS } from '@shared/contract'
import { decimals, EM_DASH, percent } from '@/lib/format'

/** SPY, DXY, VIX, GLD and WTI across the top — the same five the reference app tracks. */
export function MacroBar({ macro, loading, charts }: {
  macro: MacroQuotes
  loading: boolean
  charts: Array<{ data?: Envelope<ChartPayload>; isLoading: boolean; isError: boolean }>
}) {
  const now = useSnapshotClock()
  return (
    <div className="dashboard-macro flex shrink-0 gap-1">
      {MACRO_SYMBOLS.map((entry, index) => {
        const quote = macro[entry.label]
        const up = (quote?.change ?? 0) >= 0
        const chart = charts[index]
        const values = (chart?.data?.data.candles ?? [])
          .filter((candle) => Number.isFinite(candle.close))
          .slice(-30)
          .map((candle) => candle.close)
        const low = Math.min(...values)
        const high = Math.max(...values)
        const points = values.map((value, i) => {
          const x = 2 + (i / (values.length - 1)) * 196
          const y = high === low ? 14 : 26 - ((value - low) / (high - low)) * 24
          return `${x.toFixed(2)},${y.toFixed(2)}`
        }).join(' ')
        const freshness = chart?.data ? effectiveFreshness(chart.data, now, FRESHNESS.chartDaily) : undefined
        const warning = chart?.isError || freshness === 'failed' || freshness === 'partial' || freshness === 'stale'
        const message = chart?.isLoading ? 'Loading history…' : 'History unavailable'
        const description = `${entry.label}: last ${values.length} trading sessions (daily closes)`
        return (
          <div
            key={entry.label}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 border border-border bg-surface px-2 py-1"
            title={`${entry.symbol} · Last 30 trading sessions${warning ? ` · ${chart?.data?.meta.failureReason || freshness || 'History request failed'}` : ''}`}
          >
            {quote ? (
              <span className={`num max-w-full text-center text-2xs ${up ? 'text-up' : 'text-down'}`}>
                {entry.label}: {decimals(quote.price, 2)} ({percent(quote.change)})
              </span>
            ) : (
              <span className="num text-2xs text-text-dim">
                {entry.label}: {loading ? '...' : EM_DASH}
              </span>
            )}
            {values.length >= 2 ? (
              <svg
                viewBox="0 0 200 28"
                preserveAspectRatio="none"
                className={`h-7 w-full ${quote ? (up ? 'text-up' : 'text-down') : 'text-text-muted'}`}
                role="img"
                aria-label={description}
              >
                <title>{description}</title>
                <line x1="2" x2="198" y1="14" y2="14" stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />
                <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            ) : (
              <span className="flex h-7 items-center text-2xs text-text-dim">{message}</span>
            )}
            {warning && values.length >= 2 && (
              <span className="text-2xs text-warn">{freshness === 'stale' ? 'Stale history' : 'History incomplete'}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
