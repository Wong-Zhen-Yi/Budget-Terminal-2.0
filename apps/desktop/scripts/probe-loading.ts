import assert from 'node:assert/strict'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeExposure, emptyRiskMetrics } from '../electron/shared/analytics.js'
import { ok } from '../electron/shared/envelope.js'
import { MACRO_SYMBOLS, TABS, type AnalyticsPayload, type ChartPayload, type CryptoPayload, type NewsArticle, type OptionPosition, type Portfolio, type SignalsPayload, type SignalsRequest } from '../electron/shared/contract.js'
import { assertStartupReady, runWarmTasks, waitForWarmSlot, warmQuery, warmStartupQuery, StartupLoadError } from '../src/api/warmQueue.js'
import { recentPages, startupPages } from '../electron/shared/navigation.js'
import { recordStartupLoad, restoreStartupLoads, startupPageOrder } from '../electron/shared/startupLoading.js'
import { createProgressReporter } from '../src/api/progressReporter.js'
import { retryTransientData } from '../electron/shared/dataRetry.js'
import { observeSource } from '../electron/services/sourceHealth.js'

let progressValue = 0
const reportedProgress: number[] = []
const reporter = createProgressReporter(() => reportedProgress.push(progressValue), 10)
for (let index = 1; index <= 100; index += 1) {
  progressValue = index
  reporter.schedule()
}
assert.deepEqual(reportedProgress, [], 'API bursts must not synchronously publish every result')
await new Promise(resolve => setTimeout(resolve, 30))
assert.deepEqual(reportedProgress, [100], 'Batched progress must include every completed result')
progressValue = 101
reporter.schedule()
reporter.flush()
assert.deepEqual(reportedProgress, [100, 101], 'Final readiness must publish immediately')
reporter.schedule()
reporter.cancel()
await new Promise(resolve => setTimeout(resolve, 30))
assert.deepEqual(reportedProgress, [100, 101], 'Unmount must discard pending progress callbacks')

assert.deepEqual(recentPages(['stocks', 'charts', 'portfolio'], 'charts'), ['charts', 'stocks', 'portfolio'])
assert.equal(recentPages(['a', 'b', 'c', 'd', 'e', 'f'], 'g').length, 6)
const allPages = TABS.filter((tab) => tab.implemented).map((tab) => tab.id)
const startup = startupPages('dashboard', ['portfolio', 'charts'], ['heatmap', 'trading-volumes', 'stocks', 'fundamentals'])
assert.deepEqual(startup.slice(0, 7), ['dashboard', 'portfolio', 'charts', 'heatmap', 'trading-volumes', 'stocks', 'fundamentals'])
assert.deepEqual([...startup].sort(), [...allPages].sort())
assert.deepEqual(startupPages('heatmap', [], []).slice(0, 1), ['heatmap'])
assert.equal(startupPages('dashboard', [], []).includes('economic'), true)
assert.equal(startupPages('dashboard', [], []).includes('settings'), true)
assert.equal(startupPages('dashboard', [], []).includes('semiconductors'), true)

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

const expiredClient = new QueryClient()
expiredClient.setQueryData(['quotes', 'EXPIRED'], { ...ok({ price: 99 }, 'fixture'),
  meta: { source: 'fixture', freshness: 'fresh', fetchedAt: Date.now(), expiresAt: Date.now() - 1 } })
let expiryRefreshes = 0
await warmQuery(expiredClient, { queryKey: ['quotes', 'EXPIRED'], staleTime: Infinity,
  queryFn: async () => { expiryRefreshes += 1; return ok({ price: 100 }, 'fixture') } })
assert.equal(expiryRefreshes, 1, 'A recently retrieved snapshot whose dependencies expired must refresh')
const degradedSnapshot = { ...ok({ price: 100 }, 'fixture'),
  meta: { source: 'fixture', freshness: 'partial', fetchedAt: Date.now(), failureReason: 'Missing observation' } }
await assert.rejects(warmStartupQuery(expiredClient, { queryKey: ['startupDegraded'], staleTime: 0,
  queryFn: async () => degradedSnapshot }), (error: unknown) => error instanceof StartupLoadError && error.state === 'degraded')
assert.equal(expiredClient.getQueryData(['startupDegraded']), degradedSnapshot, 'Degraded startup retains usable panels')
for (const freshness of ['partial', 'stale', 'failed'] as const) {
  const key = ['startupRecovery', freshness]
  expiredClient.setQueryData(key, { ...degradedSnapshot, meta: { ...degradedSnapshot.meta, freshness } })
  let recoveryCalls = 0
  const recovered = await warmStartupQuery(expiredClient, { queryKey: key, staleTime: Infinity,
    queryFn: async () => { recoveryCalls++; return ok({ price: 101 }, 'fixture') } })
  assert.equal(recoveryCalls, 1, 'Recent incomplete cache entries must refetch instead of remaining pinned')
  assert.equal(recovered.meta.freshness, 'fresh')
}
assert.throws(() => assertStartupReady({ ...degradedSnapshot,
  meta: { ...degradedSnapshot.meta, failureReason: '' }, errors: [{ reason: 'HTTP 503 from upstream' }] }), /HTTP 503 from upstream/,
  'Partial envelopes without meta.failureReason must retain the actual retryable source error')
const retryDelays: number[] = []
let recoveryAttempt = 0
const recoveryProgress: string[] = []
await runWarmTasks(['transient', 'permanent'], {
  isCancelled: () => false,
  onStart: task => recoveryProgress.push(`start:${task}`),
  onSettled: (task, result) => recoveryProgress.push(`${result.status}:${task}`),
  run: task => retryTransientData(async () => {
    if (task === 'permanent') throw new Error('Invalid symbol')
    return warmStartupQuery(expiredClient, { queryKey: ['retryPartial'], staleTime: Infinity,
      queryFn: async () => ++recoveryAttempt === 1
        ? { ...degradedSnapshot, meta: { ...degradedSnapshot.meta, failureReason: 'HTTP 503' } }
        : ok({ price: 102 }, 'fixture') })
  }, { maxAttempts: 2, baseDelayMs: 12_000, random: () => 0,
    sleep: async ms => { retryDelays.push(ms) },
    onRetry: (_error, attempt) => recoveryProgress.push(`retry:${task}:${attempt}`),
  }),
})
assert.equal(recoveryAttempt, 2, 'Recovery must not reuse the partial result from the first attempt')
assert.deepEqual(retryDelays, [12_000], 'Page recovery must outlast the service negative-cache window')
assert(recoveryProgress.includes('retry:transient:2'), 'Recovery progress must be observable')
assert.equal(recoveryProgress.filter(entry => entry === 'fulfilled:transient').length, 1)
assert.equal(recoveryProgress.filter(entry => entry === 'rejected:permanent').length, 1)
assert.equal(recoveryProgress.filter(entry => entry.startsWith('start:')).length, 2, 'Retries must not double-count startup tasks')
expiredClient.clear()
console.log('Startup recovery checks passed: incomplete cached results refetch, transient partial data recovers, retry progress is visible and final failures count once.')

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
const pltrTasks = buildTasks(undefined, { hiddenTabs: ['pltr'] } as unknown as import('../electron/shared/contract.js').AppSettings,
  { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).filter(task => task.tab === 'pltr')
assert.equal(pltrTasks.length, 2, 'Hidden, unvisited PLTR must warm both market and financial data')
const pltrRequests: unknown[] = []
Object.assign(window.api, {
  stocks: async (request: unknown) => { pltrRequests.push(request); return ok({ symbol: 'PLTR' }, 'fixture') },
  fundamentalsPage: async (request: unknown) => { pltrRequests.push(request); return ok({ symbol: 'PLTR' }, 'fixture') },
})
const pltrClient = new QueryClient()
await Promise.all(pltrTasks.map(task => task.run(pltrClient, 9)))
assert.deepEqual(pltrRequests, Array(2).fill({ symbol: 'PLTR', background: true, backgroundOrder: 9 }))
assert(pltrClient.getQueryData(['stocks', 'PLTR']))
assert(pltrClient.getQueryData(['fundamentalsPage', 'PLTR', 'usd-v2']))
pltrClient.clear()
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
const dashboard2Tasks = buildTasks(portfolio, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' },
  { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).filter(task => task.tab === 'dashboard-2')
for (const label of ['Quotes', 'Agents workspace']) {
  assert(dashboard2Tasks.some(task => task.label === label), `Dashboard 2 must warm ${label}`)
}
assert(!dashboard2Tasks.some(task => ['Dashboard news', 'Market news', 'Targets', 'Dashboard targets', 'Dashboard chart', 'Dashboard options', 'Macro quotes'].includes(task.label) || task.label.endsWith('sparkline')),
  'Dashboard 2 must not depend on removed news, targets, charts, macro strip or options')
const dashboard2Agents = dashboard2Tasks.find(task => task.label === 'Agents workspace')!
let dashboardAgentReads = 0
Object.assign(window.api, { agentsStatus: async () => { dashboardAgentReads++; return ok({ messages: [] }, 'fixture') } })
const dashboardAgentClient = new QueryClient()
await dashboard2Agents.run(dashboardAgentClient)
assert.equal(dashboardAgentReads, 1, 'Embedded Agents must load before Dashboard 2 is visited')
assert(dashboardAgentClient.getQueryData(['agents']), 'Embedded Agents must share the Agents session cache')
dashboardAgentClient.clear()
assert(!macroTasks.some(task => task.tab === 'dashboard-2' && task.label.toLowerCase().includes('news')),
  'An empty Dashboard 2 portfolio must not start a removed market news feed')

// A saved, non-active portfolio must warm both its pie and Live heatmap without news or targets.
const { useDashboard } = await import('../src/stores/dashboard.js')
const previousDashboardPortfolio = useDashboard.getState().portfolioId
const dashboardStorage = useDashboard.persist.getOptions().storage
useDashboard.persist.setOptions({ storage: { getItem: () => null, setItem() {}, removeItem() {} } })
useDashboard.setState({ portfolioId: 'alternate' })
const customTasks = buildTasks({ ...portfolio, portfolios: [...portfolio.portfolios,
  { ...portfolio.portfolios[0], id: 'alternate', tickers: ['MSFT'] }] }, undefined,
  { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 })
useDashboard.setState({ portfolioId: previousDashboardPortfolio })
useDashboard.persist.setOptions({ storage: dashboardStorage })
assert(customTasks.some(task => task.tab === 'dashboard' && task.label === 'Dashboard targets'), 'Original Dashboard must still warm targets')
const customDashboard2 = customTasks.filter(task => task.tab === 'dashboard-2')
assert(!customDashboard2.some(task => /target|news/i.test(task.label)))
Object.assign(window.api, {
  quotes: async () => ok({ holdings: {} }, 'fixture'),
  news: async () => { throw new Error('Removed news must not be needed by Dashboard 2') },
  targets: async () => { throw new Error('Removed target service must not be needed by the pie') },
})
const customClient = new QueryClient()
await Promise.all(customDashboard2.filter(task => task.label === 'Dashboard holdings')
  .map(task => task.run(customClient)))
assert(customClient.getQueryData(['quotes', 'MSFT']), 'Selected portfolio pie and heatmap quotes must be ready before first visit')
customClient.clear()

assert(!scheduled.has('signals'), 'removed Day Trading page must not run a startup scan')

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

let himsRequests = 0
let himsRequest: unknown
const { emptyHimsPayload } = await import('../electron/shared/hims.js')
Object.assign(window.api, { hims: async (request: unknown) => {
  himsRequests++
  himsRequest = request
  return ok(emptyHimsPayload(), 'HIMS fixture')
} })
const himsSettings = { hiddenTabs: ['hims'], favoriteTabs: [] } as unknown as import('../electron/shared/contract.js').AppSettings
const himsTask = buildTasks(undefined, himsSettings, { stocks: 'AAPL', fundamentals: 'AAPL' },
  { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'hims')!
assert(himsTask, 'Unvisited HIMS must load even when hidden and without holdings')
const himsClient = new QueryClient()
await himsTask.run(himsClient, 10)
assert.deepEqual(himsRequest, { background: true, backgroundOrder: 10 })
assert(himsClient.getQueryData(['hims']), 'Startup must populate the HIMS page query')
await warmQuery(himsClient, { queryKey: ['hims'], queryFn: () => window.api.hims({}), staleTime: 300_000 })
assert.equal(himsRequests, 1, 'Opening warmed HIMS must not repeat its initial load')
himsClient.clear()
for (const freshness of ['partial', 'stale', 'failed'] as const) {
  Object.assign(window.api, { hims: async () => ({ data: emptyHimsPayload(), errors: [],
    meta: { source: 'HIMS fixture', freshness, fetchedAt: Date.now(), failureReason: 'HIMS reports unavailable' } }) })
  await assert.rejects(himsTask.run(himsClient), /HIMS reports unavailable/)
  if (freshness !== 'failed') assert(himsClient.getQueryData(['hims']), 'Usable incomplete HIMS panels must remain cached')
  himsClient.clear()
}

// Real partial dependencies must not leave hidden intervals or target columns unwarmed.
const { defaultCardsPayload } = await import('../electron/shared/cards.js')
const { newsQuoteTickers } = await import('../src/api/initialContent.js')
const { upDownTargetBatches, upDownTargetsKey, useUpDownTargets } = await import('../src/api/upDownTargetsQueries.js')
assert.deepEqual(newsQuoteTickers([{ ticker: 'META, AMD' }, { ticker: 'NVDA, META' }, { ticker: 'OTHER' }] as NewsArticle[]), ['AMD', 'META', 'NVDA'])
const cardIntervals: string[] = []
Object.assign(window.api, {
  cards: async () => ok(defaultCardsPayload(), 'fixture'),
  cardsPerformance: async (request: import('../electron/shared/contract.js').CardsPerformanceRequest) => {
    cardIntervals.push(request.interval)
    const result = ok({ interval: request.interval, results: {} }, 'fixture')
    return request.interval === '1d' ? { ...result, meta: { ...result.meta, freshness: 'partial', failureReason: 'Fixture intraday history unavailable' } } : result
  },
})
const dependencyTasks = buildTasks(portfolio, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' },
  { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 })
const cardClient = new QueryClient()
await assert.rejects(dependencyTasks.find(task => task.label === 'Card performance')!.run(cardClient), /Fixture intraday/)
assert.deepEqual(cardIntervals.sort(), ['1d', '1y', '30d'].sort(), 'A partial 1D card must not skip 30D and 1Y')
assert.equal(cardClient.getQueryCache().findAll({ queryKey: ['cardsPerformance'] }).length, 3)
cardClient.clear()
const targetRows = Array.from({ length: 121 }, (_, i) => ({ ticker: `FIX${i}`, name: 'Fixture', lastClose: 100,
  intervalReturn: 1, tradingDays: 1, daysUp: 1, daysDown: 0, flatDays: 0 }))
let activeTargets = 0
let peakTargets = 0
let targetReads = 0
Object.assign(window.api, {
  upDown: async (request: import('../electron/shared/contract.js').UpDownRequest) => ({ ...ok({ source: request.source,
    interval: request.interval, rows: targetRows, missing: ['MISSING'], asOf: '', dataSource: 'fixture', holdingsSource: '', forceTargets: false }, 'fixture'),
    meta: { source: 'fixture', fetchedAt: Date.now(), freshness: 'partial', failureReason: 'Fixture missing ticker' } }),
  upDownTargets: async (request: import('../electron/shared/contract.js').UpDownTargetsRequest) => {
    assert.equal(request.background, true)
    targetReads++
    activeTargets++
    peakTargets = Math.max(peakTargets, activeTargets)
    await new Promise(resolve => setTimeout(resolve, 5))
    activeTargets--
    return ok({ targets: Object.fromEntries(request.tickers.map(ticker => [ticker, 120])), resolved: request.tickers.length, available: request.tickers.length }, 'fixture')
  },
})
const targetClient = new QueryClient({ defaultOptions: { queries: { refetchOnMount: false, retry: false } } })
await assert.rejects(dependencyTasks.find(task => task.tab === 'up-down')!.run(targetClient, 4), /Fixture missing ticker/)
const targetBatches = upDownTargetBatches(targetRows)
assert.equal(targetReads, targetBatches.length, 'Targets must warm even if the base histories are partial')
assert(peakTargets <= 8, 'Startup target concurrency must remain bounded')
for (const batch of targetBatches) assert(targetClient.getQueryData(upDownTargetsKey(batch)))
function PreparedTargets() {
  const progress = useUpDownTargets(targetRows, false, 0)
  return createElement('span', null, `${progress.resolved}:${progress.available}:${progress.loading}`)
}
const targetHtml = renderToStaticMarkup(createElement(QueryClientProvider, { client: targetClient }, createElement(PreparedTargets)))
assert(targetHtml.includes('121:121:false'), 'First render must show all prepared target values')
assert.equal(targetReads, targetBatches.length, 'Opening Up/Down must not start target requests')
targetClient.clear()
console.log('Dependent startup checks passed: partial Cards warm all intervals, multi-ticker News requests split correctly, and Up/Down targets are prepared with bounded concurrency before first visit.')

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
await local.set('stale', 7, -1)
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
// An incomplete derived cache must expire in seconds, not its normal hours-long
// lifetime, while remaining immediately available to coalesce concurrent reads.
let derivedCalls = 0
await local.resolve('degraded-derived', 12 * 60 * 60_000, async () => {
  derivedCalls++
  observeSource({ fetchedAt: Date.now(), stale: false, fromCache: false, failures: ['HTTP 503'] })
  return { usable: true }
})
assert(await local.get('degraded-derived'), 'Partial content remains usable during the failure-coalescing window')
const afterDerivedCooldown = realNow() + 10_001
try {
  Date.now = () => afterDerivedCooldown
  assert.equal(await local.get('degraded-derived'), null, 'Incomplete cache must not suppress a recovery fetch for hours')
  assert(await local.get('degraded-derived', { allowStale: true }), 'Incomplete content remains available as a stale fallback')
  await local.resolve('degraded-derived', 12 * 60 * 60_000, async () => { derivedCalls++; return { usable: true } })
  assert.equal(derivedCalls, 2)
} finally { Date.now = realNow }
await local.delete('stale')
await assert.rejects(local.resolve('stale', 1000, fail), /provider unavailable/)
assert.equal(failures, 3)
await local.set('stale', 9, 1000)
assert.equal((await local.resolve('stale', 1000, loader)).value, 9)

const originalFetch = yahoo._fetch
const { defeatBeta } = await import('../electron/services/defeatbeta/client.js')
const originalPublishedRows = defeatBeta.rows
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
  defeatBeta.rows = async () => { throw new Error('Fixture publication unavailable') }
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
  defeatBeta.rows = originalPublishedRows
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
  const render = (currentValues: Record<string, number>, valuationComplete = true) => renderToStaticMarkup(
    createElement(QueryClientProvider, { client: metricsClient },
      createElement(MetricsTab, { positions, cashAmount: 0, currentValues, visible: true, valuationComplete })),
  )
  assert.match(render({}), /\$0\.00/)
  assert.match(render({ AAPL: 2000 }), /\$2,000\.00/)
  const updated = render({ AAPL: 2500 })
  assert.match(updated, /\$2,500\.00/)
  assert.match(updated, /1\.25x/)
  const incomplete = render({ AAPL: 2500 }, false)
  assert.match(incomplete, /market marks are incomplete/)
  assert.match(incomplete, /Known Invested Subtotal/)
  assert.doesNotMatch(incomplete, /1\.25x/)
  assert.doesNotMatch(incomplete, /100\.00%/)
  assert.equal(historyCalls, 0)
  assert.deepEqual(metricsClient.getQueryData(key), history)
  console.log('Metrics renderer smoke passed: exposure follows quote arrivals and updates without refetching or changing cached history.')
} finally {
  metricsClient.clear()
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
  else Reflect.deleteProperty(globalThis, 'window')
}

// Exercise the rendered quote header, rather than only the formatting functions.
const { ChartPanel } = await import('../src/components/dashboard/ChartPanel.js')
const quoteFixture = (unit: string): ChartPayload => ({
  symbol: 'FIXTURE', timeframe: '1 Day', interval: '1d', candles: [],
  stats: { symbol: 'FIXTURE', price: 123.45, absChange: -2.5, change: -1.98,
    open: 124, high: 125, low: 123, close: 123.45, volume: 100, currency: unit, longName: 'Fixture' },
  indicators: { ma200: [{ time: 1, value: 120 }], rsi: [], rsiMa: [] },
})
const quoteHeader = (unit: string) => renderToStaticMarkup(createElement(ChartPanel, {
  payload: quoteFixture(unit), loading: false, indicators: { ma200: true, rsi: false, volume: false },
}))
const euroHeader = quoteHeader('EUR')
assert.match(euroHeader, /123\.45 EUR/)
assert.match(euroHeader, /-2\.50 EUR/)
assert.match(euroHeader, /MA200 120\.00 EUR/)
assert.doesNotMatch(euroHeader, /\$/)
const penceHeader = quoteHeader('GBp')
assert.match(penceHeader, /123\.45 GBp/)
assert.match(penceHeader, /-2\.50 GBp/)
assert.doesNotMatch(penceHeader, /GBP|£|\$/)
assert.match(quoteHeader('USD'), /\$123\.45/)
assert.match(quoteHeader('USD'), /-\$2\.50/)

const { buildOptionRows, OptionsTable } = await import('../src/components/portfolio/OptionsTable.js')
const option: OptionPosition = { rowId: 'old-trade', ticker: 'AAPL', strategy: 'Buy Call', expiry: '2027-01-15',
  strike: 100, contracts: 1, premium: 2, status: 'Open', openDate: '2026-10-01',
  currentPrice: 0, volume: 0, openInterest: 0, impliedVolatility: 0 }
const optionBook: Portfolio = { id: 'fixture', name: 'Fixture', readOnly: true, tickers: [], holdings: {},
  options: [option], cashBalance: 0, marginDebt: 0, includeCashInWeight: false }
const optionRows = buildOptionRows([option], { 'old-trade': { currentPrice: 3.5, volume: 1, openInterest: 1,
  impliedVolatility: 0.2, asOf: Date.now() - 8 * 86400_000, source: 'Yahoo Finance last trade',
  markStale: true, markReason: 'Provider trade is older than seven days' } })
const optionMarkup = renderToStaticMarkup(createElement(OptionsTable, { portfolio: optionBook, rows: optionRows,
  expiries: {}, loading: false, onPatch: () => {}, onRemove: () => {} }))
for (const label of ['Last trade', '3.50', '(stale)', '192.0 hours old', 'Yahoo Finance last trade', 'Provider trade is older than seven days']) assert.ok(optionMarkup.includes(label), label)
assert.match(optionMarkup, /title="[^"]*192\.0 hours old/)
console.log('Native quote unit and stale option last-trade renderer checks passed: EUR, GBp, unchanged USD and dated mark provenance.')

const { NewsCard } = await import('../src/components/news/NewsCard.js')
const associatedStory: NewsArticle = { id: 'query-association', ticker: 'NVDA', title: 'Can Dell (DELL) sustain its growth?',
  source: 'Yahoo Finance', time: '', url: 'https://example.test/story', category: 'portfolio', publishedAt: Date.now(),
  score: null, signals: [], imageUrl: '', summary: '' }
const storyMarkup = renderToStaticMarkup(createElement(NewsCard, { article: associatedStory, price: 237.47,
  selected: false, onSelect: () => {}, onOpen: () => {}, showImages: false, now: Date.now() }))
assert.match(storyMarkup, /Related NVDA/)
assert.match(storyMarkup, /Yahoo associates this article with NVDA; the headline may concern another company/)
assert.match(storyMarkup, /Can Dell \(DELL\)/)
const { NewsTickerBadge } = await import('../src/components/news/NewsTickerBadge.js')
const feedBadge = renderToStaticMarkup(createElement(NewsTickerBadge, { ticker: 'SPY', category: 'macro' }))
assert.match(feedBadge, /Feed SPY/)
assert.match(feedBadge, /does not identify the article&#x27;s main company/)
const mentionBadge = renderToStaticMarkup(createElement(NewsTickerBadge, { ticker: 'SAP', price: 100, currency: 'EUR', category: 'other' }))
assert.match(mentionBadge, /Mentioned SAP/)
assert.match(mentionBadge, /100\.00 EUR/)
assert.doesNotMatch(mentionBadge, /\$/)
console.log('News attribution renderer checks passed: Yahoo association, macro feed and extracted mention remain distinct.')

const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } })
const cryptoClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
try {
  const { CryptoPage } = await import('../src/pages/CryptoPage.js')
  const cryptoSnapshot: CryptoPayload = { fetchedAt: '2026-10-08T07:50:45', quotes: {}, global: null, fearGreed: null, news: [], hyperliquid: null,
    heatmap: { tiles: [], coverage: { loaded: 0, total: 30 }, updatedAt: '2026-10-08T07:50:45' },
    progress: { heatmap: 'loaded', quotes: 'loaded', market: 'loaded', news: 'loaded', hyperliquid: 'loaded' } }
  const cryptoEnvelope = ok(cryptoSnapshot)
  cryptoClient.setQueryData(['crypto', 'hyperliquid-v1'], { ...cryptoEnvelope, meta: { ...cryptoEnvelope.meta, fetchedAt: Date.now() - 180_000 } })
  const cryptoMarkup = renderToStaticMarkup(createElement(QueryClientProvider, { client: cryptoClient },
    createElement(CryptoPage, { onStatusChange: () => {} })))
  assert.match(cryptoMarkup, /Snapshot updated at 07:50:45/)
  assert.doesNotMatch(cryptoMarkup, /Snapshot expired/)
  assert.match(cryptoMarkup, /Snapshot coverage 0\/30 \| stale \| Updated 07:50:45/)
  assert.doesNotMatch(cryptoMarkup, /Live data|Live coverage/)
  cryptoClient.setQueryData(['crypto', 'hyperliquid-v1'], cryptoEnvelope)
  const freshCryptoMarkup = renderToStaticMarkup(createElement(QueryClientProvider, { client: cryptoClient },
    createElement(CryptoPage, { onStatusChange: () => {} })))
  assert.match(freshCryptoMarkup, /Snapshot updated at 07:50:45 · fresh/)
  console.log('Crypto renderer expiration checks passed: expired snapshots stop advertising live data or coverage.')
  const { BmnrPage } = await import('../src/pages/BmnrPage.js')
  const { emptyBmnrPayload, parseLiveTreasury } = await import('../electron/shared/bmnr.js')
  const bmnrSnapshot = emptyBmnrPayload('2026-10-08T07:51:55')
  bmnrSnapshot.live = parseLiveTreasury({ companies: [{ symbol: 'BMNR', total_holdings: 5000,
    percentage_of_total_supply: 0.01, total_current_value_usd: 17_500_000 }] }, bmnrSnapshot.fetchedAt)
  bmnrSnapshot.progress.treasury = 'loaded'
  bmnrSnapshot.market.ethPrice.value = 3500
  const bmnrEnvelope = ok(bmnrSnapshot)
  cryptoClient.setQueryData(['bmnr'], { ...bmnrEnvelope, meta: { ...bmnrEnvelope.meta, fetchedAt: Date.now() - 360_000 } })
  const bmnrMarkup = renderToStaticMarkup(createElement(QueryClientProvider, { client: cryptoClient },
    createElement(BmnrPage, { onStatusChange: () => {} })))
  assert.match(bmnrMarkup, /CoinGecko ETH snapshot 07:51:55 · stale/)
  assert.match(bmnrMarkup, /CoinGecko · stale snapshot/)
  assert.match(bmnrMarkup, /Market Snapshot vs SEC Filed/)
  assert.match(bmnrMarkup, /Market cap \(snapshot\)/)
  assert.doesNotMatch(bmnrMarkup, /Market snapshot expired; refresh to update/)
  assert.doesNotMatch(bmnrMarkup, /Live ETH|marked live|· live|Market cap \(live\)|Basis: live/)
  console.log('BMNR renderer expiration checks passed: aged market snapshots retain their distinct SEC filed basis.')
  const { MuPage } = await import('../src/pages/MuPage.js')
  const { emptyMuPayload } = await import('../electron/shared/mu.js')
  const cacheFailure = ok(emptyMuPayload())
  cacheFailure.meta.freshness = 'partial'
  cacheFailure.errors = [{ source: 'cache', reason: 'Micron document request failed: HTTP 403', operation: 'resolve' }]
  cryptoClient.setQueryData(['mu'], cacheFailure)
  const muMarkup = renderToStaticMarkup(createElement(QueryClientProvider, { client: cryptoClient },
    createElement(MuPage, { onStatusChange: () => {}, onNavigate: () => {} })))
  assert.match(muMarkup, /cache: Micron document request failed: HTTP 403/)
  assert.doesNotMatch(muMarkup, /undefined:|null:/)
  console.log('Focus warning renderer checks passed: generic cache failures keep their source without an undefined lane prefix.')
  const { useSignalsLatest } = await import('../src/api/signalsQueries.js')
  const { useReloadAll } = await import('../src/api/queries.js')
  const { signalsHealth } = await import('../src/api/signalsHealth.js')
  const { StatusBar } = await import('../src/components/chrome/StatusBar.js')
  const closedTime = Date.parse('2026-10-10T20:00:00Z')
  const incompleteSignals: SignalsPayload = { version: 5, session: '2026-10-09', marketOpen: false, candidates: [], results: [],
    source: 'Fixture', sourcedAt: '', startedAt: '', completedAt: '', sourceCandidateCount: 1,
    prefilteredCount: 1, confirmedCount: 0, errors: { AAPL: 'Historical feed incomplete' }, universeFromCache: true }
  const savedSignals = ok(incompleteSignals)
  const signalsFooter = renderToStaticMarkup(createElement(StatusBar, { sourcePath: '', panels: [{ label: 'Day Trading',
    envelope: signalsHealth(savedSignals, closedTime), loading: false, enabled: true }] }))
  assert.match(signalsFooter, /Current page data loaded/)
  assert.doesNotMatch(signalsFooter, /incomplete data/)
  assert.doesNotMatch(signalsFooter, /data: OK/)
  const requests: SignalsRequest[] = []
  const { api: fixtureApi } = await import('../src/api/client.js')
  const originalSignals = fixtureApi.signals
  fixtureApi.signals = async (request: SignalsRequest) => { requests.push(request); return savedSignals }
  try {
    cryptoClient.setQueryData(['signals'], savedSignals)
    let reload!: () => Promise<void>
    function SignalsReloadFixture() { useSignalsLatest(); reload = useReloadAll(); return null }
    renderToStaticMarkup(createElement(QueryClientProvider, { client: cryptoClient }, createElement(SignalsReloadFixture)))
    const query = cryptoClient.getQueryCache().find({ queryKey: ['signals'] })!
    const observer = new QueryObserver(cryptoClient, { ...query.options, queryKey: ['signals'], staleTime: Infinity })
    const unsubscribe = observer.subscribe(() => {})
    try { await reload() } finally { unsubscribe(); observer.destroy() }
    assert.equal(requests.length, 1, 'Explicit F5 must perform one scan without relying on the session timer')
    assert.deepEqual(requests[0], { forceMarketRefresh: true, forceUniverseRefresh: true })
    assert.doesNotMatch(renderToStaticMarkup(createElement(StatusBar, { sourcePath: '', panels: [{ label: 'Day Trading',
      envelope: signalsHealth(cryptoClient.getQueryData(['signals']), closedTime), loading: false, enabled: true }] })), /data: OK/)
  } finally {
    if (originalSignals) fixtureApi.signals = originalSignals
    else Reflect.deleteProperty(fixtureApi, 'signals')
  }
  console.log('Day Trading renderer reload checks passed: explicit F5 forces a scan and closed-session incomplete data stays degraded.')
} finally {
  cryptoClient.clear()
  if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
  else Reflect.deleteProperty(globalThis, 'document')
}
