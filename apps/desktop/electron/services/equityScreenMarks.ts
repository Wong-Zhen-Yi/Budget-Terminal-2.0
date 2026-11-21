import type { EnvelopeError, Quote } from '../shared/contract.js'
import { equityMarket } from '../shared/equityMarkets.js'
import { getPreferredQuoteOverlay, getQuote } from './yahoo/quotes.js'
import { finnhubQuotes, finnhubSymbol } from './finnhubQuotes.js'

/** Overlay only current prices. Screener ranks, reported multiples, volumes and
 * historical stock returns keep their own source and measurement basis.
 */
export async function markEquityScreenRows<Row extends { ticker: string; price: number | null }>(rows: Row[], force = false): Promise<{
  rows: Array<Row & { priceSource?: string; priceBasis?: Quote['priceBasis'] }>
  errors: EnvelopeError[]
  marked: boolean
  sources: string[]
}> {
  const useFinnhub = await finnhubQuotes.configured('AAPL')
  const candidates = new Map<string, boolean>()
  for (const { ticker, price } of rows) {
    if (!equityMarket(ticker) && !(useFinnhub && finnhubSymbol(ticker))) continue
    candidates.set(ticker, (candidates.get(ticker) ?? true) && price !== null)
  }
  const quotes = new Map<string, Quote>()
  const errors: EnvelopeError[] = []
  const symbols = [...candidates.keys()]
  const results = await Promise.allSettled(symbols.map(symbol =>
    candidates.get(symbol) ? getPreferredQuoteOverlay(symbol, force) : getQuote(symbol, force)))
  results.forEach((result, index) => {
    const symbol = symbols[index]
    if (result.status === 'fulfilled' && result.value) quotes.set(symbol, result.value)
    const reason = result.status === 'fulfilled' ? result.value?.fallbackReason
      : result.reason instanceof Error ? result.reason.message : String(result.reason)
    if (reason) errors.push({ source: 'market prices', operation: 'quote', symbol, reason })
  })
  const applied = [...quotes.values()]
  return {
    rows: rows.map(row => {
      const quote = quotes.get(row.ticker)
      return quote ? { ...row, price: quote.price, priceSource: quote.source, priceBasis: quote.priceBasis }
        : row.price !== null && candidates.has(row.ticker) ? { ...row, priceSource: 'Yahoo Finance' } : row
    }),
    errors,
    marked: applied.some(quote => quote.priceBasis === 'equity-perp-mark' || quote.source === 'Finnhub'),
    sources: [...new Set(applied.flatMap(quote => quote.source ? [quote.source] : []))],
  }
}
