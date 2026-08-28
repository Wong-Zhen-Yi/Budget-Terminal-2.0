import { useEffect, useState } from 'react'

import type { ChartsRelationshipPayload, ChartsRelationshipPoint, ChartsRelationshipRange, ChartsRollingWindow, Envelope, EnvelopeMeta } from '@shared/contract'
import { useChartsRelationship } from '@/api/chartsQueries'
import { Button } from '@/components/ui/Button'
import { useChartsStore } from '@/stores/charts'

export function RelationshipLab({ onStatus }: { onStatus: (meta: EnvelopeMeta | undefined, loading: boolean) => void }) {
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
  useEffect(() => onStatus(query.data?.meta, query.isFetching), [query.data?.meta, query.isFetching, onStatus])
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
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border border-border bg-surface px-2 py-1">
        <h2 className="mr-2 text-xs font-semibold text-text">Relationship Lab</h2>
        <input value={left} onChange={(event) => setLeft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') analyze() }} aria-label="Left ticker" className="h-8 w-24 border border-border-strong bg-surface-raised px-2 text-2xs uppercase text-text" />
        <Button onClick={() => { setLeft(right); setRight(left); setRelationship([right.trim().toUpperCase(), left.trim().toUpperCase()]) }}>Swap</Button>
        <input value={right} onChange={(event) => setRight(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') analyze() }} aria-label="Right ticker" className="h-8 w-24 border border-border-strong bg-surface-raised px-2 text-2xs uppercase text-text" />
        <select value={range} onChange={(event) => setRelationship(symbols, event.target.value as ChartsRelationshipRange)} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text">{(['1M', '3M', '6M', '1Y', '5Y', 'Max'] as const).map((value) => <option key={value}>{value}</option>)}</select>
        <select value={rollingWindow} onChange={(event) => setRelationship(symbols, undefined, Number(event.target.value) as ChartsRollingWindow)} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text">{([30, 60, 120, 252] as const).map((value) => <option key={value} value={value}>{value}D corr</option>)}</select>
        <Button variant="accent" onClick={analyze}>{query.isFetching ? 'Analyzing…' : 'Analyze'}</Button>
        <span className="ml-auto text-2xs text-text-muted">{query.data?.meta.failureReason ?? (payload?.points.length ? `${payload.symbols[0]}/${payload.symbols[1]} relationship loaded.` : 'Enter two different tickers.')}</span>
      </div>
      <div className="grid shrink-0 grid-cols-4 gap-1">{metrics.map(([label, value]) => <div key={label} className="border border-border bg-surface px-2 py-1"><p className="text-[10px] text-text-dim">{label}</p><p className="text-xs font-semibold text-text">{value}</p></div>)}</div>
      <p className="shrink-0 text-2xs text-text-muted">{point ? `${point.date} · ${displaySymbols[0]} ${point.leftClose.toFixed(2)} · ${displaySymbols[1]} ${point.rightClose.toFixed(2)} · ratio ${point.ratio.toFixed(4)}` : 'Move across a time-series chart to inspect a shared trading date.'}</p>
      {payload?.points.length ? <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2"><TimePanel title="Indexed adjusted performance (start = 100)" points={payload.points} series={[{ key: 'leftIndexed', color: '#26c281', label: displaySymbols[0] }, { key: 'rightIndexed', color: '#4f8cff', label: displaySymbols[1] }]} selected={selected} onSelect={setSelected} /><TimePanel title="Price ratio" points={payload.points} series={[{ key: 'ratio', color: '#55c2d9', label: `${displaySymbols[0]}/${displaySymbols[1]}` }]} selected={selected} onSelect={setSelected} /><TimePanel title="Rolling return correlation" points={payload.points} series={[{ key: 'rollingCorrelation', color: '#e0a34a', label: `${payload.rollingWindow}D` }]} selected={selected} onSelect={setSelected} fixedRange={[-1, 1]} /><ScatterPanel points={payload.points} regression={payload.regressionLine} symbols={displaySymbols} selected={selected} /></div> : <div className="flex flex-1 items-center justify-center text-2xs text-text-dim">{query.isFetching ? 'Analyzing adjusted history…' : query.data?.meta.failureReason ?? 'No relationship analysis is displayed.'}</div>}
    </div>
  )
}

type NumericPointKey = 'leftIndexed' | 'rightIndexed' | 'ratio' | 'rollingCorrelation'

function TimePanel({ title, points, series, selected, onSelect, fixedRange }: { title: string; points: ChartsRelationshipPoint[]; series: Array<{ key: NumericPointKey; color: string; label: string }>; selected: number; onSelect: (index: number) => void; fixedRange?: [number, number] }) {
  const values = series.flatMap((entry) => points.map((point) => point[entry.key])).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const min = fixedRange?.[0] ?? Math.min(...values)
  const max = fixedRange?.[1] ?? Math.max(...values)
  const span = max - min || 1
  const x = (index: number) => 5 + index / Math.max(1, points.length - 1) * 90
  const y = (value: number) => 8 + (max - value) / span * 82
  return <section className="flex min-h-0 flex-col border border-border bg-surface"><header className="flex h-7 shrink-0 items-center px-2 text-[10px] font-semibold text-text uppercase">{title}<span className="ml-auto normal-case text-text-dim">{series.map((entry) => entry.label).join(' · ')}</span></header><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="min-h-0 flex-1 bg-[#0d1420]" onMouseMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onSelect(Math.max(0, Math.min(points.length - 1, Math.round((event.clientX - rect.left) / rect.width * (points.length - 1))))) }}>{[25, 50, 75].map((line) => <line key={line} x1="5" x2="95" y1={line} y2={line} stroke="#141d2c" strokeWidth="0.5" />)}{series.map((entry) => { const d = points.map((point, index) => { const value = point[entry.key]; return typeof value === 'number' ? `${index && typeof points[index - 1][entry.key] === 'number' ? 'L' : 'M'} ${x(index)} ${y(value)}` : '' }).join(' '); return <path key={entry.key} d={d} fill="none" stroke={entry.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /> })}{selected >= 0 ? <line x1={x(selected)} x2={x(selected)} y1="5" y2="92" stroke="#ffffff" strokeWidth="0.6" strokeDasharray="2 2" /> : null}</svg></section>
}

function ScatterPanel({ points, regression, symbols, selected }: { points: ChartsRelationshipPoint[]; regression: Array<{ x: number; y: number }>; symbols: [string, string]; selected: number }) {
  const rows = points.filter((point) => point.leftReturnPct !== null && point.rightReturnPct !== null)
  const allX = rows.map((point) => point.rightReturnPct!)
  const allY = rows.map((point) => point.leftReturnPct!)
  const minX = Math.min(...allX, -1); const maxX = Math.max(...allX, 1); const minY = Math.min(...allY, -1); const maxY = Math.max(...allY, 1)
  const x = (value: number) => 5 + (value - minX) / (maxX - minX || 1) * 90
  const y = (value: number) => 92 - (value - minY) / (maxY - minY || 1) * 84
  const selectedPoint = points[selected]
  return <section className="flex min-h-0 flex-col border border-border bg-surface"><header className="flex h-7 shrink-0 items-center px-2 text-[10px] font-semibold text-text uppercase">Daily return regression<span className="ml-auto normal-case text-text-dim">{symbols[1]} x · {symbols[0]} y</span></header><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="min-h-0 flex-1 bg-[#0d1420]"><line x1={x(0)} x2={x(0)} y1="5" y2="94" stroke="#334155" strokeWidth="0.5" /><line x1="4" x2="96" y1={y(0)} y2={y(0)} stroke="#334155" strokeWidth="0.5" />{rows.map((point) => <circle key={point.time} cx={x(point.rightReturnPct!)} cy={y(point.leftReturnPct!)} r="0.8" fill="#4f8cff" opacity="0.55" />)}{regression.length === 2 ? <line x1={x(regression[0].x)} y1={y(regression[0].y)} x2={x(regression[1].x)} y2={y(regression[1].y)} stroke="#e0a34a" strokeWidth="1" strokeDasharray="2 2" /> : null}{selectedPoint?.leftReturnPct != null && selectedPoint.rightReturnPct != null ? <circle cx={x(selectedPoint.rightReturnPct)} cy={y(selectedPoint.leftReturnPct)} r="2" fill="#e0a34a" /> : null}</svg></section>
}

function format(value: number | null | undefined, decimals: number, suffix = ''): string {
  return value == null || !Number.isFinite(value) ? '--' : `${value.toFixed(decimals)}${suffix}`
}
