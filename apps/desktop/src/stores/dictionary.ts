import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DICTIONARY_CATEGORIES, DICTIONARY_ENTRIES, getDictionaryEntry } from '@shared/dictionary'
import { profileStorage } from './profileStorage'

interface DictionaryState {
  selectedEntryId: string
  category: string
  savedEntryIds: string[]
  recentEntryIds: string[]
  visit: (entryId: string) => void
  setCategory: (category: string) => void
  toggleSaved: (entryId: string) => void
}

function validIds(value: unknown, limit = DICTIONARY_ENTRIES.length): string[] {
  return Array.isArray(value)
    ? [...new Set(value.flatMap(id => typeof id === 'string' ? getDictionaryEntry(id)?.entryId ?? [] : []))].slice(0, limit)
    : []
}

export const useDictionary = create<DictionaryState>()(persist((set) => ({
  selectedEntryId: 'relative-strength-index',
  category: 'Technical Indicators',
  savedEntryIds: [],
  recentEntryIds: [],
  visit: entryId => {
    if (!getDictionaryEntry(entryId)) return
    set(state => state.selectedEntryId === entryId && state.recentEntryIds[0] === entryId ? state : ({
      selectedEntryId: entryId,
      recentEntryIds: [entryId, ...state.recentEntryIds.filter(id => id !== entryId)].slice(0, 8),
    }))
  },
  setCategory: category => set({ category: DICTIONARY_CATEGORIES.some(value => value === category) ? category : 'All categories' }),
  toggleSaved: entryId => {
    if (!getDictionaryEntry(entryId)) return
    set(state => ({ savedEntryIds: state.savedEntryIds.includes(entryId)
      ? state.savedEntryIds.filter(id => id !== entryId)
      : [...state.savedEntryIds, entryId] }))
  },
}), {
  name: 'budget-terminal:dictionary',
  storage: profileStorage,
  partialize: state => ({ selectedEntryId: state.selectedEntryId, category: state.category, savedEntryIds: state.savedEntryIds, recentEntryIds: state.recentEntryIds }),
  merge: (saved, current) => {
    const value = saved as Partial<DictionaryState> | null
    return {
      ...current,
      selectedEntryId: typeof value?.selectedEntryId === 'string'
        ? getDictionaryEntry(value.selectedEntryId)?.entryId ?? current.selectedEntryId : current.selectedEntryId,
      category: typeof value?.category === 'string' && (DICTIONARY_CATEGORIES.some(category => category === value.category) || value.category === 'All categories')
        ? value.category : current.category,
      savedEntryIds: validIds(value?.savedEntryIds),
      recentEntryIds: validIds(value?.recentEntryIds, 8),
    }
  },
}))
