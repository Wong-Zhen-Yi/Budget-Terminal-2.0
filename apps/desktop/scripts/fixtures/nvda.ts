import { buildStocksStats, normalizeStocksFacts } from '../../electron/shared/stocks.js'
import type { NvdaPayload } from '../../electron/shared/nvda.js'

export function nvdaFixture(): NvdaPayload {
  const now = Date.UTC(2026, 10, 18)
  const candles = Array.from({ length: 250 }, (_, index) => {
    const price = 180 + index / 8 + Math.sin(index / 11) * 10
    return { time: now / 1000 - (249 - index) * 86400, open: price, close: price + Math.sin(index), high: price + 3, low: price - 3, volume: 1e8 }
  })
  return {
    symbol: 'NVDA',
    market: {
      symbol: 'NVDA',
      currentQuote: { symbol: 'NVDA', price: 215.66, change: 1.2, absChange: 2.56, source: 'Test stock quote', asOf: now },
      ...normalizeStocksFacts('NVDA', { companyName: 'NVIDIA' }),
      chart: { candles, mfi: [], stats: { ...buildStocksStats('NVDA', candles), source: 'Test stock history' } },
      news: [], institutional: [], insiders: [], missing: [], generatedAt: now,
    },
    earnings: {
      sourceUrl: 'https://s201.q4cdn.com/141608511/files/doc_financials/2027/Q327/Q3FY27-CFO-Commentary.pdf',
      releaseUrl: 'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-third-quarter-fiscal-2027',
      platformLabels: ['Hyperscale', 'AI Clouds, Industrial, & Enterprise', 'Edge Computing'],
      quarters: [
        { period: 'Q3 FY2027', revenue: 115.8e9, dataCenter: 107.6e9, platforms: [60.1e9, 47.5e9, 8.2e9], grossMargin: 74.8, operatingIncome: 77.5e9, dilutedEps: 2.7 },
        { period: 'Q2 FY2027', revenue: 96.2e9, dataCenter: 89e9, platforms: [48.7e9, 40.3e9, 7.2e9], grossMargin: 75, operatingIncome: 63.7e9, dilutedEps: 2.46 },
        { period: 'Q3 FY2026', revenue: 57e9, dataCenter: 51.2e9, platforms: [35.1e9, 16.1e9, 5.8e9], grossMargin: 73.4, operatingIncome: 36e9, dilutedEps: 1.3 },
      ],
      revenueGrowthYoY: 103, platformGrowthYoY: [71, 195, 42],
      guidance: { period: 'Q4 FY2027', revenueMidpoint: 130e9, rangePct: 3 },
    },
    progress: { market: 'loaded', earnings: 'loaded' },
    laneFetchedAt: { market: now, earnings: now },
  }
}
