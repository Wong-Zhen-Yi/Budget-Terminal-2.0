import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * The ETF page's session state, standing in for `_p13_session_snapshot` /
 * `_p13_restore_session_snapshot`.
 *
 * Only the ticker is persisted, not the result. The reference stores the whole
 * `EtfHoldingsResult` because its tab-session snapshot is the only thing that survives a
 * restart; here the main process already caches the issuer file for six hours, so
 * persisting the payload as well would put a five-hundred-row book in browser storage to
 * save a request that is already free — and `_p13_restore_startup_session` re-requests
 * the ticker on restore anyway.
 *
 * The two filter boxes and the active subtab are session-only, exactly as they are
 * there: `_p13_holdings_filter` and `_p13_aum_filter` are plain attributes, not snapshot
 * fields.
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
      ticker: '',
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
      version: 1,
      partialize: (state) => ({ ticker: state.ticker }),
    },
  ),
)
