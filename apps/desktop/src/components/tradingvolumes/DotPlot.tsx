import { useEffect, useMemo, useRef, useState } from 'react'

import type { TradingVolumeInterval } from '@shared/contract'
import {
  TRADING_VOLUME_METRICS,
  isLoggable,
  leastSquares,
  metricValue,
  type RankedTradingVolumeRow,
  type ReplayFrame,
  type ReplayPlan,
} from '@shared/tradingVolumes'
import { compactCurrency, percent } from '@/lib/format'

/**
 * Market cap against average daily dollar volume, both on log10 axes, with a
 * least-squares trend line. Ported from `_p20_render_dot_plot`.
 *
 * Built from scratch rather than on `LineChart`: that chart's x is the array index and
 * it exposes no scales, so a scatter cannot be expressed in it. It also stretches a
 * fixed viewBox with `preserveAspectRatio="none"`, which is fine for a path but would
 * turn every dot here into an ellipse — so this one measures its box and draws at real
 * pixel size instead.
 *
 * Like the reference, the values are log10-transformed and plotted linearly; the axis
 * ticks raise 10 to the power to print a dollar figure back (`_P20CompactCurrencyAxisItem`).
 *
 * Pass `frame` to draw one step of the Replay animation instead of live market caps.
 * Only y moves: dollar volume is one number per row, not a series.
 */

interface DotPlotProps {
  rows: RankedTradingVolumeRow[]
  interval: TradingVolumeInterval
  loaded: boolean
  /** One Replay frame, or `null` to draw live market caps. */
  frame?: ReplayFrame | null
  /** Supplies the pinned y range and the tooltip's interval-start baselines. */
  plan?: ReplayPlan | null
  /** Preview the same tickers the Remove Outliers button will hide. */
  highlightedTickers?: ReadonlySet<string>
}

const PAD = { top: 14, right: 18, bottom: 42, left: 62 }
/** Enough for `$316.2B` at the 2xs face; used to lay labels out without measuring text. */
const CHAR_WIDTH = 5.2
const LABEL_HEIGHT = 11
/** Clears the dot and its stroke, matching the reference's `anchor=(0.5, 1.15)`. */
const LABEL_OFFSET = 7
const DOT_RADIUS = 3.5

interface Point {
  ticker: string
  /** log10 of the active ADV. Fixed, including through a Replay. */
  x: number
  /** log10 of the live market cap. */
  y: number
  marketCap: number
  volume: number
  returnPct: number | null
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

function overlaps(a: Box, b: Box): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

/**
 * Ticks across a log10 range.
 *
 * Market cap spans five or six decades over a hundred names, so whole decades are plenty
 * there and a narrow pane takes every second or third. Dollar volume spans barely one,
 * and decades alone would leave the axis with two labels on it — so a short range
 * subdivides each decade at 1, 2 and 5, the usual log minor stops.
 */
function logTicks(min: number, max: number, maxTicks: number): number[] {
  const first = Math.ceil(min)
  const last = Math.floor(max)
  if (last < first) return [min, max]

  const decades: number[] = []
  for (let value = first; value <= last; value += 1) decades.push(value)

  if (decades.length * 3 <= maxTicks) {
    const mantissas = [1, 2, 5].map(Math.log10)
    const ticks: number[] = []
    for (let decade = first - 1; decade <= last; decade += 1) {
      for (const mantissa of mantissas) {
        const value = decade + mantissa
        if (value >= min && value <= max) ticks.push(value)
      }
    }
    if (ticks.length >= 2) return ticks
  }

  const step = Math.max(1, Math.ceil(decades.length / maxTicks))
  return decades.filter((_, index) => index % step === 0)
}

/** The reference's `chart_volume_up` / `chart_volume_down` / `chart_reference`. */
function dotColor(returnPct: number | null): string {
  if (returnPct === null || !Number.isFinite(returnPct) || returnPct === 0) {
    return 'var(--color-text-muted)'
  }
  return returnPct > 0 ? 'var(--color-up)' : 'var(--color-down)'
}

export function DotPlot({ rows, interval, loaded, frame = null, plan = null, highlightedTickers }: DotPlotProps) {
  const metric = TRADING_VOLUME_METRICS[interval]
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null)

  // The SVG is drawn at true pixel size, so it has to know what that size is.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setSize({ width: box.width, height: box.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const points = useMemo<Point[]>(() => {
    const result: Point[] = []
    for (const row of rows) {
      const volume = metricValue(row, metric.volumeField)
      // Both axes are log, so a zero or missing figure has nowhere to go. The row still
      // shows in the table; it just cannot be a dot.
      if (!isLoggable(volume) || !isLoggable(row.marketCap)) continue
      result.push({
        ticker: row.ticker,
        x: Math.log10(volume),
        y: Math.log10(row.marketCap),
        marketCap: row.marketCap,
        volume,
        returnPct: metricValue(row, metric.returnField),
      })
    }
    return result
  }, [rows, metric])

  /**
   * The parts that do not change frame to frame: the x range, the resting y range, and
   * which tickers get a label.
   *
   * The label set is deliberately fixed here rather than recomputed per frame. The
   * reference creates its `TextItem`s once in the static render and only moves them
   * during playback; recomputing collisions every frame would make labels blink in and
   * out as dots drift past each other.
   */
  const base = useMemo(() => {
    if (!points.length || size.width <= 0 || size.height <= 0) return null

    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    const xMinRaw = Math.min(...xs)
    const xMaxRaw = Math.max(...xs)
    const yMinRaw = Math.min(...ys)
    const yMaxRaw = Math.max(...ys)
    // `x_padding = max(span * 0.08, 0.08)`, `y_padding = max(span * 0.12, 0.08)`.
    const xPad = Math.max((xMaxRaw - xMinRaw) * 0.08, 0.08)
    const yPad = Math.max((yMaxRaw - yMinRaw) * 0.12, 0.08)

    const plotWidth = Math.max(1, size.width - PAD.left - PAD.right)
    const plotHeight = Math.max(1, size.height - PAD.top - PAD.bottom)
    const xMin = xMinRaw - xPad
    const xMax = xMaxRaw + xPad
    const staticYMin = yMinRaw - yPad
    const staticYMax = yMaxRaw + yPad

    // Label collision suppression — the one place this deliberately departs from the
    // reference, which draws all hundred labels and lets the dense cluster in the middle
    // become an unreadable pile. Biggest companies get first claim on the space, since
    // those are the names a reader scans for; anything that would land on top of an
    // already-placed label keeps its dot and loses its text. Hover still names every dot.
    const toStaticX = (value: number) => PAD.left + ((value - xMin) / (xMax - xMin)) * plotWidth
    const toStaticY = (value: number) =>
      PAD.top + plotHeight - ((value - staticYMin) / (staticYMax - staticYMin)) * plotHeight

    const labelled = new Set<string>()
    const boxes: Box[] = []
    for (const point of [...points].sort((a, b) => b.marketCap - a.marketCap)) {
      const cx = toStaticX(point.x)
      const baseline = toStaticY(point.y) - LABEL_OFFSET
      const halfWidth = (point.ticker.length * CHAR_WIDTH) / 2
      const box: Box = {
        left: cx - halfWidth,
        right: cx + halfWidth,
        top: baseline - LABEL_HEIGHT,
        bottom: baseline,
      }
      if (box.left < PAD.left || box.right > size.width - PAD.right || box.top < PAD.top) continue
      if (boxes.some((other) => overlaps(box, other))) continue
      boxes.push(box)
      labelled.add(point.ticker)
    }

    return { xMin, xMax, staticYMin, staticYMax, plotWidth, plotHeight, labelled }
  }, [points, size])

  const scene = useMemo(() => {
    if (!base) return null

    // Replay pins the y range across the whole playback, from the min and max of every
    // aligned value, so dots move against a still axis instead of one rescaling under
    // them. `setYRange` at the top of `_p20_replay_market_cap_animation` does the same.
    const animating = Boolean(frame && plan)
    const yMin = animating ? plan!.yMin : base.staticYMin
    const yMax = animating ? plan!.yMax : base.staticYMax

    const toX = (value: number) =>
      PAD.left + ((value - base.xMin) / (base.xMax - base.xMin)) * base.plotWidth
    const toY = (value: number) =>
      PAD.top + base.plotHeight - ((value - yMin) / (yMax - yMin)) * base.plotHeight

    const placed = points.map((point) => {
      const marketCap = frame?.caps[point.ticker] ?? point.marketCap
      const y = isLoggable(marketCap) ? Math.log10(marketCap) : point.y
      return { point, marketCap, cx: toX(point.x), cy: toY(y), yLog: y }
    })

    // Refitted every frame, exactly as the reference recomputes the regression line in
    // `_p20_apply_market_cap_animation_frame` — the trend is a property of where the
    // dots are now, not of where they ended up.
    const fit = leastSquares(placed.map((entry) => ({ x: entry.point.x, y: entry.yLog })))
    const xs = points.map((point) => point.x)
    const xMinRaw = Math.min(...xs)
    const xMaxRaw = Math.max(...xs)
    const trend = fit
      ? {
          x1: toX(xMinRaw),
          y1: toY(fit.alpha + fit.beta * xMinRaw),
          x2: toX(xMaxRaw),
          y2: toY(fit.alpha + fit.beta * xMaxRaw),
        }
      : null

    const labels = placed
      .filter((entry) => base.labelled.has(entry.point.ticker) || highlightedTickers?.has(entry.point.ticker))
      .map((entry) => ({ ticker: entry.point.ticker, x: entry.cx, y: entry.cy - LABEL_OFFSET }))
      // A pinned range can push a dot above the frame mid-playback; drop the text rather
      // than paint it over the axis.
      .filter((label) => label.y >= PAD.top)

    return {
      placed,
      labels,
      trend,
      xTicks: logTicks(
        base.xMin,
        base.xMax,
        Math.max(2, Math.floor(base.plotWidth / 70)),
      ).map((value) => ({ value, position: toX(value) })),
      yTicks: logTicks(yMin, yMax, Math.max(2, Math.floor(base.plotHeight / 44))).map((value) => ({
        value,
        position: toY(value),
      })),
    }
  }, [base, points, frame, plan, highlightedTickers])

  const hovered = useMemo(
    () => scene?.placed.find((entry) => entry.point.ticker === hoveredTicker) ?? null,
    [scene, hoveredTicker],
  )

  const message = !loaded
    ? 'Load Trading Volumes to plot tickers.'
    : !points.length
      ? `No rows with numeric Market Cap and ${metric.axisLabel} values to plot.`
      : null

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1">
      {message ? (
        <div className="flex h-full items-center justify-center p-4 text-2xs text-text-dim">
          {message}
        </div>
      ) : null}

      {!message && scene ? (
        <svg
          width={size.width}
          height={size.height}
          className="block"
          onMouseLeave={() => setHoveredTicker(null)}
        >
          {scene.yTicks.map((tick) => (
            <g key={`y-${tick.value.toFixed(4)}`}>
              <line
                x1={PAD.left}
                y1={tick.position}
                x2={size.width - PAD.right}
                y2={tick.position}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={tick.position + 3}
                textAnchor="end"
                className="fill-text-dim text-[9px]"
              >
                {compactCurrency(10 ** tick.value)}
              </text>
            </g>
          ))}

          {scene.xTicks.map((tick) => (
            <g key={`x-${tick.value.toFixed(4)}`}>
              <line
                x1={tick.position}
                y1={PAD.top}
                x2={tick.position}
                y2={size.height - PAD.bottom}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
              <text
                x={tick.position}
                y={size.height - PAD.bottom + 13}
                textAnchor="middle"
                className="fill-text-dim text-[9px]"
              >
                {compactCurrency(10 ** tick.value)}
              </text>
            </g>
          ))}

          {/* Least squares through the log-log points, as `chart_ma` dashed. */}
          {scene.trend ? (
            <line
              x1={scene.trend.x1}
              y1={scene.trend.y1}
              x2={scene.trend.x2}
              y2={scene.trend.y2}
              stroke="var(--color-warn)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
          ) : null}

          {scene.placed.map((entry) => (
            <circle
              key={entry.point.ticker}
              cx={entry.cx}
              cy={entry.cy}
              r={hoveredTicker === entry.point.ticker ? DOT_RADIUS + 2 : DOT_RADIUS}
              fill={dotColor(entry.point.returnPct)}
              stroke="var(--color-border-strong)"
              strokeWidth={0.6}
              onMouseEnter={() => setHoveredTicker(entry.point.ticker)}
            />
          ))}

          {scene.placed.filter((entry) => highlightedTickers?.has(entry.point.ticker)).map((entry) => (
            <circle
              key={`outlier-${entry.point.ticker}`}
              aria-label={`Remove outlier ${entry.point.ticker}`}
              cx={entry.cx}
              cy={entry.cy}
              r={DOT_RADIUS + 5}
              fill="none"
              stroke="var(--color-warn)"
              strokeWidth={2}
              className="pointer-events-none"
            />
          ))}

          {scene.labels.map((label) => (
            <text
              key={label.ticker}
              x={label.x}
              y={label.y}
              textAnchor="middle"
              className="pointer-events-none fill-text text-[9px]"
            >
              {label.ticker}
            </text>
          ))}

          <text
            x={PAD.left + (size.width - PAD.left - PAD.right) / 2}
            y={size.height - 6}
            textAnchor="middle"
            className="fill-text-muted text-[10px]"
          >
            {metric.axisLabel}
          </text>
          <text
            x={12}
            y={PAD.top + (size.height - PAD.top - PAD.bottom) / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${PAD.top + (size.height - PAD.top - PAD.bottom) / 2})`}
            className="fill-text-muted text-[10px]"
          >
            Market Cap
          </text>
        </svg>
      ) : null}

      {/* `_p20_market_cap_tooltip`. Also how a dot whose label was suppressed is named. */}
      {hovered ? (
        <div className="pointer-events-none absolute top-2 right-2 border border-border-strong bg-surface-raised px-2 py-1 text-2xs">
          <div className="font-semibold text-text">{hovered.point.ticker}</div>
          {frame ? <div className="text-text-muted">Date: {frame.date}</div> : null}
          <div className="text-text-muted">
            Est. Market Cap: {compactCurrency(hovered.marketCap)}
          </div>
          <div className="text-text-muted">
            {metric.label} ADV: {compactCurrency(hovered.point.volume)}
          </div>
          <MarketCapChange
            ticker={hovered.point.ticker}
            marketCap={hovered.marketCap}
            plan={frame ? plan : null}
          />
          <div className="text-text-dim">Price-based estimate; shares assumed unchanged.</div>
        </div>
      ) : null}
    </div>
  )
}

/** The tooltip's `Change from interval start` line, only meaningful during a Replay. */
function MarketCapChange({
  ticker,
  marketCap,
  plan,
}: {
  ticker: string
  marketCap: number
  plan: ReplayPlan | null
}) {
  if (!plan) return null

  const baseline = plan.baselines[ticker]
  if (plan.insufficient.includes(ticker) || !isLoggable(baseline)) {
    return <div className="text-text-dim">Market Cap Change: Insufficient history</div>
  }

  const change = marketCap - baseline
  const changePct = (change / baseline) * 100
  const tone = change >= 0 ? 'text-up' : 'text-down'
  return (
    <div className={tone}>
      Change from interval start: {change >= 0 ? '+' : '-'}
      {compactCurrency(Math.abs(change))} ({percent(changePct)})
    </div>
  )
}
