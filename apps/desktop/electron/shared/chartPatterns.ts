// The chart-pattern cheat sheet catalog.
//
// Every entry carries three candlestick examples built from its own skeleton — the
// pivots and boundaries that make it that pattern and nothing else. A Head and
// Shoulders has three peaks with the middle one highest because that is literally how
// it is defined here; an Ascending Triangle has a flat resistance and a rising lower
// boundary for the same reason. The bearish twin of a bullish pattern is the mirror of
// it about the 50 line, so the pair cannot drift apart.
//
// Pure and seeded: the Cheat Sheet, the Dictionary, the probes and the PNG renderer all
// draw identical bars. No Electron or React imports here.

import {
  arc,
  boundary,
  buildExample,
  mirrorSkeleton,
  mix,
  oscillate,
  peak,
  trough,
  via,
  type ChartPatternExample,
  type PatternSkeleton,
  type PatternVariant,
} from './patternCandles.js'

export type { ChartPatternExample, PatternCandle, PatternGuide } from './patternCandles.js'

export type ChartPatternFamily = 'Reversal' | 'Continuation' | 'Compression' | 'Channel'
export type ChartPatternBias = 'Bullish' | 'Bearish' | 'Neutral'

export interface ChartPattern {
  id: string
  name: string
  aliases: string[]
  family: ChartPatternFamily
  bias: ChartPatternBias
  recognition: string
  confirmation: string
  invalidation: string
  target: string
  examples: ChartPatternExample[]
}

type Build = (shape: number, variant: PatternVariant) => PatternSkeleton

const VARIANT_SHAPES: Array<Omit<PatternVariant, 'seed'>> = [
  {
    id: 'textbook',
    label: 'Textbook',
    caption: 'Clean proportions — the shape as it is drawn in the books.',
    bars: 44,
    noise: 1,
    shape: 0.5,
  },
  {
    id: 'noisy',
    label: 'Noisy tape',
    caption: 'Fewer, wilder bars. The same structure with the noise a real chart carries.',
    bars: 34,
    noise: 1.55,
    shape: 0.12,
  },
  {
    id: 'extended',
    label: 'Extended',
    caption: 'A longer, slower build with a deeper structure before the resolution.',
    bars: 58,
    noise: 0.75,
    shape: 0.9,
  },
]

const NEUTRAL_VARIANT_SHAPES: Array<Omit<PatternVariant, 'seed'>> = [
  VARIANT_SHAPES[0],
  VARIANT_SHAPES[1],
  {
    id: 'downside',
    label: 'Downside break',
    caption: 'The same formation resolving the other way — the shape does not pick a side.',
    bars: 52,
    noise: 0.85,
    shape: 0.7,
  },
]

function seedFor(id: string, index: number): number {
  let hash = 2166136261
  for (let position = 0; position < id.length; position += 1) {
    hash ^= id.charCodeAt(position)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 100000) + index * 977 + 1
}

// ---------------------------------------------------------------------------
// Skeletons, each written in its bullish-outcome orientation.
// ---------------------------------------------------------------------------

const inverseHeadShoulders: Build = (shape) => {
  const neck = 62
  const head = mix(30, 22, shape)
  return {
    pivots: [
      via(0, 86),
      trough(0.14, 48),
      peak(0.25, neck),
      trough(0.39, head),
      peak(0.52, neck),
      trough(0.66, 46),
      via(0.8, neck + 4),
      via(1, 88),
    ],
    guides: [{ start: [0.1, neck], end: [0.94, neck], label: 'Neckline', kind: 'neckline' }],
    breakout: { x: 0.78, label: 'Breakout' },
  }
}

const doubleBottom: Build = (shape) => {
  const neck = 58
  const low = mix(30, 24, shape)
  return {
    pivots: [
      via(0, 88),
      trough(0.2, low),
      peak(0.42, neck),
      trough(0.63, low + 2),
      via(0.78, neck + 4),
      via(1, 86),
    ],
    guides: [
      { start: [0.1, neck], end: [0.94, neck], label: 'Neckline', kind: 'neckline' },
      { start: [0.14, low], end: [0.7, low + 2], label: 'Support', kind: 'level' },
    ],
    breakout: { x: 0.76, label: 'Breakout' },
  }
}

const tripleBottom: Build = (shape) => {
  const neck = 55
  const low = mix(30, 26, shape)
  return {
    pivots: [
      via(0, 84),
      trough(0.15, low),
      peak(0.29, neck),
      trough(0.44, low + 1.5),
      peak(0.58, neck),
      trough(0.72, low + 1),
      via(0.86, neck + 4),
      via(1, 82),
    ],
    guides: [
      { start: [0.24, neck], end: [0.94, neck], label: 'Neckline', kind: 'neckline' },
      { start: [0.1, low], end: [0.78, low + 1], label: 'Support', kind: 'level' },
    ],
    breakout: { x: 0.84, label: 'Breakout' },
  }
}

const roundingBottom: Build = (shape) => {
  const rim = 80
  const depth = mix(28, 20, shape)
  return {
    pivots: [via(0, 86), ...arc(0.06, 0.84, rim, depth, 14, 'extreme'), via(0.92, rim + 5), via(1, 90)],
    guides: [{ start: [0.06, rim], end: [0.96, rim], label: 'Rim', kind: 'level' }],
    breakout: { x: 0.88, label: 'Breakout' },
  }
}

const cupAndHandle: Build = (shape) => {
  const rim = 74
  const depth = mix(38, 30, shape)
  const handle = mix(66, 64, shape)
  return {
    pivots: [
      via(0, 70),
      ...arc(0.04, 0.62, rim, depth, 12, 'extreme'),
      peak(0.66, rim),
      trough(0.76, handle),
      peak(0.85, rim - 1),
      via(0.92, rim + 6),
      via(1, 92),
    ],
    guides: [
      { start: [0.04, rim], end: [0.96, rim], label: 'Cup rim', kind: 'level' },
      { start: [0.66, handle], end: [0.9, handle], label: 'Handle', kind: 'level' },
    ],
    breakout: { x: 0.89, label: 'Breakout' },
  }
}

const bullFlag: Build = (shape) => {
  // The pole is a fifth of the width. Spread over a third it reads as an ordinary
  // advance, and what makes this a flag rather than a channel is that the pole is sharp.
  const upper = boundary(0.24, 74, 0.72, mix(58, 62, shape))
  const lower = boundary(0.24, 64, 0.72, mix(48, 52, shape))
  return {
    pivots: [
      via(0, 20),
      via(0.04, 22),
      via(0.22, 74),
      ...oscillate(0.26, 0.7, 5, upper, lower),
      via(0.8, 74),
      via(1, 94),
    ],
    guides: [
      { start: [0.24, upper(0.24)], end: [0.78, upper(0.78)], label: 'Flag high', kind: 'boundary' },
      { start: [0.24, lower(0.24)], end: [0.76, lower(0.76)], label: 'Flag low', kind: 'boundary' },
    ],
    breakout: { x: 0.76, label: 'Breakout' },
  }
}

const bullPennant: Build = (shape) => {
  const upper = boundary(0.24, 76, 0.72, mix(66, 64, shape))
  const lower = boundary(0.24, 54, 0.72, mix(62, 63, shape))
  return {
    pivots: [
      via(0, 22),
      via(0.04, 24),
      via(0.22, 76),
      ...oscillate(0.26, 0.7, 5, upper, lower),
      via(0.8, 76),
      via(1, 93),
    ],
    guides: [
      { start: [0.24, upper(0.24)], end: [0.78, upper(0.78)], label: 'Upper boundary', kind: 'boundary' },
      { start: [0.24, lower(0.24)], end: [0.76, lower(0.76)], label: 'Lower boundary', kind: 'boundary' },
    ],
    breakout: { x: 0.76, label: 'Breakout' },
  }
}

const bullishRectangle: Build = (shape) => {
  const top = 66
  const floor = mix(46, 40, shape)
  return {
    pivots: [
      via(0, 26),
      via(0.16, 62),
      ...oscillate(0.2, 0.78, 6, () => top, () => floor),
      via(0.88, 74),
      via(1, 88),
    ],
    guides: [
      { start: [0.14, top], end: [0.94, top], label: 'Resistance', kind: 'level' },
      { start: [0.14, floor], end: [0.84, floor], label: 'Support', kind: 'level' },
    ],
    breakout: { x: 0.85, label: 'Breakout' },
  }
}

const ascendingTriangle: Build = (shape) => {
  const top = 70
  const lower = boundary(0.08, 36, 0.76, mix(62, 66, shape))
  return {
    pivots: [
      via(0, 32),
      ...oscillate(0.08, 0.76, 7, () => top, lower, false),
      via(0.87, 78),
      via(1, 92),
    ],
    guides: [
      { start: [0.06, top], end: [0.96, top], label: 'Resistance', kind: 'level' },
      { start: [0.08, lower(0.08)], end: [0.8, lower(0.8)], label: 'Rising lows', kind: 'boundary' },
    ],
    breakout: { x: 0.84, label: 'Breakout' },
  }
}

const fallingWedge: Build = (shape) => {
  const upper = boundary(0.04, 82, 0.74, mix(54, 50, shape))
  const lower = boundary(0.04, 62, 0.74, mix(46, 44, shape))
  return {
    pivots: [via(0, 86), ...oscillate(0.04, 0.74, 7, upper, lower), via(0.86, 66), via(1, 84)],
    guides: [
      { start: [0.04, upper(0.04)], end: [0.82, upper(0.82)], label: 'Upper boundary', kind: 'boundary' },
      { start: [0.04, lower(0.04)], end: [0.78, lower(0.78)], label: 'Lower boundary', kind: 'boundary' },
    ],
    breakout: { x: 0.82, label: 'Breakout' },
  }
}

const ascendingChannel: Build = (shape) => {
  const upper = boundary(0.02, 44, 0.98, mix(86, 90, shape))
  const lower = boundary(0.02, 26, 0.98, mix(68, 72, shape))
  return {
    pivots: [via(0, 30), ...oscillate(0.04, 0.96, 10, upper, lower, false), via(1, upper(1) - 4)],
    guides: [
      { start: [0.02, upper(0.02)], end: [0.98, upper(0.98)], label: 'Upper channel', kind: 'boundary' },
      { start: [0.02, lower(0.02)], end: [0.98, lower(0.98)], label: 'Lower channel', kind: 'boundary' },
    ],
  }
}

const symmetricalTriangle: Build = (shape, variant) => {
  const down = variant.id === 'downside'
  const upper = boundary(0.05, 80, 0.74, mix(60, 58, shape))
  const lower = boundary(0.05, 30, 0.74, mix(52, 54, shape))
  return {
    pivots: [
      via(0, 30),
      ...oscillate(0.05, 0.74, down ? 8 : 7, upper, lower, false),
      down ? via(0.86, 42) : via(0.86, 72),
      down ? via(1, 24) : via(1, 88),
    ],
    guides: [
      { start: [0.05, upper(0.05)], end: [0.82, upper(0.82)], label: 'Upper boundary', kind: 'boundary' },
      { start: [0.05, lower(0.05)], end: [0.82, lower(0.82)], label: 'Lower boundary', kind: 'boundary' },
    ],
    breakout: { x: 0.83, label: down ? 'Breakdown' : 'Breakout' },
  }
}

const broadeningFormation: Build = (shape, variant) => {
  const down = variant.id === 'downside'
  const upper = boundary(0.04, 56, 0.92, mix(86, 90, shape))
  const lower = boundary(0.04, 44, 0.92, mix(16, 12, shape))
  return {
    pivots: [
      via(0, 50),
      // The widest swing is the last one, so it is given a quarter of the width to
      // travel in — ending the oscillation at the right edge packs it into four bars.
      ...oscillate(0.04, 0.74, down ? 8 : 7, upper, lower, false),
      down ? via(1, lower(1) + 6) : via(1, upper(1) - 6),
    ],
    guides: [
      { start: [0.04, upper(0.04)], end: [0.96, upper(0.96)], label: 'Upper boundary', kind: 'boundary' },
      { start: [0.04, lower(0.04)], end: [0.96, lower(0.96)], label: 'Lower boundary', kind: 'boundary' },
    ],
  }
}

/** Every bearish twin is the mirror of its bullish partner, so the pair cannot drift. */
function mirrored(build: Build): Build {
  return (shape, variant) => mirrorSkeleton(build(shape, variant))
}

function pattern(
  id: string,
  name: string,
  aliases: string[],
  family: ChartPatternFamily,
  bias: ChartPatternBias,
  recognition: string,
  confirmation: string,
  invalidation: string,
  target: string,
  build: Build,
): ChartPattern {
  const shapes = bias === 'Neutral' ? NEUTRAL_VARIANT_SHAPES : VARIANT_SHAPES
  return {
    id,
    name,
    aliases,
    family,
    bias,
    recognition,
    confirmation,
    invalidation,
    target,
    examples: shapes.map((shape, index) => {
      const variant: PatternVariant = { ...shape, seed: seedFor(id, index) }
      return buildExample(build(variant.shape, variant), variant)
    }),
  }
}

export const CHART_PATTERN_FAMILIES: readonly ChartPatternFamily[] = ['Reversal', 'Continuation', 'Compression', 'Channel']
export const CHART_PATTERN_BIASES: readonly ChartPatternBias[] = ['Bullish', 'Bearish', 'Neutral']

export const CHART_PATTERN_CATALOG: readonly ChartPattern[] = [
  pattern('head_and_shoulders', 'Head and Shoulders', ['H&S', 'Head & Shoulders'], 'Reversal', 'Bearish', 'Three peaks form after an advance; the middle head is highest.', 'A decisive close below the neckline.', 'Price closes above the right shoulder.', 'Project the head-to-neckline height downward.', mirrored(inverseHeadShoulders)),
  pattern('inverse_head_and_shoulders', 'Inverse Head and Shoulders', ['Inverse H&S'], 'Reversal', 'Bullish', 'Three troughs form after a decline; the middle trough is lowest.', 'A decisive close above the neckline.', 'Price closes below the right shoulder.', 'Project the neckline-to-head height upward.', inverseHeadShoulders),
  pattern('double_top', 'Double Top', ['M Top', 'Two Tops'], 'Reversal', 'Bearish', 'Two comparable highs are separated by a reaction low.', 'Price closes below the reaction-low neckline.', 'Price closes above the peak resistance.', 'Project the range downward from the neckline.', mirrored(doubleBottom)),
  pattern('double_bottom', 'Double Bottom', ['W Bottom', 'Two Bottoms'], 'Reversal', 'Bullish', 'Two comparable lows are separated by a reaction high.', 'Price closes above the reaction-high neckline.', 'Price closes below the trough support.', 'Project the range upward from the neckline.', doubleBottom),
  pattern('triple_top', 'Triple Top', ['Three Tops'], 'Reversal', 'Bearish', 'Three failed pushes test a similar resistance zone.', 'Price closes beneath the shared reaction-low support.', 'Price establishes acceptance above resistance.', 'Project the completed range downward.', mirrored(tripleBottom)),
  pattern('triple_bottom', 'Triple Bottom', ['Three Bottoms'], 'Reversal', 'Bullish', 'Three failed declines test a similar support zone.', 'Price closes above the shared reaction-high resistance.', 'Price establishes acceptance below support.', 'Project the completed range upward.', tripleBottom),
  pattern('rounding_top', 'Rounding Top', ['Inverted Bowl', 'Dome Top'], 'Reversal', 'Bearish', 'A gradual dome forms as an advance loses momentum.', 'Price breaks base support on the right side.', 'Price recovers the base and makes higher highs.', 'Project the dome depth downward.', mirrored(roundingBottom)),
  pattern('rounding_bottom', 'Rounding Bottom', ['Saucer Bottom', 'Bowl Bottom'], 'Reversal', 'Bullish', 'A gradual saucer forms as a decline loses momentum.', 'Price breaks rim resistance on the right side.', 'Price falls back below the rim.', 'Project the saucer depth upward.', roundingBottom),
  pattern('cup_and_handle', 'Cup and Handle', ['Cup with Handle'], 'Reversal', 'Bullish', 'A rounded cup returns to resistance before a smaller handle pullback.', 'Price closes above the cup rim.', 'Price breaks the handle low.', 'Project the cup depth upward.', cupAndHandle),
  pattern('inverse_cup_and_handle', 'Inverse Cup and Handle', ['Inverted Cup and Handle'], 'Reversal', 'Bearish', 'An inverted cup returns to support before an upward handle.', 'Price closes below the cup base.', 'Price breaks the handle high.', 'Project the cup height downward.', mirrored(cupAndHandle)),
  pattern('bull_flag', 'Bull Flag', ['Bullish Flag'], 'Continuation', 'Bullish', 'A sharp advance is followed by a short downward-sloping channel.', 'Price closes above flag resistance.', 'Price breaks the flag low.', 'Project the flagpole upward.', bullFlag),
  pattern('bear_flag', 'Bear Flag', ['Bearish Flag'], 'Continuation', 'Bearish', 'A sharp decline is followed by a short upward-sloping channel.', 'Price closes below flag support.', 'Price breaks the flag high.', 'Project the flagpole downward.', mirrored(bullFlag)),
  pattern('bull_pennant', 'Bull Pennant', ['Bullish Pennant'], 'Continuation', 'Bullish', 'A sharp advance pauses in a small contracting consolidation.', 'Price closes above the upper boundary.', 'Price breaks the lower boundary.', 'Project the flagpole upward.', bullPennant),
  pattern('bear_pennant', 'Bear Pennant', ['Bearish Pennant'], 'Continuation', 'Bearish', 'A sharp decline pauses in a small contracting consolidation.', 'Price closes below the lower boundary.', 'Price breaks the upper boundary.', 'Project the flagpole downward.', mirrored(bullPennant)),
  pattern('bullish_rectangle', 'Bullish Rectangle', ['Bull Rectangle', 'Bullish Range'], 'Continuation', 'Bullish', 'An advance pauses inside a horizontal range.', 'Price closes above range resistance.', 'Price falls below range support.', 'Project the rectangle height upward.', bullishRectangle),
  pattern('bearish_rectangle', 'Bearish Rectangle', ['Bear Rectangle', 'Bearish Range'], 'Continuation', 'Bearish', 'A decline pauses inside a horizontal range.', 'Price closes below range support.', 'Price rises above range resistance.', 'Project the rectangle height downward.', mirrored(bullishRectangle)),
  pattern('ascending_triangle', 'Ascending Triangle', ['Flat-top Triangle'], 'Compression', 'Bullish', 'Flat resistance is tested while reaction lows rise.', 'Price closes above horizontal resistance.', 'Price breaks rising support.', 'Project the widest height upward.', ascendingTriangle),
  pattern('descending_triangle', 'Descending Triangle', ['Flat-bottom Triangle'], 'Compression', 'Bearish', 'Flat support is tested while reaction highs fall.', 'Price closes below horizontal support.', 'Price breaks falling resistance.', 'Project the widest height downward.', mirrored(ascendingTriangle)),
  pattern('symmetrical_triangle', 'Symmetrical Triangle', ['Symmetric Triangle', 'Coil'], 'Compression', 'Neutral', 'Lower highs and higher lows compress toward an apex.', 'A close outside either boundary confirms direction.', 'Price immediately re-enters the triangle.', 'Project the widest height in the break direction.', symmetricalTriangle),
  pattern('rising_wedge', 'Rising Wedge', ['Ascending Wedge'], 'Compression', 'Bearish', 'Higher highs and lows form inside rising converging boundaries.', 'Price closes below the lower boundary.', 'Price reclaims support and the wedge high.', 'Project the widest height downward.', mirrored(fallingWedge)),
  pattern('falling_wedge', 'Falling Wedge', ['Descending Wedge'], 'Compression', 'Bullish', 'Lower highs and lows form inside falling converging boundaries.', 'Price closes above the upper boundary.', 'Price loses resistance and the wedge low.', 'Project the widest height upward.', fallingWedge),
  pattern('broadening_formation', 'Broadening Formation', ['Megaphone', 'Broadening Wedge'], 'Compression', 'Neutral', 'Higher highs and lower lows expand volatility.', 'A close beyond an outer boundary confirms direction.', 'Price crosses back through the formation.', 'Project the widest completed swing.', broadeningFormation),
  pattern('ascending_channel', 'Ascending Channel', ['Rising Channel', 'Uptrend Channel'], 'Channel', 'Bullish', 'Higher highs and lows oscillate between parallel rising boundaries.', 'Pullbacks hold the lower channel or price breaks the upper.', 'Price closes below the lower channel.', 'Use the opposite boundary, then channel height.', ascendingChannel),
  pattern('descending_channel', 'Descending Channel', ['Falling Channel', 'Downtrend Channel'], 'Channel', 'Bearish', 'Lower highs and lows oscillate between parallel falling boundaries.', 'Rebounds fail at the upper channel or price breaks the lower.', 'Price closes above the upper channel.', 'Use the opposite boundary, then channel height.', mirrored(ascendingChannel)),
]

if (CHART_PATTERN_CATALOG.length !== 24) throw new Error('The chart-pattern catalog must contain 24 entries.')
