import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ChartsInterval, ProjectionsTypeFilter } from '@shared/contract'
import type { SortState } from '@/components/ui/DataTable'
import {
  DEFAULT_PROJECTIONS_SYMBOL,
  DEFAULT_PROJECTIONS_TIMEFRAME,
} from '@shared/projections'

const STORE_VERSION = 1

/**
 * The Projections workspace, persisted the way `save_charts_options_top_volume_page_settings`
 * persists its own.
 *
 * Symbol, timeframe and the calls/puts table filter are what the reference keeps; its
 * splitter sizes have no equivalent here because the layout is a CSS grid rather than a
 * `QSplitter`. `expiration_scope` is not stored either — the reference pinned it to
 * `'all'` and left the setter as a no-op, so there is nothing left to remember.
 */
interface ProjectionsPageState {
  symbol: string
  timeframe: ChartsInterval
  typeFilter: ProjectionsTypeFilter
  /** One sort shared by every expiration panel, as the Options grids do. */
  summarySort: SortState | null

  setSymbol: (symbol: string) => void
  setTimeframe: (timeframe: ChartsInterval) => void
  setTypeFilter: (filter: ProjectionsTypeFilter) => void
  setSummarySort: (sort: SortState | null) => void
}

export const useProjectionsPage = create<ProjectionsPageState>()(
  persist(
    (set) => ({
      symbol: DEFAULT_PROJECTIONS_SYMBOL,
      timeframe: DEFAULT_PROJECTIONS_TIMEFRAME,
      typeFilter: 'calls',
      summarySort: null,

      setSymbol: (value) =>
        set((state) => {
          const symbol = value.trim().toUpperCase()
          return symbol === state.symbol ? state : { symbol }
        }),
      setTimeframe: (timeframe) => set({ timeframe }),
      setTypeFilter: (typeFilter) => set({ typeFilter }),
      setSummarySort: (summarySort) => set({ summarySort }),
    }),
    {
      name: 'budget-terminal:projections',
      version: STORE_VERSION,
    },
  ),
)
