import { createJSONStorage } from 'zustand/middleware'

/** Optional UI history must not interrupt a page when browser storage is full/blocked. */
export const profileStorage = createJSONStorage(() => ({
  getItem: (key: string) => {
    try { return window.localStorage.getItem(key) } catch { return null }
  },
  setItem: (key: string, value: string) => {
    try { window.localStorage.setItem(key, value) } catch { /* Keep session state usable. */ }
  },
  removeItem: (key: string) => {
    try { window.localStorage.removeItem(key) } catch { /* Storage may be disabled. */ }
  },
}))
