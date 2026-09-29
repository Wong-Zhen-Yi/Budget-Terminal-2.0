import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { profileStorage } from './profileStorage'

import type { Envelope, Freshness } from '@shared/contract'
import { recordStartupLoad, restoreStartupLoads, type StartupLoads } from '@shared/startupLoading'
import type { PanelStatus } from '@/components/chrome/StatusBar'

/** Bounded observed feed history; restored records are explicitly historical. */
export interface HealthRecord {
  page: string
  label: string
  source: string
  freshness: Freshness
  failureReason: string
  /** Non-fatal errors that came with the payload, already flattened to one line each. */
  errors: string[]
  fetchedAt: number
  previousSession?: boolean
}

export interface StartupTiming {
  tab: string
  label: string
  durationMs: number
  failed: boolean
}

interface DataHealthState {
  records: Record<string, HealthRecord>
  record: (page: string, panels: PanelStatus[]) => void
  clear: () => void
  startup: { durationMs: number; planned: number; timings: StartupTiming[]; pageOrder?: string[] } | null
  setStartup: (startup: DataHealthState['startup']) => void
  startupLoads: StartupLoads
  recordStartupLoad: (page: string, durationMs: number, failed: boolean) => void
}

function toRecord(page: string, label: string, envelope: Envelope<unknown>): HealthRecord {
  return {
    page,
    label,
    source: envelope.meta.source,
    freshness: envelope.meta.freshness,
    failureReason: envelope.meta.failureReason ?? '',
    errors: envelope.errors.slice(0, 20).map((entry) =>
      [entry.operation, entry.symbol, entry.reason].filter(Boolean).join(' ').slice(0, 1000),
    ),
    fetchedAt: envelope.meta.fetchedAt,
  }
}

export const useDataHealth = create<DataHealthState>()(persist((set) => ({
  records: {},
  startup: null,
  setStartup: (startup) => set({ startup }),
  startupLoads: {},
  recordStartupLoad: (page, durationMs, failed) => set((state) => ({
    startupLoads: recordStartupLoad(state.startupLoads, page, durationMs, failed),
  })),

  record: (page, panels) =>
    set((state) => {
      const next = { ...state.records }
      let changed = false
      for (const panel of panels) {
        if (!panel.envelope) continue
        const key = `${page}:${panel.label}`
        const record = toRecord(page, panel.label, panel.envelope)
        // Quotes re-fetch on a timer; rewriting an identical record every minute would
        // re-render the report for no reason.
        const previous = next[key]
        if (previous && JSON.stringify(previous) === JSON.stringify(record)) continue
        next[key] = record
        changed = true
      }
      return changed ? { records: Object.fromEntries(Object.entries(next)
        .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, 200)) } : state
    }),

  clear: () => set({ records: {} }),
}), {
  name: 'budget-terminal:data-health',
  storage: profileStorage,
  partialize: (state) => ({ records: state.records, startupLoads: state.startupLoads }),
  merge: (saved, current) => {
    const records = (saved as Partial<DataHealthState> | null)?.records
    const restored = Object.entries(records ?? {}).filter(([, record]) =>
      record && typeof record.page === 'string' && typeof record.label === 'string' &&
      typeof record.source === 'string' && typeof record.failureReason === 'string' &&
      Number.isFinite(record.fetchedAt) && Array.isArray(record.errors) &&
      record.errors.every((error) => typeof error === 'string') &&
      ['failed', 'partial', 'stale', 'cached', 'fresh'].includes(record.freshness),
    ).slice(0, 200).map(([key, record]) => [key, { ...record, previousSession: true }])
    return { ...current, records: Object.fromEntries(restored),
      startupLoads: restoreStartupLoads((saved as Partial<DataHealthState> | null)?.startupLoads),
    }
  },
}))

const ORDER: Record<Freshness, number> = {
  failed: 0,
  partial: 1,
  stale: 2,
  cached: 3,
  fresh: 4,
}

/** Worst state first, so the line that matters is the one at the top of the report. */
export function sortRecords(records: Record<string, HealthRecord>): HealthRecord[] {
  return Object.values(records).sort(
    (a, b) => ORDER[a.freshness] - ORDER[b.freshness] || a.page.localeCompare(b.page),
  )
}
