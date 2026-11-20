import { useEffect, useRef } from 'react'
import {
  AreaSeries, ColorType, createChart, CrosshairMode, HistogramSeries, LineSeries, LineStyle,
} from 'lightweight-charts'
import type { IChartApi, ISeriesApi, SeriesType, UTCTimestamp } from 'lightweight-charts'

export type EthChartKind = 'area' | 'line' | 'histogram'

export interface EthChartDay {
  day: number
  primary?: number
  secondary?: number
}

const utc = (day: number) => (day / 1000) as UTCTimestamp

interface Props {
  title: string
  kind: EthChartKind
  days: EthChartDay[]
  paired: boolean
  axis: (value: number) => string
  selected: number
  valueText: string
  intraday?: boolean
  onInspect: (day: number | undefined) => void
}

export function EthTrendChart({ title, kind, days, paired, axis, selected, valueText, intraday = false, onInspect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const view = useRef<{ chart: IChartApi; series: ISeriesApi<SeriesType>[] } | null>(null)
  const marks = useRef(new Map<number, { value: number; series: ISeriesApi<SeriesType> }>())

  useEffect(() => {
    if (!container.current) return
    const theme = getComputedStyle(container.current)
    const border = theme.getPropertyValue('--color-border').trim()
    const muted = theme.getPropertyValue('--color-text-muted').trim()
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: muted, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: border } },
      rightPriceScale: { borderColor: border, minimumWidth: intraday ? 44 : 72, scaleMargins: { top: 0.09, bottom: 0.08 } },
      timeScale: { borderColor: border, lockVisibleTimeRangeOnResize: true, minBarSpacing: 0.2, timeVisible: intraday },
      localization: { locale: 'en-US' },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: muted, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
    })
    chart.subscribeCrosshairMove(({ time }) => onInspect(typeof time === 'number' ? Math.round(time * 1000) : undefined))
    // Tapping the plot on a touch display also selects a date.
    chart.subscribeClick(({ time }) => { if (typeof time === 'number') onInspect(Math.round(time * 1000)) })
    view.current = { chart, series: [] }
    return () => {
      chart.remove()
      view.current = null
    }
  }, [intraday, onInspect])

  useEffect(() => {
    if (!view.current || !container.current) return
    const { chart, series } = view.current
    for (const previous of series) chart.removeSeries(previous)
    series.length = 0
    marks.current.clear()
    chart.clearCrosshairPosition()
    if (!days.some(day => day.primary !== undefined || day.secondary !== undefined)) return

    const theme = getComputedStyle(container.current)
    const primary = theme.getPropertyValue('--color-accent-hover').trim()
    const secondary = theme.getPropertyValue('--color-accent').trim()
    const common = { priceFormat: { type: 'custom' as const, formatter: axis }, priceLineVisible: false, lastValueVisible: false }

    // A hidden timeline keeps all UTC dates, including days when neither layer reported.
    const timeline = chart.addSeries(LineSeries, { ...common, visible: false })
    timeline.setData(days.map(day => ({ time: utc(day.day) })))
    series.push(timeline)

    const keys = paired ? ['primary', 'secondary'] as const : ['primary'] as const
    for (const key of keys) {
      type Point = { time: UTCTimestamp; value: number }
      const segments: Point[][] = []
      let segment: Point[] | undefined
      for (const day of days) {
        const value = day[key]
        if (value === undefined) {
          if (kind !== 'histogram') segment = undefined
          continue
        }
        if (!segment) {
          segment = []
          segments.push(segment)
        }
        segment.push({ time: utc(day.day), value })
      }

      const color = key === 'primary' ? primary : secondary
      for (const points of segments) {
        const plot = kind === 'histogram' ? chart.addSeries(HistogramSeries, { ...common, base: 0, color })
          : kind === 'area' ? chart.addSeries(AreaSeries, {
            ...common, lineColor: color, topColor: primary + '38', bottomColor: 'transparent', lineWidth: 2,
          })
            : chart.addSeries(LineSeries, {
              ...common, color, lineWidth: 2, lineStyle: key === 'secondary' ? LineStyle.Dashed : LineStyle.Solid,
            })
        plot.setData(points)
        series.push(plot)
        for (const { time, value } of points) {
          const day = Math.round(time * 1000)
          if (!marks.current.has(day)) marks.current.set(day, { value, series: plot })
        }
      }
    }
    chart.timeScale().fitContent()
  }, [days, kind, paired, axis, intraday])

  return <div ref={container} className="eth-market-view-chart-canvas" data-chart-kind={kind} role="slider" tabIndex={0}
    aria-label={title + (intraday ? ' history time' : ' history date')} aria-valuemin={0} aria-valuemax={days.length - 1}
    aria-valuenow={selected} aria-valuetext={valueText}
    onKeyDown={event => {
      const last = days.length - 1
      let index: number
      switch (event.key) {
        case 'ArrowLeft': case 'ArrowDown': index = Math.max(0, selected - 1); break
        case 'ArrowRight': case 'ArrowUp': index = Math.min(last, selected + 1); break
        case 'Home': index = 0; break
        case 'End': index = last; break
        default: return
      }
      event.preventDefault()
      const day = days[index].day
      onInspect(day)
      const mark = marks.current.get(day)
      if (mark) view.current?.chart.setCrosshairPosition(mark.value, utc(day), mark.series)
      else view.current?.chart.clearCrosshairPosition()
    }} />
}
