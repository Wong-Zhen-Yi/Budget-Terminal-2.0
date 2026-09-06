import type { MarketCapRow, MarketCapTier } from './contract.js'
import type { PriceScreenQuoteLike } from './priceScreen.js'

export const MARKET_CAP_TIERS: ReadonlyArray<{ id: MarketCapTier; label: string; minimum: number; maximum: number | null }> = [
  { id: 'all', label: 'All sizes', minimum: 0, maximum: null },
  { id: 'mega', label: 'Mega cap ($200B+)', minimum: 200e9, maximum: null },
  { id: 'large', label: 'Large cap ($10B to <$200B)', minimum: 10e9, maximum: 200e9 },
  { id: 'mid', label: 'Mid cap ($2B to <$10B)', minimum: 2e9, maximum: 10e9 },
  { id: 'small', label: 'Small cap ($300M to <$2B)', minimum: 300e6, maximum: 2e9 },
  { id: 'micro', label: 'Micro cap ($50M to <$300M)', minimum: 50e6, maximum: 300e6 },
  { id: 'nano', label: 'Nano cap (<$50M)', minimum: 0, maximum: 50e6 },
]

export function marketCapTier(tier: MarketCapTier = 'all') {
  const range = MARKET_CAP_TIERS.find((entry) => entry.id === tier)
  if (!range) throw new Error('Unknown market-cap range.')
  return range
}

export function marketCapInTier(value: number, tier: MarketCapTier): boolean {
  const range = marketCapTier(tier)
  return Number.isFinite(value) && value > 0 && value >= range.minimum && (range.maximum === null || value < range.maximum)
}

export const MARKET_CAP_EXCHANGES = ['NYQ', 'NMS', 'NGM', 'NCM', 'ASE'] as const
export const MARKET_CAP_LIMIT = 100
export const MARKET_CAP_TTL = 5 * 60_000

function positive(...values: unknown[]): number | null {
  return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0) ?? null
}

export interface MarketCapQuoteLike extends PriceScreenQuoteLike {
  epsTrailingTwelveMonths?: unknown
  trailingPE?: unknown
  forwardPE?: unknown
}

export function marketCapRowFromQuote(quote: MarketCapQuoteLike): MarketCapRow | null {
  const ticker = String(quote.symbol ?? '').trim().toUpperCase()
  const exchange = String(quote.exchange ?? '').trim().toUpperCase()
  const cap = positive(quote.marketCap, quote.intradaymarketcap)
  if (!ticker || String(quote.quoteType).toUpperCase() !== 'EQUITY' ||
      !(MARKET_CAP_EXCHANGES as readonly string[]).includes(exchange) || cap === null) return null
  return {
    rank: 0,
    ticker,
    name: String(quote.longName ?? quote.shortName ?? quote.displayName ?? ticker).trim() || ticker,
    exchange: exchange === 'NYQ' ? 'NYSE' : exchange === 'ASE' ? 'NYSE American' : 'Nasdaq',
    marketCap: cap,
    price: positive(quote.regularMarketPrice, quote.intradayprice, quote.eodprice),
    trailingEps: typeof quote.epsTrailingTwelveMonths === 'number' && Number.isFinite(quote.epsTrailingTwelveMonths)
      ? quote.epsTrailingTwelveMonths : null,
    trailingPe: positive(quote.trailingPE),
    forwardPe: positive(quote.forwardPE),
  }
}

export function rankMarketCapRows(rows: Iterable<MarketCapRow>, limit = MARKET_CAP_LIMIT): MarketCapRow[] {
  return [...rows].sort((a, b) => b.marketCap - a.marketCap || a.ticker.localeCompare(b.ticker))
    .slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }))
}
