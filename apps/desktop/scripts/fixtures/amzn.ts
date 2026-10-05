import type { StocksPayload } from '../../electron/shared/contract.js'
import { emptyAmznPayload, type AmznReport } from '../../electron/shared/amzn.js'
import { emptyFundamentalSeriesMap } from '../../electron/shared/fundamentalsPage.js'
import recordedReports from './amzn-reports.json'

/** Recorded SEC results, paired with deterministic synthetic market data. */
export function amznFixture() {
  const payload = emptyAmznPayload()
  payload.earnings = { reports: structuredClone(recordedReports) as AmznReport[], warnings: [] }
  const candles = Array.from({ length: 1100 }, (_, index) => ({ time: 1696118400 + index * 86400, open: 130 + index / 10, close: 131 + index / 10, high: 133 + index / 10, low: 129 + index / 10, volume: 30e6 }))
  payload.market = {
    symbol: 'AMZN', company: { name: 'Amazon.com', exchange: 'NASDAQ', sector: 'Consumer Cyclical', industry: 'Internet Retail', description: 'Retail and cloud services' },
    metrics: { marketCap: '$2.5T', revenue: '$760B', netIncome: '$135B', eps: '$12', grossMargin: '50%', operatingMargin: '14%', netMargin: '18%', sharesOutstanding: '10.9B', pe: '20x', forwardPe: '28x', dividend: '--', exDividendDate: '--', volume: '30M', beta: '1.2', earningsDate: '2026-10-29' },
    targets: { low: '$220', mean: '$280', high: '$320', upsideToMean: '+16%', upsidePct: 16, analysts: '50' },
    chart: { candles, mfi: [], stats: { symbol: 'AMZN', currency: 'USD', longName: 'Amazon.com', price: 241, change: 1.2, absChange: 2.9, open: 240, high: 243, low: 238, close: 241, volume: 30e6 } },
    news: [{ id: 'amzn-news', ticker: 'AMZN', title: 'Amazon announces second-quarter results', source: 'Amazon', publishedAt: Date.UTC(2026, 6, 30), url: 'https://ir.aboutamazon.com/news-release/' }],
    institutional: [], insiders: [], missing: [], generatedAt: Date.now(),
  } as StocksPayload
  const quarterly = emptyFundamentalSeriesMap()
  for (const report of payload.earnings.reports) {
    const quarter = Number(report.period.slice(-1))
    const endDate = `${report.period.slice(0, 4)}-${String(quarter * 3).padStart(2, '0')}-${quarter === 1 || quarter === 4 ? '31' : '30'}`
    for (const key of ['revenue', 'netIncome', 'operatingCashFlow', 'freeCashFlow'] as const) {
      if (report[key] !== null) quarterly[key].push({ endDate, label: endDate, value: report[key], source: 'sec' })
    }
  }
  payload.financials = {
    symbol: 'AMZN', company: { name: 'Amazon.com', exchange: 'NASDAQ', sector: 'Consumer Cyclical', industry: 'Internet Retail', currency: 'USD', website: 'https://amazon.com', irWebsite: 'https://ir.aboutamazon.com' },
    facts: { trailingPe: 20, forwardPe: 28, priceToSales: 3.3, pegRatio: 1.5, earningsGrowth: 0.2, enterpriseValue: 2.5e12, ebitda: 150e9, marketCap: 2.5e12, totalRevenue: 760e9, freeCashFlow: -7.6e9, totalCash: 90e9, totalDebt: 80e9, sharesOutstanding: 10.9e9, beta: 1.2, currentPrice: 241 },
    quarterly, annual: emptyFundamentalSeriesMap(), sec: { available: true, statementsAvailable: true, cik: '0001018724', freshness: 'fresh', statementFreshness: 'fresh', cacheAgeSeconds: 0,
      filings: [{ form: '8-K', filedDate: '2026-07-30', reportPeriod: '2026-07-30', description: 'Earnings release', items: '2.02', accessionNumber: '0001018724-26-000024', documentUrl: 'https://www.sec.gov/Archives/edgar/data/1018724/000101872426000024/amzn-20260730.htm' }], warnings: [] }, warnings: [], generatedAt: Date.now(),
  }
  payload.progress = { market: 'loaded', financials: 'loaded', earnings: 'loaded' }
  payload.laneFetchedAt = { market: Date.now(), financials: Date.now(), earnings: Date.now() }
  payload.fetchedAt = Date.now()
  return payload
}
