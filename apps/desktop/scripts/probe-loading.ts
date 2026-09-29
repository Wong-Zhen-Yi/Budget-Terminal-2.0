import assert from 'node:assert/strict'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeExposure, emptyRiskMetrics } from '../electron/shared/analytics.js'
import { ok } from '../electron/shared/envelope.js'
import { TABS, type AnalyticsPayload } from '../electron/shared/contract.js'
import { waitForWarmSlot, warmQuery } from '../src/api/warmQueue.js'
import { recentPages, startupPages } from '../electron/shared/navigation.js'

assert.deepEqual(recentPages(['stocks', 'charts', 'portfolio'], 'charts'), ['charts', 'stocks', 'portfolio'])
assert.equal(recentPages(['a', 'b', 'c', 'd', 'e', 'f'], 'g').length, 6)
const allPages = TABS.filter((tab) => tab.implemented).map((tab) => tab.id)
const startup = startupPages('dashboard', ['portfolio', 'charts'], ['heatmap', 'trading-volumes', 'stocks', 'fundamentals'])
assert.deepEqual(startup.slice(0, 7), ['dashboard', 'portfolio', 'charts', 'heatmap', 'trading-volumes', 'stocks', 'fundamentals'])
assert.deepEqual([...startup].sort(), [...allPages].sort())
assert.deepEqual(startupPages('heatmap', [], []).slice(0, 1), ['heatmap'])
assert.equal(startupPages('dashboard', [], []).includes('economic'), true)
assert.equal(startupPages('dashboard', [], []).includes('settings'), true)

// Build the actual startup task list with a representative portfolio. An added page
// must receive a task or be explicitly accounted for as local/shared initial state.
Object.assign(globalThis, { window: { api: {} } })
const { buildTasks } = await import('../src/api/prefetch.js')
const portfolio = {
  activeId: 'main', mainId: 'main', portfolios: [{
    id: 'main', readOnly: false, tickers: ['AAPL'],
    holdings: { AAPL: { shares: 1, includeInWeight: true } },
  }],
} as unknown as import('../electron/shared/contract.js').PortfolioPayload
const scheduled = new Set(buildTasks(portfolio, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' },
  { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).map((task) => task.tab))
const sharedOrLocal = new Set(['beta', 'bonds', 'dictionary', 'options', 'settings'])
for (const page of allPages) {
  assert(scheduled.has(page) || sharedOrLocal.has(page), `${page} is absent from startup loading`)
}

import { cache, TtlCache } from '../electron/services/cache.js'
import { yahoo } from '../electron/services/yahoo/client.js'
import { fetchSparkCloses } from '../electron/services/yahoo/spark.js'

// Entirely offline: measure provider calls without spending a real data allowance.
const local = new TtlCache()
let calls = 0
const loader = async () => { calls += 1; return 42 }
await Promise.all(Array.from({ length: 20 }, () => local.resolve('same', 1000, loader)))
assert.equal(calls, 1)
await local.resolve('same', 1000, loader)
assert.equal(calls, 1)
await local.resolve('same', 1000, loader, { force: true })
assert.equal(calls, 2)

let failures = 0
const fail = async () => { failures += 1; throw new Error('provider unavailable') }
local.set('stale', 7, -1)
for (let index = 0; index < 5; index += 1) {
  const fallback = await local.resolveWithStaleFallback('stale', 1000, fail, { force: true })
  assert.equal(fallback.value, 7)
  assert.equal(fallback.stale, true)
}
assert.equal(failures, 1)
const realNow = Date.now
const afterCooldown = realNow() + 10_001
try {
  Date.now = () => afterCooldown
  await local.resolveWithStaleFallback('stale', 1000, fail)
  assert.equal(failures, 2)
} finally {
  Date.now = realNow
}
local.delete('stale')
await assert.rejects(local.resolve('stale', 1000, fail), /provider unavailable/)
assert.equal(failures, 3)
local.set('stale', 9, 1000)
assert.equal((await local.resolve('stale', 1000, loader)).value, 9)

const originalFetch = yahoo._fetch
const batches: string[][] = []
Object.defineProperty(yahoo, '_fetch', { configurable: true, value: async (
  _url: string, params: { symbols: string },
) => {
  const symbols = params.symbols.split(',')
  batches.push(symbols)
  return Object.fromEntries(symbols.map((symbol) => [symbol, {
    symbol, timestamp: [1_700_000_000, 1_700_086_400], close: [100, 101],
  }]))
} })
try {
  cache.clear()
  await Promise.all([
    fetchSparkCloses(['AAPL', 'MSFT']),
    fetchSparkCloses(['MSFT', 'AAPL']),
  ])
  assert.equal(batches.length, 1)
  const overlap = await fetchSparkCloses(['MSFT', 'NVDA'])
  assert.deepEqual(batches[1], ['NVDA'])
  assert.deepEqual(overlap.missing, [])
  await fetchSparkCloses(['MSFT'])
  assert.equal(batches.length, 2)
  await fetchSparkCloses(['MSFT'], '1y', true)
  assert.equal(batches.length, 3)
  await fetchSparkCloses(['MSFT'], '1mo')
  assert.equal(batches.length, 4)
} finally {
  Object.defineProperty(yahoo, '_fetch', { configurable: true, value: originalFetch })
  cache.clear()
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
try {
  // A stuck warm request releases the queue and leaves its key retryable on mount.
  let finishLate!: (value: string) => void
  await assert.rejects(warmQuery(client, {
    queryKey: ['stuck'], staleTime: Infinity,
    queryFn: () => new Promise<string>((resolve) => { finishLate = resolve }),
  }, 20), /timed out/)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(client.getQueryState(['stuck'])?.fetchStatus, 'idle')
  assert.equal(await warmQuery(client, {
    queryKey: ['next'], staleTime: Infinity, queryFn: async () => 'next loaded',
  }), 'next loaded')
  assert.equal(await client.fetchQuery({ queryKey: ['stuck'], queryFn: async () => 'recovered' }), 'recovered')
  finishLate('obsolete result')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(client.getQueryData(['stuck']), 'recovered')

  await assert.rejects(warmQuery(client, {
    queryKey: ['failed'], staleTime: Infinity,
    queryFn: async () => ({ data: [], meta: { freshness: 'failed' } }),
  }), /load failed/)
  assert.equal(client.getQueryState(['failed'])?.status, 'error')
  const stale = { data: [42], meta: { freshness: 'stale' } }
  assert.deepEqual(await warmQuery(client, {
    queryKey: ['fallback'], staleTime: Infinity, queryFn: async () => stale,
  }), stale)

  // Joining foreground work must have a deadline without cancelling that work.
  let finishForeground!: (value: number) => void
  const foreground = client.fetchQuery({
    queryKey: ['shared'], queryFn: () => new Promise<number>((resolve) => { finishForeground = resolve }),
  })
  await assert.rejects(warmQuery(client, {
    queryKey: ['shared'], staleTime: Infinity, queryFn: async () => 0,
  }, 20), /timed out/)
  assert.equal(client.getQueryState(['shared'])?.fetchStatus, 'fetching')
  finishForeground(42)
  assert.equal(await foreground, 42)

  // Constant foreground polling may delay warm-up, but cannot starve it forever.
  await Promise.race([
    waitForWarmSlot({
      isHidden: () => false, isForegroundFetching: () => true, isCancelled: () => false,
      foregroundGraceMs: 20, pollMs: 5,
    }),
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Warm-up starved')), 500)
      timer.unref()
    }),
  ])
  let cancelled = false
  const hiddenWait = waitForWarmSlot({
    isHidden: () => true, isForegroundFetching: () => false, isCancelled: () => cancelled, pollMs: 5,
  })
  cancelled = true
  await hiddenWait
} finally {
  client.clear()
}
console.log('Loading checks passed: cache deduplication, stale fallback, warm-up deadlines, retry after failure, foreground isolation, bounded foreground wait and cancellation.')

// Exercise the real analytics hook and Metrics tab with cached history, then
// render again as initially missing quotes arrive and subsequently change.
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
let historyCalls = 0
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { api: { analytics: async () => { historyCalls += 1; throw new Error('Unexpected history request') } } },
})
const metricsClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
try {
  const { queryKeys } = await import('../src/api/client.js')
  const { positionsSignature } = await import('../src/api/portfolioQueries.js')
  const { MetricsTab } = await import('../src/components/portfolio/MetricsTab.js')
  const positions = [{ ticker: 'AAPL', shares: 10 }]
  const history = ok<AnalyticsPayload>({
    metrics: { ...emptyRiskMetrics(), beta: 1.25 },
    exposure: computeExposure(1, {}),
    benchmarkSymbol: 'SPY', lookback: '1y', startDate: '2025-01-01', endDate: '2026-01-01',
    historyPoints: 252, includedTickers: ['AAPL'], excludedTickers: [], note: '', reason: '',
  })
  const key = queryKeys.analytics(positionsSignature(positions, 0), 'SPY', '1y')
  metricsClient.setQueryData(key, history)
  const render = (currentValues: Record<string, number>) => renderToStaticMarkup(
    createElement(QueryClientProvider, { client: metricsClient },
      createElement(MetricsTab, { positions, cashAmount: 0, currentValues, visible: true })),
  )
  assert.match(render({}), /\$0\.00/)
  assert.match(render({ AAPL: 2000 }), /\$2,000\.00/)
  const updated = render({ AAPL: 2500 })
  assert.match(updated, /\$2,500\.00/)
  assert.match(updated, /1\.25x/)
  assert.equal(historyCalls, 0)
  assert.deepEqual(metricsClient.getQueryData(key), history)
  console.log('Metrics renderer smoke passed: exposure follows quote arrivals and updates without refetching or changing cached history.')
} finally {
  metricsClient.clear()
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
  else Reflect.deleteProperty(globalThis, 'window')
}
