import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries } from 'lightweight-charts'
import { createChart } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import { terminalPricePoints } from '@shared/defeatbetaTerminal'
import type { TerminalPricePoint, TerminalRow } from '@shared/defeatbetaTerminal'

const COLORS = { up: '#26c281', down: '#f0554e', text: '#7d8ea6', border: '#1e2b3f', background: '#0d1420', averages: ['#e4b45a', '#47bba6', '#b79bf2'] }
const RANGES = [{ count: 21, label: '1M' }, { count: 63, label: '3M' }, { count: 252, label: '1Y' }, { count: 1260, label: '5Y' }, { count: 0, label: 'All' }]
const price = (value: number | null | undefined) => value === null || value === undefined ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: Math.abs(value) < 1 ? 4 : 2, maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2 })
const volumeText = (value: number | null | undefined) => value === null || value === undefined ? '—' : value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const percent = (value: number | null) => value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
type Series = { candles: ISeriesApi<'Candlestick'>; volume: ISeriesApi<'Histogram'>; averages: ISeriesApi<'Line'>[] }

export function DefeatBetaPriceChart({ symbol, rows, count, onCount }: { symbol: string; rows: TerminalRow[]; count: number; onCount: (count: number) => void }) {
  const points = useMemo(() => terminalPricePoints(rows), [rows])
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<Series | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pointsRef = useRef(new Map<number, TerminalPricePoint>())
  const [hovered, setHovered] = useState<number | null>(null)
  const [averages, setAverages] = useState([true, true, true])
  const [customView, setCustomView] = useState(false)
  const applyingRange = useRef(false)
  const selected = (hovered === null ? null : pointsRef.current.get(hovered)) ?? points.at(-1)
  const visible = count ? points.slice(-count) : points
  const first = visible[0]
  const last = points.at(-1)
  const rangeChange = first && last ? (last.close / first.close - 1) * 100 : null
  const candleCount = points.filter(point => point.ohlc).length
  const resetView = useCallback(() => {
    const chart = chartRef.current
    if (!chart || !points.length) return
    applyingRange.current = true
    chart.priceScale('right', 0).applyOptions({ autoScale: true })
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(-0.5, points.length - (count || points.length) - 0.5), to: points.length + 0.5 })
    applyingRange.current = false
    setCustomView(false)
    setHovered(null)
  }, [count, points])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: COLORS.background }, textColor: COLORS.text, fontSize: 12,
        panes: { separatorColor: COLORS.border, separatorHoverColor: '#2c3e59' } },
      grid: { vertLines: { visible: false }, horzLines: { color: '#192336' } },
      rightPriceScale: { borderColor: COLORS.border, minimumWidth: 76, scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: { borderColor: COLORS.border, lockVisibleTimeRangeOnResize: true, timeVisible: false, rightOffset: 1, minBarSpacing: 0.01 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#56677f' }, horzLine: { color: '#56677f' } },
    })
    const candles = chart.addSeries(CandlestickSeries, { upColor: COLORS.up, downColor: COLORS.down,
      wickUpColor: COLORS.up, wickDownColor: COLORS.down, borderVisible: false, priceLineVisible: true,
      priceLineColor: '#56677f', priceLineWidth: 1 }, 0)
    const lines = COLORS.averages.map(color => chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0))
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1)
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 } })
    chart.panes()[0]?.setStretchFactor(4)
    chart.panes()[1]?.setStretchFactor(1)
    chart.subscribeCrosshairMove(event => {
      const time = typeof event.time === 'number' && event.point && event.point.x >= 0 && event.point.y >= 0 ? Number(event.time) : null
      setHovered(time !== null && pointsRef.current.has(time) ? time : null)
    })
    // Preset changes are applied by the effect below; only direct interaction marks a custom view.
    const markCustom = () => { if (!applyingRange.current) setCustomView(true) }
    const onDrag = (event: PointerEvent) => { if (event.buttons === 1) markCustom() }
    container.addEventListener('wheel', markCustom, { passive: true })
    container.addEventListener('pointermove', onDrag)
    chartRef.current = chart
    seriesRef.current = { candles, volume, averages: lines }
    return () => {
      container.removeEventListener('wheel', markCustom)
      container.removeEventListener('pointermove', onDrag)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    pointsRef.current = new Map(points.map(point => [point.time, point]))
    series.candles.setData(points.map(point => ({ time: point.time as UTCTimestamp, ...(point.ohlc ?? {}) })))
    series.volume.setData(points.map(point => ({ time: point.time as UTCTimestamp, ...(point.volume === null ? {} : { value: point.volume }),
      color: point.ohlc ? point.close >= point.ohlc.open ? '#26c28180' : '#f0554e80' : '#56677f80' })))
    series.averages.forEach((line, index) => line.setData(points.map(point => ({ time: point.time as UTCTimestamp,
      ...(point.averages[index] === null ? {} : { value: point.averages[index]! }) }))))
  }, [points])

  useEffect(() => { resetView() }, [resetView])
  useEffect(() => { seriesRef.current?.averages.forEach((series, index) => series.applyOptions({ visible: averages[index] })) }, [averages])

  return <section className="min-w-0 overflow-hidden rounded border border-border bg-surface" aria-label={`${symbol} candlestick chart`} data-terminal-price-chart data-candle-count={candleCount}>
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3">
      <div><h2 className="text-xs font-semibold text-text">{symbol} <span className="ml-1 font-normal text-text-muted">Candlesticks · 1D · USD</span></h2>
        <p className="mt-1 text-2xs text-text-dim">{customView ? 'Custom view · daily sessions' : `${first?.date ?? '—'} → ${last?.date ?? '—'} · ${visible.length.toLocaleString()} sessions`}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {!customView ? <span className={`num text-xs font-medium ${rangeChange === null ? 'text-text-muted' : rangeChange >= 0 ? 'text-up' : 'text-down'}`}>{percent(rangeChange)} <span className="font-normal text-text-dim">selected period</span></span> : null}
        <div className="flex rounded border border-border-strong bg-bg p-0.5" role="group" aria-label="Chart time range">
          {RANGES.map(range => <button key={range.label} type="button" aria-pressed={!customView && count === range.count} className={`rounded px-3 py-1.5 text-2xs transition-colors ${!customView && count === range.count ? 'bg-accent-dim font-semibold text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'}`}
            onClick={() => { if (count === range.count) resetView(); else onCount(range.count) }}>{range.label}</button>)}
        </div>
        <button type="button" onClick={resetView} className="rounded border border-border-strong px-2 py-1.5 text-2xs text-text-muted hover:bg-surface-hover hover:text-text">Reset view</button>
      </div>
    </div>
    <div className="flex min-h-10 flex-wrap items-center gap-x-5 gap-y-1 border-y border-border bg-bg/40 px-4 py-2 text-2xs" data-chart-readout>
      <span className="num min-w-24 text-text-muted">{selected?.date ?? 'No data'}</span>
      {[['O', selected?.ohlc?.open], ['H', selected?.ohlc?.high], ['L', selected?.ohlc?.low], ['C', selected?.close]].map(([label, value]) => <span key={label} className="num text-text"><span className="mr-1.5 text-text-dim">{label}</span>{price(typeof value === 'number' ? value : null)}</span>)}
      <span className="num text-text"><span className="mr-1.5 text-text-dim">Vol</span>{volumeText(selected?.volume)}</span>
      <span className="ml-auto text-text-dim">{hovered === null ? 'Latest session · hover to inspect' : 'Historical session'}</span>
    </div>
    <div className="relative">
      <div ref={containerRef} className="h-[380px] w-full sm:h-[420px]" role="img" aria-label="Published daily candlesticks, moving averages and volume" data-candlestick-canvas />
      {!candleCount ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface/90 text-xs text-text-muted">No complete OHLC records available for candlesticks.</div> : null}
      {candleCount > 0 ? <span className="pointer-events-none absolute bottom-20 left-3 z-10 rounded bg-surface/90 px-1 text-2xs text-text-muted">VOLUME</span> : null}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Moving averages">
        {[10, 50, 200].map((days, index) => <button key={days} type="button" aria-label={`MA${days}`} aria-pressed={averages[index]} onClick={() => setAverages(previous => previous.map((enabled, slot) => slot === index ? !enabled : enabled))}
          className={`num flex items-center gap-2 rounded px-2 py-1 text-2xs hover:bg-surface-hover ${averages[index] ? '' : 'opacity-40'}`} style={{ color: COLORS.averages[index] }}>
          <span className="h-0.5 w-4" style={{ background: COLORS.averages[index] }} />MA{days}<span>{price(selected?.averages[index])}</span>
        </button>)}
      </div>
      <p className="text-2xs text-text-dim">Scroll to zoom · drag to pan · click MA to toggle</p>
    </div>
  </section>
}
