import type { SummaryHighlight } from '@shared/optionsPage'

/**
 * The four cell highlights the summary grids paint, and the three strategy-rank
 * backgrounds the Chain tables paint.
 *
 * `_p5_top_volume_price_highlight_backgrounds` and its three siblings blend the panel
 * background toward a theme accent at a fixed amount, strongest rank first. The theme
 * here is dark-only and fixed, so the blends are resolved once rather than recomputed
 * per render: surface `#0d1420` toward up at 0.48/0.32, toward the same
 * warn-to-down mix at 0.56/0.38, toward warn at 0.48/0.32 and toward down at 0.48/0.32.
 */
export const HIGHLIGHT_BACKGROUNDS = {
  price: {
    top: ['#19684f', '#154c3f'],
    low: ['#88493d', '#603833'],
  },
  volume: {
    top: ['#6d603e', '#4d4734'],
    low: ['#7a3336', '#56292f'],
  },
} as const

/** The legend swatches, strongest rank of each highlight. */
export const HIGHLIGHT_LEGEND: ReadonlyArray<{ label: string; color: string }> = [
  { label: 'Top price', color: HIGHLIGHT_BACKGROUNDS.price.top[0] },
  { label: 'Lowest price', color: HIGHLIGHT_BACKGROUNDS.price.low[0] },
  { label: 'Top volume', color: HIGHLIGHT_BACKGROUNDS.volume.top[0] },
  { label: 'Lowest volume', color: HIGHLIGHT_BACKGROUNDS.volume.low[0] },
]

export function highlightColor(
  entry: SummaryHighlight['price'] | SummaryHighlight['volume'],
  field: 'price' | 'volume',
): string | undefined {
  if (!entry) return undefined
  return HIGHLIGHT_BACKGROUNDS[field][entry.kind][entry.rank]
}

/** `_p5_strategy_bg`: gold, blue and grey behind the top three ranked strikes. */
export function strategyBackground(rank: number | undefined): string | undefined {
  if (!rank) return undefined
  return ['#14483d', '#1b3a6a', '#24344b'][rank - 1] ?? '#121b2b'
}
