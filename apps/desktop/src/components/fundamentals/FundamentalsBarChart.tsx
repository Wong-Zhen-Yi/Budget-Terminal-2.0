import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  FundamentalsChartModel,
  FundamentalsChartPoint,
  FundamentalsChartSeries,
} from '@shared/fundamentalsPage'
import { compactNumber } from '@/lib/format'

const SERIES_COLORS: Record<FundamentalsChartSeries['metric'], string> = {
  revenue: '#4f8cff',
  netIncome: '#a67df0',
  operatingCashFlow: '#26c281',
  freeCashFlow: '#d6b25e',
  sharesOutstanding: '#ec7fb0',
  cashAndBonds: '#26c281',
  totalDebt: '#f0554e',
  sellingGeneralAdmin: '#4f8cff',
  researchDevelopment: '#a67df0',
}

/**
 * `P2_COMPACT_ANNOTATION_LIMIT`. Past roughly two full series of quarters the labels do not
 * fit whatever the placement does, so hover carries the detail instead. Fullscreen keeps them.
 */
const ANNOTATION_LIMIT = 32
/** Cascadia Mono's advance width as a fraction of the font size; the labels are all `num`. */
const CHAR_WIDTH_RATIO = 0.6
/** Gap between a bar's end and its label, and between two stacked labels. */
const LABEL_GAP = 3
const LANE_GAP = 3

interface HoveredBar {
  series: FundamentalsChartSeries
  point: FundamentalsChartPoint
  x: number
  y: number
}

interface LabelInput {
  key: string
  cx: number
  halfWidth: number
  height: number
  tipY: number
  positive: boolean
  lines: string[]
  color: string
}

interface PlacedLabel {
  key: string
  cx: number
  tipY: number
  top: number
  bottom: number
  baselineY: number
  lines: string[]
  color: string
  displaced: boolean
}

/**
 * Place the labels the way `_p2_layout_compact_annotations` does: every label starts at its own
 * bar's end, and only labels that genuinely overlap are displaced outwards. Lifting a whole
 * series by its index instead leaves labels floating over unrelated bars.
 */
function placeLabels(inputs: LabelInput[], fontSize: number): PlacedLabel[] {
  // Lanes come from horizontal overlap alone, so they do not move when the y domain does.
  const lanes = new Map<string, number>()
  const laneRightEdges: number[] = []
  const byLeftEdge = [...inputs].sort((left, right) =>
    (left.cx - left.halfWidth) - (right.cx - right.halfWidth),
  )
  for (const input of byLeftEdge) {
    const left = input.cx - input.halfWidth
    let lane = laneRightEdges.findIndex((edge) => left >= edge + 2)
    if (lane < 0) {
      lane = laneRightEdges.length
      laneRightEdges.push(input.cx + input.halfWidth)
    } else {
      laneRightEdges[lane] = input.cx + input.halfWidth
    }
    lanes.set(input.key, lane)
  }

  const placed: PlacedLabel[] = []
  const rects: Array<{ left: number; right: number; top: number; bottom: number }> = []
  for (let lane = 0; lane < laneRightEdges.length; lane += 1) {
    const laneEntries = inputs
      .filter((input) => lanes.get(input.key) === lane)
      .sort((left, right) => left.cx - right.cx)
    for (const input of laneEntries) {
      const direction = input.positive ? -1 : 1
      const preferredEdge = input.tipY + direction * LABEL_GAP
      const left = input.cx - input.halfWidth
      const right = input.cx + input.halfWidth
      let edge = preferredEdge
      let top = input.positive ? edge - input.height : edge
      for (let guard = 0; guard <= inputs.length; guard += 1) {
        top = input.positive ? edge - input.height : edge
        const bottom = top + input.height
        const conflicts = rects.filter((rect) =>
          rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top,
        )
        if (!conflicts.length) break
        edge += input.positive
          ? -(Math.max(...conflicts.map((rect) => bottom - rect.top)) + LANE_GAP)
          : Math.max(...conflicts.map((rect) => rect.bottom - top)) + LANE_GAP
      }
      const bottom = top + input.height
      rects.push({ left, right, top, bottom })
      placed.push({
        key: input.key,
        cx: input.cx,
        tipY: input.tipY,
        top,
        bottom,
        baselineY: top + fontSize,
        lines: input.lines,
        color: input.color,
        displaced: Math.abs(edge - preferredEdge) > 0.5,
      })
    }
  }
  return placed
}

export function FundamentalsBarChart({
  model,
  fullscreen = false,
}: {
  model: FundamentalsChartModel
  fullscreen?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 640, height: fullscreen ? 640 : 270 })
  const [hovered, setHovered] = useState<HoveredBar | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setSize({
        width: Math.max(320, entry.contentRect.width),
        height: Math.max(fullscreen ? 420 : 150, entry.contentRect.height),
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [fullscreen])

  const chart = useMemo(() => {
    const fontSize = fullscreen ? 12 : 10
    const lineHeight = fontSize + 2
    const margins = {
      top: 10,
      right: 18,
      bottom: fullscreen ? 38 : 32,
      left: fullscreen ? 76 : 64,
    }
    const plotWidth = Math.max(1, size.width - margins.left - margins.right)
    const plotHeight = Math.max(1, size.height - margins.top - margins.bottom)
    const slotCount = Math.max(1, model.labels.length)
    const slotWidth = plotWidth / slotCount
    const xOf = (slot: number) => margins.left + ((slot + 0.5) / slotCount) * plotWidth

    const bars = model.series.flatMap((series) =>
      series.points.map((point) => {
        const width = Math.max(2, slotWidth * series.width)
        const centre = xOf(point.slot) + slotWidth * series.offset
        return {
          key: `${series.name}:${point.label}`,
          series,
          point,
          cx: centre,
          x: centre - width / 2,
          width,
          color: SERIES_COLORS[series.metric],
        }
      }),
    )

    const values = bars.map((bar) => bar.point.value)
    const rawMin = Math.min(0, ...values)
    const rawMax = Math.max(0, ...values)
    const rawSpan = rawMax - rawMin || 1
    const labelled = fullscreen || bars.length <= ANNOTATION_LIMIT

    // The headroom labels need is not known until they are placed, and placing them needs the
    // scale — so grow the domain until nothing overflows, as the reference's four passes do.
    let domainMin = rawMin < 0 ? rawMin - rawSpan * 0.04 : 0
    let domainMax = rawMax > 0 ? rawMax + rawSpan * (labelled ? 0.04 : 0.1) : 1
    let appliedMin = domainMin
    let appliedMax = domainMax
    let labels: PlacedLabel[] = []
    let yOf = (value: number) => margins.top + ((domainMax - value) / (domainMax - domainMin)) * plotHeight

    for (let pass = 0; pass < 4; pass += 1) {
      appliedMin = domainMin
      appliedMax = domainMax
      const span = appliedMax - appliedMin || 1
      yOf = (value: number) => margins.top + ((appliedMax - value) / span) * plotHeight
      if (!labelled) break

      const scale = yOf
      const inputs: LabelInput[] = bars
        // A zero bar has no end to label, and its growth reads as a meaningless -100%.
        .filter((bar) => bar.point.value !== 0)
        .map((bar) => {
          const lines = [compactNumber(bar.point.value)]
          if (bar.point.growth !== null) {
            lines.push(`${bar.point.growth >= 0 ? '+' : ''}${bar.point.growth.toFixed(1)}%`)
          }
          const characters = Math.max(...lines.map((line) => line.length))
          return {
            key: bar.key,
            cx: bar.cx,
            halfWidth: (characters * fontSize * CHAR_WIDTH_RATIO) / 2 + 2,
            height: lines.length * lineHeight,
            tipY: scale(bar.point.value),
            positive: bar.point.value >= 0,
            lines,
            color: bar.color,
          }
        })
      labels = placeLabels(inputs, fontSize)
      if (!labels.length) break

      const overTop = Math.max(0, margins.top + 2 - Math.min(...labels.map((label) => label.top)))
      const overBottom = Math.max(
        0,
        Math.max(...labels.map((label) => label.bottom)) - (size.height - margins.bottom - 2),
      )
      if (overTop <= 0.5 && overBottom <= 0.5) break
      const perPixel = span / plotHeight
      domainMax = appliedMax + overTop * perPixel
      domainMin = appliedMin - overBottom * perPixel
    }

    const gridValues = Array.from({ length: 5 }, (_, index) =>
      appliedMax - ((appliedMax - appliedMin) * index) / 4,
    )
    const labelStep = Math.max(1, Math.ceil(slotCount / Math.max(1, Math.floor(plotWidth / 68))))
    return { bars, labels, gridValues, labelStep, margins, slotWidth, fontSize, xOf, yOf }
  }, [fullscreen, model.labels.length, model.series, size])

  if (!chart.bars.length) {
    return (
      <div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center p-2 text-center text-2xs text-text-dim">
        No statement data is available for this chart.
      </div>
    )
  }

  const { margins } = chart

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
      <svg
        role="img"
        aria-label={`${model.title} grouped bar chart`}
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        className="block"
      >
        {chart.gridValues.map((value) => (
          <g key={value}>
            <line
              x1={margins.left}
              x2={size.width - margins.right}
              y1={chart.yOf(value)}
              y2={chart.yOf(value)}
              stroke={Math.abs(value) < 1e-9 ? 'var(--color-text-muted)' : 'var(--color-border)'}
              strokeWidth={Math.abs(value) < 1e-9 ? 1.4 : 1}
            />
            <text
              x={margins.left - 7}
              y={chart.yOf(value) + 4}
              textAnchor="end"
              fill="var(--color-text-muted)"
              fontSize={fullscreen ? 13 : 11}
              className="num"
            >
              {compactNumber(value)}
            </text>
          </g>
        ))}

        <line
          x1={margins.left}
          x2={size.width - margins.right}
          y1={chart.yOf(0)}
          y2={chart.yOf(0)}
          stroke="var(--color-text-muted)"
          strokeWidth={1.4}
        />

        {model.labels.map((label, index) => (
          index === model.labels.length - 1
          || (index % chart.labelStep === 0 && model.labels.length - 1 - index >= chart.labelStep)
        ) ? (
          <text
            key={label}
            x={chart.xOf(index)}
            y={size.height - 10}
            textAnchor="middle"
            fill="var(--color-text-muted)"
            fontSize={fullscreen ? 13 : 11}
            className="num"
          >
            {label}
          </text>
        ) : null)}

        {chart.bars.map((bar) => {
          const zero = chart.yOf(0)
          const valueY = chart.yOf(bar.point.value)
          const y = Math.min(zero, valueY)
          const height = Math.max(1, Math.abs(zero - valueY))
          return (
            <rect
              key={bar.key}
              x={bar.x}
              y={y}
              width={bar.width}
              height={height}
              fill={bar.series.filled ? bar.color : 'var(--color-surface)'}
              fillOpacity={bar.series.filled ? 0.88 : 1}
              stroke={bar.color}
              strokeWidth={bar.series.filled ? 0.8 : 2}
              onPointerEnter={(event) => setHovered({
                series: bar.series,
                point: bar.point,
                x: event.clientX,
                y: event.clientY,
              })}
              onPointerMove={(event) => setHovered((current) => current ? {
                ...current,
                x: event.clientX,
                y: event.clientY,
              } : current)}
              onPointerLeave={() => setHovered(null)}
            />
          )
        })}

        {/* A displaced label no longer sits on its bar, so it gets a leader back to it. */}
        {chart.labels.map((label) => label.displaced ? (
          <line
            key={`leader:${label.key}`}
            x1={label.cx}
            x2={label.cx}
            y1={label.tipY}
            y2={label.tipY < label.top ? label.top : label.bottom}
            stroke={label.color}
            strokeWidth={1}
            strokeOpacity={0.5}
            pointerEvents="none"
          />
        ) : null)}

        {chart.labels.map((label) => (
          <text
            key={`label:${label.key}`}
            x={label.cx}
            y={label.baselineY}
            textAnchor="middle"
            fill={label.color}
            fontSize={chart.fontSize}
            className="num"
            pointerEvents="none"
          >
            {label.lines.map((line, index) => (
              <tspan key={line + index} x={label.cx} dy={index === 0 ? 0 : chart.fontSize + 2}>
                {line}
              </tspan>
            ))}
          </text>
        ))}
      </svg>

      {hovered ? (
        <ChartTooltip hovered={hovered} bounds={containerRef.current?.getBoundingClientRect() ?? null} />
      ) : null}
    </div>
  )
}

function ChartTooltip({ hovered, bounds }: { hovered: HoveredBar; bounds: DOMRect | null }) {
  const left = bounds ? Math.min(Math.max(8, hovered.x - bounds.left + 12), Math.max(8, bounds.width - 230)) : 8
  const top = bounds ? Math.min(Math.max(8, hovered.y - bounds.top + 12), Math.max(8, bounds.height - 150)) : 8
  const { point, series } = hovered
  return (
    <div
      className="pointer-events-none absolute z-10 w-[220px] border border-border-strong bg-surface-raised/95 p-2 text-2xs shadow-xl"
      style={{ left, top }}
    >
      <p className="font-semibold text-text">{series.name}</p>
      <p className="num text-text-muted">Period: {point.label}</p>
      <p className="num text-text">Raw value: {compactNumber(point.rawValue)}</p>
      {point.indexed ? (
        <p className="num text-text">Indexed: {point.value.toFixed(1)} (base {point.indexedBaseLabel})</p>
      ) : null}
      <p className="num text-text">
        Growth: {point.growth === null ? '--' : `${point.growth >= 0 ? '+' : ''}${point.growth.toFixed(2)}%`}
      </p>
      {point.growthBaseline ? <p className="text-text-muted">Baseline: {point.growthBaseline}</p> : null}
      <p className="text-text-dim">Source: {point.source.toUpperCase()}</p>
    </div>
  )
}

export function FundamentalsChartLegend({
  model,
  fullscreen = false,
}: {
  model: FundamentalsChartModel
  fullscreen?: boolean
}) {
  // Four compare series carry far more legend text than a compact card has room for, so they
  // fall back to the ticker alone — `compact_legend` in the reference.
  const compact = !fullscreen && model.series.length > 2
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 pt-1 text-2xs text-text-muted">
      {model.series.map((series) => (
        <span key={series.name} className="flex min-w-0 items-center gap-1" title={series.name}>
          <span
            className="inline-block h-2.5 w-4 shrink-0 border"
            style={{
              borderColor: SERIES_COLORS[series.metric],
              background: series.filled ? SERIES_COLORS[series.metric] : 'transparent',
            }}
          />
          <span className="truncate">{(compact && series.legendName) || series.name}</span>
        </span>
      ))}
    </div>
  )
}
