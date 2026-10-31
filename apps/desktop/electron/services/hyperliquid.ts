import type { HyperliquidPayload } from '../shared/contract.js'
import { localIsoSeconds } from '../shared/crypto.js'
import { trackApiRequest } from './apiUsage.js'
import { hyperliquidRateGate } from './hyperliquidRateGate.js'
import { parseHyperliquidMarkets } from '../shared/hyperliquid.js'
import { hyperliquidEquities } from './hyperliquidEquities.js'
import { requestPriority } from './yahoo/client.js'

export { parseHyperliquidMarkets } from '../shared/hyperliquid.js'

const INFO_URL = 'https://api.hyperliquid.xyz/info'
// metaAndAssetCtxs costs 20 weight. At most 30 requests/minute leaves headroom
// below the shared per-IP budget of 1,200 weight, even with manual refreshes.
const MIN_REQUEST_GAP_MS = 2_000

/** Public market data only: no wallet, credentials, or exchange actions. */
export class HyperliquidClient {
  private nextRequestAt = 0
  private cooldownUntil = 0
  private pending: Promise<HyperliquidPayload> | null = null
  private metadataAt = -Infinity

  constructor(
    private readonly request: typeof fetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
    private readonly stream: Pick<typeof hyperliquidEquities, 'getCryptoMarkets' | 'watchCryptoMarkets'> | null = hyperliquidEquities,
  ) {}

  getMarkets(): Promise<HyperliquidPayload> {
    const live = this.stream?.getCryptoMarkets()
    if (live && this.now() - this.metadataAt < 6 * 3600_000) return Promise.resolve(live)
    if (this.pending) return this.pending
    this.pending = this.load().finally(() => { this.pending = null })
    return this.pending
  }

  private async load(): Promise<HyperliquidPayload> {
    if (this.cooldownUntil > this.now()) {
      throw new Error(`Hyperliquid HTTP 429: retry in ${Math.ceil((this.cooldownUntil - this.now()) / 1_000)}s.`)
    }
    const delay = this.nextRequestAt - this.now()
    if (delay > 0) await this.wait(delay)
    this.nextRequestAt = this.now() + MIN_REQUEST_GAP_MS
    return hyperliquidRateGate.run(20, () => trackApiRequest('hyperliquid', async () => {
      const response = await this.request(INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        signal: AbortSignal.timeout(12_000),
      })
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After')
        const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN
        const retryAt = Number.isFinite(seconds) ? this.now() + Math.max(0, seconds) * 1_000
          : retryAfter ? Date.parse(retryAfter) : NaN
        this.cooldownUntil = Math.max(this.now() + 60_000, Number.isFinite(retryAt) ? retryAt : 0)
      }
      if (!response.ok) throw new Error(`Hyperliquid HTTP ${response.status}.`)
      const body: unknown = await response.json()
      const payload = { markets: parseHyperliquidMarkets(body), fetchedAt: localIsoSeconds(new Date(this.now())) }
      this.metadataAt = this.now()
      this.stream?.watchCryptoMarkets((body as unknown[])[0])
      return this.stream?.getCryptoMarkets() ?? payload
    }), requestPriority())
  }
}

export const hyperliquidClient = new HyperliquidClient()
