import type { Candle, ChartsHistoryPayload, ChartsHistoryRequest } from '../shared/contract.js'
import { cryptoPerpSymbol } from '../shared/cryptoWorkspace.js'
import { cache, type TtlCache } from './cache.js'
import { hyperliquidClient } from './hyperliquid.js'
import { hyperliquidRateGate } from './hyperliquidRateGate.js'
import { parseEquityCandles } from './hyperliquidEquities.js'
import { trackApiRequest } from './apiUsage.js'
import { observeSource } from './sourceHealth.js'
import { requestPriority } from './yahoo/client.js'
import { rsi, sma, toPoints } from './indicators.js'

const INTERVALS: Record<string, { api: string; width: number }> = {
  '1 Minute': { api: '1m', width: 60_000 },
  '5 Minutes': { api: '5m', width: 300_000 },
  '15 Minutes': { api: '15m', width: 900_000 },
  '1 Hour': { api: '1h', width: 3_600_000 },
  '4 Hours': { api: '4h', width: 14_400_000 },
  '1 Day': { api: '1d', width: 86_400_000 },
  '1 Week': { api: '1w', width: 604_800_000 },
  '1 Month': { api: '1M', width: 30 * 86_400_000 },
}

/** Explicit -PERP symbols never fall through to Yahoo stock/spot history. */
export class CryptoChartsClient {
  private cooldownUntil = 0

  constructor(
    private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
    private readonly storage: TtlCache = cache,
  ) {}

  async getHistory(request: ChartsHistoryRequest) {
    const wanted = cryptoPerpSymbol(request.symbol)
    const interval = INTERVALS[request.interval]
    if (!wanted || !interval) throw new Error('Unsupported crypto perpetual or candle interval.')
    const end = this.now()
    const date = new Date(end)
    const range = /^(\d+)([DMY])$/.exec(request.range)
    const requestedStart = request.range === 'YTD' ? Date.UTC(date.getUTCFullYear(), 0, 1)
      : range ? end - Number(range[1]) * ({ D: 1, M: 31, Y: 366 }[range[2]] ?? 1) * 86_400_000
      : end - 4_998 * interval.width
    const start = Math.max(requestedStart, end - 4_998 * interval.width)
    const key = `crypto:candles:v2:${wanted.toUpperCase()}:${interval.api}:${request.range}`
    const result = await this.storage.resolveWithStaleFallback(key, 60_000, async (): Promise<{ candles: Candle[]; market: string }> => {
      if (this.now() < this.cooldownUntil) throw new Error('Hyperliquid HTTP 429: candle requests are cooling down.')
      const markets = await hyperliquidClient.getMarkets()
      const market = markets.markets.find(row => row.symbol.toUpperCase() === wanted.toUpperCase())
      if (!market) throw new Error(`Hyperliquid perpetual ${wanted} is unavailable.`)
      const source = `Hyperliquid crypto perp (${market.symbol})`
      return hyperliquidRateGate.run(20 + Math.ceil((end - start) / interval.width / 60), () => trackApiRequest('hyperliquid', async () => {
        if (this.now() < this.cooldownUntil) throw new Error('Hyperliquid HTTP 429: candle requests are cooling down.')
        const response = await this.request('https://api.hyperliquid.xyz/info', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ type: 'candleSnapshot', req: { coin: market.symbol, interval: interval.api, startTime: start, endTime: end } }),
          signal: AbortSignal.timeout(12_000),
        })
        if (response.status === 429) {
          const retry = response.headers.get('Retry-After')
          const until = retry && Number.isFinite(Number(retry)) ? this.now() + Number(retry) * 1_000 : Date.parse(retry ?? '')
          this.cooldownUntil = Math.max(this.now() + 60_000, Number.isFinite(until) ? until : 0)
        }
        if (!response.ok) throw new Error(`Hyperliquid candles HTTP ${response.status}.`)
        const candles = parseEquityCandles(await response.json(), market.symbol, interval.api)
          .filter(candle => candle.time * 1000 >= start && candle.time * 1000 <= end)
        if (!candles.length) throw new Error(`No Hyperliquid candles returned for ${market.symbol}.`)
        observeSource({ fetchedAt: this.now(), expiresAt: this.now() + 60_000, stale: false, fromCache: false, failures: [], sources: [source] })
        return { candles, market: market.symbol }
      }), requestPriority())
    }, { force: request.force })
    const { candles, market } = result.value
    const source = `Hyperliquid crypto perp (${market})`
    if (request.range === 'Max' || requestedStart < start) {
      observeSource({ fetchedAt: end - result.ageSeconds * 1_000, stale: result.stale, fromCache: result.fromCache,
        failures: ['Hyperliquid history is limited to its most recent 5,000 candles; longer requested history is unavailable.'], sources: [source] })
    }
    const last = candles.at(-1)!
    const previous = candles.at(-2) ?? last
    const closes = candles.map(row => row.close)
    const rsis = rsi(closes, 14)
    const payload: ChartsHistoryPayload = {
      symbol: request.symbol.toUpperCase(), intervalLabel: request.interval, rangeLabel: request.range, interval: interval.api,
      candles,
      stats: { symbol: request.symbol.toUpperCase(), price: last.close, change: previous.close ? (last.close / previous.close - 1) * 100 : 0,
        absChange: last.close - previous.close, open: last.open, high: last.high, low: last.low, close: last.close,
        volume: last.volume, currency: 'USD', longName: `${market} perpetual`, source, market },
      // These fields represent daily SMAs elsewhere in the Charts workspace.
      indicators: { ma50: interval.api === '1d' ? toPoints(candles, sma(closes, 50)) : [],
        ma200: interval.api === '1d' ? toPoints(candles, sma(closes, 200)) : [],
        rsi: toPoints(candles, rsis), rsiMa: toPoints(candles, sma(rsis, 14)) },
    }
    return { payload, stale: result.stale, fromCache: result.fromCache, cacheAgeSeconds: result.ageSeconds }
  }
}

export const cryptoCharts = new CryptoChartsClient()
