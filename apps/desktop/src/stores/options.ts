import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { OptionsStrategy, OptionsTypeFilter } from '@shared/contract'
import type { SortState } from '@/components/ui/DataTable'

/**
 * v2 moves the default subtab to Options by Top Volume and adds `loaded`; the migration
 * drops whichever subtab a v1 install had persisted so the new default is what it opens
 * on, and arms a stored ticker so the workspace comes back with it.
 */
const STORE_VERSION = 2

export type OptionsTab = 'chain' | 'top-volume' | 'strike'

/**
 * The Options workspace, persisted the way `_p5_session_snapshot` is.
 *
 * Only the selections are kept, not the chains: the reference serialises its whole
 * DataFrame into the session file, but every value in it is a live quote that is wrong
 * by the time the app reopens, and the ticker is re-requested on restore instead — the
 * same trade `stores/etf.ts` documents for `_p13_restore_startup_session`.
 */
interface OptionsPageState {
  symbol: string
  tab: OptionsTab
  expiry: string
  strategy: OptionsStrategy
  typeFilter: OptionsTypeFilter
  selectedStrike: number | null
  /**
   * Whether a ticker has been loaded at least once. Persisted, so a restored symbol
   * arms both queries on the next launch rather than leaving the page inert behind a
   * ticker it is already showing.
   */
  loaded: boolean
  /** One sort shared by every panel in a grid, as `_p5_apply_top_volume_sort` does. */
  summarySort: SortState | null

  setSymbol: (symbol: string) => void
  setTab: (tab: OptionsTab) => void
  setExpiry: (expiry: string) => void
  setStrategy: (strategy: OptionsStrategy) => void
  setTypeFilter: (filter: OptionsTypeFilter) => void
  setSelectedStrike: (strike: number | null) => void
  setLoaded: (loaded: boolean) => void
  setSummarySort: (sort: SortState | null) => void
}

export const useOptionsPage = create<OptionsPageState>()(
  persist(
    (set) => ({
      symbol: '',
      tab: 'top-volume',
      expiry: '',
      strategy: 'None',
      typeFilter: 'both',
      selectedStrike: null,
      loaded: false,
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
      setLoaded: (loaded) => set({ loaded }),
      setSummarySort: (summarySort) => set({ summarySort }),
    }),
    {
      name: 'budget-terminal:options',
      version: STORE_VERSION,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<OptionsPageState>
        if (version >= STORE_VERSION) return state
        return {
          ...state,
          tab: 'top-volume' as OptionsTab,
          loaded: Boolean(state.symbol),
        }
      },
    },
  ),
)
