export interface Slice {
  label: string
  /** Any positive magnitude; the legend shows each one's share of the total. */
  value: number
  /** Overrides the series colour, used by the Personal Finance totals. */
  color?: string
}

/** Series colours, reused by the pie chart and the weight bars so they agree. */
export const SERIES_COLORS = [
  '#4f8ff0',
  '#26c281',
  '#e0a34a',
  '#9d7ce0',
  '#4fb8d0',
  '#f0554e',
  '#c07ad0',
  '#7fa8e0',
  '#8fd06a',
  '#d09a4a',
]

export function colorForIndex(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]
}

interface DonutProps {
  slices: Slice[]
  empty?: string
  /** Printed in the hole, over `centerSubtext`. */
  centerText?: string
  centerSubtext?: string
  /** 0..1 sweep, for the replayable totals animation. Omit to draw the full ring. */
  animationProgress?: number
  /** Dense dashboard treatment: smaller chart and a two-column legend. */
  compact?: boolean
  /**
   * Degrees clockwise from twelve o'clock to begin the first wedge at. Defaults to 0, so
   * every existing caller is unchanged; the ETF page passes a negative angle to rotate
   * its Others wedge back over the top, which is what `set_start_angle` does there.
   */
  startAngle?: number
}

const SIZE = 320
const RADIUS = 140
const INNER = 78

function polar(angleDegrees: number, radius: number): [number, number] {
  // SVG angles run clockwise from 3 o'clock; shift so the first slice starts at 12.
  const radians = ((angleDegrees - 90) * Math.PI) / 180
  return [SIZE / 2 + radius * Math.cos(radians), SIZE / 2 + radius * Math.sin(radians)]
}

function arcPath(startAngle: number, endAngle: number): string {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  const [outerStartX, outerStartY] = polar(startAngle, RADIUS)
  const [outerEndX, outerEndY] = polar(endAngle, RADIUS)
  const [innerEndX, innerEndY] = polar(endAngle, INNER)
  const [innerStartX, innerStartY] = polar(startAngle, INNER)
  return [
    `M ${outerStartX} ${outerStartY}`,
    `A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${outerEndX} ${outerEndY}`,
    `L ${innerEndX} ${innerEndY}`,
    `A ${INNER} ${INNER} 0 ${largeArc} 0 ${innerStartX} ${innerStartY}`,
    'Z',
  ].join(' ')
}

/** Allocation donut with a legend. Slices under 4% are labelled in the legend only. */
export function Donut({
  slices,
  empty = 'No allocation to show',
  centerText,
  centerSubtext,
  animationProgress = 1,
  startAngle = 0,
  compact = false,
}: DonutProps) {
  const positive = slices.filter((slice) => slice.value > 0)
  const total = positive.reduce((sum, slice) => sum + slice.value, 0)
  if (!positive.length || total <= 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-2xs text-text-dim">{empty}</div>
    )
  }

  // The sweep stops partway through the ring while the animation runs, so a wedge is
  // either whole, clipped, or not yet reached.
  const swept = startAngle + Math.max(0, Math.min(1, animationProgress)) * 360
  let cursor = startAngle
  const wedges = positive.map((slice, index) => {
    const sweep = (slice.value / total) * 360
    const start = cursor
    cursor += sweep
    const end = Math.min(cursor, start + 359.999, swept)
    return {
      ...slice,
      percent: (slice.value / total) * 100,
      color: slice.color ?? colorForIndex(index),
      path: end > start ? arcPath(start, end) : '',
    }
  })

  return (
    <div
      className={
        compact
          ? 'flex min-h-0 flex-1 items-center justify-center gap-4 p-2'
          : 'flex min-h-0 flex-1 flex-wrap items-center justify-center gap-8 p-4'
      }
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={
          compact
            ? 'h-full max-h-[150px] min-h-[110px] w-auto shrink-0'
            : 'h-full max-h-[340px] min-h-[220px] w-auto'
        }
      >
        {wedges.map((wedge, index) =>
          wedge.path ? (
            <path key={index} d={wedge.path} fill={wedge.color}>
              <title>{`${wedge.label} ${wedge.percent.toFixed(1)}%`}</title>
            </path>
          ) : null,
        )}
        {centerText ? (
          <text
            x={SIZE / 2}
            y={centerSubtext ? SIZE / 2 - 2 : SIZE / 2 + 6}
            textAnchor="middle"
            className="num fill-text"
            style={{ fontSize: 26, fontWeight: 600 }}
          >
            {centerText}
          </text>
        ) : null}
        {centerSubtext ? (
          <text
            x={SIZE / 2}
            y={SIZE / 2 + 22}
            textAnchor="middle"
            className="fill-text-muted"
            style={{ fontSize: 15 }}
          >
            {centerSubtext}
          </text>
        ) : null}
      </svg>

      <ul
        className={
          compact ? 'grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-1' : 'flex flex-col gap-1'
        }
      >
        {wedges.map((wedge, index) => (
          <li key={index} className={`flex min-w-0 items-center ${compact ? 'gap-1' : 'gap-2'}`}>
            <span
              className={`${compact ? 'size-2' : 'size-3'} shrink-0`}
              style={{ background: wedge.color }}
            />
            <span
              className={
                compact
                  ? 'min-w-0 flex-1 truncate text-[10px] text-text'
                  : 'w-20 text-2xs text-text'
              }
              title={wedge.label}
            >
              {wedge.label}
            </span>
            <span className={`num shrink-0 text-text-muted ${compact ? 'text-[10px]' : 'text-2xs'}`}>
              {wedge.percent.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
