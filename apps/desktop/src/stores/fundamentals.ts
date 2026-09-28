import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { FundamentalsPagePayload } from '@shared/contract'
import type { FundamentalsGrowthBasis, FundamentalsPeriod } from '@shared/fundamentalsPage'
import {
  FUNDAMENTALS_DEFAULT_PERIODS,
  normalizePeriodCount,
} from '@shared/fundamentalsPage'

interface FundamentalsState {
  symbol: string
  compareSymbol: string
  period: FundamentalsPeriod
  periodCount: number
  indexed: boolean
  growthBasis: FundamentalsGrowthBasis
  snapshot: FundamentalsPagePayload | null

  setSymbol: (symbol: string) => void
  setCompareSymbol: (symbol: string) => void
  setPeriod: (period: FundamentalsPeriod) => void
  setPeriodCount: (count: number) => void
  toggleIndexed: () => void
  setGrowthBasis: (basis: FundamentalsGrowthBasis) => void
  setSnapshot: (snapshot: FundamentalsPagePayload) => void
}

const defaults = {
  symbol: '',
  compareSymbol: '',
  period: 'annual' as const,
  periodCount: FUNDAMENTALS_DEFAULT_PERIODS,
  indexed: false,
  growthBasis: 'year_ago' as const,
  snapshot: null,
}

export function migrateFundamentalsState(persisted: unknown): Partial<FundamentalsState> {
  return { ...(persisted as Partial<FundamentalsState>), indexed: false }
}

export const useFundamentalsStore = create<FundamentalsState>()(
  persist(
    (set) => ({
      ...defaults,
      setSymbol: (symbol) => set({ symbol: symbol.trim().toUpperCase() }),
      setCompareSymbol: (compareSymbol) => set({ compareSymbol: compareSymbol.trim().toUpperCase().slice(0, 12) }),
      setPeriod: (period) => set({ period }),
      setPeriodCount: (periodCount) => set({ periodCount: normalizePeriodCount(periodCount) }),
      toggleIndexed: () => set((state) => ({ indexed: !state.indexed })),
      setGrowthBasis: (growthBasis) => set({ growthBasis }),
      setSnapshot: (snapshot) => set({ snapshot }),
    }),
    {
      name: 'budget-terminal:fundamentals',
      version: 2,
      migrate: migrateFundamentalsState,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<FundamentalsState>
        return {
          ...current,
          symbol: String(saved.symbol ?? '').trim().toUpperCase(),
          compareSymbol: String(saved.compareSymbol ?? '').trim().toUpperCase().slice(0, 12),
          period: saved.period === 'quarterly' ? 'quarterly' : 'annual',
          periodCount: normalizePeriodCount(saved.periodCount),
          indexed: typeof saved.indexed === 'boolean' ? saved.indexed : false,
          growthBasis: saved.growthBasis === 'prior_period' ? 'prior_period' : 'year_ago',
          snapshot: saved.snapshot?.symbol ? saved.snapshot : null,
        }
      },
    },
  ),
)
