import type { Candle, EquityMarketUpdate, HyperliquidPayload, Quote } from '../shared/contract.js'
import { parseHyperliquidMarkets } from '../shared/hyperliquid.js'
import { localIsoSeconds } from '../shared/crypto.js'
import { EQUITY_MARKETS, equityMarket, equityPriceSource } from '../shared/equityMarkets.js'
import { cache } from './cache.js'
import { trackApiRequest } from './apiUsage.js'
import { observeSource } from './sourceHealth.js'
import { hyperliquidRateGate } from './hyperliquidRateGate.js'
import { requestPriority } from './yahoo/client.js'

const INFO_URL = 'https://api.hyperliquid.xyz/info'
const WS_URL = 'wss://api.hyperliquid.xyz/ws'
const QUOTE_MAX_AGE = 15_000
const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1800_000,
  '1h': 3600_000, '4h': 14400_000, '1d': 86400_000, '1wk': 604800_000, '1mo': 31 * 86400_000,
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function finite(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

export function equityQuoteFromContext(symbol: string, market: string, value: unknown, asOf: number): Quote {
  const context = record(value)
  const price = finite(context.markPx)
  const previous = finite(context.prevDayPx)
  if (price === null || price <= 0 || previous === null || previous <= 0) {
    throw new Error(`Incomplete Hyperliquid price for ${market}.`)
  }
  const absChange = price - previous
  if (!Number.isFinite(absChange / previous * 100)) throw new Error(`Invalid Hyperliquid change for ${market}.`)
  return { symbol, price, absChange, change: absChange / previous * 100, currency: 'USD', asOf,
    priceBasis: 'equity-perp-mark', changeBasis: '24h', source: equityPriceSource(market), market }
}

export function parseEquityCandles(body: unknown, market: string, interval: string): Candle[] {
  if (!Array.isArray(body)) throw new Error(`Invalid Hyperliquid candles for ${market}.`)
  const expected = interval === '1wk' ? '1w' : interval === '1mo' ? '1M' : interval
  const rows = body.map(value => {
    const row = record(value)
    const time = finite(row.t)
    const open = finite(row.o)
    const high = finite(row.h)
    const low = finite(row.l)
    const close = finite(row.c)
    const volume = finite(row.v)
    if (row.s !== market || row.i !== expected || time === null || !Number.isSafeInteger(time) || time <= 0
      || open === null || high === null || low === null || close === null || volume === null
      || Math.min(open, high, low, close) <= 0 || volume < 0 || low > Math.min(open, close)
      || high < Math.max(open, close) || high < low) throw new Error(`Invalid Hyperliquid candle for ${market}.`)
    return { time: Math.floor(time / 1000), open, high, low, close, volume }
  })
  if (!rows.length) throw new Error(`No Hyperliquid candles for ${market}.`)
  return [...new Map(rows.sort((a, b) => a.time - b.time).map(row => [row.time, row])).values()]
}

export interface EquityCandleResult {
  candles: Candle[]
  source: string
  market: string
  fromCache: boolean
  stale: boolean
  cacheAgeSeconds: number
}

interface CandleDocument {
  candles: Candle[]
  /** Earliest boundary actually requested, including the overlap bar. */
  requestedFrom: number
}

/** One shared read-only socket and weighted REST queue for all equity consumers. */
export class HyperliquidEquities {
  private cryptoMetadata: unknown
  private cryptoMarkets: { payload: HyperliquidPayload; receivedAt: number } | undefined
  private cryptoChanged = false
  private readonly quotes = new Map<string, Quote>()
  private readonly watched = new Set<string>()
  private readonly listeners = new Set<(update: EquityMarketUpdate) => void>()
  private readonly candleWatches = new Map<string, { symbol: string; interval: string }>()
  private readonly changedCandles = new Map<string, EquityMarketUpdate['candles'][number]>()
  private readonly latestCandles = new Map<string, { candle: Candle; receivedAt: number }>()
  private socket: WebSocket | null = null
  private enabled = false
  private reconnect: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private connectingTimer: ReturnType<typeof setTimeout> | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private readonly changed = new Map<string, Quote>()
  private lastMessageAt = 0
  private connectedAt = 0
  private retryMs = 1_000
  private cooldownUntil = 0

  constructor(
    private readonly request: typeof fetch = (url, options) => globalThis.fetch(url, options),
    private readonly now: () => number = Date.now,
    private readonly socketFactory: (url: string) => WebSocket = url => new WebSocket(url),
  ) {}

  start(): void {
    this.enabled = true
    this.connect()
  }

  subscribe(listener: (update: EquityMarketUpdate) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.enabled = false
    clearTimeout(this.reconnect)
    clearTimeout(this.flushTimer)
    clearInterval(this.heartbeat)
    clearTimeout(this.connectingTimer)
    this.reconnect = undefined
    this.flushTimer = undefined
    this.heartbeat = undefined
    const socket = this.socket
    this.socket = null
    socket?.close()
    this.cryptoMarkets = undefined
    this.cryptoChanged = false
    this.quotes.clear()
    this.changed.clear()
    this.changedCandles.clear()
    this.latestCandles.clear()
  }

  /** Metadata is refreshed by REST; contexts stream on the existing shared socket. */
  watchCryptoMarkets(metadata: unknown): void {
    const first = !this.cryptoMetadata
    this.cryptoMetadata = metadata
    this.cryptoMarkets = undefined
    this.cryptoChanged = false
    if (first && this.socket?.readyState === 1) this.sendCryptoSubscription()
    this.connect()
  }

  getCryptoMarkets(): HyperliquidPayload | null {
    return this.socket?.readyState === 1 && this.cryptoMarkets && this.now() - this.cryptoMarkets.receivedAt <= QUOTE_MAX_AGE
      ? this.cryptoMarkets.payload : null
  }

  private sendCryptoSubscription(): void {
    this.socket?.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allDexsAssetCtxs' } }))
  }

  private watch(symbol: string): void {
    if (!this.watched.has(symbol)) {
      this.watched.add(symbol)
      if (this.socket?.readyState === 1) this.sendSubscription(symbol)
    }
    this.connect()
  }

  private sendSubscription(symbol: string): void {
    this.socket?.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'activeAssetCtx', coin: equityMarket(symbol) } }))
  }

  private sendCandleSubscription(symbol: string, interval: string): void {
    const apiInterval = interval === '1wk' ? '1w' : interval === '1mo' ? '1M' : interval
    this.socket?.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin: equityMarket(symbol), interval: apiInterval } }))
  }

  watchCandles(symbol: string, interval: string): void {
    const key = `${symbol}:${interval}`
    if (!equityMarket(symbol) || !INTERVAL_MS[interval] || this.candleWatches.has(key)) return
    this.candleWatches.set(key, { symbol, interval })
    this.watch(symbol)
    if (this.socket?.readyState === 1) this.sendCandleSubscription(symbol, interval)
  }

  private publish(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      const update: EquityMarketUpdate = { quotes: [...this.changed.values()], candles: [...this.changedCandles.values()] }
      if (this.cryptoChanged && this.getCryptoMarkets()) update.hyperliquid = this.cryptoMarkets!.payload
      this.cryptoChanged = false
      this.changed.clear()
      this.changedCandles.clear()
      for (const listener of this.listeners) listener(update)
    }, 250)
    this.flushTimer.unref?.()
  }

  private connect(): void {
    if (!this.enabled || this.socket || this.reconnect || (!this.watched.size && !this.cryptoMetadata)) return
    let socket: WebSocket
    try {
      socket = this.socketFactory(WS_URL)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    this.connectingTimer = setTimeout(() => { if (socket.readyState === 0) socket.close() }, 12_000)
    this.connectingTimer.unref?.()
    this.lastMessageAt = this.now()
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      clearTimeout(this.connectingTimer)
      this.connectedAt = this.now()
      if (this.cryptoMetadata) this.sendCryptoSubscription()
      for (const symbol of this.watched) this.sendSubscription(symbol)
      for (const { symbol, interval } of this.candleWatches.values()) this.sendCandleSubscription(symbol, interval)
      this.heartbeat = setInterval(() => {
        if (this.now() - this.lastMessageAt > 45_000) {
          socket.close()
          return
        }
        if (socket.readyState === 1) socket.send(JSON.stringify({ method: 'ping' }))
      }, 15_000)
      this.heartbeat.unref?.()
    })
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return
      this.lastMessageAt = this.now()
      let message: Record<string, unknown>
      try { message = record(JSON.parse(String(event.data))) } catch { return }
      if (message.channel === 'allDexsAssetCtxs' && this.cryptoMetadata) {
        const ctxs = record(message.data).ctxs
        const base = Array.isArray(ctxs) ? ctxs.find(row => Array.isArray(row) && row[0] === '') : undefined
        if (!Array.isArray(base)) return
        try {
          const markets = parseHyperliquidMarkets([this.cryptoMetadata, base[1]])
          this.cryptoMarkets = { payload: { markets, fetchedAt: localIsoSeconds(new Date(this.now())) }, receivedAt: this.now() }
          this.cryptoChanged = true
          this.publish()
        } catch {
          // Changed universe lengths require a fresh REST metadata snapshot.
          this.cryptoMarkets = undefined
        }
        return
      }
      if (message.channel === 'candle') {
        for (const value of Array.isArray(message.data) ? message.data : [message.data]) {
          const row = record(value)
          const market = typeof row.s === 'string' ? row.s : ''
          const symbol = market.split(':')[1]
          const interval = row.i === '1w' ? '1wk' : row.i === '1M' ? '1mo' : String(row.i)
          const key = `${symbol}:${interval}`
          if (!symbol || EQUITY_MARKETS[symbol] !== market || !this.candleWatches.has(key)) continue
          try {
            const candle = parseEquityCandles([row], market, interval)[0]
            if ((this.latestCandles.get(key)?.candle.time ?? 0) > candle.time) continue
            this.latestCandles.set(key, { candle, receivedAt: this.now() })
            this.changedCandles.set(key, { symbol, market, interval, candle })
            this.publish()
          } catch { /* Reject malformed or cross-market candles. */ }
        }
        return
      }
      if (message.channel !== 'activeAssetCtx') return
      const data = record(message.data)
      const market = typeof data.coin === 'string' ? data.coin : ''
      const symbol = market.split(':')[1]
      if (!symbol || EQUITY_MARKETS[symbol] !== market || !this.watched.has(symbol)) return
      try {
        const quote = equityQuoteFromContext(symbol, market, data.ctx, this.now())
        if (this.now() - this.connectedAt >= 30_000) this.retryMs = 1_000
        this.quotes.set(symbol, quote)
        this.changed.set(symbol, quote)
        this.publish()
      } catch { /* Ignore malformed observations; their age continues to increase. */ }
    })
    const disconnected = () => {
      if (this.socket !== socket) return
      this.socket = null
      clearTimeout(this.connectingTimer)
      clearInterval(this.heartbeat)
      this.heartbeat = undefined
      this.cryptoMarkets = undefined
      this.cryptoChanged = false
      // Do not reuse an old stream mark as a live quote after disconnecting.
      this.quotes.clear()
      this.latestCandles.clear()
      this.changed.clear()
      this.changedCandles.clear()
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
      this.scheduleReconnect()
    }
    socket.addEventListener('close', disconnected)
    socket.addEventListener('error', () => {
      socket.close()
      disconnected()
    })
  }

  private scheduleReconnect(): void {
    if (!this.enabled || this.reconnect) return
    this.reconnect = setTimeout(() => {
      this.reconnect = undefined
      this.connect()
    }, this.retryMs)
    this.reconnect.unref?.()
    this.retryMs = Math.min(30_000, this.retryMs * 2)
  }

  private info(body: unknown, weight = 20): Promise<unknown> {
    return hyperliquidRateGate.run(weight, async () => {
      if (this.cooldownUntil > this.now()) throw new Error('Hyperliquid equity data is rate limited; retry after cooldown.')
      return trackApiRequest('hyperliquid', async () => {
        const response = await this.request(INFO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) })
        if (response.status === 429) {
          const header = response.headers.get('Retry-After')
          const seconds = header?.trim() ? Number(header) : NaN
          const retryAt = Number.isFinite(seconds) ? this.now() + seconds * 1_000 : Date.parse(header ?? '')
          this.cooldownUntil = Math.max(this.now() + 60_000, Number.isFinite(retryAt) ? retryAt : 0)
          throw new Error('Hyperliquid HTTP 429: equity data cooldown active.')
        }
        if (!response.ok) throw new Error(`Hyperliquid equity data HTTP ${response.status}.`)
        return response.json() as Promise<unknown>
      })
    }, requestPriority())
  }

  async getQuote(symbol: string, force = false): Promise<Quote> {
    symbol = symbol.trim().toUpperCase()
    const market = equityMarket(symbol)
    if (!market) throw new Error(`No reviewed Hyperliquid stock market for ${symbol}.`)
    this.watch(symbol)
    const streamed = this.quotes.get(symbol)
    if (streamed && this.now() - streamed.asOf! <= QUOTE_MAX_AGE) {
      this.observe(streamed)
      return streamed
    }
    const dex = market.split(':')[0]
    const result = await cache.resolve(`hyperliquid:equities:contexts:v1:${dex}`, QUOTE_MAX_AGE,
      async () => ({ body: await this.info({ type: 'metaAndAssetCtxs', dex }), asOf: this.now() }), { force })
    const body = result.value.body
    if (!Array.isArray(body) || !Array.isArray(record(body[0]).universe) || !Array.isArray(body[1])) {
      throw new Error(`Invalid Hyperliquid ${dex} metadata.`)
    }
    const universe = record(body[0]).universe as unknown[]
    if (universe.length !== body[1].length) throw new Error(`Mismatched Hyperliquid ${dex} contexts.`)
    const index = universe.findIndex(asset => record(asset).name === market && record(asset).isDelisted !== true)
    if (index < 0) throw new Error(`Hyperliquid market ${market} is unavailable or delisted.`)
    const quote = equityQuoteFromContext(symbol, market, body[1][index], result.value.asOf)
    // A stream observation that arrived during REST loading takes precedence.
    const current = this.quotes.get(symbol)
    const latest = current && current.asOf! >= quote.asOf! ? current : quote
    this.observe(latest)
    return latest
  }

  private observe(quote: Quote): void {
    observeSource({ fetchedAt: quote.asOf!, asOf: quote.asOf, expiresAt: quote.asOf! + QUOTE_MAX_AGE,
      stale: false, fromCache: false, failures: [], sources: [quote.source!] })
  }

  async getCandles(symbol: string, start: Date, interval: string, force = false, requireCoverage = true): Promise<EquityCandleResult> {
    symbol = symbol.trim().toUpperCase()
    const market = equityMarket(symbol)
    const width = INTERVAL_MS[interval]
    if (!market || !width) throw new Error('Hyperliquid stock market or candle interval is unsupported.')
    const end = this.now()
    // Request one extra bar to detect a truncated start rather than silently shortening history.
    const count = Math.ceil((end - start.getTime()) / width) + 2
    if (count > 5_000) throw new Error('Requested history exceeds the Hyperliquid 5,000-candle window.')
    const apiInterval = interval === '1wk' ? '1w' : interval === '1mo' ? '1M' : interval
    // One canonical series per market/interval. Ticker revisits and indicator
    // warm-ups reuse history instead of creating a new full-range request.
    const key = `hyperliquid:equities:candles:v2:${market}:${interval}`
    const requestedFrom = start.getTime() - width
    const previous = await cache.get<CandleDocument>(key, { allowStale: true })
    const old = previous && previous.value.candles.at(-1)!.time * 1000 >= requestedFrom - width ? previous.value : undefined
    const needsRange = Boolean(previous && (!old || old.requestedFrom > requestedFrom))
    const ttl = width < INTERVAL_MS['1d'] ? 60_000 : 5 * 60_000
    let loaded = false
    const result = await cache.resolveWithStaleFallback(key, ttl, async (): Promise<CandleDocument> => {
      loaded = true
      const incremental = old && !force && !needsRange
      const from = incremental ? old.candles.at(-1)!.time * 1000 - width : requestedFrom
      const requestCount = Math.min(5_000, Math.ceil((this.now() - from) / width) + 2)
      const body = await this.info({ type: 'candleSnapshot', req: { coin: market, interval: apiInterval, startTime: from, endTime: this.now() } }, 20 + Math.ceil(requestCount / 60))
      const incoming = parseEquityCandles(body, market, interval)
      const merged = [...new Map([...(old?.candles ?? []), ...incoming].map(row => [row.time, row])).values()].sort((a, b) => a.time - b.time)
      const candles = merged.slice(-5_000)
      const attemptedFrom = Math.min(old?.requestedFrom ?? from, from)
      return { candles, requestedFrom: merged.length > candles.length ? Math.max(attemptedFrom, candles[0].time * 1000) : attemptedFrom }
    }, { force: force || needsRange })
    // Another range can join an in-flight narrow request; extend it once complete.
    if (!loaded && !result.stale && result.value.requestedFrom > requestedFrom) return this.getCandles(symbol, start, interval, force, requireCoverage)
    let candles = result.value.candles.filter(row => row.time * 1000 >= requestedFrom)
    if (!candles.length) throw new Error(`No Hyperliquid candles for ${market}.`)
    // Coverage failures are checked outside the cache loader so the known listing
    // boundary stays cached and long stock histories fall back without re-downloading.
    if (requireCoverage && candles[0].time * 1000 > start.getTime() + width) throw new Error(`Hyperliquid history for ${market} does not cover the requested start.`)
    const source = equityPriceSource(market)
    this.watchCandles(symbol, interval)
    observeSource({ fetchedAt: this.now() - result.ageSeconds * 1000, stale: result.stale, fromCache: result.fromCache,
      failures: [], sources: [source] })
    const latest = this.latestCandles.get(`${symbol}:${interval}`)
    if (latest && this.now() - latest.receivedAt <= QUOTE_MAX_AGE && latest.candle.time >= candles.at(-1)!.time) {
      candles = latest.candle.time === candles.at(-1)!.time
        ? [...candles.slice(0, -1), latest.candle] : [...candles, latest.candle]
    }
    return { candles, source, market, stale: result.stale, fromCache: result.fromCache, cacheAgeSeconds: result.ageSeconds }
  }
}

export const hyperliquidEquities = new HyperliquidEquities()
