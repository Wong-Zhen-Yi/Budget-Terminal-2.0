import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { GlobalInterval } from '@shared/contract'

/**
 * The Global page's own view state.
 *
 * The reference persists only the interval (`_normalize_global_page_settings`). The
 * fullscreen flag is ours: the map is the page, so it opens filling the whole page area
 * with the index table hidden, and the toggle is remembered from then on.
 */
interface GlobalState {
  interval: GlobalInterval
  /** When true the map takes the whole page area and the table is not rendered. */
  mapFullscreen: boolean

  setInterval: (interval: GlobalInterval) => void
  toggleMapFullscreen: () => void
}

export const useGlobalPage = create<GlobalState>()(
  persist(
    (set) => ({
      interval: '1D',
      mapFullscreen: true,

      setInterval: (interval) => set({ interval }),
      toggleMapFullscreen: () => set((state) => ({ mapFullscreen: !state.mapFullscreen })),
    }),
    { name: 'budget-terminal:global', version: 1 },
  ),
)
