import { memo, useEffect, useMemo, useRef, useState } from 'react'

import type { CompareModel } from '@shared/charts'

export const COMPARE_COLORS = ['#4f8cff', '#26c281', '#e0a34a', '#9d7ce0', '#f0554e', '#55c2d9', '#d96fa7', '#8bc34a']
const VIEWBOX_SIZE = 1000
const PADDING = { left: 20, right: 64, top: 20, bottom: 26 }
const GUIDE_LEVELS = [0, 0.25, 0.5, 0.75, 1]

export const CompareChart = memo(function CompareChart({ model, showIntervalLabels, emptyMessage }: {
  model: CompareModel | null
  showIntervalLabels: boolean
  emptyMessage: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const geometry = useMemo(() => {
    if (!model?.symbols.length) return null
    const uniqueTimes = new Set<number>()
    let min = 0
    let max = 0
    for (const symbol of model.symbols) {
      for (const point of model.normalized[symbol]) {
        uniqueTimes.add(point.time)
        min = Math.min(min, point.value)
        max = Math.max(max, point.value)
      }
    }
    if (min === max) { min = -1; max = 1 }
    const times = [...uniqueTimes].sort((a, b) => a - b)
    const first = times[0]
    const duration = Math.max(1, times.at(-1)! - first)
    const xRatio = (time: number) => (time - first) / duration
    const yRatio = (value: number) => (max - value) / (max - min)
    const paths = model.symbols.map((symbol) => model.normalized[symbol].map((point, index) =>
      `${index ? 'L' : 'M'}${(xRatio(point.time) * VIEWBOX_SIZE).toFixed(2)},${(yRatio(point.value) * VIEWBOX_SIZE).toFixed(2)}`,
    ).join(' '))
    return { times, min, max, xRatio, yRatio, paths }
  }, [model])

  const plotWidth = Math.max(1, size.width - PADDING.left - PADDING.right)
  const plotHeight = Math.max(1, size.height - PADDING.top - PADDING.bottom)
  if (!model || !geometry) return <div ref={containerRef} className="grid min-h-0 flex-1 place-items-center px-3 text-center text-[13px] text-text-muted">{emptyMessage}</div>
  const x = (time: number) => PADDING.left + geometry.xRatio(time) * plotWidth
  const y = (value: number) => PADDING.top + geometry.yRatio(value) * plotHeight
  const right = PADDING.left + plotWidth
  const labels = Math.max(2, Math.floor(plotWidth / 104))
  const labelEvery = Math.max(1, Math.ceil(geometry.times.length / labels))

  return (
    <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden">
      {size.width && size.height ? (
        <svg width={size.width} height={size.height} className="block" role="img" aria-label="Normalized performance by ticker">
          {GUIDE_LEVELS.map((ratio) => {
            const value = geometry.max - (geometry.max - geometry.min) * ratio
            const guideY = PADDING.top + ratio * plotHeight
            return (
              <g key={ratio}>
                <line x1={PADDING.left} x2={right} y1={guideY} y2={guideY} stroke="var(--color-border)" />
                <text x={right + 8} y={guideY + 4} fill="var(--color-text-muted)" fontSize="11">{value.toFixed(1)}%</text>
              </g>
            )
          })}
          <line x1={PADDING.left} x2={right} y1={y(0)} y2={y(0)} stroke="var(--color-border-strong)" strokeDasharray="4 4" />
          <svg x={PADDING.left} y={PADDING.top} width={plotWidth} height={plotHeight} viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`} preserveAspectRatio="none" overflow="visible">
            {geometry.paths.map((path, index) => <path key={model.symbols[index]} d={path} fill="none" stroke={COMPARE_COLORS[index % COMPARE_COLORS.length]} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
          </svg>
          {model.symbols.map((symbol, symbolIndex) => {
            const points = model.normalized[symbol]
            const changes = model.intervalChanges[symbol]
            const color = COMPARE_COLORS[symbolIndex % COMPARE_COLORS.length]
            const last = points.at(-1)!
            const labels = []
            if (showIntervalLabels) {
              for (let index = labelEvery - 1; index < changes.length; index += labelEvery) {
                const point = changes[index]
                labels.push(<text key={point.time} x={x(point.time)} y={y(points[index + 1].value) - 7} fill={color} fontSize="10" textAnchor="middle">{point.value >= 0 ? '+' : ''}{point.value.toFixed(1)}%</text>)
              }
            }
            return <g key={symbol}><circle cx={x(last.time)} cy={y(last.value)} r="3" fill={color} />{labels}</g>
          })}
          {Array.from({ length: Math.ceil(geometry.times.length / labelEvery) }, (_, index) => {
            const time = geometry.times[index * labelEvery]
            return <text key={time} x={x(time)} y={size.height - 8} fill="var(--color-text-muted)" fontSize="10" textAnchor={index === 0 ? 'start' : 'middle'}>{new Date(time * 1000).toISOString().slice(0, 10)}</text>
          })}
        </svg>
      ) : null}
    </div>
  )
})
