import { useEffect, useMemo, useState } from 'react'

import type { ChartsRelationshipPayload, ChartsRelationshipPoint, ChartsRelationshipRange, ChartsRollingWindow, Envelope, EnvelopeMeta } from '@shared/contract'
import { useChartsRelationship } from '@/api/chartsQueries'
import { Button } from '@/components/ui/Button'
import { useChartsStore } from '@/stores/charts'

const FIELD = 'h-8 rounded border border-border-strong bg-surface-raised px-2 text-[12px] text-text'
const CONTROL = 'rounded text-[12px]'
const LEFT_INDEXED = { key: 'leftIndexed', color: '#26c281' } as const
const RIGHT_INDEXED = { key: 'rightIndexed', color: '#4f8cff' } as const
const RATIO = { key: 'ratio', color: '#55c2d9' } as const
const ROLLING = { key: 'rollingCorrelation', color: '#e0a34a' } as const

export function RelationshipLab({ onStatus }: { onStatus: (meta: EnvelopeMeta | undefined, loading: boolean, error?: unknown) => void }) {
  const symbols = useChartsStore((state) => state.relationshipSymbols)
  const range = useChartsStore((state) => state.relationshipRange)
  const rollingWindow = useChartsStore((state) => state.relationshipWindow)
  const setRelationship = useChartsStore((state) => state.setRelationship)
  const [left, setLeft] = useState(symbols[0])
  const [right, setRight] = useState(symbols[1])
  const query = useChartsRelationship({ symbols, range, rollingWindow }, true)
  const [snapshot, setSnapshot] = useState<Envelope<ChartsRelationshipPayload> | null>(null)
  useEffect(() => { if (query.data?.data.points.length) setSnapshot(query.data) }, [query.data])
  const envelope = query.data?.data.points.length ? query.data : snapshot
  const payload = envelope?.data
  const displaySymbols = payload?.symbols ?? symbols
  const [selected, setSelected] = useState(-1)
  useEffect(() => onStatus(query.data?.meta, query.isFetching, query.error), [query.data?.meta, query.isFetching, query.error, onStatus])
  useEffect(() => { if (payload?.points.length) setSelected(payload.points.length - 1) }, [payload])
  const analyze = () => {
    const nextLeft = left.trim().toUpperCase()
    const nextRight = right.trim().toUpperCase()
    if (!nextLeft || !nextRight || nextLeft === nextRight) return
    setRelationship([nextLeft, nextRight])
  }
  const stats = payload?.stats
  const point = payload?.points[selected]
  const metrics = [
    ['Latest ratio', format(stats?.latestRatio, 4)],
    ['Rolling correlation', stats?.latestCorrelation == null ? '--' : `${stats.latestCorrelation.toFixed(3)} (n=${stats.latestCorrelationSample})`],
    ['Beta', format(stats?.beta, 3)],
    ['Daily alpha', format(stats?.alphaDailyPct, 3, '%')],
    ['R', format(stats?.r, 3)],
    ['R²', format(stats?.rSquared, 3)],
    ['Std. error', format(stats?.stdErrorPct, 3, '%')],
    ['Observations', String(stats?.observations ?? 0)],
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-2 pb-3">
      <form className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5" onSubmit={(event) => { event.preventDefault(); analyze() }}>
        <input value={left} onChange={(event) => setLeft(event.target.value)} aria-label="Left ticker" className={`${FIELD} w-24 uppercase`} />
        <Button className={CONTROL} onClick={() => { setLeft(right); setRight(left); setRelationship([right.trim().toUpperCase(), left.trim().toUpperCase()]) }}>Swap</Button>
        <input value={right} onChange={(event) => setRight(event.target.value)} aria-label="Right ticker" className={`${FIELD} w-24 uppercase`} />
        <select value={range} aria-label="Relationship range" onChange={(event) => setRelationship(symbols, event.target.value as ChartsRelationshipRange)} className={FIELD}>{(['1M', '3M', '6M', '1Y', '5Y', 'Max'] as const).map((value) => <option key={value}>{value}</option>)}</select>
        <select value={rollingWindow} aria-label="Rolling correlation window" onChange={(event) => setRelationship(symbols, undefined, Number(event.target.value) as ChartsRollingWindow)} className={FIELD}>{([30, 60, 120, 252] as const).map((value) => <option key={value} value={value}>{value}D corr</option>)}</select>
        <Button className={CONTROL} variant="accent" type="submit" disabled={!left.trim() || !right.trim() || left.trim().toUpperCase() === right.trim().toUpperCase()}>Analyze</Button>
      </form>
      <dl className="grid shrink-0 grid-cols-4 gap-px overflow-hidden rounded-md border border-border bg-border xl:grid-cols-8">
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0 bg-surface px-2.5 py-1.5">
            <dt className="truncate text-[11px] text-text-muted" title={label}>{label}</dt>
            <dd className="truncate text-[14px] font-semibold tabular-nums text-text" title={value}>{value}</dd>
          </div>
        ))}
      </dl>
      {payload?.points.length ? (
        <>
          <p className="h-6 shrink-0 truncate px-1 text-[12px] tabular-nums text-text-muted">
            {point ? <><strong className="font-medium text-text">{point.date}</strong> · {displaySymbols[0]} {point.leftClose.toFixed(2)} · {displaySymbols[1]} {point.rightClose.toFixed(2)} · Ratio {point.ratio.toFixed(4)}</> : null}
          </p>
          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2">
            <TimePanel title="Indexed adjusted performance" points={payload.points} primary={LEFT_INDEXED} secondary={RIGHT_INDEXED} legend={`${displaySymbols.join(' · ')} · Base 100`} selected={selected} onSelect={setSelected} />
            <TimePanel title="Price ratio" points={payload.points} primary={RATIO} legend={displaySymbols.join(' / ')} selected={selected} onSelect={setSelected} />
            <TimePanel title="Rolling return correlation" points={payload.points} primary={ROLLING} legend={`${payload.rollingWindow}D`} selected={selected} onSelect={setSelected} />
            <ScatterPanel points={payload.points} regression={payload.regressionLine} symbols={displaySymbols} selected={selected} />
          </div>
        </>
      ) : <div className="grid flex-1 place-items-center rounded-md border border-border bg-surface px-3 text-center text-[13px] text-text-muted">{query.isFetching ? 'Analyzing adjusted history…' : 'No relationship analysis is available.'}</div>}
    </div>
  )
}

type NumericPointKey = 'leftIndexed' | 'rightIndexed' | 'ratio' | 'rollingCorrelation'

const guides = [25, 50, 75]

function TimePanel({ title, points, primary, secondary, legend, selected, onSelect }: {
  title: string
  points: ChartsRelationshipPoint[]
  primary: { key: NumericPointKey; color: string }
  secondary?: { key: NumericPointKey; color: string }
  legend: string
  selected: number
  onSelect: (index: number) => void
}) {
  const geometry = useMemo(() => {
    const series = secondary ? [primary, secondary] : [primary]
    const fixedRange = primary.key === 'rollingCorrelation'
    let min = fixedRange ? -1 : Infinity
    let max = fixedRange ? 1 : -Infinity
    if (!fixedRange) for (const { key } of series) {
      for (const point of points) {
        const value = point[key]
        if (value == null || !Number.isFinite(value)) continue
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
    }
    const span = max - min || 1
    const paths = series.map(({ key, color }) => {
      let previous = false
      const d = points.map((point, index) => {
        const value = point[key]
        if (value == null || !Number.isFinite(value)) {
          previous = false
          return ''
        }
        const y = 8 + (max - value) / span * 82
        const segment = `${previous ? 'L' : 'M'}${timePosition(index, points.length).toFixed(3)},${y.toFixed(3)}`
        previous = true
        return segment
      }).join(' ')
      return <path key={key} d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    })
    return paths
  }, [points, primary, secondary])

  const marker = timePosition(selected, points.length)
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface">
      <PanelHeading title={title} legend={legend} />
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="min-h-0 flex-1"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          if (!rect.width) return
          const ratio = ((event.clientX - rect.left) / rect.width - 0.05) / 0.9
          onSelect(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))))
        }}
      >
        {guides.map((line) => <line key={line} x1="5" x2="95" y1={line} y2={line} stroke="var(--color-border)" vectorEffect="non-scaling-stroke" />)}
        {geometry}
        {selected >= 0 ? <line x1={marker} x2={marker} y1="5" y2="92" stroke="var(--color-text-muted)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
    </section>
  )
}

function timePosition(index: number, length: number) {
  return 5 + index / Math.max(1, length - 1) * 90
}

function ScatterPanel({ points, regression, symbols, selected }: { points: ChartsRelationshipPoint[]; regression: Array<{ x: number; y: number }>; symbols: [string, string]; selected: number }) {
  const { x, y, cloud } = useMemo(() => {
    let minX = -1
    let maxX = 1
    let minY = -1
    let maxY = 1
    const returns: { x: number; y: number }[] = []
    for (const { leftReturnPct, rightReturnPct } of points) {
      if (leftReturnPct === null || rightReturnPct === null) continue
      minX = Math.min(minX, rightReturnPct)
      maxX = Math.max(maxX, rightReturnPct)
      minY = Math.min(minY, leftReturnPct)
      maxY = Math.max(maxY, leftReturnPct)
      returns.push({ x: rightReturnPct, y: leftReturnPct })
    }
    const x = (value: number) => 5 + (value - minX) / (maxX - minX) * 90
    const y = (value: number) => 92 - (value - minY) / (maxY - minY) * 84
    // Round line caps draw each return as a dot at a fixed screen size.
    const cloud = returns.map((point) => `M${x(point.x).toFixed(3)},${y(point.y).toFixed(3)}h0`).join(' ')
    return { x, y, cloud }
  }, [points])
  const point = points[selected]
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface">
      <PanelHeading title="Daily return regression" legend={`${symbols[1]} x · ${symbols[0]} y`} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="min-h-0 flex-1" role="img" aria-label="Daily return scatter plot">
        <line x1={x(0)} x2={x(0)} y1="5" y2="94" stroke="var(--color-border-strong)" vectorEffect="non-scaling-stroke" />
        <line x1="4" x2="96" y1={y(0)} y2={y(0)} stroke="var(--color-border-strong)" vectorEffect="non-scaling-stroke" />
        <path d={cloud} fill="none" stroke="#4f8cff" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity="0.55" />
        {regression.length === 2 ? <line x1={x(regression[0].x)} y1={y(regression[0].y)} x2={x(regression[1].x)} y2={y(regression[1].y)} stroke="#e0a34a" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /> : null}
        {point?.leftReturnPct != null && point.rightReturnPct != null ? (
          <path d={`M${x(point.rightReturnPct)},${y(point.leftReturnPct)}h0`} fill="none" stroke="#e0a34a" strokeWidth="8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
    </section>
  )
}

function PanelHeading({ title, legend }: { title: string; legend: string }) {
  return (
    <header className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-raised px-2.5 py-1">
      <h3 className="text-[12px] font-semibold text-text">{title}</h3>
      <span className="text-[11px] text-text-muted">{legend}</span>
    </header>
  )
}

function format(value: number | null | undefined, decimals: number, suffix = ''): string {
  return value == null || !Number.isFinite(value) ? '--' : `${value.toFixed(decimals)}${suffix}`
}
