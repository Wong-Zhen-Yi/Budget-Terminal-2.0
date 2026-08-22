import { useState } from 'react'

import type { PositionInput, ReturnTimeframe } from '@shared/contract'
import { RETURN_TIMEFRAMES } from '@shared/contract'
import { useMomentum } from '@/api/portfolioQueries'
import { LineChart } from '@/components/charts/LineChart'
import { Button } from '@/components/ui/Button'
import { percent } from '@/lib/format'

interface MomentumTabProps {
  positions: PositionInput[]
  cashAmount: number
  visible: boolean
}

/** Portfolio return since the start of the window, against its own EMA. */
export function MomentumTab({ positions, cashAmount, visible }: MomentumTabProps) {
  const [timeframe, setTimeframe] = useState<ReturnTimeframe>('1mo')
  const query = useMomentum(positions, cashAmount, timeframe, visible)
  const data = query.data?.data

  const last = data?.returns.at(-1) ?? null
  const lastEma = data?.ema.at(-1) ?? null

  const summary = () => {
    if (!data || data.reason) return data?.reason || 'No momentum data available'
    const parts = [
      `Since ${data.startDate}`,
      `Portfolio ${percent(last, 1)}`,
      `${data.includedTickers.length} holding${data.includedTickers.length === 1 ? '' : 's'}`,
    ]
    if (last !== null && lastEma !== null) {
      parts.push(`${last >= lastEma ? 'Above' : 'Below'} ${data.emaPeriod}-day EMA`)
    }
    if (data.excludedTickers.length) parts.push(`${data.excludedTickers.length} excluded`)
    return parts.join(' | ')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
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
        <LineChart
          labels={(data?.dates ?? []).map((date) => date.slice(5))}
          series={
            data && data.returns.length
              ? [
                  { values: data.returns, color: '#4f8ff0', label: 'Portfolio' },
                  {
                    values: data.ema,
                    color: '#e0a34a',
                    dashed: true,
                    label: `${data.emaPeriod}-day EMA`,
                  },
                ]
              : []
          }
          format={(value) => `${value.toFixed(0)}%`}
          empty={query.isLoading ? 'Loading momentum...' : 'No momentum data available'}
        />
      </div>

      <p className="shrink-0 text-center text-2xs text-text-muted">{summary()}</p>
    </div>
  )
}
