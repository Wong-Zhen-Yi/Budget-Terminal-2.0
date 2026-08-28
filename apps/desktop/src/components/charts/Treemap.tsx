import { useMemo } from 'react'

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
      <div className="flex flex-1 items-center justify-center text-2xs text-text-dim">{empty}</div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1" onMouseLeave={() => onHover?.(null)}>
      {groups.map((group) => {
        const header = 20
        const inner = squarify(
          group.members.map((member) => member.weight),
          { x: 0, y: 0, width: 100, height: 100 },
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
            <div className="flex h-5 items-center bg-surface-raised px-1 text-2xs whitespace-nowrap text-text-muted">
              {group.group} {group.weight.toFixed(1)}%
            </div>
            <div className="relative" style={{ height: `calc(100% - ${header}px)` }}>
              {group.members.map((member, index) => (
                <div
                  key={member.key}
                  onMouseEnter={() => onHover?.(member)}
                  title={`${member.label}  ${format(member.changePct)}`}
                  className="absolute overflow-hidden border border-bg/60 p-1"
                  style={{
                    left: `${inner[index].x}%`,
                    top: `${inner[index].y}%`,
                    width: `${inner[index].width}%`,
                    height: `${inner[index].height}%`,
                    background: heatColor(member.changePct),
                  }}
                >
                  {/* Tiles carry their own saturated background, so they need their
                      own text colours rather than the panel palette. */}
                  <div className="text-2xs font-semibold text-white">{member.label}</div>
                  <div className="num text-2xs text-white/75">{member.subtitle}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
