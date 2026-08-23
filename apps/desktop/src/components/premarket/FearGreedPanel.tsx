import { useEffect } from 'react'

import type { FearGreedPayload, FearGreedRow } from '@shared/contract'
import { fgColor } from '@shared/preMarket'
import { FearGreedGauge } from '@/components/premarket/FearGreedGauge'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { easeOutCubic, useAnimatedProgress } from '@/lib/useAnimatedProgress'

const SWEEP_MS = 900

/** The four look-back rows down the right of the dial. */
function HistoryRow({ row }: { row: FearGreedRow }) {
  const color = fgColor(row.score)
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 shrink-0">
        <p className="text-2xs leading-tight text-text-muted">{row.period}</p>
        <p className="text-2xs leading-tight font-semibold text-text">{row.rating}</p>
      </div>
      <span
        className="num flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-2xs font-bold"
        style={{ borderColor: color, color }}
      >
        {row.score === null ? '--' : Math.trunc(row.score)}
      </span>
    </div>
  )
}

export function FearGreedPanel({
  data,
  loading,
  warning,
  className = '',
}: {
  data: FearGreedPayload | null
  loading: boolean
  warning?: string
  className?: string
}) {
  const { progress, replay } = useAnimatedProgress(SWEEP_MS, easeOutCubic)

  // Sweep the needle whenever a new score lands. Started from an effect so the rAF loop
  // re-arms after StrictMode's double mount instead of leaving the needle at zero.
  useEffect(() => {
    if (data?.score !== null && data?.score !== undefined) replay()
  }, [data?.score, replay])

  return (
    <Panel title="Fear & Greed Index" warning={warning} className={className}>
      {data ? (
        <div className="flex min-h-0 flex-1 gap-4 p-3">
          <div className="flex min-h-0 flex-[3] flex-col justify-center">
            <FearGreedGauge score={data.score} progress={progress} />
          </div>
          <div className="flex min-h-0 flex-[2] flex-col gap-1.5 overflow-hidden">
            {data.history.map((row) => (
              <HistoryRow key={row.period} row={row} />
            ))}
            <p className="mt-auto text-2xs text-text-dim">
              {data.timestamp ? `Last updated ${data.timestamp}` : ''}
            </p>
          </div>
        </div>
      ) : (
        <PanelMessage>
          {loading ? 'Loading Fear & Greed...' : 'Fear & Greed data unavailable'}
        </PanelMessage>
      )}
    </Panel>
  )
}
