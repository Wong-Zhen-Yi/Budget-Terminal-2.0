import { fitStockChart } from '@/charts/stockChartLayout'
import { syncTimeSeries } from '@/charts/seriesUpdates'
import { useEffect, useRef } from 'react'
import { CandlestickSeries, ColorType, createChart } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import type { Candle } from '@shared/contract'

export function CandlestickChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const previous = useRef<Candle[] | undefined>(undefined)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0d1420' }, textColor: '#7d8ea6', fontSize: 12 },
      grid: { vertLines: { color: '#141d2c' }, horzLines: { color: '#141d2c' } },
      rightPriceScale: { borderColor: '#1e2b3f', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: '#1e2b3f', minBarSpacing: 0.001, lockVisibleTimeRangeOnResize: true },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26c281', downColor: '#f0554e', wickUpColor: '#26c281', wickDownColor: '#f0554e', borderVisible: false,
    })
    chartRef.current = chart
    seriesRef.current = series
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitStockChart(chart, series.data().length))
    })
    observer.observe(container)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      previous.current = undefined
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const replaced = syncTimeSeries(series, previous.current, candles, candle => ({
      time: candle.time as UTCTimestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close,
    }))
    previous.current = candles
    if (replaced) fitStockChart(chartRef.current, candles.length)
  }, [candles])

  return <div ref={containerRef} className="min-h-0 flex-1" />
}
