import { useEffect, useMemo, useRef, useState } from 'react'

import type { GlobalIndexRow, GlobalInterval } from '@shared/contract'
import type { MarketStatus } from '@shared/globalMarkets'
import { performancePercent, thousands } from '@/lib/format'
import { FONT_FAMILY, FONTS, layoutLabels, type LabelInput } from './mapLayout'
import { layoutMobileMapLabels } from './mobileMapLayout'
import {
  loadWorldFeatures,
  mapRect,
  project,
  type MapRect,
  type WorldFeature,
} from './worldGeometry'

/** One index, with the session status the page derived for the current minute. */
export interface MappedRow extends GlobalIndexRow {
  status: MarketStatus
}

/**
 * The flat world map with a callout per index, ported from `GlobalMarketMapWidget`.
 *
 * Two layers over one measured rect. The land is a canvas: Natural Earth 1:50m is about
 * a hundred thousand vertices, and rebuilding that as SVG path data on every resize
 * would mean a multi-megabyte DOM attribute. The callouts are SVG on top, because they
 * carry text and tooltips — and because switching interval then repaints only them.
 */

interface Palette {
  background: string
  ocean: string
  grid: string
  land: string
  landBorder: string
  countryBorder: string
  text: string
  muted: string
  positive: string
  negative: string
  neutral: string
  labelBg: string
}

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** The theme is dark-only and static, so the palette is read once. */
function readPalette(): Palette {
  return {
    background: cssColor('--color-bg', '#080b12'),
    ocean: cssColor('--color-surface', '#0d1420'),
    grid: cssColor('--color-border', '#1e2b3f'),
    land: cssColor('--color-surface-raised', '#121b2b'),
    landBorder: cssColor('--color-border-strong', '#2c3e59'),
    countryBorder: cssColor('--color-border-strong', '#2c3e59'),
    text: cssColor('--color-text', '#d5dee9'),
    muted: cssColor('--color-text-dim', '#56677f'),
    positive: cssColor('--color-up', '#26c281'),
    negative: cssColor('--color-down', '#f0554e'),
    neutral: cssColor('--color-warn', '#d6b25e'),
    labelBg: cssColor('--color-surface', '#0d1420'),
  }
}

/** `QColor.setAlpha(135)` on the country borders, so they read as hairlines. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '')
  if (hex.length !== 6) return color
  const value = Number.parseInt(hex, 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

/* ---------------------------------------------------------- row rendering */

function performance(row: MappedRow, interval: GlobalInterval) {
  return row.intervals?.[interval]
}

/** `_row_color`: green above the dead band, red below it, amber inside it. */
function rowColor(row: MappedRow, interval: GlobalInterval, palette: Palette): string {
  const move = marketMove(row, interval)
  if (move === 'up') return palette.positive
  if (move === 'down') return palette.negative
  if (move === 'flat') return palette.neutral
  return palette.muted
}

export function marketMove(row: MappedRow, interval: GlobalInterval): 'up' | 'down' | 'flat' | 'unknown' {
  const payload = performance(row, interval)
  if (!payload?.available || typeof payload.changePct !== 'number' || !Number.isFinite(payload.changePct)) return 'unknown'
  if (payload.changePct > 0.05) return 'up'
  if (payload.changePct < -0.05) return 'down'
  return 'flat'
}

function pctText(row: MappedRow, interval: GlobalInterval): string {
  const payload = performance(row, interval)
  if (!payload?.available) return `${interval} --`
  return `${interval} ${performancePercent(payload.changePct)}`
}

function statusColor(row: MappedRow, palette: Palette): string {
  if (row.status.state === 'open') return palette.positive
  if (row.status.state === 'closed') return palette.negative
  return palette.muted
}

export function intradayRangePercent(row: Pick<GlobalIndexRow, 'dayLow' | 'dayHigh'>): string {
  const { dayLow, dayHigh } = row
  if (typeof dayLow !== 'number' || typeof dayHigh !== 'number' ||
    !Number.isFinite(dayLow) || !Number.isFinite(dayHigh) || dayLow <= 0 || dayHigh < dayLow) {
    return '--'
  }
  return `${((dayHigh - dayLow) / dayLow * 100).toFixed(2)}%`
}

export function intradayRangeText(row: Pick<GlobalIndexRow, 'dayLow' | 'dayHigh'>): string {
  return `Day range ${intradayRangePercent(row)}`
}

function tooltip(row: MappedRow, interval: GlobalInterval): string {
  const payload = performance(row, interval)
  const parts = [
    row.name || row.symbol || '--',
    `${row.country || '--'} | ${row.symbol || '--'}`,
    pctText(row, interval),
    `Intraday range (${row.lastDate || '--'}): ${thousands(row.dayLow)} – ${thousands(row.dayHigh)}`,
    `${intradayRangeText(row)} (high − low) / low × 100`,
    row.status.session,
    `Clock timezone: ${row.status.clockTimezone}`,
    `Exchange timezone: ${row.status.exchangeTimezone}`,
  ]
  if (payload?.available) parts.push(`${payload.startDate || '--'} -> ${payload.endDate || '--'}`)
  return parts.join('\n')
}

/* ------------------------------------------------------------- base layer */

function worldPaths(features: WorldFeature[], rect: MapRect): Path2D[] {
  const paths: Path2D[] = []
  for (const feature of features) {
    for (const polygon of feature.polygons ?? []) {
      const path = new Path2D()
      let drew = false
      for (const ring of polygon ?? []) {
        if (!Array.isArray(ring) || ring.length < 3) continue
        ring.forEach((coordinate, index) => {
          const { x, y } = project(coordinate[1], coordinate[0], rect)
          if (index === 0) path.moveTo(x, y)
          else path.lineTo(x, y)
        })
        path.closePath()
        drew = true
      }
      if (drew) paths.push(path)
    }
  }
  return paths
}

/** `paintEvent` minus the callouts: ocean, graticule, land, and the frame around it. */
function drawBase(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
  rect: MapRect,
  paths: Path2D[],
  palette: Palette,
  compact: boolean,
): void {
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.fillStyle = compact ? palette.ocean : palette.background
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.fillStyle = palette.ocean
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)

  ctx.lineWidth = 1
  ctx.strokeStyle = palette.grid
  ctx.beginPath()
  for (let lon = -150; lon <= 180; lon += 30) {
    const start = project(-85, lon, rect)
    const end = project(85, lon, rect)
    ctx.moveTo(start.x, compact ? size.height : start.y)
    ctx.lineTo(end.x, compact ? 0 : end.y)
  }
  for (let lat = -60; lat <= 90; lat += 30) {
    const start = project(lat, -180, rect)
    const end = project(lat, 180, rect)
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
  }
  ctx.stroke()

  if (!compact) {
    ctx.strokeStyle = palette.landBorder
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  }

  ctx.fillStyle = palette.land
  ctx.strokeStyle = withAlpha(palette.countryBorder, 135 / 255)
  for (const path of paths) {
    ctx.fill(path, 'evenodd')
    ctx.stroke(path)
  }
}

/* ------------------------------------------------------------- component */

export function WorldMap({
  rows,
  interval,
  mobile,
  className = '',
}: {
  rows: MappedRow[]
  interval: GlobalInterval
  mobile?: {
    detailsId: string
    selectedSymbol?: string
    onSelect: (symbol: string, anchor: HTMLButtonElement) => void
  }
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [features, setFeatures] = useState<WorldFeature[] | null>(null)
  const palette = useMemo(readPalette, [])
  const ready = size.width > 0 && size.height > 0

  useEffect(() => {
    let alive = true
    void loadWorldFeatures().then((loaded) => {
      if (alive) setFeatures(loaded)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setSize({ width: Math.round(box.width), height: Math.round(box.height) })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const compact = Boolean(mobile)
  const rect = useMemo(() => {
    if (!compact) return mapRect(size.width, size.height)
    // Center the geography behind the callouts and crop the untracked Antarctic band.
    const height = Math.min(size.height, Math.max(size.width / 2.4, size.height * 0.78))
    return { x: 0, y: (size.height - height) / 2, width: size.width, height: height * 180 / 150 }
  }, [compact, size])
  // `_world_paths`: reprojecting the whole world is the expensive part, so it is redone
  // only when the drawable rect actually changes.
  const paths = useMemo(() => (features ? worldPaths(features, rect) : []), [features, rect])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    // Back the canvas at device resolution, or the coastlines blur on a HiDPI display.
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * ratio)
    canvas.height = Math.round(size.height * ratio)
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawBase(context, size, rect, paths, palette, compact)
  }, [ready, size, rect, paths, palette, compact])

  const labels = useMemo(() => {
    if (!ready || compact || !rows.length) return []
    const inputs: LabelInput[] = rows.map((row) => ({
      key: row.symbol,
      point: project(row.lat, row.lon, rect),
      labelDx: row.labelDx,
      labelDy: row.labelDy,
      country: row.country || '--',
      label: row.shortName || row.name || row.symbol || '--',
      // `_status_line_text`: the market word only appears when there is timing for it.
      statusText: row.status.market.trim()
        ? `${row.status.market} | ${pctText(row, interval)}`
        : pctText(row, interval),
      showStatus: Boolean(row.status.market.trim()),
      rangeText: intradayRangeText(row),
      changeColor: rowColor(row, interval, palette),
      statusColor: statusColor(row, palette),
    }))
    return layoutLabels(inputs, rect)
  }, [ready, compact, rows, interval, rect, palette])

  const tooltips = useMemo(
    () => new Map(compact ? [] : rows.map((row) => [row.symbol, tooltip(row, interval)])),
    [compact, rows, interval],
  )
  const mobileLabels = useMemo(() => {
    if (!ready || !compact) return []
    const points = rows.map((row) => ({ row, symbol: row.symbol, lon: row.lon, point: project(row.lat, row.lon, rect) }))
    return layoutMobileMapLabels(points, size.width, size.height)
  }, [ready, compact, rows, rect, size])

  return (
    <div ref={containerRef} className={`relative min-h-0 flex-1 overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />

      {features !== null && !features.length ? (
        <p className="absolute inset-x-0 top-1/2 text-center text-2xs text-text-dim">
          Map geometry unavailable.
        </p>
      ) : null}

      <svg
        className="absolute inset-0 h-full w-full"
        width={size.width}
        height={size.height}
        viewBox={ready ? `0 0 ${size.width} ${size.height}` : undefined}
        role="img"
        aria-label="Global market index map"
        aria-hidden={compact || undefined}
      >
        {mobileLabels.map(({ symbol, point, rect: box, row }) => (
          <g key={symbol} opacity={symbol === mobile?.selectedSymbol ? 1 : 0.76}>
            <line x1={point.x} y1={point.y}
              x2={Math.max(box.x, Math.min(point.x, box.x + box.width))}
              y2={Math.max(box.y, Math.min(point.y, box.y + box.height))}
              stroke={rowColor(row, interval, palette)} strokeWidth={1} />
            <circle cx={point.x} cy={point.y} r={symbol === mobile?.selectedSymbol ? 4.5 : 3}
              fill={rowColor(row, interval, palette)} stroke={palette.background} strokeWidth={1} />
          </g>
        ))}
        {/* Leaders first, then boxes over them, then pins on top — `_draw_markers`. */}
        <g>
          {labels
            .filter((label) => label.leaderVisible)
            .map((label) => (
              <line
                key={label.key}
                x1={label.point.x}
                y1={label.point.y}
                x2={label.leaderEnd.x}
                y2={label.leaderEnd.y}
                stroke={label.changeColor}
                strokeWidth={1}
              />
            ))}
        </g>

        {labels.map((label) => (
          <g key={label.key}>
            <title>{tooltips.get(label.key)}</title>
            <rect
              x={label.rect.x}
              y={label.rect.y}
              width={label.rect.width}
              height={label.rect.height}
              rx={4}
              ry={4}
              fill={palette.labelBg}
              stroke={label.changeColor}
              strokeWidth={1}
            />
            <text
              x={label.rows.country.x}
              y={label.rows.country.y}
              fill={palette.text}
              fontFamily={FONT_FAMILY}
              fontSize={FONTS.country.size}
              fontWeight={FONTS.country.weight}
              dominantBaseline="text-before-edge"
            >
              {label.lines.country}
            </text>
            <text
              x={label.rows.label.x}
              y={label.rows.label.y}
              fill={palette.text}
              fontFamily={FONT_FAMILY}
              fontSize={FONTS.title.size}
              dominantBaseline="text-before-edge"
            >
              {label.lines.label}
            </text>
            {label.showStatus ? (
              <circle cx={label.dot.x} cy={label.dot.y} r={3.5} fill={label.statusColor} />
            ) : null}
            <text
              x={label.rows.status.x}
              y={label.rows.status.y}
              fill={label.changeColor}
              fontFamily={FONT_FAMILY}
              fontSize={FONTS.detail.size}
              dominantBaseline="text-before-edge"
            >
              {label.lines.status}
            </text>
            <text
              x={label.rows.range.x}
              y={label.rows.range.y}
              fill={palette.text}
              fontFamily={FONT_FAMILY}
              fontSize={FONTS.detail.size}
              dominantBaseline="text-before-edge"
            >
              {label.lines.range}
            </text>
          </g>
        ))}

        <g>
          {labels.map((label) => (
            <circle
              key={label.key}
              cx={label.point.x}
              cy={label.point.y}
              r={5}
              fill={label.changeColor}
              stroke={palette.background}
              strokeWidth={2}
            />
          ))}
        </g>
      </svg>
      {mobile && mobileLabels.map(({ symbol, rect: box, row }) => {
        const change = performance(row, interval)
        return (
          <button key={symbol} type="button" className="global-mobile-callout" data-symbol={symbol}
            data-move={marketMove(row, interval)} onClick={(event) => mobile.onSelect(symbol, event.currentTarget)}
            aria-expanded={symbol === mobile.selectedSymbol} aria-controls={mobile.detailsId}
            style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
            <strong>{row.country}</strong>
            <span>{row.shortName || row.name || row.symbol}</span>
            <span className="global-mobile-change">{performancePercent(change?.available ? change.changePct : null)}</span>
          </button>
        )
      })}
    </div>
  )
}
