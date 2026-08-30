import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * The IPO page's session state.
 *
 * The reference persists nothing at all for this page — `grep -i ipo` over
 * `persistence.py` and `session_cache.py` returns no hits, and its two feeds live only in
 * their own JSON cache files. The one thing worth carrying across a restart here is the
 * completed year, because it is the only choice the page offers; the rows themselves are
 * already on disk in the main process.
 *
 * `_p21_completed_year` is read from `date.today().year` when the page is built, which is
 * why a persisted year from a session left open across New Year is normalised back to the
 * current one on read.
 */

interface IpoState {
  /** The year the completed table is showing. */
  completedYear: number
  setCompletedYear: (year: number) => void
}

function currentYear(): number {
  return new Date().getFullYear()
}

export const useIpoPage = create<IpoState>()(
  persist(
    (set) => ({
      completedYear: currentYear(),
      setCompletedYear: (completedYear) =>
        set({ completedYear: Number.isFinite(completedYear) ? completedYear : currentYear() }),
    }),
    {
      name: 'ipo-page',
      version: 1,
      partialize: (state) => ({ completedYear: state.completedYear }),
    },
  ),
)
