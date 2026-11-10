import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { mock } from 'node:test'
import { manageQueryMemory, pinStartupQuery, readQueryMemoryStats } from '../src/api/queryMemory.js'
import { createBatchedEquityUpdates, mergeStreamCandle } from '../src/api/equityStream.js'
import { liveIndicators } from '../src/api/liveIndicators.js'
import { syncTimeSeries } from '../src/charts/seriesUpdates.js'
import { rsi, sma, toPoints } from '../electron/services/indicators.js'
import type { Candle, ChartPayload, Envelope } from '../electron/shared/contract.js'
import { refreshSavedData } from '../src/api/mcpChanges.js'
import { subscribeLiveStatus } from '../src/api/liveStatus.js'
import { createLiveStatusEvents } from '../electron/services/liveStatusEvents.js'
import { ok } from '../electron/shared/envelope.js'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const baseline = process.argv.includes('--baseline')
async function original(path: string) {
  const contents = execFileSync('git', ['show', `HEAD:apps/desktop/${path}`], { encoding: 'utf8' })
  const result = await build({ stdin: { contents, resolveDir: import.meta.dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const memoryModule = baseline ? await original('src/api/queryMemory.ts') : { manageQueryMemory }
const changesModule = baseline ? await original('src/api/mcpChanges.ts') : { refreshSavedData }

const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } })
let traversals = 0
const cache = client.getQueryCache()
const getAll = cache.getAll.bind(cache)
const spy = mock.method(cache, 'getAll', () => { traversals++; return getAll() })
const memory = memoryModule.manageQueryMemory(client, { maxBytes: 1024, maxQueries: 10 })
try {
  await wait(300)
  traversals = 0
  for (let burst = 0; burst < 4; burst++) {
    for (let index = 0; index < 100; index++) client.setQueryData(['agents'], { messages: [{ text: `${burst}:${index}` }] })
    await wait(300)
  }
  const excludedSweeps = traversals
  if (!baseline) assert.equal(excludedSweeps, 0, 'Local status updates must not schedule cache traversals')
  client.setQueryData(['remote', 'evict'], { text: 'x'.repeat(2048) })
  await wait(300)
  assert.equal(client.getQueryData(['remote', 'evict']), undefined, 'Eligible payloads still enforce byte limits')
  const observer = new QueryObserver(client, { queryKey: ['remote', 'active'], queryFn: async () => 'x'.repeat(2048) })
  const unobserve = observer.subscribe(() => {})
  await observer.refetch()
  await memory.sweep()
  assert(client.getQueryData(['remote', 'active']), 'Active queries must survive eviction')
  unobserve()
  await memory.sweep()
  assert.equal(client.getQueryData(['remote', 'active']), undefined)
  memory.stop(); spy.mock.restore(); client.clear()
  if (!baseline) {
    client.setQueryData(['remote', 'replacement'], { text: 'old' })
    for (let index = 0; index < 20; index++) client.setQueryData(['remote', index], index)
    let tick = 0
    const clock = mock.method(performance, 'now', () => tick += 5)
    const yielding = manageQueryMemory(client, { maxBytes: 0, maxQueries: 0 })
    try {
      const sweeping = yielding.sweep()
      client.setQueryData(['remote', 'replacement'], { text: 'new' })
      await sweeping
      assert.deepEqual(client.getQueryData(['remote', 'replacement']), { text: 'new' }, 'A refreshed payload must survive an older yielded eviction pass')
    } finally { yielding.stop(); clock.mock.restore(); client.clear() }
  }

  const fetched: string[] = []
  const families = ['portfolio', 'settings', 'returns', 'momentum', 'analytics', 'optionQuotes', 'cardsPerformance']
  for (const key of families) await client.fetchQuery({ queryKey: [key], queryFn: async () => { fetched.push(key); return {} } })
  fetched.length = 0
  await Promise.all(Array.from({ length: 3 }, () => changesModule.refreshSavedData(client, { domains: ['portfolio', 'settings'], portfolioMetadataOnly: true })))
  const metadataReads = [...fetched]
  if (!baseline) assert.deepEqual(metadataReads.sort(), ['portfolio', 'settings'])
  fetched.length = 0
  await refreshSavedData(client, { domains: ['portfolio'] })
  assert.deepEqual(fetched.sort(), families.filter(key => key !== 'settings').sort(), 'Unknown changes retain conservative refresh for prepared pages')
  client.clear()

  Object.assign(globalThis, { window: { api: {} } })
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } })
  const { buildTasks, subscribeStartupRequestInputs } = await import('../src/api/prefetch.js')
  const { useChartsStore } = await import('../src/stores/charts.js')
  useChartsStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
  let plans = 0
  const plan = () => { plans++; buildTasks(undefined, undefined, { stocks: '', fundamentals: '' }, { year: 2026, month: 1, earningsYear: 2026, ipoYear: 2026 }) }
  const stops = baseline ? [useChartsStore.subscribe(plan)] : subscribeStartupRequestInputs(plan)
  for (let index = 0; index < 5; index++) {
    useChartsStore.getState().setSplitterRatio(0.5 + index * 0.05)
    await wait(125) // Distinct edits outside the production 100 ms reconciliation window.
  }
  const layoutPlans = plans
  if (!baseline) assert.equal(layoutPlans, 0)
  useChartsStore.getState().setDrawings('fixture', [])
  if (!baseline) assert.equal(plans, 0)
  useChartsStore.getState().setSymbol('SYNTHETIC')
  assert.equal(plans, baseline ? 7 : 1, 'Actual request selections must reconcile')
  stops.forEach(stop => stop())
  console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'optimized', statusUpdates: 400, excludedSweeps, duplicateMetadataEvents: 3, metadataReads, distinctSplitterEdits: 5, layoutPlans, planningProviderCalls: 0 }))

  const hub = createLiveStatusEvents({ agents: 5, notifications: 5, browser: 5 })
  let reads = 0, value = 'initial'
  await client.fetchQuery({ queryKey: ['agents'], queryFn: async () => { reads++; return ok({ text: value }, 'fixture') } })
  const stop = subscribeLiveStatus(client, listener => hub.subscribe(listener))
  for (let chunk = 0; chunk < 100; chunk++) { value = `chunk-${chunk}`; hub.changed('agents') }
  value = 'final'; hub.changed('agents')
  await wait(30)
  assert.equal((client.getQueryData(['agents']) as ReturnType<typeof ok<{ text: string }>>).data.text, 'final')
  assert.equal(reads, 2, 'Streaming bursts coalesce without losing the final chunk')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let gated = false
  await client.fetchQuery({ queryKey: ['notifications'], staleTime: 0, queryFn: async () => {
    const captured = value
    if (gated) { gated = false; await gate }
    return ok({ text: captured }, 'fixture')
  } })
  gated = true
  value = 'first inbox'
  hub.changed('notifications')
  await wait(15)
  value = 'final inbox'
  hub.changed('notifications')
  await wait(15)
  release()
  await wait(30)
  assert.equal((client.getQueryData(['notifications']) as ReturnType<typeof ok<{ text: string }>>).data.text, 'final inbox', 'An update during an in-flight read must trigger a follow-up snapshot')
  stop()
  value = 'disconnected'; hub.changed('agents')
  await wait(30)
  assert.equal(reads, 2, 'Disposed listeners must not trigger reads')
  value = 'reconnected'
  await client.refetchQueries({ queryKey: ['agents'] })
  assert.equal((client.getQueryData(['agents']) as ReturnType<typeof ok<{ text: string }>>).data.text, 'reconnected', 'Recovery reads repair missed changes')
  console.log('PASS: live revisions, stream coalescing, final chunk, recovery and listener cleanup')

  const bars = (length: number): Candle[] => Array.from({ length }, (_, index) => ({ time: 1_700_000_000 + index * 86400,
    open: 100 + Math.sin(index) * 10, high: 120, low: 80, close: 100 + Math.cos(index / 3) * 10, volume: index + 1 }))
  const fullIndicators = (candles: Candle[]) => {
    const closes = candles.map(bar => bar.close)
    const values = rsi(closes, 14)
    return { ma200: toPoints(candles, sma(closes, 200)), rsi: toPoints(candles, values), rsiMa: toPoints(candles, sma(values, 14)) }
  }
  const chart = (candles: Candle[]): ChartPayload => ({ symbol: 'TEST', interval: '1d', timeframe: '1 Day',
    candles, stats: null, indicators: fullIndicators(candles) })
  for (const length of [14, 15, 28, 199, 240, 5000]) {
    let payload = chart(bars(length))
    for (let iteration = 0; iteration < 36; iteration++) {
      const previous = payload.candles.at(-1)!
      const next = mergeStreamCandle(payload.candles, { ...previous,
        time: previous.time + (iteration % 3 === 0 ? 86400 : 0), close: 90 + iteration % 13, high: 130 })
      const indicators = liveIndicators(payload, next)
      const expected = fullIndicators(next)
      for (const key of ['ma200', 'rsi', 'rsiMa'] as const) {
        assert.equal(indicators[key].length, expected[key].length)
        indicators[key].forEach((point, index) => {
          assert.equal(point.time, expected[key][index].time)
          assert(Math.abs(point.value - expected[key][index].value) < 1e-8, `${key} diverged at ${length}/${iteration}/${index}`)
        })
      }
      payload = { ...payload, candles: next, indicators }
    }
  }

  const streamClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  const initial = chart(bars(240))
  initial.stats = { market: 'fixture' } as NonNullable<ChartPayload['stats']>
  const original = ok(initial, 'fixture')
  streamClient.setQueryData(['chart', 'TEST'], original)
  for (let index = 0; index < 2000; index++) streamClient.setQueryData(['unrelated', index], { value: index })
  const stream = createBatchedEquityUpdates(streamClient, 60_000)
  const all = mock.method(streamClient.getQueryCache(), 'getAll', () => { throw Error('Market updates must not enumerate the cache') })
  try {
    const last = initial.candles.at(-1)!
    for (let index = 0; index < 100; index++) stream.enqueue({ quotes: [], candles: [{ symbol: 'TEST', market: 'fixture', interval: '1d', candle: { ...last, close: index + 1 } }] })
    stream.enqueue({ quotes: [], candles: [1, 2].map(offset => ({ symbol: 'TEST', market: 'fixture', interval: '1d', candle: { ...last, time: last.time + offset * 86400, close: 100 + offset } })) })
    stream.flush()
    let stored = streamClient.getQueryData<Envelope<ChartPayload>>(['chart', 'TEST'])!
    assert.equal(stored.data.candles.length, 242, 'Batching must preserve distinct bar times')
    assert.equal(stored.data.candles.at(-3)?.close, 100, 'Repeated live bars coalesce to the last value')
    assert.equal(stored.meta.fetchedAt, original.meta.fetchedAt, 'Streaming cannot refresh the age of other sources')
    for (let index = 0; index < 4; index++) {
      stream.enqueue({ quotes: [], candles: [{ symbol: 'TEST', market: 'fixture', interval: '1d', candle: { ...stored.data.candles.at(-1)!, close: 115 + index } }] })
      stream.flush()
      stored = streamClient.getQueryData<Envelope<ChartPayload>>(['chart', 'TEST'])!
      const expected = fullIndicators(stored.data.candles)
      assert(Math.abs(stored.data.indicators.rsi.at(-1)!.value - expected.rsi.at(-1)!.value) < 1e-8, 'Running state must survive React Query structural sharing')
    }
    streamClient.setQueryData(['chart', 'TEST'], { ...stored, data: { ...stored.data, symbol: 'OTHER' } })
    stream.enqueue({ quotes: [{ symbol: 'TEST', price: 999, change: 0, absChange: 0 }], candles: [] })
    stream.flush()
    assert.notEqual(streamClient.getQueryData<Envelope<ChartPayload>>(['chart', 'TEST'])!.data.stats?.price, 999, 'Replaced symbol membership must be removed')
    stream.enqueue({ quotes: [{ symbol: 'OTHER', price: 321, change: 0, absChange: 0 }], candles: [] })
    stream.stop()
    assert.equal(streamClient.getQueryData<Envelope<ChartPayload>>(['chart', 'TEST'])!.data.stats?.price, 321, 'Cleanup drains the final buffered mark')
  } finally { all.mock.restore(); stream.stop(); streamClient.clear() }

  const changes: string[] = []
  const series = { setData: (_data: Candle[]) => changes.push('replace'), update: (_bar: Candle) => changes.push('update') }
  const first = bars(20)
  syncTimeSeries(series, undefined, first, bar => bar)
  const changed = [...first.slice(0, -1), { ...first.at(-1)!, close: 200 }]
  syncTimeSeries(series, first, changed, bar => bar)
  const appended = [...changed, { ...changed.at(-1)!, time: changed.at(-1)!.time + 86400 }]
  syncTimeSeries(series, changed, appended, bar => bar)
  const corrected = [...appended]
  corrected[2] = { ...corrected[2], close: 210 }
  syncTimeSeries(series, appended, corrected, bar => bar)
  syncTimeSeries(series, corrected, corrected, bar => bar)
  syncTimeSeries(series, corrected, corrected, bar => bar, true)
  assert.deepEqual(changes, ['replace', 'update', 'update', 'replace', 'replace'], 'Tail edits, history corrections and context resets must take distinct chart paths')

  client.clear()
  pinStartupQuery(client, ['chart', 'PINNED'])
  client.setQueryData(['chart', 'PINNED'], { history: 'x'.repeat(2000) })
  client.setQueryData(['chart', 'EXTRA'], { history: 'x'.repeat(1000) })
  client.setQueryData(['agents'], { messages: ['synthetic local data'] })
  const sizes = await readQueryMemoryStats(client)
  assert.equal(sizes.pinnedQueries, 1)
  assert.equal(sizes.additionalQueries, 1)
  assert.equal(sizes.localQueries, 1)
  assert(sizes.pinnedBytes > sizes.additionalBytes && sizes.additionalBytes > sizes.localBytes)
  assert.equal(sizes.unmeasuredQueries, 0)
  console.log('PASS: incremental RSI/SMA parity including retention shifts, indexed 2,000-query routing, batched bar ordering, structural sharing, chart corrections and protected-memory estimates')
} finally {
  memory.stop(); spy.mock.restore(); client.clear()
}
