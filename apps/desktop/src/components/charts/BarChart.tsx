export interface BarSegment {
  value: number
  color: string
}

export interface Bar {
  label: string
  value: number
  /** Overrides the sign-based colour, used by the weight chart. */
  color?: string
  /**
   * Splits the column into stacked parts, drawn bottom-up. The Personal Finance silos
   * use it to show a brokerage account as stocks, then cash, then options.
   */
  segments?: BarSegment[]
}

interface BarChartProps {
  bars: Bar[]
  /** Formats the value printed above each bar. */
  format: (value: number) => string
  /** Draw a zero line and let bars fall below it. */
  signed?: boolean
  /**
   * Compress the heights logarithmically. Without it a book with one large account and
   * several small ones draws the small ones as invisible slivers.
   */
  logScale?: boolean
  /** Order by descending magnitude, like the reference app's bar widget. */
  sortByMagnitude?: boolean
  empty?: string
}

/**
 * A plain SVG-free column chart. The Dip Finder, Portfolio Weight and Personal Finance
 * Silos panels are small enough that a charting library would cost more than it saves.
 */
export function BarChart({
  bars,
  format,
  signed = true,
  logScale = false,
  sortByMagnitude = false,
  empty = 'No data',
}: BarChartProps) {
  if (!bars.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-2xs text-text-dim">{empty}</div>
    )
  }

  const ordered = sortByMagnitude
    ? [...bars].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    : bars

  const values = ordered.map((bar) => bar.value)
  const maximum = Math.max(...values, 0)
  const minimum = signed ? Math.min(...values, 0) : 0
  // A flat series would divide by zero; give it a nominal span instead.
  const span = maximum - minimum || 1
  const zeroRatio = (maximum - 0) / span
  const logDenominator = Math.log1p(Math.max(...values.map((value) => Math.abs(value)), 0))

  const heightOf = (value: number): number => {
    if (!logScale) return Math.abs(value) / span
    if (logDenominator <= 0) return 0
    return Math.log1p(Math.abs(value)) / logDenominator
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 items-stretch gap-2 px-2 pt-5">
        {signed ? (
          <div
            className="pointer-events-none absolute inset-x-2 border-t border-border-strong"
            style={{ top: `calc(1.25rem + (100% - 1.25rem) * ${zeroRatio})` }}
          />
        ) : null}
        {ordered.map((bar, barIndex) => {
          const positive = bar.value >= 0
          const heightRatio = heightOf(bar.value)
          const fallback = bar.color ?? (positive ? 'var(--color-up)' : 'var(--color-down)')
          // Segments divide the column height the scale already decided, so a stacked
          // bar is exactly as tall as the same total drawn as one block.
          const segmentTotal =
            bar.segments?.reduce((sum, segment) => sum + Math.abs(segment.value), 0) ?? 0
          return (
            <div key={barIndex} className="relative flex min-w-0 flex-1 flex-col">
              <div className="relative flex-1">
                <div
                  className="absolute flex w-full flex-col-reverse"
                  style={{
                    height: `${heightRatio * 100}%`,
                    top: positive
                      ? `calc(${zeroRatio * 100}% - ${heightRatio * 100}%)`
                      : `${zeroRatio * 100}%`,
                    background: bar.segments?.length ? undefined : fallback,
                  }}
                >
                  {bar.segments?.length
                    ? bar.segments.map((segment, index) => (
                        <div
                          key={index}
                          style={{
                            height: segmentTotal
                              ? `${(Math.abs(segment.value) / segmentTotal) * 100}%`
                              : 0,
                            background: segment.color,
                          }}
                        />
                      ))
                    : null}
                </div>
                <span
                  className="num absolute w-full text-center text-2xs whitespace-nowrap"
                  style={{
                    top: positive
                      ? `calc(${zeroRatio * 100}% - ${heightRatio * 100}% - 1.15rem)`
                      : `calc(${zeroRatio * 100}% + ${heightRatio * 100}%)`,
                    color: fallback,
                  }}
                >
                  {format(bar.value)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-2 border-t border-border px-2 pt-1">
        {ordered.map((bar, barIndex) => (
          <span
            key={barIndex}
            title={bar.label}
            className="min-w-0 flex-1 truncate text-center text-2xs text-text-muted"
          >
            {bar.label}
          </span>
        ))}
      </div>
    </div>
  )
}
