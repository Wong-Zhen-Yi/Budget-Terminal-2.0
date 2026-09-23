import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { TABS } from '@shared/contract'
import { recentPages } from '@shared/navigation'
import { profileStorage } from './profileStorage'

export const useNavigation = create<{
  recent: string[]
  symbol: string
  visit: (id: string) => void
  setSymbol: (symbol: string) => void
}>()(persist((set) => ({
  recent: [],
  symbol: '',
  visit: (id) => set((state) => ({ recent: recentPages(state.recent, id) })),
  setSymbol: (symbol) => set({ symbol: symbol.trim().toUpperCase() }),
}), {
  name: 'budget-terminal:navigation',
  storage: profileStorage,
  partialize: (state) => ({ recent: state.recent, symbol: state.symbol }),
  merge: (saved, current) => {
    const value = saved as Partial<typeof current> | null
    return {
      ...current,
      recent: Array.isArray(value?.recent)
        ? [...new Set(value.recent)].filter((id) => TABS.some((tab) => tab.id === id)).slice(0, 6) : [],
      symbol: typeof value?.symbol === 'string' ? value.symbol.slice(0, 32) : '',
    }
  },
}))
