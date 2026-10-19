import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Persist the selected fund, not duplicate holdings in localStorage. React Query and
 * the main-process disk cache retain data for 24 hours. Fresh/legacy empty sessions
 * open on SPY, which is included in startup loading before this page is visited.
 */

export type EtfSubtab = 'holdings' | 'arbitrage'

interface EtfState {
  /** The ticker the workspace is showing, which is also what the input restores to. */
  ticker: string
  subtab: EtfSubtab
  holdingsFilter: string
  aumFilter: string
  setTicker: (ticker: string) => void
  setSubtab: (subtab: EtfSubtab) => void
  setHoldingsFilter: (filter: string) => void
  setAumFilter: (filter: string) => void
}

export const useEtfPage = create<EtfState>()(
  persist(
    (set) => ({
      ticker: 'SPY',
      subtab: 'holdings',
      holdingsFilter: '',
      aumFilter: '',
      // `_p13_force_upper_input`: the field is uppercase whatever was typed into it.
      setTicker: (ticker) => set({ ticker: ticker.trim().toUpperCase() }),
      setSubtab: (subtab) => set({ subtab }),
      setHoldingsFilter: (holdingsFilter) => set({ holdingsFilter }),
      setAumFilter: (aumFilter) => set({ aumFilter }),
    }),
    {
      name: 'etf-page',
      version: 2,
      migrate: (persisted) => {
        const ticker = (persisted as { ticker?: unknown } | undefined)?.ticker
        return { ticker: typeof ticker === 'string' && ticker.trim() ? ticker.trim().toUpperCase() : 'SPY' }
      },
      merge: (persisted, current) => {
        const ticker = (persisted as { ticker?: unknown } | undefined)?.ticker
        return { ...current, ticker: typeof ticker === 'string' && ticker.trim() ? ticker.trim().toUpperCase() : 'SPY' }
      },
      partialize: (state) => ({ ticker: state.ticker }),
    },
  ),
)
