import { create } from 'zustand'

import type { Envelope, Freshness } from '@shared/contract'
import type { PanelStatus } from '@/components/chrome/StatusBar'

/**
 * A session-only log of what every panel's feed did.
 *
 * The reference's Data Health view is built the same way — it never touches disk, and a
 * restart starts it empty. Every page already reports its envelopes to the status bar,
 * so recording them there costs nothing and gives the Settings page something to show
 * for pages that are not currently mounted.
 */
export interface HealthRecord {
  page: string
  label: string
  source: string
  freshness: Freshness
  failureReason: string
  /** Non-fatal errors that came with the payload, already flattened to one line each. */
  errors: string[]
  fetchedAt: number
}

interface DataHealthState {
  records: Record<string, HealthRecord>
  record: (page: string, panels: PanelStatus[]) => void
  clear: () => void
}

function toRecord(page: string, label: string, envelope: Envelope<unknown>): HealthRecord {
  return {
    page,
    label,
    source: envelope.meta.source,
    freshness: envelope.meta.freshness,
    failureReason: envelope.meta.failureReason ?? '',
    errors: envelope.errors.map((entry) =>
      [entry.operation, entry.symbol, entry.reason].filter(Boolean).join(' '),
    ),
    fetchedAt: envelope.meta.fetchedAt,
  }
}

export const useDataHealth = create<DataHealthState>((set) => ({
  records: {},

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
        if (previous && previous.fetchedAt === record.fetchedAt) continue
        next[key] = record
        changed = true
      }
      return changed ? { records: next } : state
    }),

  clear: () => set({ records: {} }),
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
