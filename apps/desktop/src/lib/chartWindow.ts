import { normalizeChartSymbol } from '@shared/chartWindow'

/**
 * The symbol a pop-out chart window opened with, or null in the main window.
 * The main process opens the shell document with `#chart=<symbol>`.
 */
export function chartWindowSymbol(): string | null {
  if (typeof window === 'undefined') return null
  const match = /^#chart=([^&]*)$/.exec(window.location.hash)
  if (!match) return null
  try {
    return normalizeChartSymbol(decodeURIComponent(match[1])) ?? 'SPY'
  } catch {
    return 'SPY'
  }
}

export const isChartWindow = (): boolean => chartWindowSymbol() !== null
