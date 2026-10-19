import { cache, type TtlCache } from '../cache.js'

/** Persistent failure backoff and a minimum refresh age, including across restarts. */
export function resolveEtfSnapshot<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  { force = false, minimumAgeMs = 60_000, store = cache }: {
    force?: boolean
    minimumAgeMs?: number
    store?: TtlCache
  } = {},
): Promise<T> {
  const recent = store.get<T>(key, { observe: false })
  const lastRefresh = store.get<number>(`etf-refreshed:${key}`, { observe: false })?.value
  // Source age can predate this refresh (for example, a reused directory dependency).
  // Protect the actual network attempt time, not the oldest dependency's timestamp.
  const ageMs = lastRefresh === undefined ? (recent?.ageSeconds ?? Infinity) * 1000 : Date.now() - lastRefresh
  const backedOff = store.get(`etf-backoff:${key}`, { observe: false })
  const refresh = Boolean(backedOff) || (force && (!recent || ageMs >= minimumAgeMs))
  return store.resolveWithStaleFallback(key, ttlMs, async () => {
    const failure = store.get<{ reason: string }>(`etf-backoff:${key}`, { observe: false })
    if (failure) throw new Error(failure.value.reason)
    try {
      const value = await loader()
      store.delete(`etf-backoff:${key}`)
      store.set(`etf-refreshed:${key}`, Date.now(), ttlMs)
      return value
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      store.set(`etf-backoff:${key}`, { reason }, 5 * 60_000)
      throw error
    }
  }, { force: refresh }).then(result => result.value)
}
