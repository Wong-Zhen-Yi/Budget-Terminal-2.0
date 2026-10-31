import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  formatHeatmapPct,
  formatHeatmapPrice,
  formatHeatmapWeightPct,
  heatmapTileColor,
  type HeatmapRow,
} from '@shared/heatmap'
import { squarify, type Rect } from '@/components/charts/Treemap'

/**
 * The index holdings map, ported from `widgets/etf_heatmap.py`.
 *
 * The reference paints this in `paintEvent`; here it is absolutely positioned divs, but
 * the geometry rules are the same and they are all in *pixels*, which is why the widget
 * measures its own box rather than laying out in percentages: every one of the reference's
 * decisions — whether a sector gets a header, whether a tile gets a label, whether it is
 * drawn at all — is a pixel threshold, and a percentage layout has no way to ask.
 *
 * Zoom magnifies the *layout*, not the text. `_visible_rect` scales each rectangle and
 * subtracts the pan, leaving the fonts fixed, so zooming in reveals labels on tiles that
 * were too small for them rather than enlarging the ones already drawn. A CSS transform
 * on the container would scale the type with it and reveal nothing.
 *
 * One departure from the reference: tiles are laid out with the app's own squarified
 * treemap (`components/charts/Treemap.tsx`, already used by the Portfolio Heatmap) rather
 * than the reference's recursive `_binary_layout`. Both are area-accurate; squarify keeps
 * tiles closer to square, and using one layout for the app's two treemaps means a holding
 * of a given weight is the same shape on both pages.
 */

const OUTER_MARGIN = 8
const HEADER_HEIGHT = 22
const SECTOR_PADDING = 3
const MIN_ZOOM = 1
const MAX_ZOOM = 6
/** `_LEFT_DRAG_THRESHOLD`: a press that moves less than this is a click, not a pan. */
const DRAG_THRESHOLD = 4

interface Palette {
  neutral: string
  up: string
  down: string
}

const FALLBACK_PALETTE: Palette = { neutral: '#121b2b', up: '#26c281', down: '#f0554e' }

/** The tile ramp mixes hex channels, so it needs the resolved values, not `var(...)`. */
function readPalette(): Palette {
  if (typeof window === 'undefined') return FALLBACK_PALETTE
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    neutral: read('--color-surface-raised', FALLBACK_PALETTE.neutral),
    up: read('--color-up', FALLBACK_PALETTE.up),
    down: read('--color-down', FALLBACK_PALETTE.down),
  }
}

interface PlacedTile {
  row: HeatmapRow
  rect: Rect
}

interface PlacedSector {
  sector: string
  weight: number
  rect: Rect
  headerHeight: number
  tiles: PlacedTile[]
}

/** `_is_unquoted`: no usable change, as opposed to a genuine flat move. */
function isUnquoted(row: HeatmapRow): boolean {
  return typeof row.changePct !== 'number' || !Number.isFinite(row.changePct)
}

function tooltipFor(row: HeatmapRow): string {
  return [
    row.name ? `${row.symbol} - ${row.name}` : row.symbol,
    `Sector: ${row.sector}`,
    `Weight: ${formatHeatmapWeightPct(row.weight)}`,
    `Price: ${formatHeatmapPrice(row.price)}`,
    `Price source: ${row.priceSource ?? 'Yahoo stock history'}`,
    'Returns: Yahoo stock history',
    `${row.changeLabel}: ${formatHeatmapPct(row.changePct, true)}`,
  ].join('\n')
}

interface IndexHeatmapProps {
  rows: HeatmapRow[]
  selectedSymbol: string
  onSelect: (row: HeatmapRow) => void
  /** Double-click: the reference opens the holding in Charts. */
  onActivate: (symbol: string) => void
  empty: string
}

export function IndexHeatmap({
  rows,
  selectedSymbol,
  onSelect,
  onActivate,
  empty,
}: IndexHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [palette, setPalette] = useState<Palette>(FALLBACK_PALETTE)
  const drag = useRef<{ startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null>(
    null,
  )
  /** Whether the press that just ended moved far enough to have been a pan. */
  const panned = useRef(false)

  useEffect(() => setPalette(readPalette()), [])

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setSize({ width: Math.round(box.width), height: Math.round(box.height) })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // A new ETF or a fresh load resets the view, as `set_data(reset_view=True)` does.
  const signature = rows.length ? `${rows[0].etf}:${rows.length}` : 'empty'
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [signature])

  /** `_clamp_view`: at 1x there is nothing to pan, and past it the edges are hard stops. */
  const clamp = useCallback(
    (next: { x: number; y: number }, scale: number) => {
      if (scale <= 1) return { x: 0, y: 0 }
      const maxX = Math.max(0, size.width * scale - size.width)
      const maxY = Math.max(0, size.height * scale - size.height)
      return {
        x: Math.max(0, Math.min(maxX, next.x)),
        y: Math.max(0, Math.min(maxY, next.y)),
      }
    },
    [size],
  )

  const layout = useMemo<PlacedSector[]>(() => {
    if (!size.width || !size.height || !rows.length) return []
    const outer: Rect = {
      x: OUTER_MARGIN,
      y: OUTER_MARGIN,
      width: Math.max(1, size.width - OUTER_MARGIN * 2),
      height: Math.max(1, size.height - OUTER_MARGIN * 2),
    }

    const bySector = new Map<string, HeatmapRow[]>()
    for (const row of rows) {
      if (!row.symbol || !(row.weight > 0)) continue
      bySector.set(row.sector, [...(bySector.get(row.sector) ?? []), row])
    }
    const groups = [...bySector.entries()]
      .map(([sector, members]) => ({
        sector,
        members: [...members].sort((a, b) => b.weight - a.weight),
        weight: members.reduce((total, member) => total + member.weight, 0),
      }))
      .filter((group) => group.weight > 0)
      .sort((a, b) => b.weight - a.weight)

    const sectorRects = squarify(
      groups.map((group) => group.weight),
      outer,
    )

    return groups.map((group, index) => {
      const rect = sectorRects[index]
      // `header_h`: a sector too small to carry its own name simply does not get one.
      const headerHeight = rect.height >= 58 && rect.width >= 90 ? HEADER_HEIGHT : 0
      const inner: Rect = {
        x: rect.x + SECTOR_PADDING,
        y: rect.y + SECTOR_PADDING + headerHeight,
        width: Math.max(0, rect.width - SECTOR_PADDING * 2),
        height: Math.max(0, rect.height - SECTOR_PADDING * 2 - headerHeight),
      }
      const tileRects =
        inner.width > 1 && inner.height > 1
          ? squarify(
              group.members.map((member) => member.weight),
              inner,
            )
          : []
      return {
        sector: group.sector,
        weight: group.weight,
        rect,
        headerHeight,
        tiles: group.members.map((row, tileIndex) => ({
          row,
          rect: tileRects[tileIndex] ?? { x: inner.x, y: inner.y, width: 0, height: 0 },
        })),
      }
    })
  }, [rows, size])

  /** `_visible_rect`: layout pixels magnified and panned, with the text left alone. */
  const project = useCallback(
    (rect: Rect) => ({
      left: rect.x * zoom - pan.x,
      top: rect.y * zoom - pan.y,
      width: rect.width * zoom,
      height: rect.height * zoom,
    }),
    [zoom, pan],
  )

  const visible = useCallback(
    (box: { left: number; top: number; width: number; height: number }) =>
      box.left < size.width &&
      box.top < size.height &&
      box.left + box.width > 0 &&
      box.top + box.height > 0,
    [size],
  )

  /**
   * `_set_zoom_at`: hold the point under the cursor still while the scale changes.
   *
   * Bound natively rather than through `onWheel`, because React registers its wheel
   * listener passively at the root — `preventDefault` there is a no-op with a console
   * warning, and the gesture would scroll the page as well as zoom the map.
   */
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      if (!rows.length || !event.deltaY) return
      event.preventDefault()
      const box = node.getBoundingClientRect()
      const x = event.clientX - box.left
      const y = event.clientY - box.top
      // Qt reports 120 units per notch; a DOM wheel event reports pixels, so only the
      // sign carries over and one notch is one step of the reference's 1.15 factor.
      const factor = 1.15 ** (event.deltaY > 0 ? -1 : 1)
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor))
      const virtualX = (x + pan.x) / zoom
      const virtualY = (y + pan.y) / zoom
      setZoom(next)
      setPan(clamp({ x: virtualX * next - x, y: virtualY * next - y }, next))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [rows, zoom, pan, clamp])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || zoom <= 1) return
      drag.current = {
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [zoom],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current
      if (!state) return
      const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
      if (!state.moved && distance < DRAG_THRESHOLD) return
      state.moved = true
      const dx = event.clientX - state.lastX
      const dy = event.clientY - state.lastY
      state.lastX = event.clientX
      state.lastY = event.clientY
      setPan((previous) => clamp({ x: previous.x - dx, y: previous.y - dy }, zoom))
    },
    [clamp, zoom],
  )

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // `mouseReleaseEvent` only selects when the press was not a drag. The click event
    // arrives *after* this, so whether it was a drag has to outlive the drag state.
    panned.current = Boolean(drag.current?.moved)
    drag.current = null
  }, [])

  if (!rows.length) {
    return (
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 items-center justify-center bg-bg text-2xs text-text-dim"
      >
        {empty}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`relative min-h-0 flex-1 overflow-hidden bg-bg ${
        zoom > 1 ? 'cursor-grab' : ''
      }`}
    >
      {layout.map((group) => {
        const box = project(group.rect)
        if (!visible(box) || box.width < 3 || box.height < 3) return null
        const headerBox = project({ ...group.rect, height: group.headerHeight })
        return (
          <div key={group.sector}>
            <div
              className="absolute rounded border border-border bg-surface-raised"
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            />
            {group.headerHeight ? (
              <div
                className="absolute flex items-center overflow-hidden px-1.5 text-2xs font-semibold whitespace-nowrap text-text"
                style={{
                  left: headerBox.left,
                  top: headerBox.top,
                  width: headerBox.width,
                  height: headerBox.height,
                }}
              >
                {group.sector} {(group.weight * 100).toFixed(1)}%
              </div>
            ) : null}

            {group.tiles.map(({ row, rect }) => {
              // `tile_rect.adjusted(1, 1, -1, -1)`: the gap between tiles is drawn, not
              // a margin, so it survives the zoom at the same one-pixel width.
              const tile = project({
                x: rect.x + 1,
                y: rect.y + 1,
                width: Math.max(0, rect.width - 2),
                height: Math.max(0, rect.height - 2),
              })
              if (!visible(tile) || tile.width < 1 || tile.height < 1) return null
              const unquoted = isUnquoted(row)
              const selected = row.symbol === selectedSymbol
              return (
                <div
                  key={row.symbol}
                  title={tooltipFor(row)}
                  onClick={() => {
                    if (!panned.current) onSelect(row)
                  }}
                  onDoubleClick={() => onActivate(row.symbol)}
                  className="absolute cursor-pointer overflow-hidden rounded-sm"
                  style={{
                    left: tile.left,
                    top: tile.top,
                    width: tile.width,
                    height: tile.height,
                    background: heatmapTileColor(row.changePct, palette),
                    // A no-quote tile is otherwise painted the same neutral as a genuine
                    // 0.00% mover, so missing data would read as flat. Outline it instead.
                    border: selected
                      ? '2px solid var(--color-accent-hover)'
                      : unquoted
                        ? '1px dashed var(--color-text-muted)'
                        : '1px solid var(--color-bg)',
                  }}
                >
                  {tile.width >= 34 && tile.height >= 22 ? (
                    <div className="px-1 pt-0.5 leading-tight">
                      <div className="truncate text-2xs font-semibold text-white">{row.symbol}</div>
                      {tile.height >= 40 && tile.width >= 46 ? (
                        <div className="num truncate text-2xs text-white/80">
                          {row.intervalLabel} {formatHeatmapPct(row.changePct, true)}
                        </div>
                      ) : null}
                      {row.name && zoom >= 1.35 && tile.height >= 58 && tile.width >= 90 ? (
                        <div className="truncate text-2xs text-white/65">{row.name}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
