import { addDays } from './calendar.js'
import type { EconomicCalendarEvent, EconomicRow } from './contract.js'

export const MACRO_DRIVERS = [
  { title: 'Activity', ids: ['GDPC1', 'INDPRO', 'RSAFS'] },
  { title: 'Prices', ids: ['CPIAUCSL', 'CPILFESL', 'PCEPILFE'] },
  { title: 'Employment', ids: ['UNRATE', 'PAYEMS', 'ICSA'] },
] as const

export const MACRO_RATES = ['FEDFUNDS', 'SOFR', 'DGS2', 'DGS10', 'DFII10', 'T10YIE', 'T10Y2Y'] as const

export const MACRO_RELEASE_WINDOW_DAYS = 60
const macroReleaseNames = new Set(['FOMC Decision', 'CPI Release', 'PCE Inflation', 'Jobs Report', 'GDP Report'])

/** The next scheduled occurrence of each key US release, in date order. */
export function upcomingMacroReleases(events: readonly EconomicCalendarEvent[], today: string): EconomicCalendarEvent[] {
  const end = addDays(today, MACRO_RELEASE_WINDOW_DAYS)
  const upcoming = events
    .filter(event => macroReleaseNames.has(event.name) && event.date >= today && event.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
  const nextByName = new Map<string, EconomicCalendarEvent>()
  for (const event of upcoming) {
    if (!nextByName.has(event.name)) nextByName.set(event.name, event)
  }
  return [...nextByName.values()]
}

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
