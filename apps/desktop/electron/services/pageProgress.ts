import { AsyncLocalStorage } from 'node:async_hooks'
import type { Envelope } from '../shared/contract.js'

const context = new AsyncLocalStorage<{ key: string; preview: Envelope<unknown> | null }>()
const active = new Map<string, { key: string; preview: Envelope<unknown> | null }>()

export function readPageProgress(key: string): Envelope<unknown> | null {
  return active.get(key)?.preview ?? null
}

/** Request-scoped previews are never persisted or counted as completed data. */
export async function withPageProgress<T>(key: string, run: () => Promise<T>): Promise<T> {
  const state = { key, preview: null as Envelope<unknown> | null }
  active.set(key, state)
  try { return await context.run(state, run) } finally {
    if (active.get(key) === state) active.delete(key)
  }
}

export function publishPageProgress(data: unknown, source: string, errors: Envelope<unknown>['errors'] = [], channel?: string): void {
  const state = context.getStore()
  if (!state || !channel || !state.key.startsWith(`${channel}:`)) return
  state.preview = structuredClone({ data, errors, meta: {
    source, fetchedAt: Date.now(), freshness: 'partial', failureReason: 'Loading remaining data…',
  } })
}

/** Preserve input ordering while reporting each independently completed source. */
export async function progressiveAll<T extends readonly unknown[]>(
  tasks: { [K in keyof T]: Promise<T[K]> },
  publish: (values: Partial<T>) => void,
): Promise<T> {
  const values: Partial<T> = [] as unknown as Partial<T>
  return Promise.all(tasks.map(async (task, index) => {
    const value = await task
    Object.assign(values, { [index]: value })
    publish(values)
    return value
  })) as Promise<unknown> as Promise<T>
}
