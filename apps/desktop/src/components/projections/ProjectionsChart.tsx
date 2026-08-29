import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'

import type { Candle } from '@shared/contract'
import {
  PROJECTION_SIDES,
  projectionPrice,
  type ProjectionPaths,
  type ProjectionPoint,
  type ProjectionSide,
} from '@shared/projections'

const COLORS = {
  up: '#26c281',
  down: '#f0554e',
  warn: '#e0a34a',
  grid: '#141d2c',
  text: '#7d8ea6',
  border: '#1e2b3f',
}

/** `_p28_render_projection_path`: green calls, red puts, amber combined. */
export const SIDE_COLOR: Record<ProjectionSide, string> = {
  calls: COLORS.up,
  puts: COLORS.down,
  combined: COLORS.warn,
}

const DAY_SECONDS = 24 * 60 * 60

/**
 * The Projections chart: candles and volume, with the three options-implied paths drawn
 * forward off the last bar.
 *
 * **One documented departure from `_p28_weekly_x_by_date`.** The reference has no time
 * axis to extend — pyqtgraph plots against bar *indexes* — so it parks each weekly point
 * on a synthetic slot five indexes past the last bar and relabels the axis by hand. Here
 * the paths are plotted at their real dates on the same time scale as the candles, which
 * is what makes an expiration two weeks out sit two weeks out rather than ten slots out.
 * The one point that cannot use its own date is the origin: it is the latest close, and
 * on an intraday timeframe its calendar date is *behind* the last bar's timestamp, so it
 * takes that bar's exact time instead.
 */
export function ProjectionsChart({
  candles,
  paths,
  empty,
}: {
  candles: Candle[]
  paths: ProjectionPaths
  empty: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<{
    candles: ISeriesApi<'Candlestick'>
    volume: ISeriesApi<'Histogram'>
    lines: Record<ProjectionSide, ISeriesApi<'Line'>>
  } | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; points: ProjectionPoint[] } | null>(
    null,
  )

  /** Weekly points keyed by the chart time they are drawn at, for the hover card. */
  const timed = useMemo(() => {
    const lastTime = candles.at(-1)?.time ?? null
    const byTime = new Map<number, ProjectionPoint[]>()
    const series: Record<ProjectionSide, Array<{ time: number; value: number }>> = {
      calls: [],
      puts: [],
      combined: [],
    }
    if (lastTime === null) return { series, byTime }
    for (const side of PROJECTION_SIDES) {
      let previous = -Infinity
      paths[side].forEach((point, index) => {
        const parsed = Date.parse(`${point.date}T00:00:00Z`)
        if (!Number.isFinite(parsed)) return
        // The origin rides the last bar; every later point uses its own calendar date,
        // nudged forward only if a date collision would break the ascending order the
        // series requires.
        let time = index === 0 ? lastTime : Math.floor(parsed / 1000)
        if (time <= previous) time = previous + DAY_SECONDS
        previous = time
        series[side].push({ time, value: point.projectedPrice })
        // The origin is the current close, not a projection: the reference draws no dot
        // there either (`points[1:]`), so it is left out of the hover map.
        if (index > 0) byTime.set(time, [...(byTime.get(time) ?? []), point])
      })
    }
    return { series, byTime }
  }, [candles, paths])

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
      timeScale: { borderColor: COLORS.border, rightOffset: 6 },
      crosshair: { mode: CrosshairMode.Normal },
    })
    const candleSeries = chart.addSeries(
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
    const volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceLineVisible: false },
      1,
    )
    const line = (color: string) =>
      chart.addSeries(
        LineSeries,
        {
          color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          // `_p28_render_projection_points`: every weekly point stays visible, it is not
          // a hover affordance.
          pointMarkersVisible: true,
          pointMarkersRadius: 4,
        },
        0,
      )
    const lines: Record<ProjectionSide, ISeriesApi<'Line'>> = {
      calls: line(SIDE_COLOR.calls),
      puts: line(SIDE_COLOR.puts),
      combined: line(SIDE_COLOR.combined),
    }
    chart.panes()[1]?.setHeight(90)
    chartRef.current = chart
    seriesRef.current = { candles: candleSeries, volume, lines }
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return
    const unsubscribe = chart.subscribeCrosshairMove((parameter) => {
      const time = typeof parameter.time === 'number' ? Number(parameter.time) : null
      const points = time === null ? undefined : timed.byTime.get(time)
      if (!points?.length || !parameter.point) {
        setHover(null)
        return
      }
      setHover({ x: parameter.point.x, y: parameter.point.y, points })
    })
    return unsubscribe
  }, [timed])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return
    series.candles.setData(
      candles.map((row) => ({
        time: row.time as UTCTimestamp,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      })),
    )
    series.volume.setData(
      candles.map((row) => ({
        time: row.time as UTCTimestamp,
        value: row.volume,
        color: row.close >= row.open ? `${COLORS.up}80` : `${COLORS.down}80`,
      })),
    )
    for (const side of PROJECTION_SIDES) {
      series.lines[side].setData(
        timed.series[side].map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      )
    }
    // `_p28_apply_chart_ranges`: the window is the last 120 bars *plus* whatever the
    // projection paths reach, so a path never runs off the right-hand edge.
    if (candles.length) {
      const right = candles.length - 1
      const left = Math.max(0, right - 120 + 1)
      const lastProjection = Math.max(
        ...PROJECTION_SIDES.map((side) => timed.series[side].at(-1)?.time ?? -Infinity),
      )
      chart.timeScale().setVisibleRange({
        from: candles[left].time as UTCTimestamp,
        to: (Number.isFinite(lastProjection)
          ? lastProjection
          : candles[right].time) as UTCTimestamp,
      })
    }
  }, [candles, timed])

  if (!candles.length) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-2xs text-text-dim">
        {empty}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1">
      {hover ? (
        <div
          className="pointer-events-none absolute z-20 max-w-64 border border-border-strong bg-surface-raised px-2 py-1 text-2xs text-text shadow-lg"
          style={{
            left: Math.max(4, hover.x - 90),
            top: Math.max(4, hover.y - 12),
          }}
        >
          <p className="font-semibold">{hover.points[0].date}</p>
          {hover.points.map((point) => (
            <p key={point.side} style={{ color: SIDE_COLOR[point.side] }}>
              {point.side === 'calls' ? 'Calls' : point.side === 'puts' ? 'Puts' : 'Combined'}{' '}
              {projectionPrice(point.projectedPrice)} | {point.confidenceLabel} (
              {Math.round(point.confidenceScore * 100)}%)
            </p>
          ))}
          <p className="text-text-muted">
            Anchors {hover.points[0].leftAnchor} to {hover.points[0].rightAnchor}
          </p>
        </div>
      ) : null}
    </div>
  )
}
