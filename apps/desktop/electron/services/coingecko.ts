import { apiUsageTracker, trackApiRequest } from './apiUsage.js'
import { cache, type TtlCache } from './cache.js'
import { observeSource } from './sourceHealth.js'

export const COINGECKO_HEADERS = { 'User-Agent': 'BudgetTerminal/2.0', Accept: 'application/json' }
export const COINGECKO_TIMEOUT_MS = 12_000

/** One keyless budget for Crypto and BMNR, including queued work and manual refresh. */
export class CoinGeckoClient {
  private tail: Promise<unknown> = Promise.resolve()
  private nextRequestAt = 0
  private cooldownUntil = 0

  constructor(
    private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
    private readonly storage: TtlCache = cache,
  ) {}

  async getJson(url: string): Promise<unknown> {
    if (!url.startsWith('https://api.coingecko.com/api/v3/')) throw new Error('Invalid CoinGecko endpoint.')
    const ttl = url.includes('/companies/') ? 60 * 60_000 : url.endsWith('/global') ? 5 * 60_000 : 60_000
    const result = await this.storage.resolveWithStaleFallback(`coingecko:v1:${url}`, ttl, () => {
      const pending = this.tail.then(async () => {
        this.assertAvailable()
        const delay = this.nextRequestAt - this.now()
        if (delay > 0) await this.wait(delay)
        this.assertAvailable()
        this.nextRequestAt = this.now() + 12_100
        return trackApiRequest('coingecko', async () => {
          const response = await this.request(url, {
            headers: COINGECKO_HEADERS,
            signal: AbortSignal.timeout(COINGECKO_TIMEOUT_MS),
          })
          if (response.status === 429) {
            const retry = response.headers.get('Retry-After')
            const until = retry && Number.isFinite(Number(retry)) ? this.now() + Number(retry) * 1_000 : Date.parse(retry ?? '')
            this.cooldownUntil = Math.max(this.now() + 60_000, Number.isFinite(until) ? until : 0)
            apiUsageTracker.setCooldown('coingecko', this.cooldownUntil)
          }
          if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}.`)
          const body: unknown = await response.json()
          observeSource({ fetchedAt: this.now(), expiresAt: this.now() + ttl, stale: false, fromCache: false, failures: [], sources: ['CoinGecko'] })
          return body
        })
      })
      this.tail = pending.catch(() => undefined)
      return pending
    })
    if (result.stale && result.ageSeconds > 24 * 60 * 60) throw new Error('CoinGecko cached data is more than 24 hours old.')
    return result.value
  }

  private assertAvailable(): void {
    if (this.now() < this.cooldownUntil) {
      throw new Error(`CoinGecko HTTP 429: retry in ${Math.ceil((this.cooldownUntil - this.now()) / 1_000)}s.`)
    }
  }
}

export const coinGeckoClient = new CoinGeckoClient()
