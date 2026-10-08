import type { ChartPayload } from '@shared/contract'
import { PriceChart } from '@/charts/PriceChart'
import { PanelMessage } from '@/components/ui/Panel'
import { compactNumber, quotePrice, decimals, percent, signedQuotePrice } from '@/lib/format'
import type { IndicatorKey } from '@/stores/dashboard'

interface ChartPanelProps {
  payload: ChartPayload | null
  indicators: Record<IndicatorKey, boolean>
  loading: boolean
  failureReason?: string
}

/** The quote header plus the chart itself. */
export function ChartPanel({ payload, indicators, loading, failureReason }: ChartPanelProps) {
  const stats = payload?.stats ?? null
  const up = (stats?.change ?? 0) >= 0
  const lastMa200 = payload?.indicators.ma200.at(-1)?.value
  const lastRsi = payload?.indicators.rsi.at(-1)?.value
  const lastRsiMa = payload?.indicators.rsiMa.at(-1)?.value
  const lastBar = payload?.candles.at(-1)
  const barDate = lastBar && Number.isFinite(lastBar.time)
    ? new Date(lastBar.time * 1000).toISOString().replace('T', ' ').slice(0, 16)
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col border border-border bg-surface">
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-2 py-1">
        <span className="text-sm font-semibold text-text">{payload?.symbol ?? '--'}</span>
        <span className="num text-sm font-semibold text-text">{quotePrice(stats?.price, stats?.currency)}</span>
        <span className={`num text-2xs ${up ? 'text-up' : 'text-down'}`}>
          {signedQuotePrice(stats?.absChange, stats?.currency)} ({percent(stats?.change)})
        </span>
        <span className="num text-2xs text-text-muted">
          O {decimals(stats?.open, 2)} H {decimals(stats?.high, 2)} L {decimals(stats?.low, 2)} C{' '}
          {decimals(stats?.close, 2)} Vol {compactNumber(stats?.volume)}
        </span>
        {barDate ? <span className="text-2xs text-text-muted">Last bar {barDate} UTC · vs previous bar</span> : null}
        <div className="ml-auto flex items-baseline gap-3">
          {indicators.ma200 && lastMa200 !== undefined ? (
            <span className="num text-2xs" style={{ color: '#e0a34a' }}>
              MA200 {quotePrice(lastMa200, stats?.currency)}
            </span>
          ) : null}
          {indicators.rsi && lastRsi !== undefined ? (
            <span className="num text-2xs" style={{ color: '#9d7ce0' }}>
              RSI(14) {decimals(lastRsi, 2)}
              {lastRsiMa !== undefined ? (
                <span className="pl-2 text-text-muted">RSI MA(14) {decimals(lastRsiMa, 2)}</span>
              ) : null}
            </span>
          ) : null}
        </div>
      </header>

      {failureReason ? (
        <PanelMessage>{failureReason}</PanelMessage>
      ) : loading && !payload ? (
        <PanelMessage>Loading chart...</PanelMessage>
      ) : (
        <PriceChart payload={payload} indicators={indicators} />
      )}
    </div>
  )
}
