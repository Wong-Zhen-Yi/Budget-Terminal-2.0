import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'

import type { ChartsHistoryPayload } from '@shared/contract'

export function MiniChart({ payload, style, active }: { payload: ChartsHistoryPayload | null; style: 'candles' | 'line'; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<{ candles: ISeriesApi<'Candlestick'>; line: ISeriesApi<'Line'>; priceLine: IPriceLine } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = createChart(container, {
      autoSize: true,
      handleScroll: { mouseWheel: active, pressedMouseMove: active, horzTouchDrag: active, vertTouchDrag: false },
      handleScale: { mouseWheel: active, pinch: active, axisPressedMouseMove: active },
      layout: { background: { type: ColorType.Solid, color: '#0d1420' }, textColor: '#7d8ea6', fontSize: 11 },
      grid: { vertLines: { color: '#141d2c' }, horzLines: { color: '#141d2c' } },
      rightPriceScale: { borderColor: '#1e2b3f' },
      timeScale: { borderColor: '#1e2b3f', rightOffset: 4 },
    })
    const candles = chart.addSeries(CandlestickSeries, { upColor: '#26c281', downColor: '#f0554e', wickUpColor: '#26c281', wickDownColor: '#f0554e', borderVisible: false })
    const line = chart.addSeries(LineSeries, { color: '#4f8cff', lineWidth: 2, priceLineVisible: false })
    const priceLine = candles.createPriceLine({ price: 0, color: '#e0a34a', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' })
    chartRef.current = chart
    seriesRef.current = { candles, line, priceLine }
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.applyOptions({
      handleScroll: { mouseWheel: active, pressedMouseMove: active, horzTouchDrag: active, vertTouchDrag: false },
      handleScale: { mouseWheel: active, pinch: active, axisPressedMouseMove: active },
    })
  }, [active])

  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    const rows = payload?.candles ?? []
    series.candles.setData(rows.map((row) => ({ time: row.time as UTCTimestamp, open: row.open, high: row.high, low: row.low, close: row.close })))
    series.line.setData(rows.map((row) => ({ time: row.time as UTCTimestamp, value: row.close })))
    series.candles.applyOptions({ visible: style === 'candles' })
    series.line.applyOptions({ visible: style === 'line' })
    if (rows.length) series.priceLine.applyOptions({ price: rows.at(-1)!.close })
    requestAnimationFrame(() => chart.timeScale().fitContent())
  }, [payload, style])

  return <div ref={containerRef} className="min-h-44 flex-1" />
}
