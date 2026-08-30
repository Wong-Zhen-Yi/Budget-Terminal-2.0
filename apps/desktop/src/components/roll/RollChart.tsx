import { useEffect, useMemo, useRef } from 'react'
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
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'

import type { RollChartBar } from '@shared/contract'
import { rollMacd, rollPatternContext, type RollBar } from '@shared/roll'

const COLORS = {
  up: '#26c281',
  down: '#f0554e',
  line: '#4a9fe0',
  sma20: '#e0a34a',
  sma50: '#9d7ce0',
  sma200: '#7d8ea6',
  rsi: '#9d7ce0',
  macd: '#4a9fe0',
  macdSignal: '#e0a34a',
  grid: '#141d2c',
  text: '#7d8ea6',
  border: '#1e2b3f',
}

/** Price, then volume, then RSI, then MACD — the reference's four stacked plots. */
const PANE = { price: 0, volume: 1, rsi: 2, macd: 3 }

/** A date-only daily bar becomes a UTC midnight timestamp, which is what the axis wants. */
function stamp(date: string): UTCTimestamp {
  return (Date.parse(`${date}T00:00:00Z`) / 1000) as UTCTimestamp
}

/**
 * The 1Y Price Snapshot.
 *
 * Off, it is the plain close line `_p18_render_line_chart` draws. On, it is
 * `_p18_render_technical_chart`: candles with the three daily moving averages, then
 * volume, RSI and MACD in their own panes. The indicators are recomputed here from the
 * payload's own bars using `shared/roll.ts`, so the line on the chart and the number in
 * the Why panel come from the same code — the reference computes them twice and the two
 * can drift.
 */
export function RollChart({ bars, indicators }: { bars: RollChartBar[]; indicators: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<{
    area: ISeriesApi<'Area'>
    candles: ISeriesApi<'Candlestick'>
    sma20: ISeriesApi<'Line'>
    sma50: ISeriesApi<'Line'>
    sma200: ISeriesApi<'Line'>
    volume: ISeriesApi<'Histogram'>
    rsi: ISeriesApi<'Line'>
    macd: ISeriesApi<'Line'>
    macdSignal: ISeriesApi<'Line'>
    macdHistogram: ISeriesApi<'Histogram'>
  } | null>(null)

  const computed = useMemo(() => {
    if (!bars.length) return null
    const context = rollPatternContext(bars as RollBar[])
    const macd = rollMacd(context.close)
    return { context, macd }
  }, [bars])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0d1420' },
        textColor: COLORS.text,
        fontSize: 14,
        panes: { separatorColor: COLORS.border, separatorHoverColor: '#2c3e59' },
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
    })

    const line = (color: string, pane: number, width: 1 | 2 = 1, dashed = false) =>
      chart.addSeries(
        LineSeries,
        {
          color,
          lineWidth: width,
          lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        pane,
      )

    const series = {
      area: chart.addSeries(
        AreaSeries,
        {
          lineColor: COLORS.line,
          topColor: 'rgba(74, 159, 224, 0.28)',
          bottomColor: 'rgba(74, 159, 224, 0.02)',
          lineWidth: 2,
          priceLineVisible: false,
        },
        PANE.price,
      ),
      candles: chart.addSeries(
        CandlestickSeries,
        {
          upColor: COLORS.up,
          downColor: COLORS.down,
          wickUpColor: COLORS.up,
          wickDownColor: COLORS.down,
          borderVisible: false,
        },
        PANE.price,
      ),
      sma20: line(COLORS.sma20, PANE.price),
      sma50: line(COLORS.sma50, PANE.price),
      sma200: line(COLORS.sma200, PANE.price, 1, true),
      volume: chart.addSeries(
        HistogramSeries,
        { priceFormat: { type: 'volume' }, priceLineVisible: false },
        PANE.volume,
      ),
      rsi: line(COLORS.rsi, PANE.rsi),
      macd: line(COLORS.macd, PANE.macd),
      macdSignal: line(COLORS.macdSignal, PANE.macd, 1, true),
      macdHistogram: chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        PANE.macd,
      ),
    }
    // The reference draws fixed 80/20 guides on its RSI plot.
    for (const [price, color] of [
      [80, COLORS.down],
      [20, COLORS.up],
    ] as const) {
      series.rsi.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: '',
      })
    }

    chartRef.current = chart
    seriesRef.current = series
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return

    if (!bars.length || !computed) {
      for (const key of Object.keys(series) as Array<keyof typeof series>) series[key].setData([])
      return
    }
    const { context, macd } = computed
    const times = bars.map((bar) => stamp(bar.date))
    const toLine = (values: Array<number | null>) =>
      values.flatMap((value, index) =>
        value === null || !Number.isFinite(value) ? [] : [{ time: times[index], value }],
      )

    series.area.setData(bars.map((bar, index) => ({ time: times[index], value: bar.close })))
    series.candles.setData(
      bars.map((bar, index) => ({
        time: times[index],
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    )
    series.sma20.setData(toLine(context.sma20))
    series.sma50.setData(toLine(context.sma50))
    series.sma200.setData(toLine(context.sma200))
    series.volume.setData(
      bars.map((bar, index) => ({
        time: times[index],
        value: bar.volume,
        color: bar.close >= bar.open ? `${COLORS.up}80` : `${COLORS.down}80`,
      })),
    )
    series.rsi.setData(toLine(context.rsi))
    series.macd.setData(toLine(macd.line))
    series.macdSignal.setData(toLine(macd.signal))
    series.macdHistogram.setData(
      macd.histogram.flatMap((value, index) =>
        value === null
          ? []
          : [{ time: times[index], value, color: value >= 0 ? `${COLORS.up}80` : `${COLORS.down}80` }],
      ),
    )
    chart.timeScale().fitContent()
  }, [bars, computed])

  // Toggling Indicators swaps the whole presentation, so it also collapses the three
  // lower panes — a hidden series still reserves its pane height otherwise.
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    series.area.applyOptions({ visible: !indicators })
    for (const key of ['candles', 'sma20', 'sma50', 'sma200'] as const) {
      series[key].applyOptions({ visible: indicators })
    }
    const panes = chart.panes()
    for (const pane of [PANE.volume, PANE.rsi, PANE.macd]) {
      panes[pane]?.setHeight(indicators ? 72 : 1)
    }
  }, [indicators, computed])

  // Bar spacing survives a resize, so a narrower panel would show fewer bars instead of
  // the same year compressed. Refit, like every other chart in the app.
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

  return <div ref={containerRef} className="min-h-0 flex-1" />
}
