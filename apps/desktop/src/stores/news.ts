import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { NewsFilter, NewsSort } from '@shared/news'

/**
 * How the News page is being read.
 *
 * Only reading preferences persist. The free-text filter, the ticker-search box and the
 * selected article stay in the page's own `useState` — persisting a filter string would
 * open the page showing three articles with nothing on screen explaining why.
 */
interface NewsState {
  filter: NewsFilter
  sort: NewsSort
  /** Off turns the thumbnail proxy off entirely, for a slow connection. */
  showImages: boolean
  readerOpen: boolean
  readerWidth: number
  setFilter: (filter: NewsFilter) => void
  setSort: (sort: NewsSort) => void
  toggleImages: () => void
  setReaderOpen: (open: boolean) => void
  setReaderWidth: (width: number) => void
}

export const useNewsPageStore = create<NewsState>()(
  persist(
    (set) => ({
      filter: 'all',
      sort: 'newest',
      showImages: true,
      readerOpen: true,
      readerWidth: 420,
      setFilter: (filter) => set({ filter }),
      setSort: (sort) => set({ sort }),
      toggleImages: () => set((state) => ({ showImages: !state.showImages })),
      setReaderOpen: (readerOpen) => set({ readerOpen }),
      setReaderWidth: (readerWidth) => set({ readerWidth }),
    }),
    { name: 'budget-terminal:news', version: 1 },
  ),
)
