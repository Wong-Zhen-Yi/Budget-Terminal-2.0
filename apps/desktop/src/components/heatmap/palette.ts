import { heatmapTileColor } from '@shared/heatmap'

export interface HeatmapPalette {
  neutral: string
  up: string
  down: string
}

export const FALLBACK_HEATMAP_PALETTE: HeatmapPalette = { neutral: '#121b2b', up: '#26c281', down: '#f0554e' }

let cached: HeatmapPalette | null = null

/** The tile ramp mixes hex channels, so it needs the resolved theme values, not `var(...)`. */
export function readHeatmapPalette(): HeatmapPalette {
  if (cached) return cached
  if (typeof window === 'undefined' || typeof document === 'undefined') return FALLBACK_HEATMAP_PALETTE
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  const palette = {
    neutral: read('--color-surface-raised', FALLBACK_HEATMAP_PALETTE.neutral),
    up: read('--color-up', FALLBACK_HEATMAP_PALETTE.up),
    down: read('--color-down', FALLBACK_HEATMAP_PALETTE.down),
  }
  // Only cache once the stylesheet has resolved the tokens.
  if (style.getPropertyValue('--color-up').trim()) cached = palette
  return palette
}

/** One colour ramp for every heatmap, so the same move reads as the same shade across pages. */
export function heatColor(changePct: number | null): string {
  return heatmapTileColor(changePct, readHeatmapPalette())
}
