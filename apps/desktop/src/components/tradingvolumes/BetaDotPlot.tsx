import { useEffect, useMemo, useRef, useState } from 'react'
import type { TradingVolumeInterval } from '@shared/contract'
import { intervalMarketCapHistory, metricValue, TRADING_VOLUME_METRICS, type RankedTradingVolumeRow } from '@shared/tradingVolumes'
import { compactCurrency } from '@/lib/format'
import { Button } from '@/components/ui/Button'

export function BetaDotPlot({ rows, interval }: { rows: RankedTradingVolumeRow[]; interval: TradingVolumeInterval }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 800, height: 475 })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(svg)
    return () => observer.disconnect()
  })
  const right = Math.max(100, size.width - 20)
  const bottom = Math.max(80, size.height - 45)
  const metric = TRADING_VOLUME_METRICS[interval]
  const data = useMemo(() => {
    const dates = [...new Set(rows.flatMap((row) => (row.betaHistory ?? []).map((p) => p.date)))].sort()
    const timeline = intervalMarketCapHistory(dates.map((date) => ({ date, value: 1 })), interval).map((p) => p.date)
    const allowed = new Set(timeline)
    const series = rows.map((row) => ({ ticker: row.ticker, volume: metricValue(row, metric.volumeField), history: new Map((row.betaHistory ?? []).filter((p) => allowed.has(p.date) && Number.isFinite(p.value)).map((p) => [p.date, p.value])) }))
    const values = series.flatMap((s) => [...s.history.values()])
    const low = Math.min(0, ...values)
    const high = Math.max(1, ...values)
    // Center the ticker cluster, not the extremes: a few high-volume outliers
    // otherwise push most names to the left. Keep the log scale and every outlier.
    const volumes = series.flatMap((s) => s.history.size && s.volume !== null && Number.isFinite(s.volume) && s.volume > 0 ? [Math.log10(s.volume)] : []).sort((a, b) => a - b)
    const middle = Math.floor(volumes.length / 2)
    const center = volumes.length ? (volumes[middle] + volumes[Math.floor((volumes.length - 1) / 2)]) / 2 : 0.5
    const radius = volumes.length ? Math.max(center - volumes[0], volumes[volumes.length - 1] - center) + 0.1 : 0.5
    return { timeline, series, low: low - (high - low) * 0.1, high: high + (high - low) * 0.1, xmin: center - radius, xmax: center + radius }
  }, [rows, metric, interval])
  const [index, setIndex] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => { setIndex(null); setPlaying(false) }, [data])
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setIndex((previous) => {
      const next = (previous ?? 0) + 1
      if (next >= data.timeline.length - 1) setPlaying(false)
      return Math.min(next, data.timeline.length - 1)
    }), Math.max(30, 5000 / data.timeline.length))
    return () => window.clearInterval(timer)
  }, [playing, data])
  const current = Math.min(index ?? data.timeline.length - 1, data.timeline.length - 1)
  const date = data.timeline[current]
  const points = data.series.flatMap((s) => {
    const beta = s.history.get(date)
    return beta !== undefined && s.volume !== null && Number.isFinite(s.volume) && s.volume > 0 ? [{ ticker: s.ticker, beta, volume: s.volume }] : []
  })
  const { xmin, xmax } = data
  const x = (value: number) => 65 + (value - xmin) / (xmax - xmin) * (right - 65)
  const y = (value: number) => bottom - (value - data.low) / (data.high - data.low) * (bottom - 25)
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-2xs text-text-muted">
      <Button disabled={data.timeline.length < 2} onClick={() => { if (playing) setPlaying(false); else { setIndex(0); setPlaying(true) } }}>{playing ? 'Stop' : 'Replay'}</Button>
      <input aria-label="Beta date" type="range" className="min-w-20 flex-1" min={0} max={Math.max(0, data.timeline.length - 1)} value={Math.max(0, current)} disabled={!data.timeline.length} onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)) }} />
      <span>{date ?? 'No Beta history'}</span>
      <span>{points.length}/{rows.length} stocks{points.length < rows.length ? ' • others lack matched history or volume' : ''}</span>
    </div>
    <p className="px-2 text-2xs text-text-dim">β = 1: market-like sensitivity; above 1: greater sensitivity; negative: opposite direction. Rolling 60 daily returns; measures market risk, not total risk.</p>
    {!data.timeline.length ? <div className="flex flex-1 items-center justify-center p-4 text-2xs text-text-dim">Refresh to load Beta history. Requires 60 matching daily returns and S&P 500 data.</div> :
      <svg ref={svgRef} viewBox={`0 0 ${size.width} ${size.height}`} className="min-h-0 w-full flex-1" role="img" aria-label={`Stock Beta dot plot for ${date}`}>
        {Array.from({ length: 6 }, (_, i) => data.low + (data.high - data.low) * i / 5).filter((tick) => Math.abs(y(tick) - y(1)) > 14).map((tick) => <g key={tick}><line x1={65} x2={right} y1={y(tick)} y2={y(tick)} stroke="var(--color-border)" /><text x={58} y={y(tick) + 4} textAnchor="end" fill="var(--color-text-muted)" fontSize={11}>{tick.toFixed(2)}</text></g>)}
        <line x1={65} x2={right} y1={y(1)} y2={y(1)} stroke="var(--color-warn)" strokeDasharray="5 4"><title>β = 1.0</title></line>
        <text x={58} y={y(1) + 4} textAnchor="end" fill="var(--color-warn)" fontSize={11}>1.0</text>
        {Array.from({ length: 5 }, (_, i) => xmin + (xmax - xmin) * i / 4).map((tick) => <text key={tick} x={x(tick)} y={bottom + 19} textAnchor="middle" fill="var(--color-text-muted)" fontSize={11}>{compactCurrency(10 ** tick)}</text>)}
        {points.map((p) => <g key={p.ticker}><circle cx={x(Math.log10(p.volume))} cy={y(p.beta)} r={4} fill={p.beta < 1 ? 'var(--color-down)' : 'var(--color-up)'}><title>{p.ticker} | {date} | β {p.beta.toFixed(3)} | {metric.label} ADV {compactCurrency(p.volume)}</title></circle><text x={x(Math.log10(p.volume))} y={y(p.beta) - 7} textAnchor="middle" fill={p.beta < 1 ? 'var(--color-down)' : 'var(--color-up)'} fontSize={9}>{p.ticker}</text></g>)}
        <text x={(65 + right) / 2} y={size.height - 7} textAnchor="middle" fill="var(--color-text-muted)" fontSize={12}>{metric.axisLabel} • median-centered log scale • fixed during replay</text>
        <text transform={`translate(16 ${bottom / 2}) rotate(-90)`} textAnchor="middle" fill="var(--color-text-muted)" fontSize={12}>Beta (β) vs S&P 500</text>
      </svg>}
  </div>
}
