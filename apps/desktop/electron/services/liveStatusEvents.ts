import type { LiveStatusChanged, LiveStatusKind } from '../shared/liveStatus.js'

/** Compact dirty notifications; full snapshots stay on the existing read APIs. */
export function createLiveStatusEvents(cadence: Record<LiveStatusKind, number> = { agents: 700, notifications: 100, browser: 600 }) {
  const listeners = new Set<(event: LiveStatusChanged) => void>()
  const timers = new Map<LiveStatusKind, ReturnType<typeof setTimeout>>()
  let revision = 0
  return {
    changed(kind: LiveStatusKind) {
      if (!listeners.size || timers.has(kind)) return
      timers.set(kind, setTimeout(() => {
        timers.delete(kind)
        const event = { kind, revision: ++revision }
        for (const listener of listeners) {
          try { listener(event) } catch { /* A closing renderer cannot stop background services. */ }
        }
      }, cadence[kind]))
    },
    subscribe(listener: (event: LiveStatusChanged) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (!listeners.size) { for (const timer of timers.values()) clearTimeout(timer); timers.clear() }
      }
    },
  }
}

export const liveStatusEvents = createLiveStatusEvents()
export const agentsChanged = () => liveStatusEvents.changed('agents')

/** Telegram's flat public status has no nested mutable payload or credentials. */
export function observableStatus<T extends object>(value: T, changed: () => void): T {
  return new Proxy(value, {
    set(target, key, next) {
      if (Reflect.get(target, key) === next) return true
      Reflect.set(target, key, next)
      changed()
      return true
    },
  })
}
