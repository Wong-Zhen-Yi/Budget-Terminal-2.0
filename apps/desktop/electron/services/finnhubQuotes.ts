import type { Quote } from '../shared/contract.js'
import type { CachedResult } from './cache.js'
import { apiUsageTracker, trackApiRequest } from './apiUsage.js'
import { observeSource } from './sourceHealth.js'

const QUOTE_TTL = 30_000
type QuoteResult = CachedResult<Quote> & { stale: boolean }

/** US listings and share classes only. Other instruments retain their existing providers. */
export function finnhubSymbol(symbol: string): string | undefined {
  return /^[A-Z][A-Z0-9]{0,9}(?:[.-][AB])?$/.test(symbol) ? symbol.replace('-', '.') : undefined
}

export class FinnhubQuotes {
  private credential?: Promise<string | undefined>
  private generation = 0
  private enabled = false
  private quotes = new Map<string, { value: Quote; fetchedAt: number }>()
  private pending = new Map<string, Promise<QuoteResult>>()
  private active = 0
  private waiters: Array<() => void> = []
  private watched = new Map<string, number>()
  private times: number[] = []
  private until = 0
  private listeners = new Set<(quote: Quote) => void>()

  constructor(
    private getKey: () => Promise<string | undefined>,
    private request: typeof fetch = (...args) => fetch(...args),
    private now = Date.now,
  ) {}

  setCredentialLoader(loader: () => Promise<string | undefined>): void {
    this.getKey = loader
    this.credentialsChanged()
  }

  async configured(symbol: string): Promise<boolean> {
    if (!finnhubSymbol(symbol)) return false
    const generation = this.generation
    try {
      const key = await (this.credential ??= this.getKey())
      if (generation !== this.generation) return this.configured(symbol)
      this.enabled = Boolean(key)
      return this.enabled
    }
    catch { return false }
  }

  credentialsChanged(): void {
    this.generation += 1
    this.enabled = false
    this.credential = undefined
    this.quotes.clear()
    this.pending.clear()
    this.until = 0
    // Keep the request budget across key changes; saving a key must not bypass it.
  }

  prefers(symbol: string): boolean {
    return this.enabled && Boolean(finnhubSymbol(symbol))
  }

  subscribe(listener: (quote: Quote) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Rotate all requested stock symbols within the shared minute budget. */
  async poll(): Promise<void> {
    const next = [...this.watched].sort((a, b) => a[1] - b[1])
      .find(([symbol, checkedAt]) => !this.pending.has(symbol) && this.now() - checkedAt >= QUOTE_TTL)
    if (next) await this.resolve(next[0]).catch(() => undefined)
  }

  async resolve(symbol: string, force = false): Promise<QuoteResult | null> {
    const upstreamSymbol = finnhubSymbol(symbol)
    if (!upstreamSymbol) return null
    this.watched.set(symbol, this.now())
    const generation = this.generation
    let key: string | undefined
    try { key = await (this.credential ??= this.getKey()) }
    catch { throw new Error('Finnhub: encrypted key is unavailable.') }
    if (generation !== this.generation) return this.resolve(symbol, force)
    this.enabled = Boolean(key)
    if (!key) return null
    const saved = this.quotes.get(symbol)
    if (!force && saved && this.now() - saved.fetchedAt < QUOTE_TTL) {
      const result = { value: saved.value, ageSeconds: Math.max(0, (this.now() - saved.fetchedAt) / 1_000), fromCache: true, stale: false as const }
      this.observe(result)
      return result
    }
    const pending = this.pending.get(symbol)
    if (pending) return pending.then(result => { this.observe(result); return result })
    const task = this.load(symbol, upstreamSymbol, key, generation).catch(error => {
      // A rate limit or temporary outage must not replace a known stock quote
      // with a perpetual mark. Preserve its trade time and expose stale status.
      if (!saved || generation !== this.generation) throw error
      const reason = error instanceof Error ? error.message : 'Finnhub quote refresh unavailable.'
      return { value: { ...saved.value, fallbackReason: `${reason} Showing the last Finnhub stock quote.` },
        ageSeconds: Math.max(0, (this.now() - saved.fetchedAt) / 1_000), fromCache: true, stale: true }
    })
    this.pending.set(symbol, task)
    try { const result = await task; this.observe(result); return result }
    finally { if (this.pending.get(symbol) === task) this.pending.delete(symbol) }
  }

  private async load(symbol: string, upstreamSymbol: string, key: string, generation: number): Promise<QuoteResult> {
    // A large portfolio queues behind the concurrency limit instead of failing
    // every holding after the first few requests.
    if (this.active < 4) this.active += 1
    else await new Promise<void>(resolve => { this.waiters.push(resolve) })
    try { return await this.requestQuote(symbol, upstreamSymbol, key, generation) }
    finally {
      const next = this.waiters.shift()
      if (next) next()
      else this.active -= 1
    }
  }

  private async requestQuote(symbol: string, upstreamSymbol: string, key: string, generation: number): Promise<QuoteResult> {
    if (generation !== this.generation) throw new Error('Finnhub: credentials changed.')
    this.times = this.times.filter(time => time > this.now() - 60_000)
    if (this.until > this.now() || this.times.length >= 60) {
      throw new Error('Finnhub: request budget or cooldown active.')
    }
    this.times.push(this.now())
    return trackApiRequest('finnhub', async () => {
      try {
        const url = new URL('https://finnhub.io/api/v1/quote')
        url.searchParams.set('symbol', upstreamSymbol)
        // Keep the secret out of URLs, caches, diagnostics and renderer messages.
        const response = await this.request(url, { headers: { 'X-Finnhub-Token': key, Accept: 'application/json' },
          redirect: 'error', signal: AbortSignal.timeout(6_000) })
        if (!response.ok) {
          const retry = response.headers.get('Retry-After')
          const retryAt = retry && Number.isFinite(Number(retry)) ? this.now() + Math.max(0, Number(retry)) * 1_000 : Date.parse(retry ?? '')
          const delay = response.status === 401 || response.status === 403 ? 10 * 60_000 : response.status === 429 ? 60_000 : 10_000
          if (generation === this.generation) {
            this.until = Math.max(this.until, this.now() + delay, Number.isFinite(retryAt) ? retryAt : 0)
            apiUsageTracker.setCooldown('finnhub', this.until)
          }
          throw new Error('Request failed')
        }
        const text = await response.text()
        if (text.length > 16_384) throw new Error('Invalid response')
        const row = JSON.parse(text)
        if (![row.c, row.pc, row.t].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
          || row.t * 1_000 > this.now() + 300_000 || row.t * 1_000 < Date.UTC(2000, 0, 1)) throw new Error('Invalid quote')
        if (generation !== this.generation) throw new Error('Credentials changed')
        const quote: Quote = { symbol, price: row.c, absChange: row.c - row.pc, change: (row.c / row.pc - 1) * 100,
          asOf: row.t * 1_000, currency: 'USD', source: 'Finnhub', changeBasis: 'previous-close' }
        this.quotes.set(symbol, { value: quote, fetchedAt: this.now() })
        for (const listener of this.listeners) listener(quote)
        return { value: quote, ageSeconds: 0, fromCache: false, stale: false }
      } catch {
        // Never forward upstream exceptions, response bodies or request headers.
        throw new Error('Finnhub: quote request failed or no supported quote was returned.')
      }
    })
  }

  private observe(result: QuoteResult): void {
    const fetchedAt = this.now() - result.ageSeconds * 1_000
    observeSource({ fetchedAt, expiresAt: fetchedAt + QUOTE_TTL, asOf: result.value.asOf,
      fromCache: result.fromCache, stale: result.stale, failures: result.value.fallbackReason ? [result.value.fallbackReason] : [], sources: ['Finnhub'] })
  }
}

// The Electron host installs OS-backed credentials. Standalone probes stay keyless.
export const finnhubQuotes = new FinnhubQuotes(async () => undefined)
