import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  addMonths,
  startOfWeek,
  type CalendarTimezoneId,
  type EarningsRangeMode,
  type EarningsTiming,
} from '@shared/calendar'

type CalendarSubTab = 'calendar' | 'earnings'

interface CalendarState {
  initialized: boolean
  subTab: CalendarSubTab
  timezone: CalendarTimezoneId
  year: number
  month: number
  showEconomic: boolean
  showCompany: boolean
  showOptions: boolean
  showMarketHolidays: boolean
  earningsMode: EarningsRangeMode
  earningsYear: number
  earningsWeekStart: string
  earningsSearch: string
  earningsTiming: EarningsTiming
  earningsChangedOnly: boolean

  setSubTab: (subTab: CalendarSubTab) => void
  initialize: (today: string) => void
  setTimezone: (timezone: CalendarTimezoneId, today: string) => void
  changeMonth: (delta: number) => void
  setPresentMonth: (today: string) => void
  setCategory: (
    category: 'showEconomic' | 'showCompany' | 'showOptions' | 'showMarketHolidays',
    visible: boolean,
  ) => void
  setEarningsMode: (earningsMode: EarningsRangeMode) => void
  setEarningsYear: (earningsYear: number) => void
  setEarningsWeekStart: (earningsWeekStart: string) => void
  setEarningsSearch: (earningsSearch: string) => void
  setEarningsTiming: (earningsTiming: EarningsTiming) => void
  setEarningsChangedOnly: (earningsChangedOnly: boolean) => void
}

const today = new Date().toISOString().slice(0, 10)
const currentYear = Number(today.slice(0, 4))

export const useCalendarPage = create<CalendarState>()(
  persist(
    (set) => ({
      initialized: false,
      subTab: 'calendar',
      timezone: 'local',
      year: currentYear,
      month: Number(today.slice(5, 7)),
      showEconomic: true,
      showCompany: true,
      showOptions: true,
      showMarketHolidays: true,
      earningsMode: 'year',
      earningsYear: currentYear,
      earningsWeekStart: startOfWeek(today),
      earningsSearch: '',
      earningsTiming: 'all',
      earningsChangedOnly: false,

      setSubTab: (subTab) => set({ subTab }),
      initialize: (present) =>
        set((state) => state.initialized ? {} : {
          initialized: true,
          year: Number(present.slice(0, 4)),
          month: Number(present.slice(5, 7)),
          earningsYear: Number(present.slice(0, 4)),
          earningsWeekStart: startOfWeek(present),
        }),
      setTimezone: (timezone, present) =>
        set({ timezone, year: Number(present.slice(0, 4)), month: Number(present.slice(5, 7)) }),
      changeMonth: (delta) =>
        set((state) => ({ ...addMonths(state.year, state.month, delta) })),
      setPresentMonth: (present) =>
        set({ year: Number(present.slice(0, 4)), month: Number(present.slice(5, 7)) }),
      setCategory: (category, visible) => set({ [category]: visible }),
      setEarningsMode: (earningsMode) => set({ earningsMode }),
      setEarningsYear: (earningsYear) => set({ earningsYear }),
      setEarningsWeekStart: (earningsWeekStart) => set({ earningsWeekStart }),
      setEarningsSearch: (earningsSearch) => set({ earningsSearch }),
      setEarningsTiming: (earningsTiming) => set({ earningsTiming }),
      setEarningsChangedOnly: (earningsChangedOnly) => set({ earningsChangedOnly }),
    }),
    {
      name: 'budget-terminal:calendar',
      version: 1,
      partialize: (state) => ({ timezone: state.timezone }),
    },
  ),
)
