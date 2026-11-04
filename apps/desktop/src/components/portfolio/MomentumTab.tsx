import { useState } from 'react'

import type { PositionInput, ReturnTimeframe } from '@shared/contract'
import { RETURN_TIMEFRAMES } from '@shared/contract'
import { ema } from '@shared/analytics'
import { useMomentum } from '@/api/portfolioQueries'
import { LineChart } from '@/components/charts/LineChart'
import { Button } from '@/components/ui/Button'
import { currency, percent } from '@/lib/format'
import { DataFreshness } from '@/components/ui/DataFreshness'
import { FRESHNESS } from '@shared/freshness'
import { useNumberPrivacy } from '@/components/ui/NumberPrivacy'

interface MomentumTabProps {
  positions: PositionInput[]
  cashAmount: number
  visible: boolean
  valuationComplete: boolean
}

/** Portfolio value candles built from daily adjusted holding OHLC. */
export function MomentumTab({ positions, cashAmount, visible, valuationComplete }: MomentumTabProps) {
  const maskNumbers = useNumberPrivacy()
  const [timeframe, setTimeframe] = useState<ReturnTimeframe>('1mo')
  const query = useMomentum(positions, cashAmount, timeframe, visible)
  const data = query.data?.data
  const complete = valuationComplete && Boolean(data && !data.excludedTickers.length)
  const values = data?.values ?? []
  const candles = complete ? data?.candles ?? [] : []
  const valueEma = ema(values, data?.emaPeriod ?? 10)

  const last = data?.returns.at(-1) ?? null
  const lastEma = data?.ema.at(-1) ?? null

  const summary = () => {
    if (!valuationComplete) return 'Portfolio momentum unavailable: market marks are incomplete.'
    if (data?.excludedTickers.length) return `Portfolio momentum unavailable: history missing for ${data.excludedTickers.join(', ')}.`
    if (!data || data.reason) return data?.reason || 'No momentum data available'
    const holdingCount = data.includedTickers.filter(ticker => ticker !== 'CASH').length
    const parts = [
      `Since ${data.startDate}`,
      `Value ${maskNumbers ? '****' : currency(values.at(-1))}`,
      `Portfolio ${maskNumbers ? '****' : percent(last, 1)}`,
      `${maskNumbers ? '****' : holdingCount} included holding${holdingCount === 1 ? '' : 's'}${data.includedTickers.includes('CASH') ? ' · cash included' : ''}`,
    ]
    if (last !== null && lastEma !== null) {
      parts.push(`${last >= lastEma ? 'Above' : 'Below'} ${data.emaPeriod}-day EMA`)
    }
    if (data.excludedTickers.length) parts.push(`${data.excludedTickers.length} excluded`)
    return parts.join(' | ')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <DataFreshness envelope={query.data} loading={query.isFetching} error={query.error} freshnessMs={FRESHNESS.chartDaily}
        coverage={data ? `${maskNumbers ? '****' : `${data.includedTickers.filter(ticker => ticker !== 'CASH').length}/${positions.length}`} holdings in history` : undefined} />
      <div className="flex shrink-0 items-center gap-1">
        {RETURN_TIMEFRAMES.map((entry) => (
          <Button
            key={entry.key}
            variant="toggle"
            active={entry.key === timeframe}
            onClick={() => setTimeframe(entry.key)}
          >
            {entry.label}
          </Button>
        ))}
        {query.isFetching ? <span className="pl-2 text-2xs text-text-dim">Loading...</span> : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border border-border bg-surface p-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-2 text-2xs text-text-muted">
          <span>Portfolio value · Daily candles</span>
          <span style={{ color: '#25b991' }}>Green: close ≥ open</span>
          <span style={{ color: '#ed6572' }}>Red: close &lt; open</span>
          <span style={{ color: '#e0a34a' }}>{data?.emaPeriod ?? 10}-day EMA</span>
        </div>
        <LineChart
          candles={candles}
          labels={candles.map((candle) => candle.startDate)}
          baseline="auto"
          series={
            candles.length && data
              ? [
                  {
                    values: candles.map((candle) => valueEma[candle.endIndex]),
                    color: '#e0a34a',
                    dashed: true,
                    label: `${data.emaPeriod}-day EMA`,
                  },
                ]
              : []
          }
          format={(value) => currency(value, 0)}
          empty={query.isLoading ? 'Loading momentum...' : summary()}
        />
      </div>

      <p className="shrink-0 text-center text-2xs text-text-dim">One candle per trading day using adjusted holding OHLC. Wicks sum holding highs/lows as range bounds; peaks may occur at different times. Current shares and included cash are held constant.</p>
      <p className="shrink-0 text-center text-2xs text-text-muted">{summary()}</p>
    </div>
  )
}
