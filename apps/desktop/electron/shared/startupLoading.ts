import { TABS } from './contract.js'

export interface StartupLoad {
  durationMs: number
  samples: number
}

export type StartupLoads = Record<string, StartupLoad>

const PAGE_IDS = new Set(TABS.filter((tab) => tab.implemented).map((tab) => tab.id))

/** Unknown pages get an early sample; preferences break ties between equal costs. */
export function startupPageOrder(priority: readonly string[], loads: StartupLoads): string[] {
  return [...priority].sort((a, b) => (loads[a]?.durationMs ?? 0) - (loads[b]?.durationMs ?? 0))
}

/** Smooth successful page durations across launches; retain costs on instant cache reads. */
export function recordStartupLoad(loads: StartupLoads, page: string, durationMs: number, failed: boolean): StartupLoads {
  if (!PAGE_IDS.has(page) || failed || !Number.isFinite(durationMs) || durationMs < 0) return loads
  const previous = loads[page]
  if (previous && durationMs < 100) return loads
  return { ...loads, [page]: {
    durationMs: previous ? previous.durationMs * 0.7 + durationMs * 0.3 : durationMs,
    samples: Math.min(10_000, (previous?.samples ?? 0) + 1),
  } }
}

export function restoreStartupLoads(saved: unknown): StartupLoads {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
  return Object.fromEntries(Object.entries(saved).filter(([page, entry]) =>
    PAGE_IDS.has(page) && entry && typeof entry === 'object' &&
    Number.isFinite(entry.durationMs) && entry.durationMs >= 0 &&
    Number.isSafeInteger(entry.samples) && entry.samples > 0 && entry.samples <= 10_000,
  ).map(([page, entry]) => [page, { durationMs: entry.durationMs, samples: entry.samples }]))
}
