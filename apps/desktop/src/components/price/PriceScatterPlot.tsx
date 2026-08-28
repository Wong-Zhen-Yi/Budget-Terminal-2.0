import { useEffect, useMemo, useRef, useState } from 'react'

import type { PriceScreenRow } from '@shared/contract'
import { formatPriceScreenMarketCap } from '@shared/priceScreen'

interface PriceScatterPlotProps {
  rows: PriceScreenRow[]
  loaded: boolean
  selectedTicker: string | null
  onSelectTicker: (ticker: string) => void
}

const PAD = { top: 18, right: 18, bottom: 42, left: 72 }
const DOT_RADIUS = 4
const LABEL_OFFSET = 8

function niceLinearTicks(minimum: number, maximum: number, count: number): number[] {
  const span = maximum - minimum
  if (!(span > 0)) return [minimum]
  const rough = span / Math.max(2, count)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
  const ticks: number[] = []
  for (let value = Math.ceil(minimum / step) * step; value <= maximum; value += step) {
    ticks.push(Number(value.toPrecision(12)))
  }
  return ticks
}

function logTicks(minimum: number, maximum: number, maxTicks: number): number[] {
  const first = Math.ceil(minimum)
  const last = Math.floor(maximum)
  if (last < first) return [minimum, maximum]

  const decades: number[] = []
  for (let value = first; value <= last; value += 1) decades.push(value)
  if (decades.length * 3 <= maxTicks) {
    const ticks: number[] = []
    for (let decade = first - 1; decade <= last; decade += 1) {
      for (const mantissa of [0, Math.log10(2), Math.log10(5)]) {
        const value = decade + mantissa
        if (value >= minimum && value <= maximum) ticks.push(value)
      }
    }
    if (ticks.length >= 2) return ticks
  }
  const step = Math.max(1, Math.ceil(decades.length / maxTicks))
  return decades.filter((_, index) => index % step === 0)
}

function priceLabel(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: value < 10 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

export function PriceScatterPlot({
  rows,
  loaded,
  selectedTicker,
  onSelectTicker,
}: PriceScatterPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const scene = useMemo(() => {
    const points = rows
      .filter((row) => row.price > 0 && row.marketCap > 0)
      .map((row) => ({ row, x: row.price, y: Math.log10(row.marketCap) }))
    if (!points.length || size.width <= 0 || size.height <= 0) return null

    const rawXs = points.map((point) => point.x)
    const rawYs = points.map((point) => point.y)
    const rawXMin = Math.min(...rawXs)
    const rawXMax = Math.max(...rawXs)
    const rawYMin = Math.min(...rawYs)
    const rawYMax = Math.max(...rawYs)
    const xPad = Math.max((rawXMax - rawXMin) * 0.06, 0.5)
    const yPad = Math.max((rawYMax - rawYMin) * 0.1, 0.08)
    const xMin = rawXMin - xPad
    const xMax = rawXMax + xPad
    const yMin = rawYMin - yPad
    const yMax = rawYMax + yPad
    const plotWidth = Math.max(1, size.width - PAD.left - PAD.right)
    const plotHeight = Math.max(1, size.height - PAD.top - PAD.bottom)
    const toX = (value: number) => PAD.left + ((value - xMin) / (xMax - xMin)) * plotWidth
    const toY = (value: number) => PAD.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight

    return {
      points: points.map((point) => ({ ...point, cx: toX(point.x), cy: toY(point.y) })),
      xTicks: niceLinearTicks(xMin, xMax, Math.floor(plotWidth / 90)).map((value) => ({
        value,
        position: toX(value),
      })),
      yTicks: logTicks(yMin, yMax, Math.max(2, Math.floor(plotHeight / 44))).map((value) => ({
        value,
        position: toY(value),
      })),
      plotWidth,
      plotHeight,
    }
  }, [rows, size])

  const hovered = scene?.points.find((point) => point.row.ticker === hoveredTicker)?.row ?? null
  const message = !loaded
    ? 'Fetch a price range to plot matching companies.'
    : !rows.length
      ? 'No qualifying companies found in this price range.'
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
              />
              <text
                x={PAD.left - 6}
                y={tick.position + 3}
                textAnchor="end"
                className="fill-text-dim text-[9px]"
              >
                {formatPriceScreenMarketCap(10 ** tick.value)}
              </text>
            </g>
          ))}
          {scene.xTicks.map((tick) => (
            <g key={`x-${tick.value}`}>
              <line
                x1={tick.position}
                y1={PAD.top}
                x2={tick.position}
                y2={size.height - PAD.bottom}
                stroke="var(--color-border)"
              />
              <text
                x={tick.position}
                y={size.height - PAD.bottom + 14}
                textAnchor="middle"
                className="fill-text-dim text-[9px]"
              >
                {priceLabel(tick.value)}
              </text>
            </g>
          ))}

          {scene.points.map((point) => {
            const selected = point.row.ticker === selectedTicker
            const hoveredPoint = point.row.ticker === hoveredTicker
            return (
              <circle
                key={point.row.ticker}
                cx={point.cx}
                cy={point.cy}
                r={selected ? 7 : hoveredPoint ? DOT_RADIUS + 2 : DOT_RADIUS}
                fill={selected ? 'transparent' : 'var(--color-accent-hover)'}
                stroke={selected ? 'var(--color-warn)' : 'var(--color-border-strong)'}
                strokeWidth={selected ? 2 : 0.7}
                className="cursor-pointer outline-none"
                tabIndex={0}
                role="button"
                aria-label={`Select ${point.row.ticker}`}
                onMouseEnter={() => setHoveredTicker(point.row.ticker)}
                onClick={() => onSelectTicker(point.row.ticker)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectTicker(point.row.ticker)
                  }
                }}
              />
            )
          })}

          {scene.points.map((point) => (
            <text
              key={`label-${point.row.ticker}`}
              x={point.cx}
              y={point.cy - LABEL_OFFSET}
              textAnchor="middle"
              className="pointer-events-none fill-text text-[9px]"
            >
              {point.row.ticker}
            </text>
          ))}

          <text
            x={PAD.left + scene.plotWidth / 2}
            y={size.height - 6}
            textAnchor="middle"
            className="fill-text-muted text-[10px]"
          >
            Price ($)
          </text>
          <text
            x={12}
            y={PAD.top + scene.plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${PAD.top + scene.plotHeight / 2})`}
            className="fill-text-muted text-[10px]"
          >
            Market Cap
          </text>
        </svg>
      ) : null}

      {hovered ? (
        <div className="pointer-events-none absolute top-2 right-2 border border-border-strong bg-surface-raised px-2 py-1 text-2xs">
          <div className="font-semibold text-text">
            {hovered.ticker} — {hovered.name}
          </div>
          <div className="text-text-muted">Price: ${hovered.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="text-text-muted">Market Cap: {formatPriceScreenMarketCap(hovered.marketCap)}</div>
        </div>
      ) : null}
    </div>
  )
}

