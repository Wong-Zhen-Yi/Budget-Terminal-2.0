import type { EconomicRow } from './contract.js'

export const MACRO_DRIVERS = [
  { title: 'Activity', ids: ['GDPC1', 'INDPRO', 'RSAFS'] },
  { title: 'Prices', ids: ['CPIAUCSL', 'CPILFESL', 'PCEPILFE'] },
  { title: 'Employment', ids: ['UNRATE', 'PAYEMS', 'ICSA'] },
] as const

export const MACRO_RATES = ['FEDFUNDS', 'SOFR', 'DGS2', 'DGS10', 'DFII10', 'T10YIE', 'T10Y2Y'] as const

export const COMPASS_STEADY_THRESHOLD_PP = 0.10

function compassChange(row: EconomicRow | undefined) {
  if (!row?.available || row.latest === null || !Number.isFinite(row.latest) || row.change === null || !Number.isFinite(row.change)) return null
  return Math.sign(row.change) * Math.round(Math.abs(row.change) * 100) / 100 || 0
}

function compassDirection(change: number): -1 | 0 | 1 {
  if (change <= -COMPASS_STEADY_THRESHOLD_PP) return -1
  if (change >= COMPASS_STEADY_THRESHOLD_PP) return 1
  return 0
}

/** Compare each series with its own prior observation, in percentage points. */
export function macroCompass(growth: EconomicRow | undefined, inflation: EconomicRow | undefined) {
  const growthChange = compassChange(growth)
  const inflationChange = compassChange(inflation)
  return {
    growthChange,
    inflationChange,
    growthDirection: growthChange === null ? null : compassDirection(growthChange),
    inflationDirection: inflationChange === null ? null : compassDirection(inflationChange),
  }
}
