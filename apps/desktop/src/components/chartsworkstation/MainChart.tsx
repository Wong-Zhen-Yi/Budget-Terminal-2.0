import { fitStockChart, layoutIndicatorPanes } from '@/charts/stockChartLayout'
import { syncTimeSeries } from '@/charts/seriesUpdates'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'

import type { Candle, ChartsHistoryPayload } from '@shared/contract'
import type { FibonacciModel, SupportResistance } from '@shared/charts'
import type { ChartDrawing, ChartsIndicator, ChartsType, DrawingAnchor, DrawingType } from '@/stores/charts'

const COLORS = {
  up: '#26c281',
  down: '#f0554e',
  accent: '#4f8cff',
  area: 'rgba(79, 140, 255, 0.16)',
  ma50: '#60c5e8',
  ma200: '#e0a34a',
  rsi: '#9d7ce0',
  rsiMa: '#7d8ea6',
  grid: '#141d2c',
  text: '#7d8ea6',
  border: '#1e2b3f',
  support: '#26c281',
  resistance: '#f0554e',
  drawing: '#7da7ff',
  fib: '#d4a94f',
}

interface MainChartProps {
  payload: ChartsHistoryPayload | null
  candles: Candle[]
  chartType: ChartsType
  indicators: Record<ChartsIndicator, boolean>
  averagePrice: number | null
  supportResistance: SupportResistance | null
  fibonacci: FibonacciModel | null
  drawings: ChartDrawing[]
  drawingTool: DrawingType | null
  replaying: boolean
  autoFollow: boolean
  onHover: (time: number | null) => void
  onDrawingsChange: (drawings: ChartDrawing[]) => void
  onDrawingToolComplete: () => void
  emptyMessage: string
}

interface OverlayPoint extends DrawingAnchor {
  x: number
  y: number
}

const INDICATOR_SERIES = ['ma50', 'ma200', 'rsi', 'rsiMa'] as const
type IndicatorRows = Partial<ChartsHistoryPayload['indicators']>
type PriceSeries = ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'>

export const MainChart = memo(function MainChart({
  payload,
  candles: shownCandles,
  chartType,
  indicators,
  averagePrice,
  supportResistance,
  fibonacci,
  drawings,
  drawingTool,
  replaying,
  autoFollow,
  onHover,
  onDrawingsChange,
  onDrawingToolComplete,
  emptyMessage,
}: MainChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<{
    candles: ISeriesApi<'Candlestick'>
    line: ISeriesApi<'Line'>
    area: ISeriesApi<'Area'>
    volume: ISeriesApi<'Histogram'>
    ma50: ISeriesApi<'Line'>
    ma200: ISeriesApi<'Line'>
    rsi: ISeriesApi<'Line'>
    rsiMa: ISeriesApi<'Line'>
  } | null>(null)
  const fittedContext = useRef('')
  const hoveredTime = useRef<number | null>(null)
  const previousData = useRef<{ context: string; candles: Candle[]; chartType: ChartsType; volume: boolean; indicators: IndicatorRows } | null>(null)
  const overlayFrame = useRef(0)
  const hasOverlay = useRef(false)
  hasOverlay.current = Boolean(drawings.length || drawingTool)
  const propsRef = useRef({ drawings, onDrawingsChange, onDrawingToolComplete })
  propsRef.current = { drawings, onDrawingsChange, onDrawingToolComplete }
  const [pending, setPending] = useState<DrawingAnchor | null>(null)
  const [preview, setPreview] = useState<DrawingAnchor | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [, setRevision] = useState(0)
  const [dragPreview, setDragPreview] = useState<DrawingAnchor | null>(null)
  const dragRef = useRef<{ id: string; index: number; position: DrawingAnchor | null } | null>(null)
  const moved = useRef(false)
  const context = `${payload?.symbol}:${payload?.intervalLabel}:${payload?.rangeLabel}`
  const { volume: showVolume, ma50: showMa50, ma200: showMa200, rsi: showRsi, avgPrice: showAverage } = indicators
  const sourceIndicators = payload?.indicators
  const scheduleOverlay = useCallback(() => {
    if (!hasOverlay.current || overlayFrame.current) return
    overlayFrame.current = requestAnimationFrame(() => {
      overlayFrame.current = 0
      setRevision((value) => value + 1)
    })
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0d1420' },
        textColor: COLORS.text,
        fontSize: 13,
        panes: { separatorColor: COLORS.border, separatorHoverColor: '#2c3e59' },
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: COLORS.border, minBarSpacing: 0.001, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: CrosshairMode.Normal },
    })
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      borderVisible: false,
    }, 0)
    const line = chart.addSeries(LineSeries, { color: COLORS.accent, lineWidth: 2, priceLineVisible: false }, 0)
    const area = chart.addSeries(AreaSeries, {
      lineColor: COLORS.accent,
      topColor: COLORS.area,
      bottomColor: 'rgba(79, 140, 255, 0.01)',
      lineWidth: 2,
      priceLineVisible: false,
    }, 0)
    const ma50 = chart.addSeries(LineSeries, { color: COLORS.ma50, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 0)
    const ma200 = chart.addSeries(LineSeries, { color: COLORS.ma200, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 0)
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false }, 1)
    const rsi = chart.addSeries(LineSeries, { color: COLORS.rsi, lineWidth: 2, priceLineVisible: false }, 2)
    const rsiMa = chart.addSeries(LineSeries, { color: COLORS.rsiMa, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 2)
    rsi.createPriceLine({ price: 70, color: COLORS.down, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
    rsi.createPriceLine({ price: 30, color: COLORS.up, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
    chart.subscribeCrosshairMove(({ time }) => {
      const next = typeof time === 'number' ? time : null
      if (next === hoveredTime.current) return
      hoveredTime.current = next
      onHover(next)
    })
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleOverlay)
    chartRef.current = chart
    seriesRef.current = { candles, line, area, volume, ma50, ma200, rsi, rsiMa }
    const observer = new ResizeObserver(scheduleOverlay)
    observer.observe(container)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(overlayFrame.current)
      overlayFrame.current = 0
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      fittedContext.current = ''
      previousData.current = null
    }
  }, [onHover, scheduleOverlay])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const previous = previousData.current
    const reset = previous?.context !== context
    if (reset) hoveredTime.current = null
    const styleChanged = previous?.chartType !== chartType
    if (chartType === 'candles') {
      syncTimeSeries(series.candles, previous?.candles, shownCandles, candleData, reset || styleChanged)
    } else {
      syncTimeSeries(series[chartType], previous?.candles, shownCandles, closeData, reset || styleChanged)
    }
    if (previous && styleChanged) series[previous.chartType].setData([])

    if (showVolume) syncTimeSeries(series.volume, previous?.volume ? previous.candles : undefined, shownCandles, volumeData, reset)
    else if (previous?.volume) series.volume.setData([])

    const lastShownTime = shownCandles.at(-1)?.time ?? -Infinity
    const currentIndicators: IndicatorRows = {}
    for (const key of INDICATOR_SERIES) {
      const visible = key === 'ma50' ? showMa50 : key === 'ma200' ? showMa200 : showRsi
      const points = sourceIndicators?.[key]
      if (visible && points) {
        const rows = replaying ? throughTime(points, lastShownTime) : points
        currentIndicators[key] = rows
        syncTimeSeries(series[key], previous?.indicators[key], rows, pointData, reset)
      } else if (previous?.indicators[key]) {
        series[key].setData([])
      }
    }
    previousData.current = { context, chartType, candles: shownCandles, volume: showVolume, indicators: currentIndicators }
    scheduleOverlay()
  }, [context, chartType, shownCandles, showVolume, showMa50, showMa200, showRsi, sourceIndicators, replaying, scheduleOverlay])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !shownCandles.length || (fittedContext.current === context && !autoFollow && !replaying)) return
    const frame = requestAnimationFrame(() => {
      fittedContext.current = context
      fitStockChart(chart, shownCandles.length)
      scheduleOverlay()
    })
    return () => cancelAnimationFrame(frame)
  }, [context, shownCandles, autoFollow, replaying, scheduleOverlay])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    series.candles.applyOptions({ visible: chartType === 'candles' })
    series.line.applyOptions({ visible: chartType === 'line' })
    series.area.applyOptions({ visible: chartType === 'area' })
  }, [chartType])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    series.ma50.applyOptions({ visible: showMa50 })
    series.ma200.applyOptions({ visible: showMa200 })
  }, [showMa50, showMa200])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return
    layoutIndicatorPanes(chart, [
      { series: [series.volume], visible: showVolume, height: 76 },
      { series: [series.rsi, series.rsiMa], visible: showRsi, height: 100 },
    ])
    scheduleOverlay()
  }, [showVolume, showRsi, scheduleOverlay])

  useEffect(() => {
    const series = seriesRef.current?.[chartType]
    if (!series) return
    const priceLines: IPriceLine[] = []
    const add = (price: number | null, color: string, title: string, style = LineStyle.Dashed) => {
      if (price === null || !Number.isFinite(price)) return
      priceLines.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }))
    }
    if (showAverage) add(averagePrice, COLORS.ma200, 'Avg')
    if (supportResistance) {
      add(supportResistance.support, COLORS.support, 'S')
      add(supportResistance.resistance, COLORS.resistance, 'R')
    }
    for (const level of fibonacci?.levels ?? []) add(level.price, COLORS.fib, level.label, LineStyle.Dotted)
    return () => {
      if (!chartRef.current) return
      for (const line of priceLines) series.removePriceLine(line)
    }
  }, [chartType, averagePrice, supportResistance, fibonacci, showAverage])

  useEffect(() => {
    setPending(null)
    setPreview(null)
  }, [context, drawingTool])

  useEffect(() => {
    setSelected(null)
    setDragPreview(null)
    dragRef.current = null
  }, [context])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPending(null)
        setPreview(null)
        setSelected(null)
        propsRef.current.onDrawingToolComplete()
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
        if (event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable)) return
        if (!propsRef.current.drawings.some((drawing) => drawing.id === selected)) return
        event.preventDefault()
        propsRef.current.onDrawingsChange(propsRef.current.drawings.filter((drawing) => drawing.id !== selected))
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const coordinateAnchor = (clientX: number, clientY: number): DrawingAnchor | null => {
    const container = containerRef.current
    const chart = chartRef.current
    const series = seriesRef.current?.[chartType]
    if (!container || !chart || !series) return null
    const rect = container.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const time = chart.timeScale().coordinateToTime(x)
    const price = series.coordinateToPrice(y)
    if (typeof time !== 'number' || price === null || !Number.isFinite(price)) return null
    return { time: Number(time), price }
  }

  const onOverlayClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (moved.current || !drawingTool) return
    const anchor = coordinateAnchor(event.clientX, event.clientY)
    if (!anchor) return
    if (drawingTool === 'horizontal' || drawingTool === 'ray' || drawingTool === 'text') {
      const text = drawingTool === 'text' ? window.prompt('Drawing text', '')?.trim() ?? '' : ''
      if (drawingTool === 'text' && !text) return
      commitDrawing(drawingTool, [anchor], text)
      return
    }
    if (!pending) {
      setPending(anchor)
      setPreview(anchor)
    }
    else {
      commitDrawing(drawingTool, [pending, anchor], '')
      setPending(null)
      setPreview(null)
    }
  }

  const commitDrawing = (type: DrawingType, anchors: DrawingAnchor[], text: string) => {
    const drawing: ChartDrawing = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      anchors,
      text,
      color: type === 'fib' ? COLORS.fib : COLORS.drawing,
      width: 1.5,
    }
    propsRef.current.onDrawingsChange([...propsRef.current.drawings, drawing])
    setSelected(drawing.id)
    propsRef.current.onDrawingToolComplete()
  }

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag && !pending) return
    const anchor = coordinateAnchor(event.clientX, event.clientY)
    if (!anchor) return
    if (!drag) {
      setPreview(anchor)
      return
    }
    drag.position = anchor
    setDragPreview(anchor)
  }

  const finishDrag = (commit: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setDragPreview(null)
    const position = drag.position
    if (!commit || !position) return
    const drawing = propsRef.current.drawings.find((entry) => entry.id === drag.id)
    const original = drawing?.anchors[drag.index]
    if (!original || (original.time === position.time && original.price === position.price)) return
    propsRef.current.onDrawingsChange(propsRef.current.drawings.map((entry) => entry.id === drag.id ? moveAnchor(entry, drag.index, position) : entry))
  }

  const series = seriesRef.current?.[chartType]
  const drag = dragRef.current
  const overlay = drawings.map((drawing) => toOverlay(
    drag?.id === drawing.id && dragPreview ? moveAnchor(drawing, drag.index, dragPreview) : drawing,
    chartRef.current,
    series,
  )).filter((entry) => entry !== null)
  const pendingPoint = pending ? anchorToOverlay(pending, chartRef.current, series) : null
  const previewPoint = preview ? anchorToOverlay(preview, chartRef.current, series) : null

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
      {!shownCandles.length ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-3 text-center text-[13px] text-text-muted">{emptyMessage}</div>
      ) : null}
      {drawings.length || drawingTool ? <svg
        aria-hidden="true"
        className={`absolute inset-0 z-10 h-full w-full ${drawingTool ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'}`}
        onClick={onOverlayClick}
        onPointerDownCapture={() => { moved.current = false }}
        onPointerMove={onPointerMove}
        onPointerUp={() => finishDrag(true)}
        onPointerCancel={() => finishDrag(false)}
        onLostPointerCapture={() => finishDrag(false)}
      >
        {overlay.map(({ drawing, points }) => (
          <DrawingShape key={drawing.id} drawing={drawing} points={points} selected={selected === drawing.id} onSelect={() => setSelected(drawing.id)} />
        ))}
        {selected ? overlay.find((item) => item.drawing.id === selected)?.points.map((point, index) => (
          <circle
            key={`${selected}-${index}`}
            cx={point.x}
            cy={point.y}
            r="5"
            fill="#0d1420"
            stroke="#ffffff"
            strokeWidth="1.5"
            style={{ pointerEvents: 'all' }}
            onPointerDown={(event) => {
              event.stopPropagation()
              moved.current = true
              dragRef.current = { id: selected, index, position: null }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
          />
        )) : null}
        {pendingPoint ? <circle cx={pendingPoint.x} cy={pendingPoint.y} r="5" fill={COLORS.drawing} /> : null}
        {pendingPoint && previewPoint && drawingTool ? <DrawingShape drawing={{ id: 'preview', type: drawingTool, anchors: [pendingPoint, previewPoint], text: '', color: COLORS.drawing, width: 1 }} points={[pendingPoint, previewPoint]} selected={false} /> : null}
      </svg> : null}
    </div>
  )
})

function candleData(row: Candle) {
  return { time: row.time as UTCTimestamp, open: row.open, high: row.high, low: row.low, close: row.close }
}

function closeData(row: Candle) {
  return { time: row.time as UTCTimestamp, value: row.close }
}

function volumeData(row: Candle) {
  return { time: row.time as UTCTimestamp, value: row.volume, color: row.close >= row.open ? `${COLORS.up}80` : `${COLORS.down}80` }
}

function pointData(point: { time: number; value: number }) {
  return { time: point.time as UTCTimestamp, value: point.value }
}

function throughTime<T extends { time: number }>(points: T[], lastTime: number): T[] {
  if (!points.length || points.at(-1)!.time <= lastTime) return points
  let low = 0
  let high = points.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle].time <= lastTime) low = middle + 1
    else high = middle
  }
  return points.slice(0, low)
}

function moveAnchor(drawing: ChartDrawing, index: number, position: DrawingAnchor): ChartDrawing {
  return { ...drawing, anchors: drawing.anchors.map((anchor, current) => current === index ? position : anchor) }
}

function anchorToOverlay(anchor: DrawingAnchor, chart: IChartApi | null, series?: PriceSeries): OverlayPoint | null {
  if (!chart || !series) return null
  const x = chart.timeScale().timeToCoordinate(anchor.time as UTCTimestamp)
  const y = series.priceToCoordinate(anchor.price)
  return x === null || y === null ? null : { ...anchor, x, y }
}

function toOverlay(drawing: ChartDrawing, chart: IChartApi | null, series?: PriceSeries) {
  const points = drawing.anchors.map((anchor) => anchorToOverlay(anchor, chart, series))
  return points.length && points.every((point) => point !== null) ? { drawing, points } : null
}

function DrawingShape({ drawing, points, selected, onSelect }: { drawing: ChartDrawing; points: OverlayPoint[]; selected: boolean; onSelect?: () => void }) {
  const stroke = selected ? '#ffffff' : drawing.color
  const onClick = onSelect ? (event: React.MouseEvent) => { event.stopPropagation(); onSelect() } : undefined
  const common = { stroke, strokeWidth: drawing.width + (selected ? 1 : 0), fill: 'none', pointerEvents: onSelect ? 'stroke' : 'none', onClick }
  const first = points[0]
  const second = points[1] ?? first
  if (drawing.type === 'horizontal') return <line x1="0" x2="100%" y1={first.y} y2={first.y} {...common} />
  if (drawing.type === 'ray') return <line x1={first.x} x2="100%" y1={first.y} y2={first.y} {...common} />
  if (drawing.type === 'rectangle') return <rect x={Math.min(first.x, second.x)} y={Math.min(first.y, second.y)} width={Math.abs(second.x - first.x)} height={Math.abs(second.y - first.y)} {...common} fill={`${drawing.color}18`} />
  if (drawing.type === 'text') return <text x={first.x + 4} y={first.y - 4} fill={stroke} fontSize="12" pointerEvents={onSelect ? 'all' : 'none'} onClick={onClick}>{drawing.text}</text>
  if (drawing.type === 'fib') {
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
    return <g>{levels.map((level) => {
      const y = second.y + (first.y - second.y) * level
      return <line key={level} x1={Math.min(first.x, second.x)} x2="100%" y1={y} y2={y} {...common} />
    })}</g>
  }
  return <line x1={first.x} x2={second.x} y1={first.y} y2={second.y} {...common} />
}
