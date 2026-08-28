import assert from 'node:assert/strict'

import type { Candle, StocksPayload } from '../electron/shared/contract.js'
import {
  buildStocksLlmExport,
  buildStocksStats,
  calculateMfi,
  emptyStocksPayload,
  normalizeStocksFacts,
  selectStocksPayload,
  stocksExportEscape,
  stocksHolderChange,
} from '../electron/shared/stocks.js'
import {
  getStocks,
  normalizeInsiders,
  normalizeInstitutional,
} from '../electron/services/yahoo/stocks.js'

function candles(count: number, direction: 'up' | 'flat' = 'up'): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = direction === 'up' ? 100 + index : 100
    return {
      time: 1_700_000_000 + index * 86_400,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000 + index,
    }
  })
}

function fixturePayload(): StocksPayload {
  const payload = emptyStocksPayload('TEST')
  const rows = candles(20)
  const normalized = normalizeStocksFacts('TEST', {
    companyName: 'Test | Corp',
    revenue: 2_000_000_000,
    netIncome: 200_000_000,
    grossMargin: 0.4,
    targetMean: 120,
    currentPrice: 100,
    analystCount: 12,
    description: 'Line one\nLine two',
  })
  return {
    ...payload,
    ...normalized,
    chart: {
      candles: rows,
      stats: buildStocksStats('TEST', rows),
      mfi: calculateMfi(rows),
    },
    news: [{ id: 'n1', ticker: 'TEST', title: 'Pipe | headline', source: 'Wire', publishedAt: 1_700_000_000_000, url: 'https://example.test/a|b' }],
    institutional: [{ holder: 'Alpha | Capital', pctHeld: '2.00%', shares: '1.0K', value: '$100.0K', pctChange: '+125.00%', reported: 'Mar 31, 2026' }],
    insiders: [{ date: 'Mar 31, 2026', insider: 'Jane Doe', title: 'Director', transaction: 'Sale', shares: '500', value: '$50.0K' }],
    generatedAt: 1_700_000_000_000,
  }
}

function runOffline(): void {
  const risingMfi = calculateMfi(candles(20))
  assert.equal(risingMfi.length, 7)
  assert.ok(risingMfi.every((point) => point.value === 100))
  const flatMfi = calculateMfi(candles(20, 'flat'))
  assert.ok(flatMfi.every((point) => point.value === 50))

  const statsRows = candles(3)
  const stats = buildStocksStats('TEST', statsRows)
  assert.equal(stats.close, 102)
  assert.equal(stats.absChange, 1)
  assert.equal(stats.change, 100 / 101)

  const normalized = normalizeStocksFacts('TEST', {
    revenue: 2_000_000_000,
    netIncome: 200_000_000,
    targetMean: 120,
    currentPrice: 100,
    dividendRate: 1.08,
    dividendYield: 0.0035,
  })
  assert.equal(normalized.metrics.revenue, '2.00B')
  assert.equal(normalized.metrics.netIncome, '200.00M')
  assert.equal(normalized.metrics.dividend, '$1.08 (0.35%)')
  assert.equal(normalized.targets.upsideToMean, '+20.00%')

  const holders = normalizeInstitutional({
    ownershipList: [
      { organization: 'Beta', pctHeld: 0.01, position: 500, value: 50_000, pctChange: -1.5, reportDate: '2026-03-31' },
      { organization: 'Alpha', pctHeld: 0.02, position: 1_000, value: 100_000, pctChange: 1.25, reportDate: '2026-03-31' },
    ],
  })
  assert.equal(holders[0].holder, 'Alpha')
  assert.equal(holders[0].pctChange, '+125.00%')
  assert.equal(holders[1].pctChange, '-150.00%')
  assert.equal(stocksHolderChange(1), '+100.00%')

  const insiders = normalizeInsiders({
    transactions: [
      { startDate: '2026-01-01', filerName: 'Old', filerRelation: 'Director', transactionText: 'Buy', shares: 1, value: 10 },
      { startDate: '2026-02-01', filerName: 'New', filerRelation: 'Officer', transactionText: 'Sale', shares: 2, value: 20 },
    ],
  })
  assert.equal(insiders[0].insider, 'New')

  const fixture = fixturePayload()
  const partial = { ...fixture, missing: ['News'] }
  assert.equal(selectStocksPayload(partial, null), partial)
  assert.equal(selectStocksPayload(emptyStocksPayload('BAD'), fixture), fixture)
  assert.equal(stocksExportEscape('one | two\nthree'), 'one \\| two three')
  const exported = buildStocksLlmExport(fixture, { autoFollow: true, mfiEnabled: true }, new Date('2026-01-02T03:04:05Z'))
  assert.match(exported, /# Stocks Export - TEST/)
  assert.match(exported, /\| Pipe \\\| headline \|/)
  assert.match(exported, /\| Alpha \\\| Capital \| 2\.00%/)
  assert.match(exported, /MFI14/)
  assert.equal(exported.split('\n').filter((line) => /^\| 2023-/.test(line)).length, 20)
  console.log('Stocks offline checks passed: MFI, metrics, holders, insiders, fallback, and export.')
}

async function runLive(symbol: string): Promise<void> {
  const { payload, failures } = await getStocks(symbol, true)
  const rows = payload.chart.candles
  assert.ok(rows.length > 500, `Expected three years of daily candles, received ${rows.length}.`)
  for (let index = 1; index < rows.length; index += 1) assert.ok(rows[index].time > rows[index - 1].time)
  assert.ok(rows.every((row) => row.time < 100_000_000_000), 'Candle timestamps must be epoch seconds.')
  const coverageDays = (rows.at(-1)!.time - rows[0].time) / 86_400
  assert.ok(coverageDays >= 1_000 && coverageDays <= 1_120, `Unexpected chart coverage: ${coverageDays.toFixed(0)} days.`)
  assert.equal(payload.chart.stats.close, rows.at(-1)!.close)
  assert.ok(payload.chart.mfi.length > 0)
  assert.ok(payload.news.length <= 20)
  assert.ok(payload.institutional.length <= 25)
  assert.ok(payload.insiders.length <= 25)
  console.log(JSON.stringify({
    symbol: payload.symbol,
    company: payload.company.name,
    candles: rows.length,
    coverageDays: Math.round(coverageDays),
    close: payload.chart.stats.close,
    changePct: payload.chart.stats.change,
    latestMfi: payload.chart.mfi.at(-1)?.value ?? null,
    metrics: payload.metrics,
    targets: payload.targets,
    news: payload.news.length,
    institutional: payload.institutional.length,
    insiders: payload.insiders.length,
    failures,
  }, null, 2))
}

const args = process.argv.slice(2)
runOffline()
if (!args.includes('--offline')) {
  const symbol = args.find((arg) => !arg.startsWith('--'))?.trim().toUpperCase() || 'AAPL'
  await runLive(symbol)
}
