import { create } from 'zustand'
import type { ChartsInterval } from '@shared/contract'

export const useCryptoWorkspace = create<{
  symbol: string
  interval: ChartsInterval
  selectSymbol: (symbol: string) => void
  setInterval: (interval: ChartsInterval) => void
}>(set => ({
  symbol: 'BTC',
  interval: '1 Hour',
  selectSymbol: symbol => set({ symbol }),
  setInterval: interval => set({ interval }),
}))
