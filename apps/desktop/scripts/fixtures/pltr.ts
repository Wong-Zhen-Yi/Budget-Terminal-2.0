import type { FundamentalsPagePayload, StocksPayload } from '../../electron/shared/contract.js'
import { emptyFundamentalSeriesMap } from '../../electron/shared/fundamentalsPage.js'
import { buildStocksStats, normalizeStocksFacts } from '../../electron/shared/stocks.js'

/** Synthetic UI and calculation fixtures, not reported Palantir results. */
export function pltrFixture(): { market: StocksPayload; financials: FundamentalsPagePayload } {
  const quarterly = emptyFundamentalSeriesMap()
  for (let index = 0; index < 12; index++) {
    const endDate = new Date(Date.UTC(2023, 3 + index * 3, 0)).toISOString().slice(0, 10)
    const point = (value: number) => ({ endDate, label: endDate, source: 'sec' as const, value })
    quarterly.revenue.push(point((index + 1) * 100e6))
    quarterly.netIncome.push(point((index - 2) * 20e6))
    quarterly.operatingCashFlow.push(point((index + 1) * 35e6))
    quarterly.freeCashFlow.push(point((index + 1) * 30e6))
    quarterly.sharesOutstanding.push(point(2e9 + index * 10e6))
    quarterly.researchDevelopment.push(point(100e6 + index * 5e6))
  }
  const financials: FundamentalsPagePayload = {
    symbol: 'PLTR', displayCurrency: 'USD', currencyVersion: 2, generatedAt: Date.now(),
    company: { name: 'Palantir Technologies', exchange: 'NASDAQ', sector: 'Technology', industry: 'Software', currency: 'USD', website: '', irWebsite: '' },
    facts: { marketCap: 200e9, trailingPe: 90, forwardPe: 60, priceToSales: 40, pegRatio: null, earningsGrowth: null,
      enterpriseValue: 195e9, ebitda: null, totalRevenue: 5e9, freeCashFlow: 1e9, totalCash: 5e9, totalDebt: 0,
      sharesOutstanding: 2.11e9, beta: 1.8, currentPrice: 94 },
    quarterly, annual: emptyFundamentalSeriesMap(), warnings: [],
    sec: { available: true, statementsAvailable: true, cik: '1321655', freshness: 'fresh', statementFreshness: 'fresh', cacheAgeSeconds: 0, warnings: [],
      filings: [{ form: '10-Q', filedDate: '2026-05-05', reportPeriod: '2026-03-31', description: 'Quarterly report', items: '', accessionNumber: 'fixture', documentUrl: 'https://www.sec.gov/Archives/edgar/data/1321655/fixture/pltr.htm' }] },
  }
  const candles = Array.from({ length: 1000 }, (_, index) => ({ time: Date.UTC(2023, 0, index + 1) / 1000,
    open: 20 + index / 15, high: 23 + index / 15, low: 18 + index / 15, close: 21 + index / 15, volume: 20e6 + index * 1e4 }))
  return { financials, market: { symbol: 'PLTR', ...normalizeStocksFacts('PLTR', {
    companyName: 'Palantir Technologies', exchange: 'NASDAQ', sector: 'Technology', description: 'Synthetic Palantir company profile for the offline UI probe.',
    pe: 90, forwardPe: 60, targetMean: 100, analystCount: 20,
  }), generatedAt: Date.now(), missing: [],
  institutional: [{ holder: 'Fixture institution', pctHeld: '5.0%', shares: '100M', value: '$9.4B', pctChange: '+1.0%', reported: '2025-12-31' }],
  insiders: [{ date: '2026-01-15', insider: 'Fixture insider', title: 'Director', transaction: 'Sale', shares: '1,000', value: '$94,000' }],
  chart: { candles, stats: buildStocksStats('PLTR', candles, 'USD', 'Palantir Technologies'), mfi: [] },
  news: [{ id: 'fixture', ticker: 'PLTR', title: 'Palantir fixture headline', source: 'Fixture IR', publishedAt: Date.now(), url: 'https://investors.palantir.com/' }] } }
}
