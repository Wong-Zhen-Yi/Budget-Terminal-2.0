import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { StocksPayload, StocksRangePreset } from '@shared/contract'

const STORE_VERSION = 1

interface StocksPageState {
  symbol: string
  autoFollow: boolean
  mfiEnabled: boolean
  rangePreset: StocksRangePreset
  mainSizes: [number, number, number]
  leftSizes: [number, number, number]
  middleSizes: [number, number, number]
  snapshot: StocksPayload | null
  logicalRange: { from: number; to: number } | null

  setSymbol: (symbol: string) => void
  toggleAutoFollow: () => void
  toggleMfi: () => void
  setRangePreset: (range: StocksRangePreset) => void
  setMainSizes: (sizes: [number, number, number]) => void
  setLeftSizes: (sizes: [number, number, number]) => void
  setMiddleSizes: (sizes: [number, number, number]) => void
  setSnapshot: (payload: StocksPayload) => void
  setLogicalRange: (range: { from: number; to: number } | null) => void
}

function positiveSizes(
  sizes: [number, number, number],
  fallback: [number, number, number],
): [number, number, number] {
  return sizes.every((value) => Number.isFinite(value) && value > 0) ? sizes : fallback
}

export const useStocksPage = create<StocksPageState>()(
  persist(
    (set) => ({
      symbol: 'SPY',
      autoFollow: true,
      mfiEnabled: false,
      rangePreset: '',
      mainSizes: [3, 3, 5],
      leftSizes: [430, 150, 330],
      middleSizes: [2, 2, 3],
      snapshot: null,
      logicalRange: null,

      setSymbol: (value) => set({ symbol: value.trim().toUpperCase() || 'SPY' }),
      toggleAutoFollow: () => set((state) => ({ autoFollow: !state.autoFollow })),
      toggleMfi: () => set((state) => ({ mfiEnabled: !state.mfiEnabled })),
      setRangePreset: (rangePreset) => set({ rangePreset }),
      setMainSizes: (sizes) => set({ mainSizes: positiveSizes(sizes, [3, 3, 5]) }),
      setLeftSizes: (sizes) => set({ leftSizes: positiveSizes(sizes, [430, 150, 330]) }),
      setMiddleSizes: (sizes) => set({ middleSizes: positiveSizes(sizes, [2, 2, 3]) }),
      setSnapshot: (snapshot) => set({ snapshot }),
      setLogicalRange: (logicalRange) => set({ logicalRange }),
    }),
    {
      name: 'budget-terminal:stocks',
      version: STORE_VERSION,
    },
  ),
)
