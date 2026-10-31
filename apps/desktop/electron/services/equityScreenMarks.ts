import type { EnvelopeError, Quote } from '../shared/contract.js'
import { equityMarket } from '../shared/equityMarkets.js'
import { getQuotes } from './yahoo/quotes.js'

/** Overlay only current prices. Screener ranks, reported multiples, volumes and
 * historical stock returns keep their own source and measurement basis.
 */
export async function markEquityScreenRows<Row extends { ticker: string; price: number | null }>(rows: Row[], force = false): Promise<{
  rows: Array<Row & { priceSource?: string; priceBasis?: Quote['priceBasis'] }>
  errors: EnvelopeError[]
  marked: boolean
}> {
  const symbols = rows.map(row => row.ticker).filter(symbol => equityMarket(symbol))
  if (!symbols.length) return { rows, errors: [], marked: false }
  const batch = await getQuotes(symbols, force)
  return {
    rows: rows.map(row => {
      const quote = batch.quotes[row.ticker]
      return quote ? { ...row, price: quote.price, priceSource: quote.source, priceBasis: quote.priceBasis }
        : equityMarket(row.ticker) ? { ...row, priceSource: 'Yahoo stock snapshot (selected live quote unavailable)' } : row
    }),
    errors: batch.errors.map(error => ({ source: 'market prices', operation: 'quote', symbol: error.symbol, reason: error.reason })),
    marked: Object.values(batch.quotes).some(quote => quote.priceBasis === 'equity-perp-mark'),
  }
}
