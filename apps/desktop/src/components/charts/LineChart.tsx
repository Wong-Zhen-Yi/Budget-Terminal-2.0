import { useEffect, useMemo, useRef, useState } from 'react'

export interface LineSeries {
  /** `null` breaks the line rather than plotting a point, keeping the x alignment. */
  values: Array<number | null>
  color: string
  dashed?: boolean
  label: string
}

interface LineChartProps {
  /** X labels, one per point; only a handful are drawn. */
  labels: string[]
  series: LineSeries[]
  format: (value: number) => string
  empty?: string
  /**
   * `zero` pins the baseline at zero and draws it, which is what a returns chart wants.
   * `auto` fits the data — a $550-$770 price series against a forced zero is a flat line
   * at the top of the frame.
   */
  baseline?: 'zero' | 'auto'
  /**
   * Fallback drawing size for the first paint, before the container has been measured.
   * The chart draws at true pixel size after that, so this no longer sets the look.
   */
  viewBox?: { width: number; height: number }
  /** Drop the value labels and x ticks for a chart too small to carry them. */
  axisLabels?: boolean
  /** Roughly how many x labels to print. */
  ticks?: number
}

const WIDTH = 1000
const HEIGHT = 380
const PAD = { top: 16, right: 56, bottom: 26, left: 8 }
const BARE_PAD = { top: 8, right: 8, bottom: 8, left: 8 }

/**
 * An SVG line chart, for the Momentum Tracker and the Pre-Market page's macro panels.
 *
 * It measures its box and draws at real pixel size, the way `DotPlot` does. The fixed
 * viewBox it used before was stretched with `preserveAspectRatio="none"`, which is fine
 * for a path but scaled the axis text by the container's aspect ratio — squashed or
 * smeared differently in every panel.
 */
export function LineChart({
  labels,
  series,
  format,
  empty = 'No data',
  baseline = 'zero',
  viewBox,
  axisLabels = true,
  ticks = 8,
}: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  // Drawing at true pixel size means knowing what that size is.
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

  const width = size.width || viewBox?.width || WIDTH
  const height = size.height || viewBox?.height || HEIGHT
  const pad = axisLabels ? PAD : BARE_PAD

  const plot = useMemo(() => {
    const all = series
      .flatMap((entry) => entry.values)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    if (!all.length) return null

    // A returns chart is meaningless without its zero line; a price chart is unreadable
    // with one.
    const minimum = baseline === 'zero' ? Math.min(...all, 0) : Math.min(...all)
    const maximum = baseline === 'zero' ? Math.max(...all, 0) : Math.max(...all)
    const span = maximum - minimum || 1
    const innerWidth = width - pad.left - pad.right
    const innerHeight = height - pad.top - pad.bottom
    const count = Math.max(...series.map((entry) => entry.values.length))

    const x = (index: number) =>
      pad.left + (count > 1 ? (index / (count - 1)) * innerWidth : innerWidth / 2)
    const y = (value: number) => pad.top + ((maximum - value) / span) * innerHeight

    const gridValues = [
      maximum,
      maximum - span / 4,
      maximum - span / 2,
      maximum - (span * 3) / 4,
      minimum,
    ]

    return {
      minimum,
      maximum,
      x,
      y,
      gridValues,
      zeroY: y(0),
      paths: series.map((entry) => ({
        ...entry,
        // A gap restarts the path with `M`, so the 125-day mean can begin 124 bars in
        // without dragging a line back to the origin.
        d: entry.values
          .map((value, index) =>
            typeof value === 'number' && Number.isFinite(value)
              ? `${index && typeof entry.values[index - 1] === 'number' ? 'L' : 'M'} ${x(index)} ${y(value)}`
              : '',
          )
          .filter(Boolean)
          .join(' '),
      })),
    }
  }, [series, baseline, width, height, pad.left, pad.right, pad.top, pad.bottom])

  if (!plot) {
    return (
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 items-center justify-center text-2xs text-text-dim"
      >
        {empty}
      </div>
    )
  }

  // Roughly `ticks` labels, whatever the series length.
  const tickStep = Math.max(1, Math.ceil(labels.length / ticks))

  return (
    <div ref={containerRef} className="min-h-0 w-full flex-1 overflow-hidden">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
        {plot.gridValues.map((value) => (
          <g key={value}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={plot.y(value)}
              y2={plot.y(value)}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            {axisLabels ? (
              <text
                x={width - pad.right + 6}
                y={plot.y(value) + 4}
                fill="var(--color-text-muted)"
                fontSize={11}
              >
                {format(value)}
              </text>
            ) : null}
          </g>
        ))}

        {baseline === 'zero' ? (
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={plot.zeroY}
            y2={plot.zeroY}
            stroke="var(--color-border-strong)"
            strokeDasharray="4 4"
          />
        ) : null}

        {plot.paths.map((entry) => (
          <path
            key={entry.label}
            d={entry.d}
            fill="none"
            stroke={entry.color}
            strokeWidth={2}
            strokeDasharray={entry.dashed ? '6 4' : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* The first and last labels anchor inwards; centred, they hang off the frame. */}
        {axisLabels
          ? labels.map((label, index) =>
              index % tickStep === 0 ? (
                <text
                  key={`${label}-${index}`}
                  x={plot.x(index)}
                  y={height - 8}
                  fill="var(--color-text-muted)"
                  fontSize={11}
                  textAnchor={
                    index === 0 ? 'start' : index + tickStep >= labels.length ? 'end' : 'middle'
                  }
                >
                  {label}
                </text>
              ) : null,
            )
          : null}
      </svg>
    </div>
  )
}
