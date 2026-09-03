import { useEffect, useMemo, useRef, useState } from 'react'

import type { ChartsComparePayload } from '@shared/contract'
import { buildCompareModel } from '@shared/charts'

const COLORS = ['#4f8cff', '#26c281', '#e0a34a', '#9d7ce0', '#f0554e', '#55c2d9', '#d96fa7', '#8bc34a']

export function CompareChart({ payload, showIntervalLabels }: { payload: ChartsComparePayload | null; showIntervalLabels: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 900, height: 480 })
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(300, entry.contentRect.width), height: Math.max(220, entry.contentRect.height) }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const model = useMemo(() => payload ? buildCompareModel(payload) : null, [payload])
  /**
   * Each series' value indexed by timestamp, for the interval labels below.
   *
   * They used to `.find()` back into the normalized series per label, which is a linear
   * scan inside a loop inside a loop — five symbols of a year of daily bars is hundreds of
   * thousands of comparisons, re-run on every frame the ResizeObserver fires while a
   * splitter is being dragged.
   */
  const valueByTime = useMemo(() => {
    const lookup: Record<string, Map<number, number>> = {}
    for (const symbol of model?.symbols ?? []) {
      lookup[symbol] = new Map((model?.normalized[symbol] ?? []).map((point) => [point.time, point.value]))
    }
    return lookup
  }, [model])
  const geometry = useMemo(() => {
    if (!model?.symbols.length) return null
    const all = model.symbols.flatMap((symbol) => model.normalized[symbol] ?? [])
    if (!all.length) return null
    const times = [...new Set(all.map((point) => point.time))].sort((a, b) => a - b)
    const min = Math.min(0, ...all.map((point) => point.value))
    const max = Math.max(0, ...all.map((point) => point.value))
    const span = max - min || 1
    const pad = { left: 12, right: 92, top: 18, bottom: 28 }
    const x = (time: number) => pad.left + ((time - times[0]) / Math.max(1, times.at(-1)! - times[0])) * (size.width - pad.left - pad.right)
    const y = (value: number) => pad.top + ((max - value) / span) * (size.height - pad.top - pad.bottom)
    return { times, min, max, x, y, pad }
  }, [model, size])
  if (!model || !geometry) return <div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center text-2xs text-text-dim">Add one or more tickers to compare normalized performance.</div>
  const labelEvery = Math.max(1, Math.ceil(geometry.times.length / Math.max(6, Math.floor(size.width / 90))))
  return (
    <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden">
      <svg width={size.width} height={size.height} className="block">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = geometry.max - (geometry.max - geometry.min) * ratio
          return <g key={ratio}><line x1={geometry.pad.left} x2={size.width - geometry.pad.right} y1={geometry.y(value)} y2={geometry.y(value)} stroke="var(--color-border)" /><text x={size.width - geometry.pad.right + 6} y={geometry.y(value) + 4} fill="var(--color-text-muted)" fontSize="11">{value.toFixed(1)}%</text></g>
        })}
        <line x1={geometry.pad.left} x2={size.width - geometry.pad.right} y1={geometry.y(0)} y2={geometry.y(0)} stroke="var(--color-border-strong)" strokeDasharray="4 4" />
        {model.symbols.map((symbol, symbolIndex) => {
          const points = model.normalized[symbol]
          const color = COLORS[symbolIndex % COLORS.length]
          const path = points.map((point, index) => `${index ? 'L' : 'M'} ${geometry.x(point.time)} ${geometry.y(point.value)}`).join(' ')
          const last = points.at(-1)!
          return <g key={symbol}><path d={path} fill="none" stroke={color} strokeWidth="2" /><text x={geometry.x(last.time) + 6} y={geometry.y(last.value) + 4} fill={color} fontSize="11" fontWeight="600">{symbol} {last.value >= 0 ? '+' : ''}{last.value.toFixed(1)}%</text>{showIntervalLabels ? model.intervalChanges[symbol].map((point, index) => index % labelEvery === 0 ? <text key={point.time} x={geometry.x(point.time)} y={geometry.y(valueByTime[symbol]?.get(point.time) ?? 0) - 6} fill={color} fontSize="9" textAnchor="middle">{point.value >= 0 ? '+' : ''}{point.value.toFixed(1)}%</text> : null) : null}</g>
        })}
        {geometry.times.map((time, index) => index % labelEvery === 0 ? <text key={time} x={geometry.x(time)} y={size.height - 8} fill="var(--color-text-muted)" fontSize="10" textAnchor="middle">{new Date(time * 1000).toISOString().slice(0, 10)}</text> : null)}
      </svg>
    </div>
  )
}

export { COLORS as COMPARE_COLORS }
