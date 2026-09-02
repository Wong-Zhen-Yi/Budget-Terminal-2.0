import { useLayoutEffect, useRef, useState } from 'react'

import { layoutPattern, type ChartPatternExample } from '@shared/patternCandles'

const UP = '#26c281'
const DOWN = '#f0554e'

/**
 * The candlestick diagram behind every cheat-sheet and dictionary chart pattern.
 *
 * It measures its own box and lays out in pixels, like `DotPlot` and `IndexHeatmap`:
 * candle width, the guide-label gutter and the minimum body height are all pixel
 * thresholds, and a stretched viewBox would turn a 3px body into an ellipse of one at
 * one aspect ratio and a hairline at another. The geometry itself comes from
 * `layoutPattern` in shared, which is also what the PNG renderer draws, so a card and
 * its exported image cannot disagree.
 */
export function PatternChart({
  example,
  labels = true,
  className,
  ariaLabel,
}: {
  example: ChartPatternExample
  labels?: boolean
  className?: string
  ariaLabel: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => setBox({ width: host.clientWidth, height: host.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const ready = box.width > 20 && box.height > 20
  // Labels need a gutter; below ~260px there is no room for one and they are dropped,
  // the same rule the heatmap uses to decide whether a tile can carry its name.
  const showLabels = labels && box.width >= 260
  const layout = ready
    ? layoutPattern(example, {
        width: box.width,
        height: box.height,
        padTop: 8,
        padBottom: 8,
        padLeft: 6,
        padRight: showLabels ? 74 : 6,
        labelGap: 11,
      })
    : null

  return (
    <div ref={hostRef} className={className}>
      {layout ? (
        <svg role="img" aria-label={ariaLabel} width={box.width} height={box.height} className="block">
          {layout.gridlines.map((y) => (
            <line key={y} x1={0} x2={box.width} y1={y} y2={y} stroke="#141d2c" strokeWidth={1} />
          ))}
          {layout.guides.map((guide, index) => (
            <g key={`${guide.label}-${index}`}>
              <line
                x1={guide.x1}
                y1={guide.y1}
                x2={guide.x2}
                y2={guide.y2}
                stroke="#7d8ea6"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {showLabels ? (
                <text x={guide.x2 + 5} y={guide.labelY + 3} fill="#7d8ea6" fontSize={9}>
                  {guide.label}
                </text>
              ) : null}
            </g>
          ))}
          {layout.breakout ? (
            <g>
              <line
                x1={layout.breakout.x}
                y1={4}
                x2={layout.breakout.x}
                y2={box.height - 4}
                stroke="#d6b25e"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              {showLabels ? (
                <text x={layout.breakout.x + 4} y={13} fill="#d6b25e" fontSize={9}>
                  {layout.breakout.label}
                </text>
              ) : null}
            </g>
          ) : null}
          {layout.candles.map((candle, index) => (
            <g key={index} fill={candle.up ? UP : DOWN} stroke={candle.up ? UP : DOWN}>
              <line
                x1={candle.x}
                y1={candle.wickTop}
                x2={candle.x}
                y2={candle.wickBottom}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <rect
                x={candle.x - candle.halfWidth}
                y={candle.bodyTop}
                width={candle.halfWidth * 2}
                height={Math.max(1, candle.bodyBottom - candle.bodyTop)}
                shapeRendering="crispEdges"
              />
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  )
}
