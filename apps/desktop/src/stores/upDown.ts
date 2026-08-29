import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { UpDownInterval, UpDownSource } from '@shared/contract'

interface UpDownState {
  activeSource: UpDownSource
  interval: UpDownInterval
  customSymbols: string[]
  setActiveSource: (activeSource: UpDownSource) => void
  setInterval: (interval: UpDownInterval) => void
  setCustomSymbols: (customSymbols: string[]) => void
}

export const useUpDownPage = create<UpDownState>()(
  persist(
    (set) => ({
      activeSource: 'portfolio',
      interval: '1d',
      customSymbols: [],
      setActiveSource: (activeSource) => set({ activeSource }),
      setInterval: (interval) => set({ interval }),
      setCustomSymbols: (customSymbols) => set({ customSymbols }),
    }),
    {
      name: 'budget-terminal:up-down',
      version: 1,
      partialize: (state) => ({
        activeSource: state.activeSource,
        interval: state.interval,
        customSymbols: state.customSymbols,
      }),
    },
  ),
)
