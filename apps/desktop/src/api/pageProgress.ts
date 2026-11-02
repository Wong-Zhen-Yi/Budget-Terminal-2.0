import { hashKey, type QueryKey } from '@tanstack/react-query'
import type { Envelope } from '@shared/contract'

let current: string | undefined
const previews = new Map<string, Envelope<unknown>>()
const listeners = new Map<string, Set<() => void>>()

export function trackPageQuery<T>(key: QueryKey, run: () => T): T {
  const previous = current
  current = hashKey(key)
  try { return run() } finally { current = previous }
}

export const currentPageQuery = () => current
export const pagePreview = (key: string) => previews.get(key)
export function subscribePagePreview(key: string, listener: () => void) {
  const group = listeners.get(key) ?? new Set<() => void>()
  listeners.set(key, group)
  group.add(listener)
  return () => {
    group.delete(listener)
    if (!group.size) listeners.delete(key)
  }
}
export function setPagePreview(key: string, value: Envelope<unknown> | null) {
  if (value) previews.set(key, value)
  else previews.delete(key)
  for (const listener of listeners.get(key) ?? []) listener()
}
