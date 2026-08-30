import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * The Economic page's persisted controls, standing in for the reference's
 * `load_economic_page_settings` / `save_economic_page_settings` pair and its
 * `_normalize_economic_page_settings`.
 *
 * Nothing about the data lives here — the payload is cached in the main process, because
 * it is shared with the probe and survives a renderer reload.
 */

export const ECONOMIC_TABS = ['overview', 'inflation', 'labor', 'growth', 'rates'] as const
export type EconomicTab = (typeof ECONOMIC_TABS)[number]

export const ECONOMIC_LOOKBACKS = [
  { key: '1y', label: '1Y', years: 1 },
  { key: '3y', label: '3Y', years: 3 },
  { key: '5y', label: '5Y', years: 5 },
  { key: '10y', label: '10Y', years: 10 },
] as const
export type EconomicLookback = (typeof ECONOMIC_LOOKBACKS)[number]['key']

export const ECONOMIC_GROUP_FILTERS = ['all', 'inflation', 'labor', 'growth', 'rates'] as const
export type EconomicGroupFilter = (typeof ECONOMIC_GROUP_FILTERS)[number]

/** Sub-tab key to catalog group. `overview` spans every group and so maps to nothing. */
export const ECONOMIC_TAB_GROUPS = {
  inflation: 'Inflation',
  labor: 'Labor',
  growth: 'Growth',
  rates: 'Rates',
} as const

interface EconomicState {
  activeTab: EconomicTab
  lookback: EconomicLookback
  groupFilter: EconomicGroupFilter
  search: string
  hideUnavailable: boolean
  /** Charted series per group, keyed by catalog group name. */
  selectedSeries: Record<string, string>
  setActiveTab: (tab: EconomicTab) => void
  setLookback: (lookback: EconomicLookback) => void
  setGroupFilter: (filter: EconomicGroupFilter) => void
  setSearch: (search: string) => void
  setHideUnavailable: (hide: boolean) => void
  selectSeries: (group: string, seriesId: string) => void
}

export const useEconomicPage = create<EconomicState>()(
  persist(
    (set) => ({
      activeTab: 'overview',
      lookback: '5y',
      groupFilter: 'all',
      search: '',
      // A provider this network cannot reach leaves a long run of em dashes that reads as a
      // broken page, so the tables hide those by default and the status line carries the count.
      hideUnavailable: true,
      selectedSeries: {},
      setActiveTab: (activeTab) => set({ activeTab }),
      setLookback: (lookback) => set({ lookback }),
      setGroupFilter: (groupFilter) => set({ groupFilter }),
      setSearch: (search) => set({ search }),
      setHideUnavailable: (hideUnavailable) => set({ hideUnavailable }),
      selectSeries: (group, seriesId) =>
        set((state) => ({ selectedSeries: { ...state.selectedSeries, [group]: seriesId } })),
    }),
    {
      name: 'budget-terminal:economic',
      version: 1,
      partialize: (state) => ({
        activeTab: state.activeTab,
        lookback: state.lookback,
        groupFilter: state.groupFilter,
        search: state.search,
        hideUnavailable: state.hideUnavailable,
        selectedSeries: state.selectedSeries,
      }),
    },
  ),
)

/** Years of history the chart span control asks for. */
export function lookbackYears(lookback: EconomicLookback): number {
  return ECONOMIC_LOOKBACKS.find((entry) => entry.key === lookback)?.years ?? 5
}
