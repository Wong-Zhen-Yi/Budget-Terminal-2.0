import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { mock } from 'node:test'
import { manageQueryMemory } from '../src/api/queryMemory.js'
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
} finally {
  memory.stop(); spy.mock.restore(); client.clear()
}
