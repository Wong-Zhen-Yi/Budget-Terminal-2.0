/**
 * Callout placement for the Global map, ported from `_layout_labels` and its helpers in
 * the PySide6 `widgets/global_market_map.py`.
 *
 * Seventeen boxes have to sit on a world map without covering each other, without
 * covering somebody else's pin, and with leader lines that do not cross. The reference
 * solves that with a scored candidate list and a four-stage fallback ladder, and the
 * clean result is worth porting exactly rather than approximating.
 */

import type { MapRect, Point } from './worldGeometry'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Fonts for the three lines of a callout.
 *
 * Canvas and SVG text does not follow `--text-2xs` in `styles/theme.css`, so these move
 * by hand when the type scale does — the same caveat as `PriceChart`'s `fontSize`. Sizes
 * also feed the box widths, so growing them crowds the map.
 */
export const FONT_FAMILY = "'Segoe UI', system-ui, sans-serif"

export interface FontSpec {
  css: string
  size: number
  weight: number
  /** `QFontMetrics.height()`: the line box, not the em size. */
  height: number
}

function font(size: number, weight: number): FontSpec {
  return { css: `${weight} ${size}px ${FONT_FAMILY}`, size, weight, height: Math.round(size * 1.33) }
}

export const FONTS = {
  country: font(13, 700),
  title: font(12, 400),
  detail: font(12, 400),
} as const

let measureContext: CanvasRenderingContext2D | null = null
const measureCache = new Map<string, number>()

/** `QFontMetrics.horizontalAdvance`, via one offscreen canvas shared by the module. */
export function textWidth(text: string, spec: FontSpec): number {
  const key = `${spec.css}\u0000${text}`
  const hit = measureCache.get(key)
  if (hit !== undefined) return hit
  measureContext ??= document.createElement('canvas').getContext('2d')
  if (!measureContext) return text.length * spec.size * 0.55
  measureContext.font = spec.css
  const width = measureContext.measureText(text).width
  measureCache.set(key, width)
  return width
}

/** `QFontMetrics.elidedText(..., ElideRight)`. */
export function elide(text: string, maxWidth: number, spec: FontSpec): string {
  if (maxWidth <= 0) return ''
  if (textWidth(text, spec) <= maxWidth) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (textWidth(`${text.slice(0, middle)}…`, spec) <= maxWidth) low = middle
    else high = middle - 1
  }
  return low > 0 ? `${text.slice(0, low)}…` : '…'
}

/* --------------------------------------------------------------- geometry */

const left = (rect: Rect): number => rect.x
const top = (rect: Rect): number => rect.y
const right = (rect: Rect): number => rect.x + rect.width
const bottom = (rect: Rect): number => rect.y + rect.height

/** `QRectF.adjusted`. */
function adjusted(rect: Rect, dx1: number, dy1: number, dx2: number, dy2: number): Rect {
  return {
    x: rect.x + dx1,
    y: rect.y + dy1,
    width: rect.width + (dx2 - dx1),
    height: rect.height + (dy2 - dy1),
  }
}

/** `QRectF.intersects`: overlapping area, touching edges do not count. */
function intersects(a: Rect, b: Rect): boolean {
  return left(a) < right(b) && left(b) < right(a) && top(a) < bottom(b) && top(b) < bottom(a)
}

/** `QRectF.contains(QPointF)`: inside or on the edge. */
function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= left(rect) && point.x <= right(rect) && point.y >= top(rect) && point.y <= bottom(rect)
  )
}

function hypot(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function orientation(first: Point, second: Point, third: Point): number {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  return (
    Math.min(start.x, end.x) - 0.0001 <= point.x &&
    point.x <= Math.max(start.x, end.x) + 0.0001 &&
    Math.min(start.y, end.y) - 0.0001 <= point.y &&
    point.y <= Math.max(start.y, end.y) + 0.0001
  )
}

function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const epsilon = 0.0001
  const first = orientation(a1, a2, b1)
  const second = orientation(a1, a2, b2)
  const third = orientation(b1, b2, a1)
  const fourth = orientation(b1, b2, a2)
  if (first * second < -epsilon && third * fourth < -epsilon) return true
  if (Math.abs(first) <= epsilon && pointOnSegment(b1, a1, a2)) return true
  if (Math.abs(second) <= epsilon && pointOnSegment(b2, a1, a2)) return true
  if (Math.abs(third) <= epsilon && pointOnSegment(a1, b1, b2)) return true
  if (Math.abs(fourth) <= epsilon && pointOnSegment(a2, b1, b2)) return true
  return false
}

type Segment = [Point, Point]

function segmentIntersectsRect(segment: Segment, rect: Rect): boolean {
  const [start, end] = segment
  if (containsPoint(rect, start) || containsPoint(rect, end)) return true
  const topLeft = { x: left(rect), y: top(rect) }
  const topRight = { x: right(rect), y: top(rect) }
  const bottomRight = { x: right(rect), y: bottom(rect) }
  const bottomLeft = { x: left(rect), y: bottom(rect) }
  const edges: Segment[] = [
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ]
  return edges.some(([edgeStart, edgeEnd]) => segmentsIntersect(start, end, edgeStart, edgeEnd))
}

/** The pin every label has to stay clear of, `_pin_hit_rect`. */
export const PIN_RADIUS = 8

function pinHitRect(point: Point): Rect {
  return { x: point.x - PIN_RADIUS, y: point.y - PIN_RADIUS, width: PIN_RADIUS * 2, height: PIN_RADIUS * 2 }
}

function rectsNearlyEqual(first: Rect, second: Rect): boolean {
  return (
    Math.abs(first.x - second.x) <= 0.001 &&
    Math.abs(first.y - second.y) <= 0.001 &&
    Math.abs(first.width - second.width) <= 0.001 &&
    Math.abs(first.height - second.height) <= 0.001
  )
}

/** `_leader_endpoint`: the pin's own position, clamped onto the label box. */
function leaderEndpoint(point: Point, rect: Rect): Point {
  return {
    x: Math.min(Math.max(point.x, left(rect)), right(rect)),
    y: Math.min(Math.max(point.y, top(rect)), bottom(rect)),
  }
}

/* -------------------------------------------------------------- placement */

function clampedRect(x: number, y: number, width: number, height: number, area: MapRect): Rect {
  return {
    x: Math.min(Math.max(x, area.x + 4), area.x + area.width - width - 4),
    y: Math.min(Math.max(y, area.y + 4), area.y + area.height - height - 4),
    width,
    height,
  }
}

function labelCollides(rect: Rect, occupied: Rect[]): boolean {
  const padded = adjusted(rect, -6, -6, 6, 6)
  return occupied.some((other) => intersects(padded, adjusted(other, -6, -6, 6, 6)))
}

function labelIntersects(rect: Rect, occupied: Rect[]): boolean {
  return occupied.some((other) => intersects(rect, other))
}

function labelCoversPin(rect: Rect, point: Point, protectedPins: Rect[]): boolean {
  const labelRect = adjusted(rect, -1, -1, 1, 1)
  const own = pinHitRect(point)
  return protectedPins.some((pin) => !rectsNearlyEqual(pin, own) && intersects(labelRect, pin))
}

function leaderConflicts(rect: Rect, point: Point, occupied: Rect[], leaders: Segment[]): boolean {
  const leader: Segment = [point, leaderEndpoint(point, rect)]
  if (occupied.some((other) => segmentIntersectsRect(leader, adjusted(other, -2, -2, 2, 2)))) {
    return true
  }
  const padded = adjusted(rect, -2, -2, 2, 2)
  return leaders.some(
    (other) =>
      segmentIntersectsRect(other, padded) ||
      segmentsIntersect(leader[0], leader[1], other[0], other[1]),
  )
}

function coversExistingLeader(rect: Rect, leaders: Segment[]): boolean {
  const padded = adjusted(rect, -2, -2, 2, 2)
  return leaders.some((leader) => segmentIntersectsRect(leader, padded))
}

function labelConflicts(
  rect: Rect,
  point: Point,
  occupied: Rect[],
  leaders: Segment[],
  protectedPins: Rect[],
): boolean {
  if (labelCollides(rect, occupied)) return true
  if (labelCoversPin(rect, point, protectedPins)) return true
  return leaderConflicts(rect, point, occupied, leaders)
}

/** `_label_score`: stay near the hand-tuned offset, keep the leader short, avoid edges. */
function labelScore(rect: Rect, point: Point, preferred: Rect, area: MapRect): number {
  const preferredDistance = Math.abs(rect.x - preferred.x) + Math.abs(rect.y - preferred.y)
  const leaderDistance = hypot(leaderEndpoint(point, rect), point)
  let edgePenalty = 0
  if (left(rect) <= area.x + 5 || right(rect) >= area.x + area.width - 5) edgePenalty += 24
  if (top(rect) <= area.y + 5 || bottom(rect) >= area.y + area.height - 5) edgePenalty += 24
  return preferredDistance * 1.55 + leaderDistance * 0.6 + edgePenalty
}

/**
 * Every position worth trying, best first: the configured offset, the same offset slid
 * up and down, a ring of fixed placements around the pin, then widening arcs.
 *
 * `Math.trunc(labelDx) || 12` reproduces `int(row.get("label_dx", 12) or 12)` — a
 * **zero** offset counts as unset and falls back to 12/-18.
 */
function labelCandidates(
  point: Point,
  width: number,
  height: number,
  labelDx: number,
  labelDy: number,
  area: MapRect,
): Rect[] {
  const preferredDx = Math.trunc(labelDx) || 12
  const preferredDy = Math.trunc(labelDy) || -18
  const offsets: Array<[number, number]> = [[preferredDx, preferredDy]]
  for (const shift of [-60, 60, -120, 120, -180, 180]) {
    offsets.push([preferredDx, preferredDy + shift])
  }
  offsets.push(
    [14, -height - 10],
    [14, 10],
    [14, -height / 2],
    [-width - 14, -height - 10],
    [-width - 14, 10],
    [-width - 14, -height / 2],
    [-width / 2, -height - 14],
    [-width / 2, 14],
    [46, -height - 18],
    [46, 18],
    [-width - 46, -height - 18],
    [-width - 46, 18],
  )
  for (const radius of [54, 78, 104, 132, 164, 198, 236, 276]) {
    for (const angle of [-165, -135, -105, -75, -45, -15, 15, 45, 75, 105, 135, 165, 180]) {
      const radians = (angle * Math.PI) / 180
      offsets.push([Math.cos(radians) * radius - width / 2, Math.sin(radians) * radius - height / 2])
    }
  }

  const preferred = clampedRect(point.x + preferredDx, point.y + preferredDy, width, height, area)
  const unique = new Map<string, Rect>()
  for (const [dx, dy] of offsets) {
    const rect = clampedRect(point.x + dx, point.y + dy, width, height, area)
    // A box sitting on top of its own pin is never a candidate.
    if (containsPoint(adjusted(rect, -4, -4, 4, 4), point)) continue
    unique.set(`${Math.round(rect.x)},${Math.round(rect.y)}`, rect)
  }
  return [...unique.values()].sort(
    (a, b) => labelScore(a, point, preferred, area) - labelScore(b, point, preferred, area),
  )
}

/** `_find_open_label_rect`: scan the map for the nearest gap that will take the box. */
function findOpenLabelRect(
  point: Point,
  width: number,
  height: number,
  area: MapRect,
  occupied: Rect[],
  leaders: Segment[],
  protectedPins: Rect[],
  { requireLeader, tight = false }: { requireLeader: boolean; tight?: boolean },
): Rect | null {
  const startX = Math.trunc(area.x + 4)
  const endX = Math.trunc(area.x + area.width - width - 4)
  const startY = Math.trunc(area.y + 4)
  const endY = Math.trunc(area.y + area.height - height - 4)
  if (endX < startX || endY < startY) {
    return clampedRect(area.x + 4, area.y + 4, width, height, area)
  }

  let best: { score: number; rect: Rect } | null = null
  for (let y = startY; y <= endY; y += 5) {
    for (let x = startX; x <= endX; x += 6) {
      const rect: Rect = { x, y, width, height }
      if (containsPoint(adjusted(rect, -4, -4, 4, 4), point)) continue
      if (tight ? labelIntersects(rect, occupied) : labelCollides(rect, occupied)) continue
      if (labelCoversPin(rect, point, protectedPins)) continue
      if (coversExistingLeader(rect, leaders)) continue
      if (requireLeader && leaderConflicts(rect, point, occupied, leaders)) continue

      let score = Math.abs(x + width / 2 - point.x) + Math.abs(y + height / 2 - point.y) * 1.2
      if (left(rect) <= area.x + 5 || right(rect) >= area.x + area.width - 5) score += 24
      if (top(rect) <= area.y + 5 || bottom(rect) >= area.y + area.height - 5) score += 24
      if (!best || score < best.score) best = { score, rect }
    }
  }
  return best?.rect ?? null
}

/** Last resort: tile the boxes across the top of the map rather than drop any. */
function stackedLabelRect(width: number, height: number, area: MapRect, index: number): Rect {
  const gap = 6
  const columns = Math.max(1, Math.floor((area.width - 8) / Math.max(width + gap, 1)))
  return clampedRect(
    area.x + 4 + (index % columns) * (width + gap),
    area.y + 4 + Math.floor(index / columns) * (height + gap),
    width,
    height,
    area,
  )
}

/** The reference's four-stage ladder: relax one constraint at a time, never drop a box. */
function placeLabel(
  point: Point,
  width: number,
  height: number,
  labelDx: number,
  labelDy: number,
  area: MapRect,
  occupied: Rect[],
  leaders: Segment[],
  protectedPins: Rect[],
): Rect {
  const candidates = labelCandidates(point, width, height, labelDx, labelDy, area)
  for (const rect of candidates) {
    if (!labelConflicts(rect, point, occupied, leaders, protectedPins)) return rect
  }
  for (const rect of candidates) {
    if (!labelCollides(rect, occupied) && !labelCoversPin(rect, point, protectedPins)) return rect
  }
  for (const rect of candidates) {
    if (!labelIntersects(rect, occupied) && !labelCoversPin(rect, point, protectedPins)) return rect
  }
  const ladder: Array<{ requireLeader: boolean; tight?: boolean }> = [
    { requireLeader: true },
    { requireLeader: false },
    { requireLeader: false, tight: true },
  ]
  for (const options of ladder) {
    const rect = findOpenLabelRect(point, width, height, area, occupied, leaders, protectedPins, options)
    if (rect) return rect
  }
  return stackedLabelRect(width, height, area, occupied.length)
}

/* ----------------------------------------------------------------- layout */

export interface LabelInput {
  key: string
  point: Point
  labelDx: number
  labelDy: number
  country: string
  label: string
  statusText: string
  /** Whether the status line leads with a coloured open/closed dot. */
  showStatus: boolean
  changeColor: string
  statusColor: string
}

export interface PlacedLabel {
  key: string
  point: Point
  rect: Rect
  leaderEnd: Point
  leaderVisible: boolean
  changeColor: string
  statusColor: string
  showStatus: boolean
  /** Already elided to their boxes. */
  lines: { country: string; label: string; status: string }
  /** Top-aligned text rows inside the box, from `_draw_markers`. */
  rows: { country: Rect; label: Rect; status: Rect }
  dot: Point
}

/** Width the status dot steals from its line. */
const DOT_INSET = 13

/**
 * Place every callout.
 *
 * The crowded pins go first — a label in the middle of Europe has far fewer usable
 * positions than one over the Pacific, so it gets to claim its spot before the roomy
 * ones fence it in.
 */
export function layoutLabels(inputs: LabelInput[], area: MapRect): PlacedLabel[] {
  const occupied: Rect[] = []
  const leaders: Segment[] = []
  const protectedPins = inputs.map((item) => pinHitRect(item.point))
  const height = FONTS.country.height + FONTS.title.height + FONTS.detail.height + 12

  const crowding = inputs.map((item, index) =>
    inputs.reduce(
      (sum, other, otherIndex) =>
        otherIndex === index ? sum : sum + Math.max(0, 1 - hypot(item.point, other.point) / 140),
      0,
    ),
  )
  const order = inputs
    .map((_, index) => index)
    .sort((a, b) => crowding[b] - crowding[a] || a - b)

  const placed: PlacedLabel[] = []
  for (const index of order) {
    const item = inputs[index]
    const widest = Math.max(
      textWidth(item.country, FONTS.country),
      textWidth(item.label, FONTS.title),
      textWidth(item.statusText, FONTS.detail) + (item.showStatus ? DOT_INSET : 0),
    )
    const width = Math.min(Math.max(widest + 16, 70), 150)

    const rect = placeLabel(
      item.point, width, height, item.labelDx, item.labelDy, area, occupied, leaders, protectedPins,
    )
    const leaderEnd = leaderEndpoint(item.point, rect)
    // Read before the box joins `occupied`: a leader never conflicts with its own label.
    const leaderVisible = !leaderConflicts(rect, item.point, occupied, leaders)
    occupied.push(rect)
    if (leaderVisible) leaders.push([item.point, leaderEnd])

    const textLeft = left(rect) + 7
    const textSpan = rect.width - 14
    const country: Rect = { x: textLeft, y: top(rect) + 4, width: textSpan, height: FONTS.country.height + 1 }
    const label: Rect = { x: textLeft, y: bottom(country) - 1, width: textSpan, height: FONTS.title.height + 1 }
    const status: Rect = { x: textLeft, y: bottom(label), width: textSpan, height: FONTS.detail.height + 1 }
    const statusSpan = item.showStatus ? Math.max(1, status.width - DOT_INSET) : status.width

    placed.push({
      key: item.key,
      point: item.point,
      rect,
      leaderEnd,
      leaderVisible,
      changeColor: item.changeColor,
      statusColor: item.statusColor,
      showStatus: item.showStatus,
      lines: {
        country: elide(item.country, textSpan, FONTS.country),
        label: elide(item.label, textSpan, FONTS.title),
        status: elide(item.statusText, statusSpan, FONTS.detail),
      },
      rows: {
        country,
        label,
        status: item.showStatus ? { ...status, x: status.x + DOT_INSET, width: statusSpan } : status,
      },
      dot: { x: status.x + 4, y: status.y + Math.max(5, FONTS.detail.height / 2) },
    })
  }
  return placed
}
