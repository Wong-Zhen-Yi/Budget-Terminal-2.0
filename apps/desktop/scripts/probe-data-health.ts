import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DataFreshness } from '../src/components/ui/DataFreshness.js'
import type { Envelope } from '../electron/shared/contract.js'

// Simulate a previous renderer session without touching the user's browser storage.
const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const storage = new Map<string, string>()
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
  setItem: (key: string, value: string) => storage.set(key, value),
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
