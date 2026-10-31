import type { HyperliquidMarket, HyperliquidPayload } from '../shared/contract.js'
import { localIsoSeconds } from '../shared/crypto.js'
import { trackApiRequest } from './apiUsage.js'

const INFO_URL = 'https://api.hyperliquid.xyz/info'
// metaAndAssetCtxs costs 20 weight. At most 30 requests/minute leaves headroom
// below the shared per-IP budget of 1,200 weight, even with manual refreshes.
const MIN_REQUEST_GAP_MS = 2_000

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function number(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

/** Metadata and asset contexts align by index, including delisted assets. */
export function parseHyperliquidMarkets(body: unknown): HyperliquidMarket[] {
  if (!Array.isArray(body) || body.length !== 2) throw new Error('Invalid Hyperliquid response.')
  const universe = record(body[0])?.universe
  const contexts: unknown = body[1]
  if (!Array.isArray(universe) || !Array.isArray(contexts) || universe.length !== contexts.length) {
    throw new Error('Hyperliquid metadata and market contexts do not match.')
  }
  const markets: HyperliquidMarket[] = []
  const symbols = new Set<string>()
  for (let index = 0; index < universe.length; index += 1) {
    const asset = record(universe[index])
    if (asset?.isDelisted === true) continue
    const symbol = typeof asset?.name === 'string' ? asset.name.trim() : ''
    const context = record(contexts[index])
    const markPrice = number(context?.markPx)
    const funding = number(context?.funding)
    const openInterest = number(context?.openInterest)
    const volume24hUsd = number(context?.dayNtlVlm)
    const previous = number(context?.prevDayPx)
    if (!symbol || symbols.has(symbol) || markPrice === null || markPrice <= 0
      || funding === null || openInterest === null || openInterest < 0
      || volume24hUsd === null || volume24hUsd < 0) {
      throw new Error(`Incomplete Hyperliquid market data for ${symbol || `asset ${index}`}.`)
    }
    const fundingHourlyPct = funding * 100
    const openInterestUsd = openInterest * markPrice
    const changePct = previous !== null && previous > 0 ? (markPrice / previous - 1) * 100 : null
    if (!Number.isFinite(fundingHourlyPct) || !Number.isFinite(openInterestUsd)
      || (changePct !== null && !Number.isFinite(changePct))) {
      throw new Error(`Invalid Hyperliquid market values for ${symbol}.`)
    }
    symbols.add(symbol)
    markets.push({ symbol, markPrice, changePct, fundingHourlyPct, openInterestUsd, volume24hUsd })
  }
  if (!markets.length) throw new Error('Hyperliquid returned no active perpetual markets.')
  return markets.sort((a, b) => b.volume24hUsd - a.volume24hUsd || a.symbol.localeCompare(b.symbol))
}

/** Public market data only: no wallet, credentials, or exchange actions. */
export class HyperliquidClient {
  private nextRequestAt = 0
  private cooldownUntil = 0
  private pending: Promise<HyperliquidPayload> | null = null

  constructor(
    private readonly request: typeof fetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  ) {}

  getMarkets(): Promise<HyperliquidPayload> {
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
    return trackApiRequest('hyperliquid', async () => {
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
      return { markets: parseHyperliquidMarkets(await response.json()), fetchedAt: localIsoSeconds(new Date(this.now())) }
    })
  }
}

export const hyperliquidClient = new HyperliquidClient()
