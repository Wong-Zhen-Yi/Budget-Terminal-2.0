import type { CryptoQuote, Quote } from '../shared/contract.js'
import { COINGECKO_IDS, CRYPTO_HEATMAP_LIMIT, firstNumber } from '../shared/crypto.js'
import type { CachedResult } from './cache.js'
import { coinGeckoClient } from './coingecko.js'
import { hyperliquidClient } from './hyperliquid.js'
import { captureSources, observeSource } from './sourceHealth.js'

export const CRYPTO_MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets?' + new URLSearchParams({
  vs_currency: 'usd', order: 'market_cap_desc', page: '1', sparkline: 'false',
  price_change_percentage: '24h', per_page: String(CRYPTO_HEATMAP_LIMIT),
})

export type CoinQuote = Pick<CryptoQuote, 'price' | 'changePct' | 'volume' | 'marketCap' | 'source'>

export function isCryptoQuoteSymbol(symbol: string): boolean {
  return /^[A-Z0-9]+-USD$/.test(symbol)
}

/** Reuse the heatmap endpoint and its shared cache, pacing and cooldown. */
export async function fetchCoinGeckoQuotes(): Promise<Record<string, CoinQuote>> {
  const body = await coinGeckoClient.getJson(CRYPTO_MARKETS_URL)
  const rows = Array.isArray(body) ? body : []
  const quotes: Record<string, CoinQuote> = {}
  const ids = { ...COINGECKO_IDS }
  // Unknown tickers must be unique in the ranked response; known coins use stable IDs.
  for (const row of rows) {
    const label = typeof row?.symbol === 'string' ? row.symbol.toUpperCase() : ''
    if (!/^[A-Z0-9]+$/.test(label) || Object.hasOwn(ids, label) || typeof row.id !== 'string') continue
    if (rows.filter(candidate => String(candidate?.symbol ?? '').toUpperCase() === label).length === 1) ids[label] = row.id
  }
  for (const [label, id] of Object.entries(ids)) {
    const row = rows.find(row => row?.id === id)
    if (!row) continue
    const price = firstNumber(row.current_price)
    quotes[label] = {
      price: price !== null && price > 0 ? price : null,
      changePct: firstNumber(row.price_change_percentage_24h_in_currency, row.price_change_percentage_24h),
      volume: firstNumber(row.total_volume), marketCap: firstNumber(row.market_cap), source: 'CoinGecko',
    }
  }
  return quotes
}

/** Crypto bypasses stock credentials and all other quote providers. */
export async function resolveCryptoQuote(symbol: string): Promise<CachedResult<Quote> & { stale: boolean }> {
  const label = symbol.slice(0, -4)
  const { value: coins, snapshot } = await captureSources(() => fetchCoinGeckoQuotes().catch(() => ({} as Record<string, CoinQuote>)))
  const coin = coins[label]
  if (coin?.price != null && coin.changePct != null && coin.changePct > -100) {
    const asOf = snapshot?.asOf ?? snapshot?.fetchedAt ?? Date.now()
    if (snapshot) observeSource(snapshot)
    return { value: { symbol, price: coin.price, change: coin.changePct,
      absChange: coin.price - coin.price / (1 + coin.changePct / 100), currency: 'USD',
      source: 'CoinGecko', changeBasis: '24h', asOf },
    ageSeconds: Math.max(0, (Date.now() - asOf) / 1000), fromCache: snapshot?.fromCache ?? false,
    stale: snapshot?.stale ?? false, snapshot }
  }
  const payload = await hyperliquidClient.getMarkets()
  const market = payload.markets.find(row => row.symbol === label)
  if (!market || market.changePct === null || market.changePct <= -100) throw new Error(`${symbol}: Hyperliquid and CoinGecko quote unavailable.`)
  const asOf = new Date(payload.fetchedAt).getTime()
  const fallbackReason = 'CoinGecko spot quote unavailable; using a Hyperliquid perpetual mark.'
  observeSource({ fetchedAt: asOf, asOf, stale: false, fromCache: false,
    failures: [fallbackReason], sources: ['Hyperliquid crypto perp'] })
  return { value: { symbol, price: market.markPrice, change: market.changePct,
    absChange: market.markPrice - market.markPrice / (1 + market.changePct / 100), currency: 'USD',
    source: 'Hyperliquid crypto perp', changeBasis: '24h', asOf, fallbackReason },
  fromCache: false, stale: false, ageSeconds: Math.max(0, (Date.now() - asOf) / 1000) }
}
