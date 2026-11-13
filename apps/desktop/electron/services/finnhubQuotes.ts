import type { Quote } from '../shared/contract.js'
import type { CachedResult } from './cache.js'
import { apiUsageTracker, trackApiRequest } from './apiUsage.js'
import { observeSource } from './sourceHealth.js'

const QUOTE_TTL = 30_000
type QuoteResult = CachedResult<Quote> & { stale: boolean }
type ReferenceQuote = { price: number; previousClose: number; asOf: number }
type Trade = { price: number; asOf: number }
const marketDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })

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
  private references = new Map<string, ReferenceQuote>()
  private trades = new Map<string, Trade>()
  private streaming = false
  private socket?: WebSocket
  private subscriptions = new Set<string>()
  private reconnectAt = 0
  private retryMs = 1_000
  private lastMessageAt = 0
  private rotationAt = 0
  private rotation = 0
  private changed = new Map<string, Quote>()
  private flushTimer?: ReturnType<typeof setTimeout>

  constructor(
    private getKey: () => Promise<string | undefined>,
    private request: typeof fetch = (...args) => fetch(...args),
    private now = Date.now,
    private socketFactory: (url: string) => WebSocket = url => new WebSocket(url),
  ) {}

  start(): void {
    this.streaming = true
    void this.connect()
  }

  close(): void {
    this.streaming = false
    this.disconnect()
  }

  private disconnect(): void {
    const socket = this.socket
    this.socket = undefined
    this.subscriptions.clear()
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    this.changed.clear()
    try { socket?.close() } catch { /* Never expose authenticated socket URLs. */ }
  }

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
    this.references.clear()
    this.trades.clear()
    this.disconnect()
    this.reconnectAt = 0
    this.retryMs = 1_000
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
    if (this.streaming) {
      if (this.socket && this.now() - this.lastMessageAt > 90_000) this.disconnect()
      await this.connect()
      this.syncSubscriptions()
    }
    const next = [...this.watched].sort((a, b) => a[1] - b[1])
      .find(([symbol, checkedAt]) => !this.pending.has(symbol) && this.now() - checkedAt >= QUOTE_TTL)
    if (next) await this.resolve(next[0], true).catch(() => undefined)
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
    if (this.streaming) {
      void this.connect()
      this.syncSubscriptions()
    }
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
      const latest = this.quotes.get(symbol)
      if (!latest || generation !== this.generation) throw error
      if (this.trades.get(symbol)?.asOf === latest.value.asOf && this.now() - latest.fetchedAt < QUOTE_TTL) {
        return { value: latest.value, ageSeconds: (this.now() - latest.fetchedAt) / 1_000, fromCache: false, stale: false }
      }
      const reason = error instanceof Error ? error.message : 'Finnhub quote refresh unavailable.'
      return { value: { ...latest.value, fallbackReason: `${reason} Showing the last Finnhub stock quote.` },
        ageSeconds: Math.max(0, (this.now() - latest.fetchedAt) / 1_000), fromCache: true, stale: true }
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
        this.references.set(symbol, { price: row.c, previousClose: row.pc, asOf: row.t * 1_000 })
        let quote: Quote = { symbol, price: row.c, absChange: row.c - row.pc, change: (row.c / row.pc - 1) * 100,
          asOf: row.t * 1_000, currency: 'USD', source: 'Finnhub', changeBasis: 'previous-close' }
        // A periodic REST close must never overwrite a newer extended-hours trade.
        const trade = this.trades.get(symbol)
        if (trade && trade.asOf > quote.asOf!) quote = this.tradeQuote(symbol, trade) ?? quote
        this.quotes.set(symbol, { value: quote, fetchedAt: this.now() })
        this.changed.delete(symbol)
        for (const listener of this.listeners) listener(quote)
        return { value: quote, ageSeconds: 0, fromCache: false, stale: false }
      } catch {
        // Never forward upstream exceptions, response bodies or request headers.
        throw new Error('Finnhub: quote request failed or no supported quote was returned.')
      }
    })
  }

  private tradeQuote(symbol: string, trade: Trade): Quote | undefined {
    const reference = this.references.get(symbol)
    if (!reference) return undefined
    // Before today's open REST still reports yesterday's c and the day before's pc.
    const previousClose = marketDate.format(trade.asOf) > marketDate.format(reference.asOf)
      ? reference.price : reference.previousClose
    return { symbol, price: trade.price, asOf: trade.asOf, currency: 'USD', source: 'Finnhub',
      absChange: trade.price - previousClose, change: (trade.price / previousClose - 1) * 100, changeBasis: 'previous-close' }
  }

  private async connect(): Promise<void> {
    if (!this.streaming || this.socket || !this.watched.size || this.now() < this.reconnectAt) return
    const generation = this.generation
    let key: string | undefined
    try { key = await (this.credential ??= this.getKey()) } catch { return }
    if (!key || generation !== this.generation || !this.streaming || this.socket) return
    let socket: WebSocket
    try {
      // Finnhub requires query authentication for WebSockets. This URL stays in main;
      // never forward socket errors, URLs, payloads or close reasons to diagnostics.
      socket = this.socketFactory(`wss://ws.finnhub.io?token=${encodeURIComponent(key)}`)
    } catch {
      this.reconnectAt = this.now() + this.retryMs
      this.retryMs = Math.min(this.retryMs * 2, 60_000)
      return
    }
    this.socket = socket
    this.lastMessageAt = this.now()
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.lastMessageAt = this.now()
      this.syncSubscriptions()
    })
    const failed = () => {
      if (this.socket !== socket) return
      this.disconnect()
      this.reconnectAt = this.now() + this.retryMs
      this.retryMs = Math.min(this.retryMs * 2, 60_000)
    }
    socket.addEventListener('error', failed)
    socket.addEventListener('close', failed)
    socket.addEventListener('message', event => {
      if (this.socket !== socket || generation !== this.generation) return
      const text = typeof event.data === 'string' ? event.data : ''
      if (!text || text.length > 1_000_000) return
      let message: { type?: string; data?: unknown[] }
      try { message = JSON.parse(text) } catch { return }
      if (!message || typeof message !== 'object') return
      this.lastMessageAt = this.now()
      if (message.type === 'error') { failed(); return }
      this.retryMs = 1_000
      if (message.type !== 'trade' || !Array.isArray(message.data)) return
      for (const value of message.data) {
        if (!value || typeof value !== 'object') continue
        const row = value as { s?: unknown; p?: unknown; t?: unknown }
        if (typeof row.s !== 'string' || !this.subscriptions.has(row.s)
          || typeof row.p !== 'number' || !Number.isFinite(row.p) || row.p <= 0
          || typeof row.t !== 'number' || !Number.isFinite(row.t)
          || row.t < Date.UTC(2000, 0, 1) || row.t > this.now() + 30_000) continue
        for (const symbol of this.watched.keys()) {
          if (finnhubSymbol(symbol) !== row.s || row.t <= (this.trades.get(symbol)?.asOf ?? 0)
            || row.t <= (this.quotes.get(symbol)?.value.asOf ?? 0)) continue
          const trade = { price: row.p, asOf: row.t }
          this.trades.set(symbol, trade)
          const quote = this.tradeQuote(symbol, trade)
          if (!quote) continue // Keep early trades until the initial REST reference arrives.
          this.quotes.set(symbol, { value: quote, fetchedAt: this.now() })
          this.changed.set(symbol, quote)
        }
      }
      if (this.changed.size && !this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = undefined
          const quotes = [...this.changed.values()]
          this.changed.clear()
          for (const quote of quotes) for (const listener of this.listeners) listener(quote)
        }, 250)
        this.flushTimer.unref?.()
      }
    })
  }

  private syncSubscriptions(): void {
    const socket = this.socket
    if (!socket || socket.readyState !== 1) return
    const symbols = [...new Set([...this.watched.keys()].map(finnhubSymbol).filter((value): value is string => Boolean(value)))]
    // Stay within the free feed's symbol budget; rotate larger startup universes.
    if (this.now() >= this.rotationAt) {
      this.rotation = symbols.length > 50 ? (this.rotation + 50) % symbols.length : 0
      this.rotationAt = this.now() + 30_000
    }
    const desired = new Set([...symbols.slice(this.rotation), ...symbols.slice(0, this.rotation)].slice(0, 50))
    try {
      for (const symbol of this.subscriptions) if (!desired.has(symbol)) {
        socket.send(JSON.stringify({ type: 'unsubscribe', symbol }))
        this.subscriptions.delete(symbol)
      }
      for (const symbol of desired) if (!this.subscriptions.has(symbol)) {
        socket.send(JSON.stringify({ type: 'subscribe', symbol }))
        this.subscriptions.add(symbol)
      }
    } catch {
      this.disconnect()
      this.reconnectAt = this.now() + this.retryMs
    }
  }

  private observe(result: QuoteResult): void {
    const fetchedAt = this.now() - result.ageSeconds * 1_000
    observeSource({ fetchedAt, expiresAt: fetchedAt + QUOTE_TTL, asOf: result.value.asOf,
      fromCache: result.fromCache, stale: result.stale, failures: result.value.fallbackReason ? [result.value.fallbackReason] : [], sources: ['Finnhub'] })
  }
}

// The Electron host installs OS-backed credentials. Standalone probes stay keyless.
export const finnhubQuotes = new FinnhubQuotes(async () => undefined)
