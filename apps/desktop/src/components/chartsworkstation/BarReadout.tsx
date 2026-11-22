import { memo, useImperativeHandle, useState, type Ref } from 'react'

import type { Candle, ChartsHistoryPayload } from '@shared/contract'

export interface BarReadoutHandle {
  setHoveredTime: (time: number | null) => void
}

export const BarReadout = memo(function BarReadout({ ref, candles, indicators, intraday }: {
  ref: Ref<BarReadoutHandle>
  candles: Candle[]
  indicators: ChartsHistoryPayload['indicators'] | undefined
  intraday: boolean
}) {
  const [hoveredTime, setHoveredTime] = useState<number | null>(null)
  useImperativeHandle(ref, () => ({ setHoveredTime }), [])
  const candle = (hoveredTime === null ? undefined : atTime(candles, hoveredTime)) ?? candles.at(-1)
  if (!candle) return <div className="h-8 border-b border-border bg-surface" />

  const { time, open, high, low, close, volume } = candle
  const timestamp = new Date(time * 1000).toISOString().replace('T', ' ').slice(0, intraday ? 16 : 10)
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-b border-border bg-surface px-3 text-[11px] tabular-nums text-text-muted" aria-label="Selected bar">
      <time className="shrink-0 text-text" title={intraday ? 'UTC' : undefined}>{timestamp}</time>
      <ReadoutValue label="O" value={open.toFixed(2)} />
      <ReadoutValue label="H" value={high.toFixed(2)} />
      <ReadoutValue label="L" value={low.toFixed(2)} />
      <ReadoutValue label="C" value={close.toFixed(2)} />
      <ReadoutValue label="Vol" value={Math.round(volume).toLocaleString()} />
      <ReadoutValue label="RSI" value={atTime(indicators?.rsi, time)?.value.toFixed(1)} />
      <ReadoutValue label="MA50" value={atTime(indicators?.ma50, time)?.value.toFixed(2)} />
      <ReadoutValue label="MA200" value={atTime(indicators?.ma200, time)?.value.toFixed(2)} />
    </div>
  )
})

function ReadoutValue({ label, value }: { label: string; value: string | undefined }) {
  return <span className="shrink-0">{label} <span className="text-text">{value ?? '—'}</span></span>
}

function atTime<T extends { time: number }>(rows: T[] | undefined, time: number): T | undefined {
  if (!rows) return undefined
  let low = 0
  let high = rows.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const row = rows[middle]
    if (row.time === time) return row
    if (row.time < time) low = middle + 1
    else high = middle - 1
  }
  return undefined
}
