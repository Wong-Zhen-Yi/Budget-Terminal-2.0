import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { profileStorage } from './profileStorage'

export const useDefeatBetaTerminal = create<{ symbol: string; setSymbol: (symbol: string) => void }>()(persist(set => ({
  symbol: 'AAPL',
  setSymbol: symbol => set({ symbol }),
}), { name: 'budget-terminal:defeatbeta', storage: profileStorage,
  merge: (saved, current) => {
    const symbol = (saved as { symbol?: unknown } | null)?.symbol
    return { ...current, symbol: typeof symbol === 'string' && /^[A-Z][A-Z0-9-]{0,14}$/.test(symbol) ? symbol : 'AAPL' }
  },
}))
