import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { normalizeScorecardPreferences, SCORECARD_MAX_SAVED, type ScorecardMetricKey, type ScorecardPreferences } from '@shared/scorecard'
import { profileStorage } from './profileStorage'

interface ScorecardState extends ScorecardPreferences {
  setSymbols: (symbols: string[]) => void
  toggleColumn: (key: ScorecardMetricKey) => void
  setChartMetric: (key: ScorecardMetricKey) => void
  saveComparison: (name: string) => string
  loadComparison: (id: string) => void
  deleteComparison: (id: string) => void
}

export const useScorecard = create<ScorecardState>()(persist((set, get) => ({
  ...normalizeScorecardPreferences(null),
  setSymbols: symbols => set({ symbols: [...symbols] }),
  toggleColumn: key => set(state => ({ columns: state.columns.includes(key)
    ? state.columns.length > 1 ? state.columns.filter(column => column !== key) : state.columns
    : [...state.columns, key] })),
  setChartMetric: chartMetric => set({ chartMetric }),
  saveComparison: input => {
    const state = get()
    const name = input.trim().slice(0, 60)
    if (!name) return 'Enter a name for this comparison.'
    const existing = state.comparisons.find(entry => entry.name.toLowerCase() === name.toLowerCase())
    if (!existing && state.comparisons.length >= SCORECARD_MAX_SAVED) return `You can save up to ${SCORECARD_MAX_SAVED} comparisons. Delete one first.`
    const id = existing?.id ?? crypto.randomUUID()
    const comparison = { id, name, symbols: [...state.symbols], columns: [...state.columns], chartMetric: state.chartMetric }
    set({ comparisons: existing ? state.comparisons.map(entry => entry.id === id ? comparison : entry) : [...state.comparisons, comparison], selectedId: id })
    return ''
  },
  loadComparison: id => {
    const saved = get().comparisons.find(entry => entry.id === id)
    if (saved) set({ symbols: [...saved.symbols], columns: [...saved.columns], chartMetric: saved.chartMetric, selectedId: id })
  },
  deleteComparison: id => set(state => ({ comparisons: state.comparisons.filter(entry => entry.id !== id), selectedId: state.selectedId === id ? '' : state.selectedId })),
}), {
  name: 'budget-terminal:scorecard',
  storage: profileStorage,
  partialize: state => ({ symbols: state.symbols, columns: state.columns, chartMetric: state.chartMetric, comparisons: state.comparisons, selectedId: state.selectedId }),
  merge: (saved, current) => ({ ...current, ...normalizeScorecardPreferences(saved) }),
}))
