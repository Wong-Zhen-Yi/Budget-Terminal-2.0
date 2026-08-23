import type { ReactNode } from 'react'

import { MACRO_RANGES, type MacroRange, type MacroSeries } from '@shared/contract'
import { sliceRange } from '@shared/preMarket'
import { LineChart } from '@/components/charts/LineChart'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'

/**
 * One of the three macro readings — DXY, 10Y Yield, VIX.
 *
 * The reference prints three text lines and nothing else. The chart underneath is new;
 * the range buttons slice a series the service already sent in full, so switching one
 * never goes back to Yahoo.
 */
export function MacroPanel({
  title,
  stats,
  note,
  series,
  color,
  range,
  onRangeChange,
  format,
  loading,
  warning,
  className = '',
}: {
  title: string
  /** The panel's value lines, in the reference's order. */
  stats: ReactNode
  /** The interpretation sentence; DXY leaves it empty on a flat tape, VIX has none. */
  note?: string
  series: MacroSeries | null
  color: string
  range: MacroRange
  onRangeChange: (range: MacroRange) => void
  format: (value: number) => string
  loading: boolean
  warning?: string
  className?: string
}) {
  const windowed = series ? sliceRange(series, range) : null

  return (
    <Panel
      title={title}
      warning={warning}
      className={className}
      actions={MACRO_RANGES.map((entry) => (
        <Button
          key={entry}
          variant="toggle"
          active={entry === range}
          className="h-6 px-1.5"
          onClick={() => onRangeChange(entry)}
        >
          {entry}
        </Button>
      ))}
    >
      {series ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
          <div className="shrink-0 space-y-0.5 text-2xs">{stats}</div>
          {note ? <p className="shrink-0 text-2xs text-text-muted">{note}</p> : null}
          <div className="flex min-h-0 flex-1 flex-col pt-1">
            <LineChart
              labels={windowed?.dates.map((date) => date.slice(5)) ?? []}
              series={windowed ? [{ values: windowed.values, color, label: title }] : []}
              format={format}
              baseline="auto"
              // Near the panel's own aspect ratio, so `preserveAspectRatio="none"` does
              // not stretch the tick text into illegibility.
              viewBox={{ width: 420, height: 190 }}
              ticks={4}
            />
          </div>
        </div>
      ) : (
        <PanelMessage>{loading ? `Loading ${title}...` : `No ${title} data available`}</PanelMessage>
      )}
    </Panel>
  )
}

/** One `Label: value` line, the shape every macro stat takes. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-text">
      <span className="text-text-muted">{label}: </span>
      <span className="num">{value}</span>
    </p>
  )
}
