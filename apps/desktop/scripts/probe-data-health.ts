import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DataFreshness } from '../src/components/ui/DataFreshness.js'
import { StatusBar } from '../src/components/chrome/StatusBar.js'
import { MacroBar } from '../src/components/dashboard/MacroBar.js'
import { effectiveFreshness, registerSnapshot } from '../src/api/snapshotHealth.js'
import { FRESHNESS } from '../electron/shared/freshness.js'
import type { ChartPayload, Envelope } from '../electron/shared/contract.js'

// Simulate a previous renderer session without touching the user's browser storage.
const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const storage = new Map<string, string>()
let storageWrites = 0
const fetchedAt = Date.now() - 60_000
storage.set('budget-terminal:data-health', JSON.stringify({ state: { records: {
  'stocks:Quote': { page: 'stocks', label: 'Quote', source: 'fixture', freshness: 'fresh', failureReason: '', errors: [], fetchedAt },
}, startupLoads: {
  heatmap: { durationMs: 90_000, samples: 2 },
  stocks: { durationMs: -1, samples: 1 },
  removedPage: { durationMs: 5, samples: 1 },
} }, version: 0 }))
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storageWrites += 1; storage.set(key, value) },
  removeItem: (key: string) => storage.delete(key),
} })
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: globalThis.localStorage } })
try {
  const { useDataHealth } = await import('../src/stores/dataHealth.js')
  const { DataHealthPanel } = await import('../src/components/settings/DataHealthPanel.js')
  assert.equal(useDataHealth.getState().records['stocks:Quote'].previousSession, true)
  assert.deepEqual(useDataHealth.getState().startupLoads, { heatmap: { durationMs: 90_000, samples: 2 } })
  useDataHealth.getState().recordStartupLoad('global', 2_000, false)
  assert.equal(JSON.parse(storage.get('budget-terminal:data-health')!).state.startupLoads.global.durationMs, 2_000)
  const writesBeforeProgress = storageWrites
  for (let index = 0; index < 100; index += 1) {
    useDataHealth.getState().setStartup({ durationMs: index, planned: 100, timings: [] })
    useDataHealth.getState().record('stocks', [])
  }
  assert.equal(storageWrites, writesBeforeProgress, 'Transient progress and unchanged health must not serialize or write profile history')
  useDataHealth.getState().setStartup(null)
  useDataHealth.setState({ startupLoads: {} })
  // setState persists too, so simulate the saved profile from the previous launch.
  const savedProfile = JSON.parse(storage.get('budget-terminal:data-health')!)
  savedProfile.state.startupLoads = { heatmap: { durationMs: 90_000, samples: 2 }, global: { durationMs: 2_000, samples: 1 } }
  storage.set('budget-terminal:data-health', JSON.stringify(savedProfile))
  await useDataHealth.persist.rehydrate()
  assert.equal(useDataHealth.getState().startupLoads.global.durationMs, 2_000)
  assert.equal(useDataHealth.getState().startup, null, 'Only learned costs should restore, not progress from an old launch')
  assert.match(renderToStaticMarkup(createElement(DataHealthPanel, { onStatus: () => {} })), /no panels observed this session/)
  const envelope: Envelope<null> = { data: null,
    meta: { source: 'fixture', freshness: 'stale', fetchedAt, failureReason: 'Provider unavailable' }, errors: [],
  }
  // A failed refresh can keep the old timestamp. Its new health must still be recorded.
  useDataHealth.getState().record('stocks', [{ label: 'Quote', envelope, loading: false }])
  assert.equal(useDataHealth.getState().records['stocks:Quote'].freshness, 'stale')
  assert.equal(JSON.parse(storage.get('budget-terminal:data-health')!).state.records['stocks:Quote'].freshness, 'stale',
    'Changed health must still persist immediately')
  const writesBeforeRepeat = storageWrites
  useDataHealth.getState().record('stocks', [{ label: 'Quote', envelope, loading: true }])
  useDataHealth.getState().record('stocks', [{ label: 'Quote', envelope, loading: false }])
  assert.equal(storageWrites, writesBeforeRepeat, 'Loading transitions with the same health must not write history again')
  const failure = new Error('Fixture IPC disconnected')
  const footer = renderToStaticMarkup(createElement(StatusBar, {
    panels: [{ label: 'Quotes', envelope: undefined, loading: false, enabled: true, error: failure }], sourcePath: '',
  }))
  assert.match(footer, /Fixture IPC disconnected/)
  assert(!footer.includes('data: OK'), 'A thrown query failure must never report OK')
  const manual = renderToStaticMarkup(createElement(StatusBar, {
    panels: [{ label: 'Options', envelope: undefined, loading: false, enabled: false }], sourcePath: '',
  }))
  assert.match(manual, /No remote data required/)
  useDataHealth.getState().record('global', [{ label: 'Markets', envelope: undefined, loading: false, enabled: true, error: failure }])
  assert.equal(useDataHealth.getState().records['global:Markets'].freshness, 'failed')
  useDataHealth.getState().record('stocks', [{ label: 'Quote', envelope, loading: false, error: failure }])
  assert.equal(useDataHealth.getState().records['stocks:Quote'].failureReason, failure.message)
  const fresh = { ...envelope, meta: { ...envelope.meta, freshness: 'fresh' as const, failureReason: undefined } }
  const settingsFooter = renderToStaticMarkup(createElement(StatusBar, {
    panels: [{ label: 'Settings', envelope: { ...fresh, meta: { ...fresh.meta, fetchedAt: Date.now() } }, loading: false }], sourcePath: '',
  }))
  assert.match(settingsFooter, /Current page data: OK/, 'Settings must distinguish its local data health from global feed diagnostics')
  registerSnapshot(fresh, 30_000)
  assert.equal(effectiveFreshness(fresh), 'stale', 'An expired successful snapshot must be visibly stale')
  assert.match(renderToStaticMarkup(createElement(DataFreshness, { envelope: fresh })), /STALE/)
  assert.match(renderToStaticMarkup(createElement(DataFreshness, { envelope: fresh, error: failure })), /REFRESH FAILED/)
  const dependent = { ...fresh, meta: { ...fresh.meta, fetchedAt: Date.now(), expiresAt: Date.now() - 1 } }
  assert.equal(effectiveFreshness(dependent, Date.now(), Infinity), 'stale', 'Derived snapshots preserve dependency expiry')
  // Inline labels must age while a snapshot stays mounted; no provider refresh is involved.
  const clock = Date.now
  try {
    const collected = clock()
    const history: Envelope<ChartPayload> = { data: { symbol: 'SPY', timeframe: '1 Day', interval: '1d', stats: null,
      indicators: { ma200: [], rsi: [], rsiMa: [] }, candles: [100, 101].map((close, index) => ({ time: index + 1, open: close, high: close, low: close, close, volume: 1 })) }, errors: [],
      meta: { source: 'fixture daily bars', freshness: 'fresh' as const, fetchedAt: collected } }
    const renderMacro = () => renderToStaticMarkup(createElement(MacroBar, { macro: {}, loading: false,
      charts: [{ data: history, isLoading: false, isError: false }] }))
    Date.now = () => collected + FRESHNESS.chartDaily - 1
    assert(!renderMacro().includes(' · stale'), 'Daily history remains current within its policy')
    Date.now = () => collected + FRESHNESS.chartDaily + 1
    assert.match(renderMacro(), / · stale/, 'Daily-history tooltip expires without refetching')
    assert(!renderMacro().includes('Stale history'), 'Stale sparklines have no yellow history label')
    const copied = { ...fresh, meta: { ...fresh.meta, fetchedAt: collected } }
    Date.now = () => collected + FRESHNESS.sofi + 1
    const copiedPanel = { label: 'SOFI reported quarters', envelope: copied, loading: false, enabled: true, freshnessMs: FRESHNESS.sofi }
    assert.match(renderToStaticMarkup(createElement(StatusBar, { panels: [copiedPanel], sourcePath: '' })), /Snapshot expired/,
      'A copied panel envelope must retain explicit query TTL after losing WeakMap identity')
    assert.match(renderToStaticMarkup(createElement(StatusBar, { panels: [{ ...copiedPanel, error: failure }], sourcePath: '' })), /Fixture IPC disconnected/)
  } finally { Date.now = clock }
  assert.equal(useDataHealth.getState().records['stocks:Quote'].previousSession, undefined)
  // Server rendering uses Zustand's initial hook snapshot; the report reads current state.
  assert.match(renderToStaticMarkup(createElement(DataHealthPanel, { onStatus: () => {} })), /\[STALE\] Stocks/)
  const rendered = renderToStaticMarkup(createElement(DataFreshness, { envelope, coverage: '3/5 holdings', loading: true }))
  for (const text of ['STALE', 'Refreshing', 'fixture', 'Snapshot:', '3/5 holdings', 'Provider unavailable']) assert.ok(rendered.includes(text), text)
  useDataHealth.getState().clear()
  assert.deepEqual(JSON.parse(storage.get('budget-terminal:data-health')!).state.records, {})
  assert.equal(useDataHealth.getState().startupLoads.heatmap.durationMs, 90_000)
  globalThis.localStorage.setItem = () => { throw new Error('Quota exceeded') }
  assert.doesNotThrow(() => useDataHealth.getState().record('stocks', [{ label: 'Quote', envelope, loading: false }]))
  assert.equal(useDataHealth.getState().records['stocks:Quote'].freshness, 'stale')
  console.log('PASS: prior-session labeling, changed health at unchanged timestamp, stale warning, inline provenance and persisted clear')
} finally {
  if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
  else Reflect.deleteProperty(globalThis, 'localStorage')
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
  else Reflect.deleteProperty(globalThis, 'window')
}
