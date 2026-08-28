import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { OptionsStrategy, OptionsTypeFilter } from '@shared/contract'
import type { SortState } from '@/components/ui/DataTable'

const STORE_VERSION = 1

export type OptionsTab = 'chain' | 'top-volume' | 'strike'

/**
 * The Options workspace, persisted the way `_p5_session_snapshot` is.
 *
 * Only the selections are kept, not the chains: the reference serialises its whole
 * DataFrame into the session file, but every value in it is a live quote that is wrong
 * by the time the app reopens, and the two loads here are cheap to repeat from the
 * buttons the page already has.
 */
interface OptionsPageState {
  symbol: string
  tab: OptionsTab
  expiry: string
  strategy: OptionsStrategy
  typeFilter: OptionsTypeFilter
  selectedStrike: number | null
  /** One sort shared by every panel in a grid, as `_p5_apply_top_volume_sort` does. */
  summarySort: SortState | null

  setSymbol: (symbol: string) => void
  setTab: (tab: OptionsTab) => void
  setExpiry: (expiry: string) => void
  setStrategy: (strategy: OptionsStrategy) => void
  setTypeFilter: (filter: OptionsTypeFilter) => void
  setSelectedStrike: (strike: number | null) => void
  setSummarySort: (sort: SortState | null) => void
}

export const useOptionsPage = create<OptionsPageState>()(
  persist(
    (set) => ({
      symbol: '',
      tab: 'chain',
      expiry: '',
      strategy: 'None',
      typeFilter: 'both',
      selectedStrike: null,
      summarySort: null,

      setSymbol: (value) =>
        set((state) => {
          const symbol = value.trim().toUpperCase()
          if (symbol === state.symbol) return state
          // A new ticker invalidates both selections; neither survives a symbol change
          // in the reference either.
          return { symbol, expiry: '', selectedStrike: null }
        }),
      setTab: (tab) => set({ tab }),
      setExpiry: (expiry) => set({ expiry }),
      setStrategy: (strategy) => set({ strategy }),
      setTypeFilter: (typeFilter) => set({ typeFilter }),
      setSelectedStrike: (selectedStrike) => set({ selectedStrike }),
      setSummarySort: (summarySort) => set({ summarySort }),
    }),
    {
      name: 'budget-terminal:options',
      version: STORE_VERSION,
    },
  ),
)
