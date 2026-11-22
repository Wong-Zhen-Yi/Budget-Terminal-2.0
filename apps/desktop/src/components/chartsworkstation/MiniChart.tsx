import { fitStockChart } from '@/charts/stockChartLayout'
import { syncTimeSeries } from '@/charts/seriesUpdates'
import { memo, useEffect, useRef } from 'react'
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

import type { Candle, ChartsHistoryPayload } from '@shared/contract'

export const MiniChart = memo(function MiniChart({ payload, style, active }: { payload: ChartsHistoryPayload; style: 'candles' | 'line'; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const previousData = useRef<{ rows: Candle[]; style: typeof style; context: string } | null>(null)
  const rows = payload.candles
  const context = `${payload.symbol}:${payload.intervalLabel}:${payload.rangeLabel}`
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
      timeScale: { borderColor: '#1e2b3f', minBarSpacing: 0.001, lockVisibleTimeRangeOnResize: true },
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
      previousData.current = null
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
    const previous = previousData.current
    const styleChanged = previous?.style !== style
    const reset = previous?.context !== context
    let replaced: boolean
    if (style === 'candles') {
      replaced = syncTimeSeries(series.candles, previous?.rows, rows,
        row => ({ time: row.time as UTCTimestamp, open: row.open, high: row.high, low: row.low, close: row.close }), reset || styleChanged)
      const close = rows.at(-1)?.close
      if (close !== undefined && (styleChanged || close !== previous?.rows.at(-1)?.close)) series.priceLine.applyOptions({ price: close })
    } else {
      replaced = syncTimeSeries(series.line, previous?.rows, rows, row => ({ time: row.time as UTCTimestamp, value: row.close }), reset || styleChanged)
    }
    if (previous && styleChanged) series[previous.style].setData([])
    previousData.current = { context, rows, style }
    if (!rows.length || !(reset || (replaced && !styleChanged))) return
    fitStockChart(chart, rows.length)
  }, [context, rows, style])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    series.candles.applyOptions({ visible: style === 'candles' })
    series.line.applyOptions({ visible: style === 'line' })
  }, [style])

  return <div ref={containerRef} className="min-h-44 flex-1" />
})
