import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { profileStorage } from './profileStorage'

/** Device-only presentation preference. Credentials remain in main-process safeStorage. */
export const useAuthPrompt = create<{
  hidden: boolean
  setHidden: (hidden: boolean) => void
}>()(persist((set) => ({
  hidden: false,
  setHidden: (hidden) => set({ hidden }),
}), {
  name: 'budget-terminal:auth-prompt',
  storage: profileStorage,
  partialize: (state) => ({ hidden: state.hidden }),
  merge: (saved, current) => ({ ...current, hidden: (saved as { hidden?: unknown } | null)?.hidden === true }),
}))
