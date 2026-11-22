import { layoutIndicatorPanes } from '@/charts/stockChartLayout'
import { syncTimeSeries } from '@/charts/seriesUpdates'
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
  type UTCTimestamp,
} from 'lightweight-charts'

import type { ChartPayload } from '@shared/contract'
import type { IndicatorKey } from '@/stores/dashboard'

export const DASHBOARD_INDICATOR_COLORS = {
  ma200: '#e0a34a',
  rsi: '#9d7ce0',
  rsiMa: '#7d8ea6',
}

const COLORS = {
  up: '#26c281',
  down: '#f0554e',
  ...DASHBOARD_INDICATOR_COLORS,
  grid: '#141d2c',
  text: '#7d8ea6',
  border: '#1e2b3f',
}

/** Pane layout: price on top, then volume, then RSI, each toggled independently. */
const PANE = { price: 0, volume: 1, rsi: 2 }

interface PriceChartProps {
  payload: ChartPayload | null
  indicators: Record<IndicatorKey, boolean>
  onInspect?: (time: number | null) => void
}

function fitPriceChart(chart: IChartApi | null, count: number) {
  if (chart && count > 0) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, count - 90) - 0.5, to: count + 1 })
}

function indicatorPaneHeight(height: number) {
  return Math.max(30, Math.min(64, Math.floor(height * 0.18)))
}

/**
 * lightweight-charts v5 wrapper.
 *
 * v5's `addSeries(SeriesDefinition, options, paneIndex)` puts volume and RSI in their
 * own panes on a shared time axis, which is what the reference app draws with three
 * stacked pyqtgraph plots. The chart instance is created once and only its data is
 * swapped, so changing ticker or timeframe does not flash a rebuilt canvas.
 */
export function PriceChart({ payload, indicators, onInspect }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const previousPayload = useRef<ChartPayload | null>(null)
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
        fontSize: 12,
        panes: { separatorColor: COLORS.border, separatorHoverColor: '#2c3e59' },
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, minBarSpacing: 0.001, lockVisibleTimeRangeOnResize: true },
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
      previousPayload.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onInspect) return
    const inspect: Parameters<IChartApi['subscribeCrosshairMove']>[0] = ({ time }) =>
      onInspect(typeof time === 'number' ? time : null)
    chart.subscribeCrosshairMove(inspect)
    return () => chart.unsubscribeCrosshairMove(inspect)
  }, [onInspect])

  // Mark-only updates must not replace the candle series or reset its zoom.
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
      previousPayload.current = null
      return
    }

    const previous = previousPayload.current
    const reset = previous?.symbol !== payload.symbol || previous?.interval !== payload.interval || previous?.timeframe !== payload.timeframe
    const replaced = syncTimeSeries(series.candles, previous?.candles, payload.candles, candle => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }), reset)
    syncTimeSeries(series.volume, previous?.candles, payload.candles, candle => ({
      time: candle.time as UTCTimestamp,
      value: candle.volume,
      // Volume bars take the colour of their own candle, as in the reference chart.
      color: candle.close >= candle.open ? `${COLORS.up}80` : `${COLORS.down}80`,
    }), reset)
    const line = (point: { time: number; value: number }) => ({ time: point.time as UTCTimestamp, value: point.value })
    syncTimeSeries(series.ma200, previous?.indicators.ma200, payload.indicators.ma200, line, reset)
    syncTimeSeries(series.rsi, previous?.indicators.rsi, payload.indicators.rsi, line, reset)
    syncTimeSeries(series.rsiMa, previous?.indicators.rsiMa, payload.indicators.rsiMa, line, reset)
    previousPayload.current = payload

    if (replaced) fitPriceChart(chart, payload.candles.length)
  }, [payload?.symbol, payload?.interval, payload?.timeframe, payload?.candles, payload?.indicators])

  // Keep the recent-bar window in view when resizing the dashboard or dragging a splitter.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let frame = 0
    let width = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const chart = chartRef.current
        if (container.clientHeight > 0) {
          const height = indicatorPaneHeight(container.clientHeight)
          for (const pane of chart?.panes().slice(1) ?? []) pane.setHeight(height)
        }
        if (container.clientWidth > 0 && container.clientWidth !== width) {
          width = container.clientWidth
          fitPriceChart(chart, seriesRef.current?.candles.data().length ?? 0)
        }
      })
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

    const height = indicatorPaneHeight(containerRef.current?.clientHeight ?? 0)
    layoutIndicatorPanes(chart, [
      { series: [series.volume], visible: indicators.volume, height },
      { series: [series.rsi, series.rsiMa], visible: indicators.rsi, height },
    ])
  }, [indicators])

  return <div ref={containerRef} className="min-h-0 flex-1" />
}
