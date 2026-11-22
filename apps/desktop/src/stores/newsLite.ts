import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { NewsArticle } from '@shared/contract'
import { profileStorage } from './profileStorage'

interface NewsLiteReadingState {
  saved: Record<string, NewsArticle[]>
  read: string[]
  toggleSaved: (id: string, articles: NewsArticle[]) => void
  toggleRead: (id: string) => void
}

export const useNewsLiteReading = create<NewsLiteReadingState>()(persist(
  set => ({
    saved: {},
    read: [],
    toggleSaved: (id, articles) => set(state => {
      const saved = { ...state.saved }
      if (saved[id]) delete saved[id]
      else saved[id] = articles.map(article => ({ ...article, imageUrl: '' }))
      return { saved }
    }),
    toggleRead: id => set(state => ({
      read: state.read.includes(id) ? state.read.filter(key => key !== id) : [...state.read.slice(-1999), id],
    })),
  }),
  { name: 'budget-terminal:news-lite', storage: profileStorage, partialize: ({ saved, read }) => ({ saved, read }) },
))
