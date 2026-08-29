import assert from 'node:assert/strict'

import type { BacktestPriceSeries } from '../electron/shared/contract.js'
import {
  calculateBuyHoldBacktest,
  normalizeBacktestPageSettings,
  normalizeBacktestRows,
} from '../electron/shared/backtest.js'
import { cache } from '../electron/services/cache.js'
import { yahooProvider } from '../electron/services/provider.js'
import { yahoo } from '../electron/services/yahoo/client.js'

function series(values: number[], start = '2020-01-01'): BacktestPriceSeries {
  const first = new Date(`${start}T00:00:00Z`)
  return {
    dates: values.map((_, index) => new Date(first.getTime() + index * 86_400_000).toISOString().slice(0, 10)),
    values,
  }
}

async function offlineChecks(): Promise<void> {
  const normalized = normalizeBacktestRows([
    { symbol: 'aapl', weight: '60' },
    { symbol: 'MSFT', weight: 40 },
    { symbol: 'MSFT', weight: 20 },
    { symbol: '', weight: 20 },
  ])
  assert.equal(normalized.totalWeight, 100)
  assert.deepEqual(normalized.rows, [
    { symbol: 'AAPL', weight: 60 },
    { symbol: 'MSFT', weight: 40 },
  ])

  const result = calculateBuyHoldBacktest(
    { AAA: series([100, 110, 120]), BBB: series([100, 100, 100]) },
    [{ symbol: 'AAA', weight: 50 }, { symbol: 'BBB', weight: 50 }],
  )
  assert.ok(Math.abs(result.points.at(-1)!.portfolioReturnPct - 10) < 1e-10)
  assert.equal(result.stats?.finalValue, 11_000)

  const aligned = calculateBuyHoldBacktest(
    { AAA: series([100, 110, 120]), BBB: series([100, 105, 110], '2020-01-02') },
    [{ symbol: 'AAA', weight: 50 }, { symbol: 'BBB', weight: 50 }],
  )
  assert.equal(aligned.stats?.start, '2020-01-02')
  assert.throws(
    () => calculateBuyHoldBacktest(
      { AAA: series([100, 110, 120]) },
      [{ symbol: 'AAA', weight: 50 }, { symbol: 'BBB', weight: 50 }],
    ),
    /BBB/,
  )

  const compared = calculateBuyHoldBacktest(
    { AAA: series([100, 110, 120]) },
    [{ symbol: 'AAA', weight: 100 }],
    {
      compareSeries: series([200, 220, 240, 260], '2019-12-31'),
      compareSymbol: 'SPY',
    },
  )
  assert.ok(Math.abs(compared.points.at(-1)!.compareReturnPct! - 18.1818181818) < 1e-8)

  const settings = normalizeBacktestPageSettings({
    rows: [{ symbol: ' spy ', weight: -1 }, { symbol: 'SPY', weight: 50 }],
    compareSymbol: ' qqq ',
    interval: 'bad',
    range: 'ytd',
    splitterSizes: [3, 7],
  })
  assert.deepEqual(settings.rows, [{ symbol: 'SPY', weight: 0 }])
  assert.equal(settings.compareSymbol, 'QQQ')
  assert.equal(settings.interval, '1D')
  assert.equal(settings.range, 'YTD')
  assert.deepEqual(settings.splitterSizes, [3, 7])

  const chartClient = yahoo as unknown as { chart: (symbol: string) => Promise<unknown> }
  const originalChart = yahoo.chart.bind(yahoo) as unknown as (symbol: string) => Promise<unknown>
  const fixture = (symbol: string) => ({
    quotes: Array.from({ length: 12 }, (_, index) => ({
      date: new Date(Date.UTC(2020, 0, index + 1)),
      close: 100 + index,
      adjclose: (symbol === 'BBB' ? 200 : 100) + index,
    })),
  })
  try {
    cache.clear()
    chartClient.chart = async (symbol) => fixture(symbol)
    const request = {
      rows: [{ symbol: 'AAA', weight: 50 }, { symbol: 'BBB', weight: 50 }],
      compareSymbol: 'SPY',
      interval: '1D' as const,
      range: 'Max' as const,
      force: true,
    }
    const fresh = await yahooProvider.backtest(request)
    assert.equal(fresh.meta.freshness, 'fresh')
    assert.equal(fresh.data.points.length, 12)
    assert.equal(fresh.data.stats?.start, '2020-01-01')
    const cached = await yahooProvider.backtest({ ...request, force: false })
    assert.equal(cached.meta.freshness, 'cached')
    chartClient.chart = async () => { throw new Error('injected provider outage') }
    const stale = await yahooProvider.backtest(request)
    assert.equal(stale.meta.freshness, 'stale')
    const failed = await yahooProvider.backtest({
      ...request,
      rows: [{ symbol: 'NEVER-CACHED', weight: 100 }],
      compareSymbol: '',
    })
    assert.equal(failed.meta.freshness, 'failed')
  } finally {
    chartClient.chart = originalChart
    cache.clear()
  }

  console.log('Backtest offline checks passed: settings, weights, overlap, buy-and-hold return, comparison alignment, missing data, and provider cache/error states.')
}

async function liveCheck(symbol: string): Promise<void> {
  const envelope = await yahooProvider.backtest({
    rows: [{ symbol, weight: 100 }],
    compareSymbol: symbol === 'SPY' ? 'QQQ' : 'SPY',
    interval: '1D',
    range: '1Y',
    force: true,
  })
  assert.notEqual(envelope.meta.freshness, 'failed', envelope.meta.failureReason ?? '')
  assert.ok(envelope.data.points.length > 100)
  assert.ok(envelope.data.stats)
  console.log(JSON.stringify({
    symbol,
    freshness: envelope.meta.freshness,
    points: envelope.data.points.length,
    compare: envelope.data.compareSymbol,
    stats: envelope.data.stats,
  }, null, 2))
}

const args = process.argv.slice(2)
await offlineChecks()
if (!args.includes('--offline')) {
  await liveCheck(args.find((argument) => !argument.startsWith('--'))?.trim().toUpperCase() || 'SPY')
}
