import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Logical,
  type LogicalRange,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'

import type { Candle, StocksChartPayload, StocksRangePreset } from '@shared/contract'
import {
  STOCKS_AUTO_ANCHOR,
  STOCKS_DEFAULT_VISIBLE_BARS,
  STOCKS_MFI_OVERBOUGHT,
  STOCKS_MFI_OVERSOLD,
} from '@shared/stocks'

const COLORS = {
  up: '#26c281',
  down: '#f0554e',
  mfi: '#9d7ce0',
  grid: '#141d2c',
  text: '#7d8ea6',
  border: '#1e2b3f',
  reference: '#e0a34a',
}

const RANGE_BARS: Record<Exclude<StocksRangePreset, ''>, number> = {
  '1M': 21,
  '3M': 63,
  '6M': 126,
  '1Y': 252,
  '3Y': 0,
}

interface StocksChartProps {
  payload: StocksChartPayload | null
  mfiEnabled: boolean
  autoFollow: boolean
  rangePreset: StocksRangePreset
  logicalRange: LogicalRange | null
  onLogicalRangeChange: (range: LogicalRange | null) => void
  onManualRange: () => void
  onHoverCandle: (candle: Candle | null) => void
}

export function StocksChart({
  payload,
  mfiEnabled,
  autoFollow,
  rangePreset,
  logicalRange,
  onLogicalRangeChange,
  onManualRange,
  onHoverCandle,
}: StocksChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<{
    candles: ISeriesApi<'Candlestick'>
    mfi: ISeriesApi<'Line'>
    lastPrice: IPriceLine
  } | null>(null)
  const candlesRef = useRef(new Map<number, Candle>())
  const applyingRange = useRef(false)
  const expectedRange = useRef<LogicalRange | null>(null)
  const stateRef = useRef({ autoFollow, rangePreset, logicalRange })
  stateRef.current = { autoFollow, rangePreset, logicalRange }
  const callbacksRef = useRef({ onLogicalRangeChange, onManualRange, onHoverCandle })
  callbacksRef.current = { onLogicalRangeChange, onManualRange, onHoverCandle }

  const setRange = (range: LogicalRange) => {
    const chart = chartRef.current
    if (!chart || range.to <= range.from) return
    applyingRange.current = true
    expectedRange.current = range
    chart.timeScale().setVisibleLogicalRange(range)
    requestAnimationFrame(() => {
      applyingRange.current = false
    })
  }

  const anchoredRange = (count: number, span: number): LogicalRange => {
    const latest = Math.max(0, count - 1)
    const safeSpan = Math.max(10, Math.min(span, count))
    return {
      from: (latest - safeSpan * STOCKS_AUTO_ANCHOR) as Logical,
      to: (latest + safeSpan * (1 - STOCKS_AUTO_ANCHOR)) as Logical,
    }
  }

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
      rightPriceScale: {
        borderColor: COLORS.border,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
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
      0,
    )
    const mfi = chart.addSeries(
      LineSeries,
      {
        color: COLORS.mfi,
        lineWidth: 2,
        priceLineVisible: false,
        title: 'MFI(14)',
      },
      1,
    )
    mfi.createPriceLine({ price: STOCKS_MFI_OVERBOUGHT, color: COLORS.reference, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' })
    mfi.createPriceLine({ price: STOCKS_MFI_OVERSOLD, color: COLORS.up, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' })
    const lastPrice = candles.createPriceLine({ price: 0, color: COLORS.reference, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' })

    const onRange = (range: LogicalRange | null) => {
      if (!range) return
      const expected = expectedRange.current
      if (
        applyingRange.current ||
        (expected && Math.abs(Number(range.from) - Number(expected.from)) < 0.01 && Math.abs(Number(range.to) - Number(expected.to)) < 0.01)
      ) {
        expectedRange.current = null
        return
      }
      const state = stateRef.current
      callbacksRef.current.onManualRange()
      if (state.autoFollow) {
        const count = candlesRef.current.size
        setRange(anchoredRange(count, Math.max(10, range.to - range.from)))
      } else callbacksRef.current.onLogicalRangeChange(range)
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)
    chart.subscribeCrosshairMove((parameter) => {
      if (!parameter.time) {
        callbacksRef.current.onHoverCandle(null)
        return
      }
      const data = parameter.seriesData.get(candles) as CandlestickData<Time> | undefined
      const time = typeof parameter.time === 'number' ? Number(parameter.time) : null
      if (!data || time === null) callbacksRef.current.onHoverCandle(null)
      else callbacksRef.current.onHoverCandle(candlesRef.current.get(time) ?? null)
    })

    chartRef.current = chart
    seriesRef.current = { candles, mfi, lastPrice }
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return
    if (!payload?.candles.length) {
      series.candles.setData([])
      series.mfi.setData([])
      candlesRef.current.clear()
      return
    }
    candlesRef.current = new Map(payload.candles.map((candle) => [candle.time, candle]))
    series.candles.setData(payload.candles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })))
    series.mfi.setData(payload.mfi.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })))
    series.lastPrice.applyOptions({ price: payload.stats.close })
    callbacksRef.current.onHoverCandle(null)

    requestAnimationFrame(() => {
      const count = payload.candles.length
      const state = stateRef.current
      if (state.rangePreset) {
        const bars = RANGE_BARS[state.rangePreset] || count
        setRange(anchoredRange(count, bars))
      } else if (state.autoFollow) {
        const span = state.logicalRange && state.logicalRange.to - state.logicalRange.from >= 10
          ? state.logicalRange.to - state.logicalRange.from
          : Math.min(STOCKS_DEFAULT_VISIBLE_BARS, count)
        setRange(anchoredRange(count, span))
      } else if (state.logicalRange) setRange(state.logicalRange)
      else chart.timeScale().fitContent()
    })
  }, [payload])

  useEffect(() => {
    const count = payload?.candles.length ?? 0
    if (!count || !rangePreset) return
    setRange(anchoredRange(count, RANGE_BARS[rangePreset] || count))
  }, [payload?.candles.length, rangePreset])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return
    series.mfi.applyOptions({ visible: mfiEnabled })
    const panes = chart.panes()
    panes[1]?.setHeight(mfiEnabled ? 120 : 1)
  }, [mfiEnabled])

  useEffect(() => {
    if (!autoFollow || !payload?.candles.length) return
    const current = chartRef.current?.timeScale().getVisibleLogicalRange()
    const span = current ? current.to - current.from : Math.min(STOCKS_DEFAULT_VISIBLE_BARS, payload.candles.length)
    setRange(anchoredRange(payload.candles.length, span))
  }, [autoFollow, payload?.candles.length])

  return <div ref={containerRef} className="min-h-0 flex-1" />
}
