// Deterministic candlestick synthesis for the chart-pattern cheat sheet.
//
// A pattern is defined by its skeleton — the pivots that make it that pattern and
// nothing else — in a normalised space of t (0..1 across the example) by price (0..100).
// synthesizeCandles walks that skeleton into OHLC bars: the price path is the
// piecewise-linear pivot curve, the wobble around it is damped to zero at every named
// extreme, and each extreme candle is then shifted so its wick tips the pivot exactly.
// That is what puts a peak on the resistance guide rather than near it.
//
// Everything here is pure and seeded, so the renderer, the probes and the PNG script
// all draw the same bars. No Electron, React or Node imports.

export interface PatternCandle {
  open: number
  high: number
  low: number
  close: number
}

export type PatternPivotKind = 'peak' | 'trough' | 'path'

export interface PatternPivot {
  t: number
  price: number
  kind: PatternPivotKind
}

export type PatternGuideKind = 'level' | 'boundary' | 'neckline'

export interface PatternGuide {
  start: [number, number]
  end: [number, number]
  label: string
  kind: PatternGuideKind
}

export interface PatternMarker {
  x: number
  label: string
}

export interface PatternSkeleton {
  pivots: PatternPivot[]
  guides: PatternGuide[]
  breakout?: PatternMarker
}

export interface PatternVariant {
  id: string
  label: string
  caption: string
  bars: number
  seed: number
  noise: number
  shape: number
}

/** One drawable example. Guide and marker x values are candle indexes, not t. */
export interface ChartPatternExample {
  id: string
  label: string
  caption: string
  candles: PatternCandle[]
  guides: PatternGuide[]
  breakout?: PatternMarker
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

export function mix(a: number, b: number, weight: number): number {
  return a + (b - a) * weight
}

export function peak(t: number, price: number): PatternPivot {
  return { t, price, kind: 'peak' }
}

export function trough(t: number, price: number): PatternPivot {
  return { t, price, kind: 'trough' }
}

export function via(t: number, price: number): PatternPivot {
  return { t, price, kind: 'path' }
}

/** A straight boundary as a function of t, so a triangle reads as its own rule. */
export function boundary(t0: number, p0: number, t1: number, p1: number): (t: number) => number {
  return (t) => p0 + ((p1 - p0) * (t - t0)) / (t1 - t0)
}

/** Alternating touches of two boundaries — every triangle, wedge, channel and rectangle. */
export function oscillate(
  t0: number,
  t1: number,
  count: number,
  upper: (t: number) => number,
  lower: (t: number) => number,
  startUpper = true,
): PatternPivot[] {
  const pivots: PatternPivot[] = []
  for (let index = 0; index < count; index += 1) {
    const t = t0 + ((t1 - t0) * index) / (count - 1)
    const onUpper = startUpper ? index % 2 === 0 : index % 2 === 1
    pivots.push(onUpper ? peak(t, upper(t)) : trough(t, lower(t)))
  }
  return pivots
}

/**
 * A saucer or dome: depth at the middle, rim at both ends.
 *
 * `edges: 'extreme'` names the two rim points as pivots as well, which is what pins a
 * bar's wick to the rim line on each side of the cup. Left as plain path points the rim
 * is a level the bars only pass near, and the guide describes nothing.
 */
export function arc(
  t0: number,
  t1: number,
  rim: number,
  depth: number,
  steps = 12,
  edges: 'extreme' | 'path' = 'path',
): PatternPivot[] {
  const bowl = rim > depth
  const pivots: PatternPivot[] = []
  for (let index = 0; index <= steps; index += 1) {
    const u = index / steps
    const price = depth + (rim - depth) * (2 * u - 1) ** 2
    const t = mix(t0, t1, u)
    const middle = index * 2 === steps
    const edge = edges === 'extreme' && (index === 0 || index === steps)
    if (middle) pivots.push(bowl ? trough(t, price) : peak(t, price))
    else if (edge) pivots.push(bowl ? peak(t, price) : trough(t, price))
    else pivots.push(via(t, price))
  }
  return pivots
}

const FLIPPED_LABELS: Record<string, string> = {
  Resistance: 'Support',
  Support: 'Resistance',
  'Rising lows': 'Falling highs',
  'Falling highs': 'Rising lows',
  'Flag high': 'Flag low',
  'Flag low': 'Flag high',
  'Upper boundary': 'Lower boundary',
  'Lower boundary': 'Upper boundary',
  'Upper channel': 'Lower channel',
  'Lower channel': 'Upper channel',
  'Cup rim': 'Cup base',
  'Cup base': 'Cup rim',
  Rim: 'Base',
  Base: 'Rim',
  Breakout: 'Breakdown',
  Breakdown: 'Breakout',
}

function flipLabel(label: string): string {
  return FLIPPED_LABELS[label] ?? label
}

/** Mirror a skeleton about the 50 line. Every bearish twin in the catalog is built this way. */
export function mirrorSkeleton(skeleton: PatternSkeleton): PatternSkeleton {
  return {
    pivots: skeleton.pivots.map((pivot) => ({
      t: pivot.t,
      price: 100 - pivot.price,
      kind: pivot.kind === 'peak' ? 'trough' : pivot.kind === 'trough' ? 'peak' : 'path',
    })),
    guides: skeleton.guides.map((guide) => ({
      start: [guide.start[0], 100 - guide.start[1]] as [number, number],
      end: [guide.end[0], 100 - guide.end[1]] as [number, number],
      label: flipLabel(guide.label),
      kind: guide.kind,
    })),
    breakout: skeleton.breakout
      ? { x: skeleton.breakout.x, label: flipLabel(skeleton.breakout.label) }
      : undefined,
  }
}

function sampleCurve(pivots: PatternPivot[], t: number): number {
  if (t <= pivots[0].t) return pivots[0].price
  const last = pivots[pivots.length - 1]
  if (t >= last.t) return last.price
  for (let index = 1; index < pivots.length; index += 1) {
    const right = pivots[index]
    if (t > right.t) continue
    const left = pivots[index - 1]
    const width = right.t - left.t
    if (width <= 0) return right.price
    return left.price + ((right.price - left.price) * (t - left.t)) / width
  }
  return last.price
}

function dampFactor(extremes: PatternPivot[], t: number, bars: number): number {
  let nearest = Number.POSITIVE_INFINITY
  for (const pivot of extremes) nearest = Math.min(nearest, Math.abs(pivot.t - t) * (bars - 1))
  return clamp(nearest / 2, 0, 1)
}

function shiftCandle(candle: PatternCandle, delta: number): PatternCandle {
  return {
    open: candle.open + delta,
    high: candle.high + delta,
    low: candle.low + delta,
    close: candle.close + delta,
  }
}

export function synthesizeCandles(skeleton: PatternSkeleton, variant: PatternVariant): PatternCandle[] {
  const bars = variant.bars
  const random = mulberry32(variant.seed)
  const prices = skeleton.pivots.map((pivot) => pivot.price)
  const span = Math.max(...prices) - Math.min(...prices) || 1
  const amplitude = span * 0.028 * variant.noise
  const extremes = skeleton.pivots.filter((pivot) => pivot.kind !== 'path')

  const closes: number[] = []
  for (let index = 0; index < bars; index += 1) {
    const t = index / (bars - 1)
    const damp = dampFactor(extremes, t, bars)
    closes.push(sampleCurve(skeleton.pivots, t) + (random() * 2 - 1) * amplitude * 1.6 * damp)
  }

  const candles: PatternCandle[] = []
  for (let index = 0; index < bars; index += 1) {
    const close = closes[index]
    const open =
      index === 0 ? close - amplitude * 0.8 : closes[index - 1] + (random() * 2 - 1) * amplitude * 0.25
    const top = Math.max(open, close)
    const bottom = Math.min(open, close)
    candles.push({
      open,
      close,
      high: top + amplitude * (0.3 + random() * 0.9),
      low: bottom - amplitude * (0.3 + random() * 0.9),
    })
  }

  for (const pivot of extremes) {
    const index = clamp(Math.round(pivot.t * (bars - 1)), 0, bars - 1)
    const candle = candles[index]
    const delta = pivot.kind === 'peak' ? pivot.price - candle.high : pivot.price - candle.low
    candles[index] = shiftCandle(candle, delta)
  }

  return candles
}

export function buildExample(skeleton: PatternSkeleton, variant: PatternVariant): ChartPatternExample {
  const candles = synthesizeCandles(skeleton, variant)
  const toIndex = (t: number) => clamp(t, 0, 1) * (variant.bars - 1)
  return {
    id: variant.id,
    label: variant.label,
    caption: variant.caption,
    candles,
    guides: skeleton.guides.map((guide) => ({
      start: [toIndex(guide.start[0]), guide.start[1]] as [number, number],
      end: [toIndex(guide.end[0]), guide.end[1]] as [number, number],
      label: guide.label,
      kind: guide.kind,
    })),
    breakout: skeleton.breakout
      ? { x: toIndex(skeleton.breakout.x), label: skeleton.breakout.label }
      : undefined,
  }
}

// ---------------------------------------------------------------------------
// Layout — shared by the SVG components and the PNG rasterizer so the two agree.
// ---------------------------------------------------------------------------

export interface PatternLayoutBox {
  width: number
  height: number
  padTop: number
  padRight: number
  padBottom: number
  padLeft: number
  /** Minimum vertical distance between two guide labels. */
  labelGap?: number
}

export interface LaidCandle {
  x: number
  halfWidth: number
  bodyTop: number
  bodyBottom: number
  wickTop: number
  wickBottom: number
  up: boolean
}

export interface LaidGuide {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Where the label goes. On a converging pair the two line ends nearly coincide, so
   *  labels are spread apart here rather than printed on top of each other. */
  labelY: number
  label: string
  kind: PatternGuideKind
}

export interface PatternLayout {
  box: PatternLayoutBox
  candles: LaidCandle[]
  guides: LaidGuide[]
  breakout?: { x: number; label: string }
  gridlines: number[]
}

/** Push overlapping labels apart, then pull the run back inside the box. */
function spreadLabels(guides: LaidGuide[], gap: number, height: number): void {
  const ordered = [...guides].sort((a, b) => a.labelY - b.labelY)
  for (let index = 1; index < ordered.length; index += 1) {
    ordered[index].labelY = Math.max(ordered[index].labelY, ordered[index - 1].labelY + gap)
  }
  const last = ordered[ordered.length - 1]
  const overflow = last ? last.labelY - (height - gap / 2) : 0
  if (overflow > 0) for (const guide of ordered) guide.labelY -= overflow
}

export function layoutPattern(example: ChartPatternExample, box: PatternLayoutBox): PatternLayout {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const candle of example.candles) {
    low = Math.min(low, candle.low)
    high = Math.max(high, candle.high)
  }
  for (const guide of example.guides) {
    low = Math.min(low, guide.start[1], guide.end[1])
    high = Math.max(high, guide.start[1], guide.end[1])
  }
  const pad = (high - low) * 0.08 || 1
  low -= pad
  high += pad

  const plotTop = box.padTop
  const plotHeight = box.height - box.padTop - box.padBottom
  const plotLeft = box.padLeft
  const plotWidth = box.width - box.padLeft - box.padRight
  const priceToY = (price: number) => plotTop + ((high - price) / (high - low)) * plotHeight

  const slot = plotWidth / example.candles.length
  const halfWidth = Math.max(0.75, slot * 0.32)
  const indexToX = (index: number) => plotLeft + slot * (index + 0.5)

  const candles = example.candles.map((candle, index) => {
    const bodyTop = priceToY(Math.max(candle.open, candle.close))
    const bodyBottom = priceToY(Math.min(candle.open, candle.close))
    return {
      x: indexToX(index),
      halfWidth,
      bodyTop,
      bodyBottom: Math.max(bodyBottom, bodyTop + 0.9),
      wickTop: priceToY(candle.high),
      wickBottom: priceToY(candle.low),
      up: candle.close >= candle.open,
    }
  })

  const guides: LaidGuide[] = example.guides.map((guide) => {
    const y2 = priceToY(guide.end[1])
    return {
      x1: indexToX(guide.start[0]),
      y1: priceToY(guide.start[1]),
      x2: indexToX(guide.end[0]),
      y2,
      labelY: y2,
      label: guide.label,
      kind: guide.kind,
    }
  })
  spreadLabels(guides, box.labelGap ?? 11, box.height)

  return {
    box,
    candles,
    guides,
    breakout: example.breakout
      ? { x: indexToX(example.breakout.x), label: example.breakout.label }
      : undefined,
    gridlines: [0.25, 0.5, 0.75].map((fraction) => plotTop + plotHeight * fraction),
  }
}
