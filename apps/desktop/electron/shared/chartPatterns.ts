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
  path: Array<[number, number]>
  guides: Array<{ start: [number, number]; end: [number, number]; label: string }>
}

const bullish: Array<[number, number]> = [[0, 78], [18, 42], [34, 64], [50, 28], [66, 54], [82, 32], [100, 12]]
const bearish: Array<[number, number]> = [[0, 22], [18, 58], [34, 36], [50, 72], [66, 46], [82, 68], [100, 88]]
const neutral: Array<[number, number]> = [[0, 24], [18, 76], [36, 34], [54, 66], [70, 43], [84, 56], [100, 50]]

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
  path?: Array<[number, number]>,
): ChartPattern {
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
    path: path ?? (bias === 'Bullish' ? bullish : bias === 'Bearish' ? bearish : neutral),
    guides: [
      { start: [10, bias === 'Bearish' ? 62 : 38], end: [88, bias === 'Bearish' ? 62 : 38], label: bias === 'Bearish' ? 'Support' : 'Resistance' },
    ],
  }
}

export const CHART_PATTERN_FAMILIES: readonly ChartPatternFamily[] = ['Reversal', 'Continuation', 'Compression', 'Channel']
export const CHART_PATTERN_BIASES: readonly ChartPatternBias[] = ['Bullish', 'Bearish', 'Neutral']

export const CHART_PATTERN_CATALOG: readonly ChartPattern[] = [
  pattern('head_and_shoulders', 'Head and Shoulders', ['H&S', 'Head & Shoulders'], 'Reversal', 'Bearish', 'Three peaks form after an advance; the middle head is highest.', 'A decisive close below the neckline.', 'Price closes above the right shoulder.', 'Project the head-to-neckline height downward.'),
  pattern('inverse_head_and_shoulders', 'Inverse Head and Shoulders', ['Inverse H&S'], 'Reversal', 'Bullish', 'Three troughs form after a decline; the middle trough is lowest.', 'A decisive close above the neckline.', 'Price closes below the right shoulder.', 'Project the neckline-to-head height upward.'),
  pattern('double_top', 'Double Top', ['M Top', 'Two Tops'], 'Reversal', 'Bearish', 'Two comparable highs are separated by a reaction low.', 'Price closes below the reaction-low neckline.', 'Price closes above the peak resistance.', 'Project the range downward from the neckline.'),
  pattern('double_bottom', 'Double Bottom', ['W Bottom', 'Two Bottoms'], 'Reversal', 'Bullish', 'Two comparable lows are separated by a reaction high.', 'Price closes above the reaction-high neckline.', 'Price closes below the trough support.', 'Project the range upward from the neckline.'),
  pattern('triple_top', 'Triple Top', ['Three Tops'], 'Reversal', 'Bearish', 'Three failed pushes test a similar resistance zone.', 'Price closes beneath the shared reaction-low support.', 'Price establishes acceptance above resistance.', 'Project the completed range downward.'),
  pattern('triple_bottom', 'Triple Bottom', ['Three Bottoms'], 'Reversal', 'Bullish', 'Three failed declines test a similar support zone.', 'Price closes above the shared reaction-high resistance.', 'Price establishes acceptance below support.', 'Project the completed range upward.'),
  pattern('rounding_top', 'Rounding Top', ['Inverted Bowl', 'Dome Top'], 'Reversal', 'Bearish', 'A gradual dome forms as an advance loses momentum.', 'Price breaks base support on the right side.', 'Price recovers the base and makes higher highs.', 'Project the dome depth downward.'),
  pattern('rounding_bottom', 'Rounding Bottom', ['Saucer Bottom', 'Bowl Bottom'], 'Reversal', 'Bullish', 'A gradual saucer forms as a decline loses momentum.', 'Price breaks rim resistance on the right side.', 'Price falls back below the rim.', 'Project the saucer depth upward.'),
  pattern('cup_and_handle', 'Cup and Handle', ['Cup with Handle'], 'Reversal', 'Bullish', 'A rounded cup returns to resistance before a smaller handle pullback.', 'Price closes above the cup rim.', 'Price breaks the handle low.', 'Project the cup depth upward.'),
  pattern('inverse_cup_and_handle', 'Inverse Cup and Handle', ['Inverted Cup and Handle'], 'Reversal', 'Bearish', 'An inverted cup returns to support before an upward handle.', 'Price closes below the cup base.', 'Price breaks the handle high.', 'Project the cup height downward.'),
  pattern('bull_flag', 'Bull Flag', ['Bullish Flag'], 'Continuation', 'Bullish', 'A sharp advance is followed by a short downward-sloping channel.', 'Price closes above flag resistance.', 'Price breaks the flag low.', 'Project the flagpole upward.'),
  pattern('bear_flag', 'Bear Flag', ['Bearish Flag'], 'Continuation', 'Bearish', 'A sharp decline is followed by a short upward-sloping channel.', 'Price closes below flag support.', 'Price breaks the flag high.', 'Project the flagpole downward.'),
  pattern('bull_pennant', 'Bull Pennant', ['Bullish Pennant'], 'Continuation', 'Bullish', 'A sharp advance pauses in a small contracting consolidation.', 'Price closes above the upper boundary.', 'Price breaks the lower boundary.', 'Project the flagpole upward.'),
  pattern('bear_pennant', 'Bear Pennant', ['Bearish Pennant'], 'Continuation', 'Bearish', 'A sharp decline pauses in a small contracting consolidation.', 'Price closes below the lower boundary.', 'Price breaks the upper boundary.', 'Project the flagpole downward.'),
  pattern('bullish_rectangle', 'Bullish Rectangle', ['Bull Rectangle', 'Bullish Range'], 'Continuation', 'Bullish', 'An advance pauses inside a horizontal range.', 'Price closes above range resistance.', 'Price falls below range support.', 'Project the rectangle height upward.'),
  pattern('bearish_rectangle', 'Bearish Rectangle', ['Bear Rectangle', 'Bearish Range'], 'Continuation', 'Bearish', 'A decline pauses inside a horizontal range.', 'Price closes below range support.', 'Price rises above range resistance.', 'Project the rectangle height downward.'),
  pattern('ascending_triangle', 'Ascending Triangle', ['Flat-top Triangle'], 'Compression', 'Bullish', 'Flat resistance is tested while reaction lows rise.', 'Price closes above horizontal resistance.', 'Price breaks rising support.', 'Project the widest height upward.'),
  pattern('descending_triangle', 'Descending Triangle', ['Flat-bottom Triangle'], 'Compression', 'Bearish', 'Flat support is tested while reaction highs fall.', 'Price closes below horizontal support.', 'Price breaks falling resistance.', 'Project the widest height downward.'),
  pattern('symmetrical_triangle', 'Symmetrical Triangle', ['Symmetric Triangle', 'Coil'], 'Compression', 'Neutral', 'Lower highs and higher lows compress toward an apex.', 'A close outside either boundary confirms direction.', 'Price immediately re-enters the triangle.', 'Project the widest height in the break direction.'),
  pattern('rising_wedge', 'Rising Wedge', ['Ascending Wedge'], 'Compression', 'Bearish', 'Higher highs and lows form inside rising converging boundaries.', 'Price closes below the lower boundary.', 'Price reclaims support and the wedge high.', 'Project the widest height downward.'),
  pattern('falling_wedge', 'Falling Wedge', ['Descending Wedge'], 'Compression', 'Bullish', 'Lower highs and lows form inside falling converging boundaries.', 'Price closes above the upper boundary.', 'Price loses resistance and the wedge low.', 'Project the widest height upward.'),
  pattern('broadening_formation', 'Broadening Formation', ['Megaphone', 'Broadening Wedge'], 'Compression', 'Neutral', 'Higher highs and lower lows expand volatility.', 'A close beyond an outer boundary confirms direction.', 'Price crosses back through the formation.', 'Project the widest completed swing.'),
  pattern('ascending_channel', 'Ascending Channel', ['Rising Channel', 'Uptrend Channel'], 'Channel', 'Bullish', 'Higher highs and lows oscillate between parallel rising boundaries.', 'Pullbacks hold the lower channel or price breaks the upper.', 'Price closes below the lower channel.', 'Use the opposite boundary, then channel height.'),
  pattern('descending_channel', 'Descending Channel', ['Falling Channel', 'Downtrend Channel'], 'Channel', 'Bearish', 'Lower highs and lows oscillate between parallel falling boundaries.', 'Rebounds fail at the upper channel or price breaks the lower.', 'Price closes above the upper channel.', 'Use the opposite boundary, then channel height.'),
]

if (CHART_PATTERN_CATALOG.length !== 24) throw new Error('The chart-pattern catalog must contain 24 entries.')
