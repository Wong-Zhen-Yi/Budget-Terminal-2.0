import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
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
  chartType: ChartsType
  indicators: Record<ChartsIndicator, boolean>
  averagePrice: number | null
  supportResistance: SupportResistance
  fibonacci: FibonacciModel | null
  drawings: ChartDrawing[]
  drawingTool: DrawingType | null
  replayLimit: number | null
  autoFollow: boolean
  onHover: (candle: Candle | null) => void
  onDrawingsChange: (drawings: ChartDrawing[]) => void
  onDrawingToolComplete: () => void
}

interface OverlayPoint extends DrawingAnchor {
  x: number
  y: number
}

export function MainChart({
  payload,
  chartType,
  indicators,
  averagePrice,
  supportResistance,
  fibonacci,
  drawings,
  drawingTool,
  replayLimit,
  autoFollow,
  onHover,
  onDrawingsChange,
  onDrawingToolComplete,
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
  const priceLines = useRef<IPriceLine[]>([])
  const candlesRef = useRef(new Map<number, Candle>())
  const propsRef = useRef({ drawings, drawingTool, onDrawingsChange, onDrawingToolComplete })
  propsRef.current = { drawings, drawingTool, onDrawingsChange, onDrawingToolComplete }
  const [pending, setPending] = useState<DrawingAnchor | null>(null)
  const [preview, setPreview] = useState<DrawingAnchor | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const dragRef = useRef<{ id: string; anchor: number } | null>(null)

  const shownCandles = useMemo(() => {
    const source = payload?.candles ?? []
    return replayLimit === null ? source : source.slice(0, Math.max(1, replayLimit))
  }, [payload?.candles, replayLimit])
  const lastShownTime = shownCandles.at(-1)?.time ?? Infinity

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
      timeScale: { borderColor: COLORS.border, rightOffset: 4 },
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
    const ma50 = chart.addSeries(LineSeries, { color: COLORS.ma50, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: '50-day SMA' }, 0)
    const ma200 = chart.addSeries(LineSeries, { color: COLORS.ma200, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 0)
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false }, 1)
    const rsi = chart.addSeries(LineSeries, { color: COLORS.rsi, lineWidth: 2, priceLineVisible: false }, 2)
    const rsiMa = chart.addSeries(LineSeries, { color: COLORS.rsiMa, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 2)
    rsi.createPriceLine({ price: 70, color: COLORS.down, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
    rsi.createPriceLine({ price: 30, color: COLORS.up, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
    chart.subscribeCrosshairMove((parameter) => {
      if (!parameter.time) {
        onHover(null)
        return
      }
      const data = parameter.seriesData.get(candles) as CandlestickData<Time> | undefined
      const time = typeof parameter.time === 'number' ? Number(parameter.time) : null
      onHover(data && time !== null ? candlesRef.current.get(time) ?? null : null)
    })
    chart.timeScale().subscribeVisibleTimeRangeChange(() => setRevision((value) => value + 1))
    chartRef.current = chart
    seriesRef.current = { candles, line, area, volume, ma50, ma200, rsi, rsiMa }
    const observer = new ResizeObserver(() => setRevision((value) => value + 1))
    observer.observe(container)
    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [onHover])

  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    candlesRef.current = new Map(shownCandles.map((candle) => [candle.time, candle]))
    series.candles.setData(shownCandles.map((row) => ({ time: row.time as UTCTimestamp, open: row.open, high: row.high, low: row.low, close: row.close })))
    const closeData = shownCandles.map((row) => ({ time: row.time as UTCTimestamp, value: row.close }))
    series.line.setData(closeData)
    series.area.setData(closeData)
    series.volume.setData(shownCandles.map((row) => ({ time: row.time as UTCTimestamp, value: row.volume, color: row.close >= row.open ? `${COLORS.up}80` : `${COLORS.down}80` })))
    series.ma50.setData((payload?.indicators.ma50 ?? []).filter((point) => point.time <= lastShownTime).map(pointData))
    series.ma200.setData((payload?.indicators.ma200 ?? []).filter((point) => point.time <= lastShownTime).map(pointData))
    series.rsi.setData((payload?.indicators.rsi ?? []).filter((point) => point.time <= lastShownTime).map(pointData))
    series.rsiMa.setData((payload?.indicators.rsiMa ?? []).filter((point) => point.time <= lastShownTime).map(pointData))
    if (shownCandles.length && (autoFollow || replayLimit !== null)) requestAnimationFrame(() => chart.timeScale().fitContent())
    setRevision((value) => value + 1)
  }, [payload?.indicators, shownCandles, lastShownTime, autoFollow, replayLimit])

  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    series.candles.applyOptions({ visible: chartType === 'candles' })
    series.line.applyOptions({ visible: chartType === 'line' })
    series.area.applyOptions({ visible: chartType === 'area' })
    series.volume.applyOptions({ visible: indicators.volume })
    series.ma50.applyOptions({ visible: indicators.ma50 })
    series.ma200.applyOptions({ visible: indicators.ma200 })
    series.rsi.applyOptions({ visible: indicators.rsi })
    series.rsiMa.applyOptions({ visible: indicators.rsi })
    chart.panes()[1]?.setHeight(indicators.volume ? 90 : 1)
    chart.panes()[2]?.setHeight(indicators.rsi ? 100 : 1)
  }, [chartType, indicators])

  useEffect(() => {
    const series = seriesRef.current?.candles
    if (!series) return
    for (const line of priceLines.current) series.removePriceLine(line)
    priceLines.current = []
    const add = (price: number | null, color: string, title: string, style = LineStyle.Dashed) => {
      if (price === null || !Number.isFinite(price)) return
      priceLines.current.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }))
    }
    if (indicators.avgPrice) add(averagePrice, COLORS.ma200, 'Avg')
    if (indicators.supportResistance) {
      add(supportResistance.support, COLORS.support, 'S')
      add(supportResistance.resistance, COLORS.resistance, 'R')
    }
    if (indicators.fibonacci && fibonacci) {
      for (const level of fibonacci.levels) add(level.price, COLORS.fib, level.label, LineStyle.Dotted)
    }
  }, [averagePrice, supportResistance, fibonacci, indicators])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPending(null)
        setPreview(null)
        setSelected(null)
        propsRef.current.onDrawingToolComplete()
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
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
    const series = seriesRef.current?.candles
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
    if (dragRef.current || !drawingTool) return
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
    const anchor = coordinateAnchor(event.clientX, event.clientY)
    if (!anchor) return
    if (!drag) {
      if (pending) setPreview(anchor)
      return
    }
    propsRef.current.onDrawingsChange(propsRef.current.drawings.map((drawing) => {
      if (drawing.id !== drag.id) return drawing
      const anchors = drawing.anchors.map((value, index) => index === drag.anchor ? anchor : value)
      return { ...drawing, anchors }
    }))
  }

  const overlay = drawings.map((drawing) => toOverlay(drawing, chartRef.current, seriesRef.current?.candles)).filter(Boolean) as Array<{ drawing: ChartDrawing; points: OverlayPoint[] }>
  const pendingPoint = pending ? anchorToOverlay(pending, chartRef.current, seriesRef.current?.candles) : null
  const previewPoint = preview ? anchorToOverlay(preview, chartRef.current, seriesRef.current?.candles) : null

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
      <svg
        key={revision}
        className={`absolute inset-0 z-10 h-full w-full ${drawingTool ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'}`}
        onClick={onOverlayClick}
        onPointerMove={onPointerMove}
        onPointerUp={() => { dragRef.current = null }}
        onPointerLeave={() => { dragRef.current = null }}
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
              dragRef.current = { id: selected, anchor: index }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
          />
        )) : null}
        {pendingPoint ? <circle cx={pendingPoint.x} cy={pendingPoint.y} r="5" fill={COLORS.drawing} /> : null}
        {pendingPoint && previewPoint && drawingTool ? <DrawingShape drawing={{ id: 'preview', type: drawingTool, anchors: [pending!, preview!], text: '', color: COLORS.drawing, width: 1 }} points={[pendingPoint, previewPoint]} selected={false} onSelect={() => undefined} /> : null}
      </svg>
    </div>
  )
}

function pointData(point: { time: number; value: number }) {
  return { time: point.time as UTCTimestamp, value: point.value }
}

function anchorToOverlay(anchor: DrawingAnchor, chart: IChartApi | null, series?: ISeriesApi<'Candlestick'>): OverlayPoint | null {
  if (!chart || !series) return null
  const x = chart.timeScale().timeToCoordinate(anchor.time as UTCTimestamp)
  const y = series.priceToCoordinate(anchor.price)
  return x === null || y === null ? null : { ...anchor, x, y }
}

function toOverlay(drawing: ChartDrawing, chart: IChartApi | null, series?: ISeriesApi<'Candlestick'>) {
  const points = drawing.anchors.map((anchor) => anchorToOverlay(anchor, chart, series))
  return points.every(Boolean) ? { drawing, points: points as OverlayPoint[] } : null
}

function DrawingShape({ drawing, points, selected, onSelect }: { drawing: ChartDrawing; points: OverlayPoint[]; selected: boolean; onSelect: () => void }) {
  const stroke = selected ? '#ffffff' : drawing.color
  const common = { stroke, strokeWidth: drawing.width + (selected ? 1 : 0), fill: 'none', style: { pointerEvents: 'stroke' as const }, onClick: (event: React.MouseEvent) => { event.stopPropagation(); onSelect() } }
  const first = points[0]
  const second = points[1] ?? first
  if (drawing.type === 'horizontal') return <line x1="0" x2="100%" y1={first.y} y2={first.y} {...common} />
  if (drawing.type === 'ray') return <line x1={first.x} x2="100%" y1={first.y} y2={first.y} {...common} />
  if (drawing.type === 'rectangle') return <rect x={Math.min(first.x, second.x)} y={Math.min(first.y, second.y)} width={Math.abs(second.x - first.x)} height={Math.abs(second.y - first.y)} {...common} fill={`${drawing.color}18`} />
  if (drawing.type === 'text') return <text x={first.x + 4} y={first.y - 4} fill={stroke} fontSize="12" style={{ pointerEvents: 'all' }} onClick={(event) => { event.stopPropagation(); onSelect() }}>{drawing.text}</text>
  if (drawing.type === 'fib') {
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
    return <g onClick={(event) => { event.stopPropagation(); onSelect() }} style={{ pointerEvents: 'stroke' }}>{levels.map((level) => {
      const y = second.y + (first.y - second.y) * level
      return <line key={level} x1={Math.min(first.x, second.x)} x2="100%" y1={y} y2={y} {...common} />
    })}</g>
  }
  return <line x1={first.x} x2={second.x} y1={first.y} y2={second.y} {...common} />
}
