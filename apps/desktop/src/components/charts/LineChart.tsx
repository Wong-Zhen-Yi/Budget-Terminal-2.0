import { useMemo } from 'react'

export interface LineSeries {
  values: number[]
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
}

const WIDTH = 1000
const HEIGHT = 380
const PAD = { top: 16, right: 56, bottom: 26, left: 8 }

/**
 * An SVG line chart with a zero baseline, for the Momentum Tracker.
 *
 * It uses a fixed viewBox and scales to fit, so it needs no resize observer and no
 * charting library — the series is a few hundred daily points at most.
 */
export function LineChart({ labels, series, format, empty = 'No data' }: LineChartProps) {
  const plot = useMemo(() => {
    const all = series.flatMap((entry) => entry.values)
    if (!all.length) return null

    // Always include zero so the baseline is meaningful, as the reference chart does.
    const minimum = Math.min(...all, 0)
    const maximum = Math.max(...all, 0)
    const span = maximum - minimum || 1
    const innerWidth = WIDTH - PAD.left - PAD.right
    const innerHeight = HEIGHT - PAD.top - PAD.bottom
    const count = Math.max(...series.map((entry) => entry.values.length))

    const x = (index: number) =>
      PAD.left + (count > 1 ? (index / (count - 1)) * innerWidth : innerWidth / 2)
    const y = (value: number) => PAD.top + ((maximum - value) / span) * innerHeight

    const gridValues = [maximum, maximum - span / 4, maximum - span / 2, maximum - (span * 3) / 4, minimum]

    return {
      minimum,
      maximum,
      x,
      y,
      gridValues,
      zeroY: y(0),
      paths: series.map((entry) => ({
        ...entry,
        d: entry.values.map((value, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(value)}`).join(' '),
        last: entry.values[entry.values.length - 1],
      })),
    }
  }, [series])

  if (!plot) {
    return (
      <div className="flex flex-1 items-center justify-center text-2xs text-text-dim">{empty}</div>
    )
  }

  // Roughly eight ticks, whatever the series length.
  const tickStep = Math.max(1, Math.ceil(labels.length / 8))

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="min-h-0 w-full flex-1">
      {plot.gridValues.map((value) => (
        <g key={value}>
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={plot.y(value)}
            y2={plot.y(value)}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
          <text
            x={WIDTH - PAD.right + 6}
            y={plot.y(value) + 4}
            fill="var(--color-text-muted)"
            fontSize={11}
          >
            {format(value)}
          </text>
        </g>
      ))}

      <line
        x1={PAD.left}
        x2={WIDTH - PAD.right}
        y1={plot.zeroY}
        y2={plot.zeroY}
        stroke="var(--color-border-strong)"
        strokeDasharray="4 4"
      />

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

      {labels.map((label, index) =>
        index % tickStep === 0 ? (
          <text
            key={`${label}-${index}`}
            x={plot.x(index)}
            y={HEIGHT - 8}
            fill="var(--color-text-muted)"
            fontSize={11}
            textAnchor="middle"
          >
            {label}
          </text>
        ) : null,
      )}
    </svg>
  )
}
