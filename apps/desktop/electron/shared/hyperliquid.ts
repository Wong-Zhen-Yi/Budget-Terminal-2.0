import type { CryptoPayload, HyperliquidMarket, HyperliquidPayload } from './contract.js'

/** Stream only explicitly labelled perp fallbacks; spot quotes keep their basis. */
export function markCryptoPerpetuals(payload: CryptoPayload, perpetuals: HyperliquidPayload): CryptoPayload {
  const markets = new Map(perpetuals.markets.map(row => [row.symbol, row]))
  const quotes = { ...payload.quotes }
  for (const [label, quote] of Object.entries(quotes)) {
    const market = markets.get(label)
    if (!market || quote.source !== 'Hyperliquid crypto perp') continue
    quotes[label] = { ...quote, price: market.markPrice, changePct: market.changePct,
      volume: quote.volumeSource?.startsWith('Hyperliquid') ? market.volume24hUsd : quote.volume }
  }
  return { ...payload, quotes, hyperliquid: perpetuals }
}

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

