import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { MacroRange } from '@shared/contract'

/**
 * Which window each macro chart is showing.
 *
 * Persisted, like the dashboard's column widths: the choice is a reading preference, not
 * page state, and losing it on every launch is more annoying than it sounds. Market
 * Momentum has no entry — its window is fixed at two years by the 125-day mean drawn
 * over it.
 */
interface PreMarketState {
  ranges: { dxy: MacroRange; tnx: MacroRange; vix: MacroRange }
  setRange: (panel: keyof PreMarketState['ranges'], range: MacroRange) => void
}

export const usePreMarketPage = create<PreMarketState>()(
  persist(
    (set) => ({
      ranges: { dxy: '1Y', tnx: '1Y', vix: '1Y' },
      setRange: (panel, range) =>
        set((state) => ({ ranges: { ...state.ranges, [panel]: range } })),
    }),
    { name: 'budget-terminal:pre-market', version: 1 },
  ),
)
