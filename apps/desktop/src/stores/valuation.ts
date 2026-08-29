import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  normalizeValuationAssumptions,
  type ValuationAssumptions,
} from '@shared/valuation'

/**
 * The Valuation page's persisted state, standing in for the reference's
 * `load_valuation_page_settings` / `save_valuation_page_settings` pair.
 *
 * Everything here is keyed by ticker, exactly as the reference stores it: assumptions,
 * notes and custom peers all belong to one company, not to the page. Assumptions survive
 * as the *first-paint* defaults only — a load always re-derives, so a saved set is what
 * you see before a fetch answers and never an input to the derivation.
 */

export type ValuationTab = 'main' | 'scenarios' | 'peers' | 'risk' | 'trends' | 'notes' | 'sources'

interface ValuationState {
  ticker: string
  activeTab: ValuationTab
  assumptionsByTicker: Record<string, ValuationAssumptions>
  notesByTicker: Record<string, string>
  customPeersByTicker: Record<string, string[]>
  setTicker: (ticker: string) => void
  setActiveTab: (activeTab: ValuationTab) => void
  setAssumptions: (ticker: string, assumptions: ValuationAssumptions) => void
  setNotes: (ticker: string, notes: string) => void
  addCustomPeer: (ticker: string, peer: string) => void
  removeCustomPeer: (ticker: string, peer: string) => void
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase()
}

export const useValuationPage = create<ValuationState>()(
  persist(
    (set) => ({
      ticker: 'NVDA',
      activeTab: 'main',
      assumptionsByTicker: {},
      notesByTicker: {},
      customPeersByTicker: {},
      setTicker: (ticker) => set({ ticker: normalizeSymbol(ticker) }),
      setActiveTab: (activeTab) => set({ activeTab }),
      setAssumptions: (ticker, assumptions) =>
        set((state) => ({
          assumptionsByTicker: {
            ...state.assumptionsByTicker,
            [normalizeSymbol(ticker)]: normalizeValuationAssumptions(assumptions),
          },
        })),
      setNotes: (ticker, notes) =>
        set((state) => {
          const key = normalizeSymbol(ticker)
          const next = { ...state.notesByTicker }
          // An emptied note drops its key rather than persisting a blank string, so the
          // Notes tab's per-ticker map stays the list of tickers that actually have one.
          if (notes.trim()) next[key] = notes
          else delete next[key]
          return { notesByTicker: next }
        }),
      addCustomPeer: (ticker, peer) =>
        set((state) => {
          const key = normalizeSymbol(ticker)
          const symbol = normalizeSymbol(peer)
          if (!key || !symbol || symbol === key) return {}
          const existing = state.customPeersByTicker[key] ?? []
          if (existing.includes(symbol)) return {}
          return {
            customPeersByTicker: { ...state.customPeersByTicker, [key]: [...existing, symbol] },
          }
        }),
      removeCustomPeer: (ticker, peer) =>
        set((state) => {
          const key = normalizeSymbol(ticker)
          const symbol = normalizeSymbol(peer)
          const remaining = (state.customPeersByTicker[key] ?? []).filter((item) => item !== symbol)
          const next = { ...state.customPeersByTicker }
          if (remaining.length) next[key] = remaining
          else delete next[key]
          return { customPeersByTicker: next }
        }),
    }),
    {
      name: 'budget-terminal:valuation',
      version: 1,
      partialize: (state) => ({
        ticker: state.ticker,
        activeTab: state.activeTab,
        assumptionsByTicker: state.assumptionsByTicker,
        notesByTicker: state.notesByTicker,
        customPeersByTicker: state.customPeersByTicker,
      }),
    },
  ),
)

/** The saved assumptions for one ticker, or the normalized defaults when it has none. */
export function savedAssumptions(
  assumptionsByTicker: Record<string, ValuationAssumptions>,
  ticker: string,
): ValuationAssumptions {
  return normalizeValuationAssumptions(assumptionsByTicker[normalizeSymbol(ticker)])
}
