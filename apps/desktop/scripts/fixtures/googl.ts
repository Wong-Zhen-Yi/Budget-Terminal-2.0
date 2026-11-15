import type { StocksPayload } from '../../electron/shared/contract.js'
import { emptyGooglPayload, type GooglReport } from '../../electron/shared/googl.js'
import reports from './googl-reports.json'

/** SEC results with synthetic market data; never used by the application service. */
export function googlFixture() {
  const payload = emptyGooglPayload()
  payload.earnings = { reports: structuredClone(reports) as GooglReport[], warnings: [] }
  const candles = Array.from({ length: 760 }, (_, index) => ({ time: 1728000000 + index * 86400, open: 160 + index / 7, close: 161 + index / 7, high: 163 + index / 7, low: 159 + index / 7, volume: 20e6 }))
  payload.market = {
    symbol: 'GOOGL', currentQuote: { symbol: 'GOOGL', price: 270, change: 1.1, absChange: 2.94, source: 'Synthetic stock quote', asOf: Date.UTC(2026, 10, 13) },
    company: { name: 'Alphabet', exchange: 'NASDAQ', sector: 'Communication Services', industry: 'Internet Content', description: 'Search, advertising and cloud' },
    metrics: { marketCap: '$3.3T', revenue: '$480B', netIncome: '$120B', eps: '$10', grossMargin: '60%', operatingMargin: '32%', netMargin: '25%', sharesOutstanding: '12B', pe: '27x', forwardPe: '24x', dividend: '$0.88', exDividendDate: '2026-12-07', volume: '20M', beta: '1.1', earningsDate: '2027-02-03' },
    targets: { low: '$220', mean: '$300', high: '$350', upsideToMean: '+11%', upsidePct: 11, analysts: '40' },
    chart: { candles, mfi: [], stats: { symbol: 'GOOGL', currency: 'USD', longName: 'Alphabet', price: 270, change: 1.1, absChange: 2.94, open: 269, high: 273, low: 268, close: 270, volume: 20e6, source: 'Synthetic daily history' } },
    news: [], institutional: [], insiders: [], missing: [], generatedAt: Date.now(),
  } satisfies StocksPayload
  payload.progress = { market: 'loaded', earnings: 'loaded' }
  payload.laneFetchedAt = { market: Date.now(), earnings: Date.now() }
  payload.fetchedAt = Date.now()
  return payload
}
