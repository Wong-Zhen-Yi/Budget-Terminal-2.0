import type { Quote } from '../shared/contract.js'
import { cache, type TtlCache, type CachedResult } from './cache.js'
import { diversifiedHttp, type DiversifiedHttp } from './diversifiedHttp.js'
import { observeSource } from './sourceHealth.js'

function numeric(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return NaN
  return Number(value)
}
function positive(value: unknown): number {
  const number = numeric(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error('Invalid price')
  return number
}

/** Public USD spot prices only; no authenticated provider access. Perpetuals and adjusted history stay separate. */
export class DiversifiedData {
  constructor(private http: DiversifiedHttp = diversifiedHttp, private storage: TtlCache = cache, private now = Date.now) {}

  private async cached<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<CachedResult<T>> {
    return this.storage.resolve(`diversified:v1:${key}`, ttl, loader)
  }

  private quote(symbol: string, price: unknown, previous: unknown, timestamp: unknown, source: string): Quote {
    const current = positive(price)
    const prior = positive(previous)
    const asOf = numeric(timestamp)
    if (!Number.isFinite(asOf) || asOf > this.now() + 300_000 || asOf < this.now() - 120_000) throw new Error('Invalid quote timestamp')
    return { symbol, price: current, change: (current / prior - 1) * 100, absChange: current - prior, asOf, currency: 'USD', source }
  }

  private async coinbase(symbol: string): Promise<CachedResult<Quote>> {
    return this.cached(`spot:coinbase:${symbol}`, 30_000, () => this.http.get('coinbase', new URL(`https://api.exchange.coinbase.com/products/${symbol}/stats`), text => {
      const row = JSON.parse(text)
      return this.quote(symbol, row.last, row.open, this.now(), 'Coinbase spot (USD, rolling 24h)')
    }))
  }

  async spot(symbol: string): Promise<(CachedResult<Quote> & { stale: false }) | null> {
    if (!/^(BTC|ETH|SOL|XRP|BNB)-USD$/.test(symbol)) return null
    const coin = symbol.split('-')[0]
    const providers = coin === 'BNB' ? ['binance'] : coin === 'ETH' ? ['binance', 'coinbase'] : ['coinbase', 'binance']
    for (const provider of providers) {
      try {
        const result = provider === 'coinbase' ? await this.coinbase(symbol) : await this.cached(`spot:binance-usd:${symbol}`, 30_000, async () => {
          // USDT is not USD. Convert both endpoints of the 24h return using a shared USDT/USD quote.
          const conversion = await this.coinbase('USDT-USD')
          this.observe(conversion, 30_000, 'Coinbase USDT/USD conversion')
          const url = new URL('https://data-api.binance.vision/api/v3/ticker/24hr')
          url.searchParams.set('symbol', `${coin}USDT`)
          return this.http.get('binance', url, text => {
            const row = JSON.parse(text)
            if (row.symbol !== `${coin}USDT`) throw new Error('Wrong market')
            const priorUsd = conversion.value.price - conversion.value.absChange
            return this.quote(symbol, positive(row.lastPrice) * conversion.value.price, positive(row.openPrice) * priorUsd,
              Math.min(positive(row.closeTime), conversion.value.asOf!), 'Binance spot (USDT converted to USD, rolling 24h)')
          })
        })
        this.observe(result, 30_000, result.value.source!)
        return { ...result, stale: false }
      } catch { /* CoinGecko/Yahoo remain the final spot fallbacks at the call site. */ }
    }
    return null
  }

  private observe<T>(result: CachedResult<T>, ttl: number, source: string): void {
    const fetchedAt = this.now() - result.ageSeconds * 1_000
    observeSource({ fetchedAt, expiresAt: Math.min(fetchedAt + ttl, result.snapshot?.expiresAt ?? Infinity), fromCache: result.fromCache, stale: false, failures: [], sources: [source] })
  }
}

export const diversifiedData = new DiversifiedData()
