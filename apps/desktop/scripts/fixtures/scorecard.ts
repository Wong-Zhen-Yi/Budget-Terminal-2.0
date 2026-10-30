import type { FundamentalsPagePayload } from '../../electron/shared/contract.js'
import { emptyFundamentalSeriesMap } from '../../electron/shared/fundamentalsPage.js'

/** Synthetic company financials; never reads a user's saved data or live providers. */
export function scorecardFixture(symbol: string, scale = 1): FundamentalsPagePayload {
  const annual = emptyFundamentalSeriesMap()
  annual.revenue = [
    { endDate: '2024-12-31', label: '2024', value: 100e9 * scale, source: 'sec' },
    { endDate: '2025-12-31', label: '2025', value: 125e9 * scale, source: 'sec' },
  ]
  annual.netIncome = [{ endDate: '2025-12-31', label: '2025', value: 25e9 * scale, source: 'sec' }]
  annual.freeCashFlow = [{ endDate: '2025-12-31', label: '2025', value: 20e9 * scale, source: 'derived' }]
  return {
    symbol, displayCurrency: 'USD', currencyVersion: 2, currencyNote: '',
    company: { name: `${symbol} Example Company`, sector: 'Technology', exchange: 'NASDAQ', industry: 'Software', currency: 'USD', quoteCurrency: 'USD', financialCurrency: 'USD', website: '', irWebsite: '' },
    facts: { trailingPe: 20, forwardPe: 18, priceToSales: 4, pegRatio: 1, earningsGrowth: .2, enterpriseValue: 480e9 * scale,
      ebitda: 40e9 * scale, marketCap: 500e9 * scale, totalRevenue: 130e9 * scale, freeCashFlow: 22e9 * scale,
      totalCash: 30e9 * scale, totalDebt: 10e9 * scale, sharesOutstanding: 1e9, beta: 1.1, currentPrice: 100 },
    annual, quarterly: emptyFundamentalSeriesMap(),
    sec: { available: true, statementsAvailable: true, cik: '', freshness: 'fresh', statementFreshness: 'fresh', cacheAgeSeconds: 0, filings: [], warnings: [] },
    warnings: [], generatedAt: Date.now(),
  }
}
