import assert from 'node:assert/strict'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeExposure, emptyRiskMetrics } from '../electron/shared/analytics.js'
import { ok } from '../electron/shared/envelope.js'
import { MACRO_SYMBOLS, TABS, type AnalyticsPayload } from '../electron/shared/contract.js'
import { runWarmTasks, waitForWarmSlot, warmQuery } from '../src/api/warmQueue.js'
import { recentPages, startupPages } from '../electron/shared/navigation.js'
import { recordStartupLoad, restoreStartupLoads, startupPageOrder } from '../electron/shared/startupLoading.js'

assert.deepEqual(recentPages(['stocks', 'charts', 'portfolio'], 'charts'), ['charts', 'stocks', 'portfolio'])
assert.equal(recentPages(['a', 'b', 'c', 'd', 'e', 'f'], 'g').length, 6)
const allPages = TABS.filter((tab) => tab.implemented).map((tab) => tab.id)
const startup = startupPages('dashboard', ['portfolio', 'charts'], ['heatmap', 'trading-volumes', 'stocks', 'fundamentals'])
assert.deepEqual(startup.slice(0, 7), ['dashboard', 'portfolio', 'charts', 'heatmap', 'trading-volumes', 'stocks', 'fundamentals'])
assert.deepEqual([...startup].sort(), [...allPages].sort())
assert.deepEqual(startupPages('heatmap', [], []).slice(0, 1), ['heatmap'])
assert.equal(startupPages('dashboard', [], []).includes('economic'), true)
assert.equal(startupPages('dashboard', [], []).includes('settings'), true)

const firstOrder = startupPages('dashboard', ['heatmap'], ['trading-volumes'])
assert.deepEqual(startupPageOrder(firstOrder, {}), firstOrder)
let learnedLoads = recordStartupLoad({}, 'heatmap', 90_000, false)
learnedLoads = recordStartupLoad(learnedLoads, 'trading-volumes', 60_000, false)
learnedLoads = recordStartupLoad(learnedLoads, 'global', 3_000, false)
const learnedOrder = startupPageOrder(firstOrder, learnedLoads)
assert.deepEqual(learnedOrder.slice(-3), ['global', 'trading-volumes', 'heatmap'])
assert.deepEqual([...learnedOrder].sort(), [...allPages].sort())
assert.deepEqual(firstOrder, startupPages('dashboard', ['heatmap'], ['trading-volumes']))
assert.equal(recordStartupLoad(learnedLoads, 'heatmap', 5, false), learnedLoads, 'Instant cache reads must retain the learned load cost')
assert.equal(recordStartupLoad(learnedLoads, 'heatmap', 600_000, true), learnedLoads, 'Provider outages must not replace successful durations')
assert.equal(recordStartupLoad(learnedLoads, 'heatmap', NaN, false), learnedLoads)
learnedLoads = recordStartupLoad(learnedLoads, 'heatmap', 10_000, false)
assert.equal(learnedLoads.heatmap.durationMs, 66_000)
assert.equal(learnedLoads.heatmap.samples, 2)
assert.deepEqual(restoreStartupLoads({ ...learnedLoads,
  stocks: { durationMs: -1, samples: 1 }, calendar: { durationMs: 1, samples: 0 },
  removedPage: { durationMs: 1, samples: 1 },
}), learnedLoads)
assert.deepEqual(restoreStartupLoads(null), {})
console.log('Adaptive loading checks passed: first launch order, learned slow pages last, all pages retained, cache/failure isolation and smoothing.')

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
const macroTasks = buildTasks(undefined, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' },
  { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 })
for (const { label } of MACRO_SYMBOLS) {
  assert(macroTasks.some(task => task.tab === 'dashboard' && task.label === `${label} sparkline`),
    `${label} history must warm even without holdings`)
}
for (const page of allPages) {
  assert(scheduled.has(page) || sharedOrLocal.has(page), `${page} is absent from startup loading`)
}

let signalsRequest: unknown
Object.assign(window.api, { signals: async (request: unknown) => { signalsRequest = request; return ok(null, 'fixture') } })
const signalsStartup = buildTasks(portfolio, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' },
  { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find((task) => task.tab === 'signals')!
const signalsClient = new QueryClient()
await signalsStartup.run(signalsClient, 7)
assert.deepEqual(signalsRequest, { background: true, backgroundOrder: 7 }, 'startup must pass the learned page order to the provider')
signalsClient.clear()

let muRequest: unknown
Object.assign(window.api, { mu: async (request: unknown) => { muRequest = request; return ok({ symbol: 'MU' }, 'fixture') } })
const muStartup = buildTasks(undefined, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' },
  { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'mu')!
const muClient = new QueryClient()
await muStartup.run(muClient, 8)
assert.deepEqual(muRequest, { background: true, backgroundOrder: 8 })
assert.equal(muClient.getQueryData<{ data: { symbol: string } }>(['mu'])?.data.symbol, 'MU', 'MU must warm the page hook cache key')
muClient.clear()
Object.assign(window.api, { mu: async () => ({ ...ok({ symbol: 'MU' }, 'fixture'),
  meta: { source: 'fixture', freshness: 'partial', fetchedAt: Date.now(), failureReason: 'Memory data unavailable' } }) })
const partialMuClient = new QueryClient()
await assert.rejects(muStartup.run(partialMuClient), /Memory data unavailable/)
assert.equal(partialMuClient.getQueryData<{ data: { symbol: string } }>(['mu'])?.data.symbol, 'MU', 'Partial MU startup must retain usable panels')
partialMuClient.clear()

let sofiRequests = 0
let sofiRequest: unknown
const { emptySofiPayload } = await import('../electron/shared/sofi.js')
Object.assign(window.api, { sofi: async (request: unknown) => {
  sofiRequests += 1
  sofiRequest = request
  return ok(emptySofiPayload(), 'SOFI fixture')
} })
const sofiSettings = { hiddenTabs: ['sofi'], favoriteTabs: [] } as unknown as import('../electron/shared/contract.js').AppSettings
const sofiTask = buildTasks(undefined, sofiSettings, { stocks: 'AAPL', fundamentals: 'AAPL' },
  { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'sofi')!
assert(sofiTask, 'Unvisited SOFI must load even when hidden and without holdings')
const sofiClient = new QueryClient()
await sofiTask.run(sofiClient, 8)
assert.deepEqual(sofiRequest, { background: true, backgroundOrder: 8 })
assert(sofiClient.getQueryData(['sofi']), 'Startup must populate the SOFI page query')
await warmQuery(sofiClient, { queryKey: ['sofi'], queryFn: () => window.api.sofi({}), staleTime: 300_000 })
assert.equal(sofiRequests, 1, 'Opening warmed SOFI must not repeat its initial load')
sofiClient.clear()
for (const freshness of ['partial', 'stale', 'failed'] as const) {
  Object.assign(window.api, { sofi: async () => ({ data: emptySofiPayload(), errors: [],
    meta: { source: 'SOFI fixture', freshness, fetchedAt: Date.now(), failureReason: 'SOFI reports unavailable' } }) })
  await assert.rejects(sofiTask.run(sofiClient), /SOFI reports unavailable/, 'Incomplete SOFI startup must remain visible')
  if (freshness !== 'failed') assert(sofiClient.getQueryData(['sofi']), 'Usable partial SOFI must remain cached')
  sofiClient.clear()
}

let hoodRequests = 0
let hoodRequest: unknown
const { emptyHoodPayload } = await import('../electron/shared/hood.js')
Object.assign(window.api, { hood: async (request: unknown) => {
  hoodRequests += 1
  hoodRequest = request
  return ok(emptyHoodPayload(), 'HOOD fixture')
} })
const hoodSettings = { hiddenTabs: ['hood'], favoriteTabs: [] } as unknown as import('../electron/shared/contract.js').AppSettings
const hoodTask = buildTasks(undefined, hoodSettings, { stocks: 'AAPL', fundamentals: 'AAPL' },
  { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'hood')!
assert(hoodTask, 'An unvisited, hidden HOOD page must load at startup even without holdings')
const hoodClient = new QueryClient()
await hoodTask.run(hoodClient, 9)
assert.deepEqual(hoodRequest, { background: true, backgroundOrder: 9 })
assert(hoodClient.getQueryData(['hood']), 'Startup must populate the page query')
await warmQuery(hoodClient, { queryKey: ['hood'], queryFn: () => window.api.hood({}), staleTime: 300_000 })
assert.equal(hoodRequests, 1, 'Opening warmed HOOD must not repeat the initial load')
hoodClient.clear()

let amznRequests = 0
let amznRequest: unknown
const { emptyAmznPayload } = await import('../electron/shared/amzn.js')
Object.assign(window.api, { amzn: async (request: unknown) => {
  amznRequests++
  amznRequest = request
  return ok(emptyAmznPayload(), 'AMZN fixture')
} })
const amznSettings = { hiddenTabs: ['amzn'], favoriteTabs: [] } as unknown as import('../electron/shared/contract.js').AppSettings
const amznTask = buildTasks(undefined, amznSettings, { stocks: 'AAPL', fundamentals: 'AAPL' },
  { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'amzn')!
assert(amznTask, 'Unvisited AMZN must load even when hidden and without holdings')
const amznClient = new QueryClient()
await amznTask.run(amznClient, 10)
assert.deepEqual(amznRequest, { background: true, backgroundOrder: 10 })
assert(amznClient.getQueryData(['amzn']), 'Startup must populate the AMZN page query')
await warmQuery(amznClient, { queryKey: ['amzn'], queryFn: () => window.api.amzn({}), staleTime: 300_000 })
assert.equal(amznRequests, 1, 'Opening warmed AMZN must not repeat its initial load')
amznClient.clear()
for (const freshness of ['partial', 'stale', 'failed'] as const) {
  Object.assign(window.api, { amzn: async () => ({ data: emptyAmznPayload(), errors: [],
    meta: { source: 'AMZN fixture', freshness, fetchedAt: Date.now(), failureReason: 'Amazon reports unavailable' } }) })
  await assert.rejects(amznTask.run(amznClient), /Amazon reports unavailable/)
  if (freshness !== 'failed') assert(amznClient.getQueryData(['amzn']), 'Usable incomplete AMZN panels must remain cached')
  amznClient.clear()
}

// Every task must start while the slow first task is still pending. A failure
// must remain visible and must not stop other pages from finishing.
const parallelTasks = Array.from({ length: 12 }, (_, index) => index)
const started: number[] = []
const settled: Array<{ task: number; status: string }> = []
let releaseSlow!: () => void
let cancelledRun = false
const parallelRun = runWarmTasks(parallelTasks, {
  isCancelled: () => cancelledRun,
  onStart: (task) => { started.push(task) },
  onSettled: (task, result) => { settled.push({ task, status: result.status }) },
  run: async (task) => {
    if (task === 0) await new Promise<void>((resolve) => { releaseSlow = resolve })
    if (task === 1) throw new Error('Page unavailable')
  },
})
assert.deepEqual(started, parallelTasks)
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(settled.length, 11)
assert.deepEqual(settled.find((entry) => entry.task === 1), { task: 1, status: 'rejected' })
releaseSlow()
await parallelRun
assert.equal(settled.length, 12)
cancelledRun = true
await runWarmTasks(parallelTasks, {
  isCancelled: () => cancelledRun,
  onStart: () => { throw new Error('Cancelled task started') },
  onSettled: () => { throw new Error('Cancelled task reported') },
  run: async () => { throw new Error('Cancelled task ran') },
})
let releaseCancelled!: () => void
cancelledRun = false
const cancellation = runWarmTasks([0], {
  isCancelled: () => cancelledRun,
  onStart: () => {},
  onSettled: () => { throw new Error('Unmounted startup reported progress') },
  run: () => new Promise<void>((resolve) => { releaseCancelled = resolve }),
})
cancelledRun = true
releaseCancelled()
await cancellation
console.log('Parallel startup checks passed: all pages start, failures stay visible, slow pages do not block and cancellation suppresses progress.')

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
