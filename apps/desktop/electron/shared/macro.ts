import type { EconomicRow } from './contract.js'

export const MACRO_DRIVERS = [
  { title: 'Activity', ids: ['GDPC1', 'INDPRO', 'RSAFS'] },
  { title: 'Prices', ids: ['CPIAUCSL', 'CPILFESL', 'PCEPILFE'] },
  { title: 'Employment', ids: ['UNRATE', 'PAYEMS', 'ICSA'] },
] as const

export const MACRO_RATES = ['FEDFUNDS', 'SOFR', 'DGS2', 'DGS10', 'DFII10', 'T10YIE', 'T10Y2Y'] as const

export function macroDirection(row: EconomicRow | undefined): number | null {
  if (!row?.available || row.latest === null || !Number.isFinite(row.latest) || row.change === null || !Number.isFinite(row.change)) return null
  return Math.sign(row.change)
}

/** Latest release changes, not a synchronized cycle model or a recession forecast. */
export function macroCompass(rows: readonly EconomicRow[]): string | null {
  const growth = macroDirection(rows.find(row => row.seriesId === 'GDPC1'))
  const prices = macroDirection(rows.find(row => row.seriesId === 'CPIAUCSL'))
  if (growth === null || prices === null || growth === 0 || prices === 0) return null
  return `${growth > 0 ? 'firmer' : 'softer'}-${prices > 0 ? 'rising' : 'easing'}`
}
