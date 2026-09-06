import type { Envelope } from '../../shared/contract.js'
import { meta } from '../../shared/envelope.js'
import { cache } from '../cache.js'
import { paced, yahoo } from './client.js'

export function priceToSalesValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export async function getMarketCapSales(symbols: string[], force = false): Promise<Envelope<Record<string, number | null>>> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 100)
  const errors: Envelope<Record<string, number | null>>['errors'] = []
  const entries = await Promise.all(unique.map(async (symbol) => {
    try {
      const result = await cache.resolveWithStaleFallback(`market-cap-sales:${symbol}`, 5 * 60_000, async () => {
        const summary = await paced(() => yahoo.quoteSummary(symbol, { modules: ['summaryDetail'] }))
        return priceToSalesValue(summary.summaryDetail?.priceToSalesTrailing12Months)
      }, { force })
      if (result.stale) errors.push({ source: 'Yahoo Finance', symbol, operation: 'P/S', reason: 'Refresh failed; showing cached P/S.' })
      return [symbol, result.value] as const
    } catch {
      errors.push({ source: 'Yahoo Finance', symbol, operation: 'P/S', reason: 'P/S could not be loaded.' })
      return [symbol, null] as const
    }
  }))
  return { data: Object.fromEntries(entries), meta: meta('Yahoo Finance', errors.length ? 'partial' : 'fresh'), errors }
}
