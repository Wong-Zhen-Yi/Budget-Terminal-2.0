import { create } from 'zustand'
import type { ForexPair, ForexRange } from '@shared/forex'

export const useForexStore = create<{
  pair: ForexPair
  range: ForexRange
  setPair: (pair: ForexPair) => void
  setRange: (range: ForexRange) => void
}>((set) => ({
  pair: 'EUR/USD', range: '1M',
  setPair: (pair) => set({ pair }),
  setRange: (range) => set({ range }),
}))
