import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CandlestickSeries, ColorType, createChart, CrosshairMode, LineSeries } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, LogicalRange, UTCTimestamp } from 'lightweight-charts'
import { CHARTS_INTERVALS, CHARTS_RANGES } from '@shared/contract'
import type { Candle, ChartsInterval, ChartsRange } from '@shared/contract'
import type { AgentCandlestick } from '@shared/agentCharts'
import { useChartsHistory } from '@/api/chartsQueries'
import { agentHistoryCandles, agentHistoryStart } from '@/lib/agentChartHistory'

type ViewRange = ChartsRange | 'Custom'
const prices = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 })
const date = (time: number) => new Date(time * 1000).toISOString().slice(0, 10)
const time = (candle: Candle, intraday: boolean) => intraday
  ? new Date(candle.time * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  : date(candle.time)
const EMPTY: Candle[] = []
const retention: Partial<Record<ChartsInterval, string>> = {
  '1 Minute': '6 days', '5 Minutes': '59 days', '15 Minutes': '59 days', '1 Hour': '729 days', '4 Hours': '729 days',
}

export function AgentMarketChart({ chart, symbol }: { chart: AgentCandlestick; symbol: string }) {
  const titleId = useId()
  const [interval, setInterval] = useState<ChartsInterval>('1 Day')
  const [range, setRange] = useState<ViewRange>('Max')
  // Every interval loads Max. Range shortcuts only change the viewport, never the source history.
  // Reuse Charts' query/cache and trusted IPC; switching views never sends another Agent prompt.
  const query = useChartsHistory({ symbol, interval, range: 'Max' })
  const envelope = query.data
  const raw = envelope?.data?.candles ?? EMPTY
  const candles = useMemo(() => envelope?.meta.freshness === 'failed' ? EMPTY : agentHistoryCandles(raw), [raw, envelope?.meta.freshness])
  const unit = envelope?.data?.stats?.currency || chart.unit
  const intraday = Boolean(retention[interval])
  const failure = query.error?.message || (envelope?.meta.freshness === 'failed'
    ? envelope.errors.map(error => error.reason).join('; ') || 'The provider could not load this history.'
    : !query.isPending && !candles.length ? 'No usable OHLC history was returned.' : '')

  return <figure className="agents-candlestick agents-market-chart" aria-labelledby={titleId} aria-busy={query.isFetching}>
    <figcaption id={titleId}>{chart.title}<span> · {symbol}{unit ? ` · ${unit}` : ''}</span></figcaption>
    <div className="agents-history-controls">
      <label>Candle interval <select aria-label={`${symbol} candle interval`} value={interval} onChange={event => {
        setInterval(event.target.value as ChartsInterval)
        setRange('Max')
      }}>{CHARTS_INTERVALS.map(value => <option key={value}>{value}</option>)}</select></label>
      <div className="agents-history-ranges" role="group" aria-label={`${symbol} chart time range`}>
        {CHARTS_RANGES.map(value => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{value}</button>)}
      </div>
    </div>
    {query.isPending && <p role="status">Loading full available {interval.toLowerCase()} history for {symbol}…</p>}
    {failure && <div className="agents-history-warning" role="alert">{failure}{candles.length > 0 && ' Showing previously loaded history.'} <button type="button" disabled={query.isFetching} onClick={() => { void query.refetch() }}>Retry history</button></div>}
    <HistoryPlot candles={candles} interval={interval} range={range} onRangeChange={setRange} symbol={symbol} unit={unit} />
    {candles.length > 0 && <p className="agents-candlestick-caption" data-history-count={candles.length}>
      {envelope?.meta.freshness === 'stale' || envelope?.meta.freshness === 'partial' || query.error || raw.length > candles.length ? 'Available history (coverage may be incomplete)' : 'Full available history loaded'}: {date(candles[0].time)} – {date(candles.at(-1)!.time)} · {candles.length.toLocaleString()} candles · {interval} · {envelope?.meta.source} · {envelope?.meta.freshness}
      {envelope?.meta.fetchedAt ? ` · Fetched ${new Date(envelope.meta.fetchedAt).toLocaleString()}` : ''}
    </p>}
    {intraday && <p className="agents-history-warning">Intraday provider coverage is limited to at most {retention[interval]}. Choose daily, weekly or monthly candles for longer history.</p>}
    {envelope && (envelope.meta.freshness === 'stale' || envelope.meta.freshness === 'partial' || envelope.errors.length > 0) && <p className="agents-history-warning" role="status">{envelope.meta.freshness === 'stale' ? 'Stale cached history; coverage may be incomplete. ' : 'Coverage warning: '}{envelope.errors.map(error => error.reason).join('; ')}</p>}
    {envelope?.meta.freshness !== 'failed' && raw.length > candles.length && <p className="agents-history-warning">Excluded {raw.length - candles.length} invalid or duplicate bars; no replacement prices were invented.</p>}
    {chart.caption && <p className="agents-candlestick-caption">{chart.caption}</p>}
    <HistoryTable key={interval} candles={candles} intraday={intraday} title={chart.title} />
  </figure>
}

function HistoryPlot({ candles, interval, range, onRangeChange, symbol, unit }: {
  candles: Candle[]; interval: ChartsInterval; range: ViewRange; onRangeChange: (range: ViewRange) => void; symbol: string; unit?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const api = useRef<IChartApi | null>(null)
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const line = useRef<ISeriesApi<'Line'> | null>(null)
  const byTime = useRef(new Map<number, Candle>())
  const drag = useRef<{ x: number; y: number } | null>(null)
  const view = useRef({ candles, range })
  view.current = { candles, range }
  const [hovered, setHovered] = useState<Candle | null>(null)
  const [visible, setVisible] = useState<LogicalRange | null>(null)
  const [style, setStyle] = useState('candles')
  const intraday = Boolean(retention[interval])

  useEffect(() => {
    if (!container.current) return
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0d1420' }, textColor: '#8d9db3', fontSize: 12 },
      grid: { vertLines: { color: '#182334' }, horzLines: { color: '#182334' } },
      rightPriceScale: { borderColor: '#28364a', scaleMargins: { top: 0.08, bottom: 0.08 } },
      // fitContent must fit decades of daily bars too, not silently clamp the view to ~1000 bars.
      timeScale: { borderColor: '#28364a', minBarSpacing: 0.001, rightOffset: 0 },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    })
    const bars = chart.addSeries(CandlestickSeries, {
      upColor: '#26c281', downColor: '#f0554e', wickUpColor: '#26c281', wickDownColor: '#f0554e', borderVisible: false,
    })
    const closes = chart.addSeries(LineSeries, { color: '#6b9fff', lineWidth: 2, visible: false })
    api.current = chart
    series.current = bars
    line.current = closes
    chart.subscribeCrosshairMove(event => setHovered(typeof event.time === 'number' ? byTime.current.get(event.time) ?? null : null))
    chart.timeScale().subscribeVisibleLogicalRangeChange(setVisible)
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitHistory(chart, view.current.candles, view.current.range))
    })
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      chart.remove()
      api.current = null
      series.current = null
      line.current = null
    }
  }, [])

  useEffect(() => {
    byTime.current = new Map(candles.map(candle => [candle.time, candle]))
    setHovered(null)
    series.current?.setData(candles.map(candle => ({ time: candle.time as UTCTimestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close })))
    line.current?.setData(candles.map(candle => ({ time: candle.time as UTCTimestamp, value: candle.close })))
  }, [candles])

  useEffect(() => {
    api.current?.applyOptions({ timeScale: { timeVisible: intraday, secondsVisible: false } })
  }, [intraday])

  useEffect(() => {
    if (api.current) fitHistory(api.current, candles, range)
  }, [candles, range])

  useEffect(() => {
    series.current?.applyOptions({ visible: style === 'candles' })
    line.current?.applyOptions({ visible: style === 'line' })
  }, [style])

  function zoom(factor: number) {
    const current = api.current?.timeScale().getVisibleLogicalRange()
    if (!current) return
    onRangeChange('Custom')
    const center = (current.from + current.to) / 2
    const half = Math.max(1, (current.to - current.from) * factor / 2)
    api.current!.timeScale().setVisibleLogicalRange({ from: center - half, to: center + half })
  }

  function reset() {
    onRangeChange('Max')
    api.current?.timeScale().fitContent()
  }

  const current = hovered ?? candles.at(-1)
  const visibleCount = visible && candles.length ? Math.max(0, Math.min(candles.length - 1, Math.floor(visible.to)) - Math.max(0, Math.ceil(visible.from)) + 1) : 0
  return <>
    <div className="agents-history-navigation">
      <label>Style <select aria-label={`${symbol} chart style`} value={style} onChange={event => setStyle(event.target.value)}><option value="candles">Candlesticks</option><option value="line">Close line</option></select></label>
      <button type="button" aria-label={`${symbol} zoom in`} disabled={!candles.length} onClick={() => zoom(0.65)}>Zoom +</button>
      <button type="button" aria-label={`${symbol} zoom out`} disabled={!candles.length} onClick={() => zoom(1.5)}>Zoom −</button>
      <button type="button" disabled={!candles.length} onClick={reset}>Reset view</button>
      <span className="agents-history-visible" data-visible-bars={visibleCount} data-visible-from={visible?.from} data-visible-to={visible?.to}>{range} · {visibleCount.toLocaleString()} / {candles.length.toLocaleString()} bars in view</span>
    </div>
    <p className="agents-history-ohlc" aria-label={`${symbol} OHLC readout`}>{current
      ? `${time(current, intraday)} · O ${prices.format(current.open)} · H ${prices.format(current.high)} · L ${prices.format(current.low)} · C ${prices.format(current.close)}${unit ? ` ${unit}` : ''}`
      : 'OHLC values appear here when history is available.'}</p>
    <div ref={container} className="agents-history-canvas" role="region" tabIndex={0}
      aria-label={`${symbol} interactive price chart. Scroll to zoom, drag to pan, hover for OHLC. Keyboard: plus/minus to zoom, left/right to pan, Home to reset.`}
      onWheelCapture={() => onRangeChange('Custom')}
      onPointerDown={event => { drag.current = { x: event.clientX, y: event.clientY } }}
      onPointerMove={event => {
        if (drag.current && Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 3) onRangeChange('Custom')
      }} onPointerUp={() => { drag.current = null }} onPointerLeave={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
      onKeyDown={event => {
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.65) }
        else if (event.key === '-') { event.preventDefault(); zoom(1.5) }
        else if (event.key === 'Home') { event.preventDefault(); reset() }
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          const current = api.current?.timeScale().getVisibleLogicalRange()
          if (!current) return
          onRangeChange('Custom')
          const shift = Math.max(1, (current.to - current.from) * 0.2) * (event.key === 'ArrowLeft' ? -1 : 1)
          api.current!.timeScale().setVisibleLogicalRange({ from: current.from + shift, to: current.to + shift })
        }
      }} />
    <p className="agents-candlestick-legend">Scroll to zoom · Drag to pan · Hover for OHLC · +/−, ←/→ and Home work when the chart is focused · Dates/times in UTC · Green: close ≥ open · Red: close &lt; open</p>
  </>
}

function fitHistory(chart: IChartApi, candles: Candle[], range: ViewRange) {
  if (!candles.length || range === 'Custom') return
  if (range === 'Max') chart.timeScale().fitContent()
  else chart.timeScale().setVisibleLogicalRange({ from: agentHistoryStart(candles, range) - 0.5, to: candles.length - 0.5 })
}

function HistoryTable({ candles, intraday, title }: { candles: Candle[]; intraday: boolean; title: string }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const lastPage = Math.max(0, Math.ceil(candles.length / 100) - 1)
  const currentPage = Math.min(page, lastPage)
  const start = currentPage * 100
  return <details className="agents-candlestick-data" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Show OHLC data ({candles.length.toLocaleString()} candles)</summary>
    {open && <>
      <div className="agents-history-navigation">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(0)}>First</button>
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>Rows {candles.length ? start + 1 : 0}–{Math.min(start + 100, candles.length)} of {candles.length.toLocaleString()}</span>
        <button type="button" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>Next</button>
        <button type="button" disabled={currentPage >= lastPage} onClick={() => setPage(lastPage)}>Last</button>
      </div>
      <div tabIndex={0} role="region" aria-label={`${title} exact OHLC values`}><table>
        <thead><tr>{['Time (UTC)', 'Open', 'High', 'Low', 'Close'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{candles.slice(start, start + 100).map(candle => <tr key={candle.time}><th scope="row">{time(candle, intraday)}</th>{[candle.open, candle.high, candle.low, candle.close].map((price, index) => <td key={index}>{String(price)}</td>)}</tr>)}</tbody>
      </table></div>
    </>}
  </details>
}
