/**
 * An in-memory TTL cache with single-flight coalescing.
 *
 * Two roles, both taken from the PySide6 app: `CacheManager` keeps a Reload from
 * refetching everything, and `DashboardFetchCoordinator` collapses identical in-flight
 * requests so two panels asking for the same symbol cause one upstream fetch.
 */

interface Entry<T> {
  value: T
  storedAt: number
  ttlMs: number
}

export const TTL = {
  quotes: 30_000,
  chartIntraday: 60_000,
  chartDaily: 5 * 60_000,
  options: 5 * 60_000,
  targets: 30 * 60_000,
  news: 10 * 60_000,
  profile: 12 * 60 * 60_000,
  // The Personal Finance page refreshes FX on the reference's 300s cadence.
  fx: 5 * 60_000,
  // CNN recomputes the Fear & Greed score a few times an hour; the Pre-Market page's own
  // refresh is every 15 minutes, so this only collapses a Reload landing on top of one.
  fearGreed: 5 * 60_000,
  // Trading Volumes costs a 12-page screen plus 100 daily charts, so it is the most
  // expensive load in the app. The reference has no refresh timer at all; this only
  // stops a page revisit from paying for the whole thing again.
  tradingVolumes: 15 * 60_000,
  // The News page is a second, wider news query than the Dashboard panel above, on the
  // reference's own 15-minute `_DETAILS_CACHE_TTL_SECONDS`. Two entries, because the two
  // paths ask Yahoo for different things and must not share a cache key.
  newsPage: 15 * 60_000,
  newsFeed: 15 * 60_000,
  newsPreview: 30 * 60_000,
  // A publisher thumbnail is immutable once fetched; the long TTL is what keeps a card
  // grid from re-downloading a hundred images every time the page is revisited.
  newsImage: 6 * 60 * 60_000,
  // The Crypto page has no refresh timer, like the reference's `init_page19`. This only
  // stops a tab revisit from spending CoinGecko's free-tier rate budget again.
  crypto: 5 * 60_000,
  // The BMNR page: one CoinGecko call, two SEC calls behind their own six-hour disk cache
  // and three Yahoo quotes. Matched to `crypto` because it is the same CoinGecko free tier
  // and the same rate budget, and the page has no refresh timer either.
  bmnr: 5 * 60_000,
} as const

export interface CachedResult<T> {
  value: T
  /** Age of the returned value in seconds; 0 when it was fetched just now. */
  ageSeconds: number
  fromCache: boolean
}

export class TtlCache {
  private readonly entries = new Map<string, Entry<unknown>>()
  private readonly inFlight = new Map<string, Promise<unknown>>()

  get<T>(key: string, { allowStale = false } = {}): CachedResult<T> | null {
    const entry = this.entries.get(key) as Entry<T> | undefined
    if (!entry) return null
    const ageMs = Date.now() - entry.storedAt
    if (ageMs > entry.ttlMs && !allowStale) return null
    return { value: entry.value, ageSeconds: ageMs / 1000, fromCache: true }
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.entries.set(key, { value, storedAt: Date.now(), ttlMs })
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  /**
   * Return the cached value, or run `loader` once for all concurrent callers.
   * `force` skips the freshness check but still joins an in-flight load.
   */
  async resolve<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
    { force = false } = {},
  ): Promise<CachedResult<T>> {
    if (!force) {
      const hit = this.get<T>(key)
      if (hit) return hit
    }
    const existing = this.inFlight.get(key) as Promise<T> | undefined
    if (existing) return { value: await existing, ageSeconds: 0, fromCache: false }

    const pending = loader()
      .then((value) => {
        this.set(key, value, ttlMs)
        return value
      })
      .finally(() => {
        this.inFlight.delete(key)
      })
    this.inFlight.set(key, pending)
    return { value: await pending, ageSeconds: 0, fromCache: false }
  }

  /**
   * Like `resolve`, but on failure falls back to a stale entry when one exists.
   * Returns `stale: true` so the caller can mark the envelope accordingly.
   */
  async resolveWithStaleFallback<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
    { force = false } = {},
  ): Promise<CachedResult<T> & { stale: boolean }> {
    try {
      const result = await this.resolve(key, ttlMs, loader, { force })
      return { ...result, stale: false }
    } catch (error) {
      const stale = this.get<T>(key, { allowStale: true })
      if (stale) return { ...stale, stale: true }
      throw error
    }
  }
}

export const cache = new TtlCache()
