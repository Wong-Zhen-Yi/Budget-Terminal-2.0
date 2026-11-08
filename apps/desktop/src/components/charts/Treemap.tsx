import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PrivateNumber, useNumberPrivacy } from '@/components/ui/NumberPrivacy'

export interface TreemapTile {
  key: string
  label: string
  /** Relative area. */
  weight: number
  /** Drives the tile colour; null renders neutral. */
  changePct: number | null
  group: string
  subtitle: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Squarified treemap: lay tiles along the shorter edge, flushing a row whenever adding
 * the next tile would make the row's aspect ratios worse. Keeps tiles close to square
 * instead of the slivers a naive slice-and-dice produces.
 */
export function squarify(values: number[], bounds: Rect): Rect[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return values.map(() => ({ x: bounds.x, y: bounds.y, width: 0, height: 0 }))

  const area = bounds.width * bounds.height
  const scaled = values.map((value) => (value / total) * area)
  const out: Rect[] = new Array(values.length)

  let remaining = { ...bounds }
  let index = 0

  const worst = (row: number[], side: number): number => {
    const sum = row.reduce((total_, value) => total_ + value, 0)
    if (sum <= 0 || side <= 0) return Infinity
    const max = Math.max(...row)
    const min = Math.min(...row)
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
  }

  while (index < scaled.length) {
    const vertical = remaining.width >= remaining.height
    const side = vertical ? remaining.height : remaining.width
    const row: number[] = []
    const rowIndexes: number[] = []

    while (index < scaled.length) {
      const candidate = [...row, scaled[index]]
      if (row.length && worst(candidate, side) > worst(row, side)) break
      row.push(scaled[index])
      rowIndexes.push(index)
      index += 1
    }

    const rowSum = row.reduce((sum, value) => sum + value, 0)
    const thickness = side > 0 ? rowSum / side : 0
    let offset = vertical ? remaining.y : remaining.x

    rowIndexes.forEach((tileIndex, position) => {
      const length = thickness > 0 ? row[position] / thickness : 0
      out[tileIndex] = vertical
        ? { x: remaining.x, y: offset, width: thickness, height: length }
        : { x: offset, y: remaining.y, width: length, height: thickness }
      offset += length
    })

    remaining = vertical
      ? {
          x: remaining.x + thickness,
          y: remaining.y,
          width: remaining.width - thickness,
          height: remaining.height,
        }
      : {
          x: remaining.x,
          y: remaining.y + thickness,
          width: remaining.width,
          height: remaining.height - thickness,
        }
  }

  return out
}

/** Reference palette: green above, red below, deepening with the size of the move. */
export function heatColor(changePct: number | null): string {
  if (changePct === null || !Number.isFinite(changePct)) return '#2a3446'
  const magnitude = Math.min(Math.abs(changePct) / 5, 1)
  const lightness = 22 + magnitude * 24
  return changePct >= 0 ? `hsl(152 55% ${lightness}%)` : `hsl(4 60% ${lightness}%)`
}

interface TreemapProps {
  tiles: TreemapTile[]
  onHover?: (tile: TreemapTile | null) => void
  format: (value: number | null) => string
  empty?: string
}

/** Sector groups laid out first, then the holdings inside each group. */
export function Treemap({ tiles, onHover, format, empty = 'No holdings to map' }: TreemapProps) {
  const maskNumbers = useNumberPrivacy()
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const groups = useMemo(() => {
    const byGroup = new Map<string, TreemapTile[]>()
    for (const tile of tiles) {
      if (tile.weight <= 0) continue
      const bucket = byGroup.get(tile.group) ?? []
      bucket.push(tile)
      byGroup.set(tile.group, bucket)
    }
    const entries = [...byGroup.entries()]
      .map(([group, members]) => ({
        group,
        members: [...members].sort((a, b) => b.weight - a.weight),
        weight: members.reduce((sum, member) => sum + member.weight, 0),
      }))
      .sort((a, b) => b.weight - a.weight)

    const outer = squarify(
      entries.map((entry) => entry.weight),
      { x: 0, y: 0, width: 100, height: 100 },
    )
    return entries.map((entry, index) => ({ ...entry, rect: outer[index] }))
  }, [tiles])

  if (!groups.length) {
    return (
      <div ref={containerRef} className="flex flex-1 items-center justify-center text-2xs text-text-dim">{empty}</div>
    )
  }

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1" onMouseLeave={() => onHover?.(null)}>
      {groups.map((group) => {
        const width = Math.max(0, size.width * group.rect.width / 100 - 2)
        const height = Math.max(0, size.height * group.rect.height / 100 - 2)
        const header = height >= 55 ? 20 : 0
        const inner = squarify(
          group.members.map((member) => member.weight),
          { x: 0, y: 0, width, height: Math.max(0, height - header) },
        )
        return (
          <div
            key={group.group}
            className="absolute border border-border"
            style={{
              left: `${group.rect.x}%`,
              top: `${group.rect.y}%`,
              width: `${group.rect.width}%`,
              height: `${group.rect.height}%`,
            }}
          >
            {header ? (
              <div
                className="h-5 truncate bg-surface-raised px-1 text-2xs text-text-muted"
                title={`${group.group} ${maskNumbers ? '****' : `${group.weight.toFixed(1)}%`}`}
              >
                {group.group} <PrivateNumber>{group.weight.toFixed(1)}%</PrivateNumber>
              </div>
            ) : null}
            <div className="relative" style={{ height: `calc(100% - ${header}px)` }}>
              {group.members.map((member, index) => {
                const fullSubtitle = maskNumbers ? '****' : member.subtitle
                const compactSubtitle = maskNumbers ? '****' : format(member.changePct)
                const subtitle = inner[index].width >= fullSubtitle.length * 9.5 + 10
                  ? fullSubtitle : compactSubtitle
                return (
                  <div
                    key={member.key}
                    onMouseEnter={() => onHover?.(member)}
                    onFocus={() => onHover?.(member)}
                    onBlur={() => onHover?.(null)}
                    tabIndex={0}
                    aria-label={`${member.label}, ${group.group}, ${maskNumbers ? '****' : member.subtitle}`}
                    title={`${member.label}  ${maskNumbers ? '****' : format(member.changePct)}`}
                    className="absolute overflow-hidden border border-bg/60 p-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-hover"
                    style={{
                      left: inner[index].x,
                      top: inner[index].y,
                      width: inner[index].width,
                      height: inner[index].height,
                      background: heatColor(member.changePct),
                    }}
                  >
                    {/* Tiles carry their own saturated background, so they need their
                        own text colours rather than the panel palette. */}
                    {inner[index].width >= member.label.length * 11 + 10 && inner[index].height >= 30 ? (
                      <div className="text-2xs font-semibold whitespace-nowrap text-white">{member.label}</div>
                    ) : null}
                    {inner[index].width >= subtitle.length * 9.5 + 10 && inner[index].height >= 50 ? (
                      <div className="num text-2xs whitespace-nowrap text-white/75"><PrivateNumber>{subtitle}</PrivateNumber></div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
