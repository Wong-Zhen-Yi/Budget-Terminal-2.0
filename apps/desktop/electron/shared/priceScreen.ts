import type { PriceScreenRow } from './contract.js'

/** Exchanges admitted by `PriceScreenWorker._MAJOR_EXCHANGES`. */
export const PRICE_SCREEN_EXCHANGES = ['NYQ', 'NMS', 'NGM', 'NCM', 'ASE'] as const

export const PRICE_SCREEN_LIMIT = 100

const EXCHANGE_LABELS: Readonly<Record<string, string>> = {
  NYQ: 'NYSE',
  NMS: 'Nasdaq',
  NGM: 'Nasdaq',
  NCM: 'Nasdaq',
  ASE: 'NYSE American',
}

export interface PriceScreenQuoteLike {
  symbol?: unknown
  quoteType?: unknown
  exchange?: unknown
  longName?: unknown
  shortName?: unknown
  displayName?: unknown
  regularMarketPrice?: unknown
  intradayprice?: unknown
  eodprice?: unknown
  marketCap?: unknown
  intradaymarketcap?: unknown
  'lastclosemarketcap.lasttwelvemonths'?: unknown
}

export function validatePriceRange(minimumPrice: number, maximumPrice: number): void {
  if (!Number.isFinite(minimumPrice) || !Number.isFinite(maximumPrice)) {
    throw new Error('Price range must contain finite values.')
  }
  if (minimumPrice <= 0 || maximumPrice <= 0) {
    throw new Error('Price range must be greater than $0.')
  }
  if (minimumPrice > maximumPrice) {
    throw new Error('Minimum price cannot exceed maximum price.')
  }
}

function firstPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return numeric
  }
  return null
}

/** `PriceScreenWorker._row_from_quote`, kept pure for the focused probe. */
export function priceScreenRowFromQuote(
  quote: PriceScreenQuoteLike,
  minimumPrice: number,
  maximumPrice: number,
): PriceScreenRow | null {
  if (String(quote.quoteType ?? '').trim().toUpperCase() !== 'EQUITY') return null

  const exchangeCode = String(quote.exchange ?? '').trim().toUpperCase()
  if (!(PRICE_SCREEN_EXCHANGES as readonly string[]).includes(exchangeCode)) return null

  const ticker = String(quote.symbol ?? '').trim().toUpperCase()
  if (!ticker) return null

  const price = firstPositiveNumber(
    quote.regularMarketPrice,
    quote.intradayprice,
    quote.eodprice,
  )
  const marketCap = firstPositiveNumber(
    quote.marketCap,
    quote.intradaymarketcap,
    quote['lastclosemarketcap.lasttwelvemonths'],
  )
  if (price === null || marketCap === null) return null
  if (price < minimumPrice || price > maximumPrice) return null

  const name = String(
    quote.longName ?? quote.shortName ?? quote.displayName ?? ticker,
  ).trim()
  return {
    ticker,
    name: name || ticker,
    exchange: EXCHANGE_LABELS[exchangeCode] ?? exchangeCode,
    price,
    marketCap,
  }
}

/** Stable ranking used by the worker and renderer: cap desc, price asc, ticker asc. */
export function rankPriceScreenRows(
  rows: Iterable<PriceScreenRow>,
  limit = PRICE_SCREEN_LIMIT,
): PriceScreenRow[] {
  return [...rows]
    .sort(
      (left, right) =>
        right.marketCap - left.marketCap ||
        left.price - right.price ||
        left.ticker.localeCompare(right.ticker),
    )
    .slice(0, Math.max(1, Math.trunc(limit)))
}

/** `_p30_format_compact_currency`: two decimal places on every magnitude band. */
export function formatPriceScreenMarketCap(value: number): string {
  if (!Number.isFinite(value)) return 'N/A'
  const sign = value < 0 ? '-' : ''
  const absolute = Math.abs(value)
  for (const [divisor, suffix] of [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ] as const) {
    if (absolute >= divisor) return `${sign}$${(absolute / divisor).toFixed(2)}${suffix}`
  }
  return `${sign}$${absolute.toFixed(2)}`
}
