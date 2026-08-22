import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'

import type { ChartPayload } from '@shared/contract'
import type { IndicatorKey } from '@/stores/dashboard'

const COLORS = {
  up: '#26c281',
  down: '#f0554e',
  ma200: '#e0a34a',
  rsi: '#9d7ce0',
  rsiMa: '#7d8ea6',
  grid: '#141d2c',
  text: '#7d8ea6',
  border: '#1e2b3f',
}

/** Pane layout: price on top, then volume, then RSI, each toggled independently. */
const PANE = { price: 0, volume: 1, rsi: 2 }

interface PriceChartProps {
  payload: ChartPayload | null
  indicators: Record<IndicatorKey, boolean>
}

/**
 * lightweight-charts v5 wrapper.
 *
 * v5's `addSeries(SeriesDefinition, options, paneIndex)` puts volume and RSI in their
 * own panes on a shared time axis, which is what the reference app draws with three
 * stacked pyqtgraph plots. The chart instance is created once and only its data is
 * swapped, so changing ticker or timeframe does not flash a rebuilt canvas.
 */
export function PriceChart({ payload, indicators }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<{
    candles: ISeriesApi<'Candlestick'>
    volume: ISeriesApi<'Histogram'>
    ma200: ISeriesApi<'Line'>
    rsi: ISeriesApi<'Line'>
    rsiMa: ISeriesApi<'Line'>
  } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0d1420' },
        textColor: COLORS.text,
        // Canvas text is not styled by the stylesheet, so it tracks the type scale by hand.
        fontSize: 14,
        panes: { separatorColor: COLORS.border, separatorHoverColor: '#2c3e59' },
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
    })

    const candles = chart.addSeries(
      CandlestickSeries,
      {
        upColor: COLORS.up,
        downColor: COLORS.down,
        wickUpColor: COLORS.up,
        wickDownColor: COLORS.down,
        borderVisible: false,
      },
      PANE.price,
    )
    const ma200 = chart.addSeries(
      LineSeries,
      { color: COLORS.ma200, lineWidth: 2, priceLineVisible: false, lastValueVisible: false },
      PANE.price,
    )
    const volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceLineVisible: false },
      PANE.volume,
    )
    const rsi = chart.addSeries(
      LineSeries,
      { color: COLORS.rsi, lineWidth: 1, priceLineVisible: false },
      PANE.rsi,
    )
    const rsiMa = chart.addSeries(
      LineSeries,
      {
        color: COLORS.rsiMa,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      },
      PANE.rsi,
    )

    // The 30/70 bands make the RSI pane readable without a legend.
    rsi.createPriceLine({ price: 70, color: COLORS.down, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
    rsi.createPriceLine({ price: 30, color: COLORS.up, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })

    chartRef.current = chart
    seriesRef.current = { candles, volume, ma200, rsi, rsiMa }

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // Data: replaced wholesale whenever the payload changes.
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return

    if (!payload || !payload.candles.length) {
      series.candles.setData([])
      series.volume.setData([])
      series.ma200.setData([])
      series.rsi.setData([])
      series.rsiMa.setData([])
      return
    }

    series.candles.setData(
      payload.candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    )
    series.volume.setData(
      payload.candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        // Volume bars take the colour of their own candle, as in the reference chart.
        color: candle.close >= candle.open ? `${COLORS.up}80` : `${COLORS.down}80`,
      })),
    )
    series.ma200.setData(toLine(payload.indicators.ma200))
    series.rsi.setData(toLine(payload.indicators.rsi))
    series.rsiMa.setData(toLine(payload.indicators.rsiMa))

    chart.timeScale().fitContent()
  }, [payload])

  // lightweight-charts keeps its bar spacing when the canvas resizes, so a narrower pane
  // shows fewer bars rather than the same range compressed. Refit so dragging a splitter
  // still leaves the whole series in view.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => chartRef.current?.timeScale().fitContent())
    })
    observer.observe(container)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  // Visibility: toggling an indicator must not refetch or reset the zoom.
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return

    series.ma200.applyOptions({ visible: indicators.ma200 })
    series.volume.applyOptions({ visible: indicators.volume })
    series.rsi.applyOptions({ visible: indicators.rsi })
    series.rsiMa.applyOptions({ visible: indicators.rsi })

    // A hidden series still reserves its pane, so collapse the pane too.
    const panes = chart.panes()
    panes[PANE.volume]?.setHeight(indicators.volume ? 90 : 1)
    panes[PANE.rsi]?.setHeight(indicators.rsi ? 90 : 1)
  }, [indicators])

  return <div ref={containerRef} className="min-h-0 flex-1" />
}

function toLine(points: Array<{ time: number; value: number }>): Array<{ time: Time; value: number }> {
  return points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value }))
}
