import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { serialize } from 'node:v8'
import { dehydrate, QueryClient } from '@tanstack/react-query'

import { createWorkerRpc, serviceWorker } from '../electron/services/workerRpc.js'
import { TtlCache } from '../electron/services/cache.js'
import { TTL } from '../electron/services/cache.js'
import { resolveYahooQuote } from '../electron/services/yahoo/quotes.js'
import { regularMarketRefreshAt } from '../electron/shared/marketRefresh.js'
import { closeYahooWorker } from '../electron/services/yahoo/client.js'
import { observeSource } from '../electron/services/sourceHealth.js'
import { warmStartupQuery } from '../src/api/warmQueue.js'
import { startupRefreshDelay } from '../src/api/startupHealth.js'
import { readCacheSettings, saveCacheSettings } from '../electron/services/cacheSettings.js'
import { DEFAULT_CACHE_SETTINGS } from '../electron/shared/cachePolicy.js'
import {
  getYahooSeries,
  type YahooSeriesInterval,
  type YahooSeriesRow,
} from '../electron/services/yahoo/series.js'
import {
  queryFreshness,
  shouldPersistRemoteQuery,
  trimPersistedClient,
  trimPersistedClientInBackground,
} from '../src/api/queryPersistence.js'

const scratch = mkdtempSync(join(tmpdir(), 'bt-cache-'))
const databasePath = join(scratch, 'cache.sqlite')
const originalAppData = process.env.APPDATA
const originalLocalAppData = process.env.LOCALAPPDATA
process.env.APPDATA = join(scratch, 'roaming')
process.env.LOCALAPPDATA = join(scratch, 'local')

function row(time: number, close: number): YahooSeriesRow {
  return { time, open: close, high: close, low: close, close, adjclose: close, volume: 100 }
}

async function persistentCacheChecks(): Promise<void> {
  const first = new TtlCache({ path: databasePath, maxBytes: 4_096 })
  const saved = { when: new Date('2026-01-02T00:00:00Z'), bytes: Buffer.from('cache'), value: 7 }
  await first.set('snapshot:fixture', saved, 60_000)
  await first.close()

  const reopened = new TtlCache({ path: databasePath, maxBytes: 4_096 })
  const restored = (await reopened.get<typeof saved>('snapshot:fixture'))
  assert.equal(restored?.fromCache, true)
  assert.equal(restored?.value.when.toISOString(), saved.when.toISOString())
  assert.equal(restored?.value.bytes.toString(), 'cache')

  let calls = 0
  const [left, right] = await Promise.all([
    reopened.resolve('single-flight', 60_000, async () => { calls += 1; return 1 }),
    reopened.resolve('single-flight', 60_000, async () => { calls += 1; return 2 }),
  ])
  assert.equal(calls, 1)
  assert.equal(left.value, right.value)

  await reopened.set('stale', { usable: true }, -1)
  const fallback = await reopened.resolveWithStaleFallback(
    'stale',
    -1,
    async () => { throw new Error('offline') },
    { force: true },
  )
  assert.equal(fallback.stale, true)
  await reopened.close()

  const degradedPath = join(scratch, 'degraded.sqlite')
  const degraded = new TtlCache({ path: degradedPath })
  const fetchedAt = Date.now()
  await degraded.set('partial', { rows: [1] }, 43_200_000,
    { fetchedAt, stale: false, fromCache: false, failures: ['HTTP 503'] })
  await degraded.close()
  // Also cover incomplete entries persisted by an older build with the full TTL.
  const oldPartial = new DatabaseSync(degradedPath)
  oldPartial.prepare('UPDATE cache_entries SET ttl_ms = ?').run(43_200_000)
  oldPartial.close()
  const recoveredStore = new TtlCache({ path: degradedPath })
  const originalNow = Date.now
  try {
    Date.now = () => fetchedAt + 10_001
    assert.equal((await recoveredStore.get('partial')), null, 'Persisted partial data must not block recovery for hours')
    assert.deepEqual((await recoveredStore.get('partial', { allowStale: true }))?.value, { rows: [1] })
    let loads = 0
    const refreshed = await recoveredStore.resolve('partial', 43_200_000, async () => { loads++; return { rows: [1, 2] } })
    assert.equal(loads, 1)
    assert.deepEqual(refreshed.value.rows, [1, 2])
    assert.deepEqual((await recoveredStore.get('partial'))?.snapshot?.failures, [], 'Recovery must clear cached failure provenance')
  } finally {
    Date.now = originalNow
    await recoveredStore.close()
  }

  const database = new DatabaseSync(databasePath)
  const sizePlan = database.prepare('EXPLAIN QUERY PLAN SELECT COALESCE(SUM(size_bytes), 0) AS total FROM cache_entries').all()
  assert.ok(sizePlan.some(step => String(step.detail).includes('COVERING INDEX')),
    'Per-write cache accounting must avoid scanning the table containing large payloads')
  database.prepare('UPDATE cache_entries SET value = ? WHERE key = ?').run(serialize({ rows: [], coveredFrom: 1 }), 'snapshot:fixture')
  database.close()
  const legacy = new TtlCache({ path: databasePath, maxBytes: 4_096 })
  const barePayload = (await legacy.get('snapshot:fixture', { allowStale: true }))
  const validWrapped = (await legacy.get<number>('single-flight'))?.value
  await legacy.set('snapshot:fixture', saved, 60_000)
  await legacy.set('malformed-wrapper', 1, 60_000)
  await legacy.close()
  assert.equal(barePayload, null, 'A bare legacy payload is not a usable wrapped cache entry')
  assert.equal(validWrapped, 1, 'Valid wrapped entries remain available')
  const malformed = new DatabaseSync(databasePath)
  malformed.prepare('UPDATE cache_entries SET value = ? WHERE key = ?').run(serialize({ value: undefined, snapshot: undefined }), 'malformed-wrapper')
  malformed.close()
  const invalid = new TtlCache({ path: databasePath, maxBytes: 4_096 })
  const undefinedPayload = (await invalid.get('malformed-wrapper'))
  await invalid.close()
  assert.equal(undefinedPayload, null, 'An undefined decoded payload must trigger reload, not a truthy cache hit')
  const broken = new DatabaseSync(databasePath)
  broken.prepare('UPDATE cache_entries SET value = ? WHERE key = ?').run(Buffer.from([0, 1, 2]), 'snapshot:fixture')
  broken.close()
  const corrupt = new TtlCache({ path: databasePath, maxBytes: 4_096 })
  assert.equal((await corrupt.get('snapshot:fixture', { allowStale: true })), null)
  for (let index = 0; index < 8; index += 1) await corrupt.set(`snapshot:${index}`, 'x'.repeat(900), 60_000)
  await corrupt.close()
  const pruned = new DatabaseSync(databasePath)
  const size = pruned.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM cache_entries').get() as { total: number }
  assert.ok(size.total <= 4_096)
  pruned.close()
}


async function workerFailureChecks(): Promise<void> {
  const blocked = join(scratch, 'blocked-directory')
  writeFileSync(blocked, 'fixture')
  const path = join(blocked, 'cache.sqlite')
  const store = new TtlCache({ path })
  const warn = console.warn
  let warnings = 0
  console.warn = () => { warnings++ }
  try {
    await store.set('memory', 1, 60_000)
    assert.equal((await store.get<number>('memory'))?.value, 1, 'Persistence failure must retain successful memory data')
    assert.ok(warnings > 0, 'Persistence failure must remain diagnosable')
    rmSync(blocked)
    await store.set('recovered', 2, 60_000)
    await store.close()
    const reopened = new TtlCache({ path, memoryMaxBytes: 0 })
    try { assert.equal((await reopened.get<number>('recovered'))?.value, 2, 'The next operation must restart a failed worker') }
    finally { await reopened.close() }
  } finally { console.warn = warn; await store.close() }
}

async function batchingChecks(): Promise<void> {
  const rpc = createWorkerRpc(() => serviceWorker('cacheWorker', { path: join(scratch, 'batches.sqlite'), maxBytes: 1_000_000 }))
  try {
    await Promise.all(Array.from({ length: 100 }, (_, index) => rpc.call({ kind: 'set', key: `row:${index}`,
      value: serialize({ value: index, snapshot: undefined }), storedAt: Date.now(), ttlMs: 60_000, retention: 'snapshot' })))
    const before = await rpc.call<{ transactions: number; pruningRuns: number; accessWrites: number }>({ kind: 'stats' })
    assert.ok(before.transactions < 10, 'Cache writes must share transactions')
    assert.equal(before.pruningRuns, 0, 'Under-budget writes must not scan pruning candidates')
    await Promise.all(Array.from({ length: 100 }, () => rpc.call({ kind: 'touch', key: 'row:1', now: Date.now() })))
    const touched = await rpc.call<typeof before>({ kind: 'stats' })
    assert.equal(touched.transactions, before.transactions, 'Cache hits must not immediately write access timestamps')
    await rpc.call({ kind: 'flush' })
    const after = await rpc.call<typeof before>({ kind: 'stats' })
    assert.equal(after.accessWrites, 1, 'Repeated touches must coalesce by key')
    await rpc.call({ kind: 'close' })
  } finally { rpc.close() }
}

async function memoryAndOrderingChecks(): Promise<void> {
  const path = join(scratch, 'bounded.sqlite')
  const store = new TtlCache({ path, maxBytes: 64 * 1024 * 1024, memoryMaxBytes: 512, memoryMaxEntries: 2 })
  try {
    for (const key of ['a', 'b', 'c']) await store.set(key, 'x'.repeat(150), 60_000)
    assert.ok(store.memoryUsage.bytes <= 512 && store.memoryUsage.entries <= 2)
    assert.equal((await store.get<string>('a'))?.value, 'x'.repeat(150), 'Memory eviction must retain disk snapshots')
    const writes = Array.from({ length: 100 }, (_, i) => store.set(`batch:${i}`, i, 60_000))
    await Promise.all(writes)
    await store.flush()
    assert.equal((await store.get<number>('batch:99'))?.value, 99)
    const big = 'x'.repeat(5 * 1024 * 1024)
    const older = store.set('older', big, 60_000)
    const waiting = store.set('waiting', big, 60_000)
    assert.ok(store.memoryUsage.pendingBytes <= 8 * 1024 * 1024)
    const clear = store.clear()
    const latest = store.set('latest', 'survives', 60_000)
    await Promise.all([older, waiting, clear, latest])
    assert.equal(await store.get('older'), null)
    assert.equal(await store.get('waiting'), null)
    assert.equal((await store.get<string>('latest'))?.value, 'survives')
    let release!: (value: number) => void
    let started!: () => void
    const began = new Promise<void>(resolve => { started = resolve })
    const loading = store.resolve('cleared-loader', 60_000, async () => {
      started()
      return new Promise<number>(resolve => { release = resolve })
    })
    await began
    await store.clear()
    release(42)
    await loading
    assert.equal(await store.get('cleared-loader'), null, 'Clear must invalidate an older provider load')
    const pending = store.set('shutdown', big, 60_000)
    const blocked = store.set('shutdown-waiting', big, 60_000)
    await store.close()
    await Promise.all([pending, blocked])
  } finally { await store.close() }
  const reopened = new TtlCache({ path, memoryMaxBytes: 0 })
  try {
    assert.equal((await reopened.get<string>('shutdown-waiting'))?.value.length, 5 * 1024 * 1024)
    const pending = reopened.set('deleted', 1, 60_000)
    const removed = reopened.delete('deleted')
    await Promise.all([pending, removed])
    assert.equal(await reopened.get('deleted'), null)
  } finally { await reopened.close() }
  const volatile = new TtlCache({ memoryMaxBytes: 0 })
  const resolved = await volatile.resolve('oversized', 60_000, async () => {
    return { successful: true }
  })
  assert.equal(resolved.value.successful, true)
  assert.equal(resolved.snapshot?.fromCache, false)
  await volatile.close()
}

async function incrementalSeriesChecks(): Promise<void> {
  const store = new TtlCache()
  const originalNow = Date.now
  let now = Date.UTC(2026, 0, 20)
  Date.now = () => now
  const calls: Array<{ start: number; end?: number }> = []
  let fail = false
  const loader = async (_symbol: string, _interval: YahooSeriesInterval, start: Date, end?: Date) => {
    if (fail) throw new Error('provider offline')
    calls.push({ start: start.getTime(), end: end?.getTime() })
    const first = Math.floor(start.getTime() / 1000)
    const last = Math.floor(Math.min(end?.getTime() ?? now, now) / 1000)
    const rows: YahooSeriesRow[] = []
    for (let time = first; time <= last; time += 86_400) rows.push(row(time, time))
    return { rows, currency: 'USD', longName: 'Fixture' }
  }

  try {
    const start = new Date(now - 30 * 86_400_000)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let first = true
    const gatedLoader: typeof loader = async (...args) => {
      if (first) { first = false; await gate }
      return loader(...args)
    }
    const short = getYahooSeries({ symbol: 'CONCURRENT', start, interval: '1d' }, store, gatedLoader)
    const fullStart = new Date(start.getTime() - 400 * 86_400_000)
    const full = getYahooSeries({ symbol: 'CONCURRENT', start: fullStart, interval: '1d' }, store, gatedLoader)
    release()
    await short
    const concurrentFull = await full
    assert.equal(concurrentFull.rows[0].time, fullStart.getTime() / 1000, 'Max must backfill when joining a shorter in-flight chart request')
    assert.ok(concurrentFull.rows.length > 400, 'Concurrent Max loads must not silently inherit a short window')
    const listing = new Date(now - 20 * 86_400_000)
    const ipoLoader: typeof loader = async (symbol, interval, requested, end) => {
      if (end && end <= listing) throw new Error('No quotes exist before listing')
      const data = await loader(symbol, interval, new Date(Math.max(requested.getTime(), listing.getTime())), end)
      return end ? { ...data, rows: data.rows.map(value => ({ ...value, close: 999 })) } : data
    }
    const listed = await getYahooSeries({ symbol: 'IPO', start, interval: '1d' }, store, ipoLoader)
    const listedMax = await getYahooSeries({ symbol: 'IPO', start: fullStart, interval: '1d' }, store, ipoLoader)
    assert.equal(listedMax.stale, false, 'Expanding already-complete IPO history is not a provider outage')
    assert.equal(listedMax.rows[0].close, listed.rows[0].close, 'Partial head overlaps must not overwrite existing complete OHLC bars')
    calls.length = 0
    await store.set('series:yahoo-only:ohlcv:BAD:1d', { rows: [] }, 60_000)
    const recovered = await getYahooSeries({ symbol: 'BAD', start, interval: '1d' }, store, loader)
    assert.ok(recovered.rows.length >= 30, 'Malformed canonical history is discarded and reloaded')
    calls.length = 0
    const cold = await getYahooSeries({ symbol: 'FIX', start, interval: '1d' }, store, loader)
    assert.ok(cold.rows.length >= 30)
    assert.equal(calls.length, 1)
    await getYahooSeries({ symbol: 'FIX', start, interval: '1d' }, store, loader)
    assert.equal(calls.length, 1, 'a fresh covered series makes no request')

    now += TTL.chartDaily + 1
    await getYahooSeries({ symbol: 'FIX', start, interval: '1d' }, store, loader)
    assert.equal(calls.length, 2)
    assert.ok(calls[1].start > start.getTime(), 'a stale series requests only its overlapping tail')

    const earlier = new Date(start.getTime() - 10 * 86_400_000)
    await getYahooSeries({ symbol: 'FIX', start: earlier, interval: '1d' }, store, loader)
    assert.equal(calls.length, 4, 'earlier coverage backfills the head and refreshes the tail')
    assert.equal(calls[2].start, earlier.getTime())

    now += 8 * 86_400_000
    await getYahooSeries({ symbol: 'FIX', start: earlier, interval: '1d' }, store, loader)
    assert.equal(calls.at(-1)?.start, earlier.getTime(), 'weekly reconciliation reloads the requested range')

    now += TTL.chartDaily + 1
    fail = true
    const stale = await getYahooSeries({ symbol: 'FIX', start: earlier, interval: '1d' }, store, loader)
    assert.equal(stale.stale, true)
    assert.ok(stale.rows.length > 0)

    fail = false
    const minuteStart = new Date(now - 7 * 86_400_000)
    await getYahooSeries({ symbol: 'MINUTE', start: minuteStart, interval: '1m' }, store, loader)
    const beforeRefresh = calls.length
    await getYahooSeries({ symbol: 'MINUTE', start: minuteStart, interval: '1m', refresh: true }, store, loader)
    assert.equal(calls.length, beforeRefresh + 1, 'explicit refresh bypasses the fresh shared chart cache')
    assert.ok(calls.at(-1)!.start > minuteStart.getTime(), 'refresh retains history and only downloads overlapping tail')
    await getYahooSeries({ symbol: 'MINUTE', start: minuteStart, interval: '1m', force: true }, store, loader)
    assert.equal(calls.at(-1)!.start, minuteStart.getTime(), 'force still replaces the full range')
  } finally {
    Date.now = originalNow
  }
}

async function rendererPolicyChecks(): Promise<void> {
  const client = new QueryClient()
  client.setQueryData(['quotes', 'AAPL'], {
    data: { AAPL: 1 },
    meta: { freshness: 'fresh', fetchedAt: Date.now() },
    errors: [],
  })
  client.setQueryData(['portfolio'], { data: { private: true } })
  client.setQueryData(['agents'], { data: { messages: ['Private chat'] } })
  client.setQueryData(['cloudSyncStatus'], { data: { signedIn: true, url: 'https://fixture.convex.cloud' } })
  client.setQueryData(['stocks', 'FAIL'], {
    data: {},
    meta: { freshness: 'failed', fetchedAt: Date.now() },
    errors: [{ reason: 'offline' }],
  })
  const state = dehydrate(client, { shouldDehydrateQuery: shouldPersistRemoteQuery })
  assert.deepEqual(state.queries.map((query) => query.queryKey), [['quotes', 'AAPL']])
  assert.equal(queryFreshness(['quotes', 'AAPL']), 30_000)
  const persisted = trimPersistedClient({ timestamp: Date.now(), buster: 'fixture', clientState: state })
  assert.equal(persisted.clientState.queries.length, 1)
  await assert.rejects(client.fetchQuery({ queryKey: ['quotes', 'AAPL'], retry: false,
    queryFn: async () => { throw new Error('Refresh offline') } }), /Refresh offline/)
  assert.equal(client.getQueryState(['quotes', 'AAPL'])?.status, 'error')
  assert.deepEqual(dehydrate(client, { shouldDehydrateQuery: shouldPersistRemoteQuery }).queries.map(query => query.queryKey),
    [['quotes', 'AAPL']], 'A failed refresh must not erase the last usable disk snapshot')
  client.clear()
}

async function marketSessionChecks(): Promise<void> {
  const originalNow = Date.now
  const friday = Date.parse('2026-10-30T21:00:00Z')
  const mondayOpen = Date.parse('2026-11-02T14:30:00Z')
  const meta = { instrumentType: 'EQUITY', exchangeTimezoneName: 'America/New_York',
    currentTradingPeriod: { regular: { start: new Date('2026-10-30T13:30:00Z'), end: new Date('2026-10-30T20:00:00Z') } } }
  assert.equal(regularMarketRefreshAt(meta, TTL.quotes, friday), mondayOpen, 'Weekend reuse must follow the DST change')
  for (const at of ['2026-10-30T14:00:00Z', '2026-10-30T20:10:00Z', '2026-11-02T15:00:00Z']) {
    const now = Date.parse(at)
    assert.equal(regularMarketRefreshAt(meta, TTL.quotes, now), now + TTL.quotes, 'Trading and closing updates retain their cadence, even with old session metadata')
  }
  const beforeOpen = Date.parse('2026-10-30T13:29:50Z')
  assert.equal(regularMarketRefreshAt(meta, TTL.quotes, beforeOpen), meta.currentTradingPeriod.regular.start.getTime(), 'Reuse must end at the opening, even within the normal interval')
  for (const other of [undefined, {}, { ...meta, instrumentType: 'CRYPTOCURRENCY' },
    { ...meta, instrumentType: 'FUTURE' }, { ...meta, exchangeTimezoneName: 'Europe/London' }]) {
    assert.equal(regularMarketRefreshAt(other, TTL.quotes, friday), friday + TTL.quotes, 'Unknown and continuously traded markets keep their normal policy')
  }
  assert.equal(regularMarketRefreshAt(meta, TTL.quotes, Date.parse('2026-11-26T15:00:00Z')),
    Date.parse('2026-11-27T14:30:00Z'), 'Thanksgiving is not a trading day')
  const halfDay = { ...meta, currentTradingPeriod: { regular: {
    start: new Date('2026-11-27T14:30:00Z'), end: new Date('2026-11-27T18:00:00Z'),
  } } }
  assert.equal(regularMarketRefreshAt(halfDay, TTL.quotes, Date.parse('2026-11-27T19:00:00Z')),
    Date.parse('2026-11-30T14:30:00Z'), 'Early closes must use the next trading session')

  const path = join(scratch, 'sessions.sqlite')
  let store = new TtlCache({ path })
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  let now = friday
  Date.now = () => now
  let quoteLoads = 0
  let historyLoads = 0
  const start = new Date('2026-10-01T00:00:00Z')
  const quoteLoader = async () => {
    quoteLoads++
    return { quotes: [{ date: new Date('2026-10-29'), close: 99 }, { date: new Date('2026-10-30'), close: 100 }],
      meta: { ...meta, regularMarketPrice: 100, regularMarketTime: new Date('2026-10-30T20:00:00Z') } }
  }
  const historyLoader = async () => {
    historyLoads++
    return { rows: [row(start.getTime() / 1000, 99), row(Date.parse('2026-10-30') / 1000, 100)], currency: 'USD', longName: 'Fixture', meta }
  }
  try {
    await store.resolve('dynamic-degraded', () => mondayOpen - now, async () => {
      observeSource({ fetchedAt: now, stale: false, fromCache: false, failures: ['fixture partial feed'] })
      return 1
    })
    now += 10_001
    assert.equal(await store.get('dynamic-degraded'), null, 'A longer session lifetime must not suppress recovery of partial results')
    await store.resolve('dynamic-dependency', () => mondayOpen - now, async () => {
      observeSource({ fetchedAt: now, expiresAt: now + 1_000, stale: false, fromCache: false, failures: [] })
      return 1
    })
    now += 1_001
    assert.equal(await store.get('dynamic-dependency'), null, 'Earlier dependency checks must still limit a dynamic lifetime')
    const first = await resolveYahooQuote('SESSION', false, store, quoteLoader)
    assert.equal(first.snapshot?.expiresAt, mondayOpen)
    const request = { symbol: 'SESSION', interval: '1d' as const, start }
    await getYahooSeries(request, store, historyLoader)
    await store.close()
    store = new TtlCache({ path })
    now += 24 * 60 * 60_000
    for (let index = 0; index < 5; index++) {
      now += 60 * 60_000
      const quote = await resolveYahooQuote('SESSION', false, store, quoteLoader)
      assert.equal(quote.fromCache, true)
      assert.equal(quote.stale, false)
      assert.equal(quote.value.asOf, Date.parse('2026-10-30T20:00:00Z'), 'Reuse must preserve the actual trade time')
      assert.equal((await getYahooSeries(request, store, historyLoader)).fromCache, true)
    }
    assert.equal(quoteLoads, 1, 'Restart and repeated weekend reads must not reload unchanged quotes')
    assert.equal(historyLoads, 1, 'Restart and repeated weekend reads must not reload chart tails')

    const key = ['quotes', 'SESSION']
    const saved = { data: { price: 100 }, errors: [], meta: { source: 'fixture', freshness: 'cached' as const,
      fetchedAt: friday, expiresAt: mondayOpen } }
    client.setQueryData(key, saved, { updatedAt: friday })
    let rendererLoads = 0
    const options = { queryKey: key, staleTime: TTL.quotes, queryFn: async () => { rendererLoads++; return saved } }
    assert.equal(await warmStartupQuery(client, options), saved, 'Startup must reuse a checked closing snapshot even after its normal timer')
    assert.equal(rendererLoads, 0)
    assert.equal(startupRefreshDelay([{ key, result: saved }], false, now), mondayOpen - now + 250)
    await client.invalidateQueries({ queryKey: key, refetchType: 'none' })
    await warmStartupQuery(client, options)
    assert.equal(rendererLoads, 1, 'Invalidation must still recheck closed-market data')
    await warmStartupQuery(client, { ...options, staleTime: 0 })
    assert.equal(rendererLoads, 2, 'Explicit refresh must still recheck closed-market data')
    await assert.rejects(client.fetchQuery({ queryKey: key, staleTime: 0, retry: false,
      queryFn: async () => { throw Error('fixture renderer refresh failed') } }), /fixture renderer refresh failed/)
    await warmStartupQuery(client, options)
    assert.equal(rendererLoads, 3, 'A failed renderer refresh must recover before the next session')

    await resolveYahooQuote('SESSION', true, store, quoteLoader)
    await getYahooSeries({ ...request, force: true }, store, historyLoader)
    assert.equal(quoteLoads, 2, 'Manual quote refresh bypasses the closed-session cache')
    assert.equal(historyLoads, 2, 'Manual chart refresh bypasses the closed-session cache')
    const fallback = await resolveYahooQuote('SESSION', true, store, async () => { throw Error('fixture offline') })
    assert.equal(fallback.stale, true, 'Closed-market refresh failures remain visible')
    assert.equal(fallback.value.price, 100)

    now = mondayOpen + 1
    await resolveYahooQuote('SESSION', false, store, quoteLoader)
    await getYahooSeries(request, store, historyLoader)
    assert.equal(quoteLoads, 3, 'A new session resumes quote requests')
    assert.equal(historyLoads, 3, 'A new session resumes history updates')
    await warmStartupQuery(client, options)
    assert.equal(rendererLoads, 4, 'Renderer reuse must also end at the next session')
  } finally {
    Date.now = originalNow
    client.clear()
    await store.close()
  }
}

async function liveMarketChecks(): Promise<void> {
  const store = new TtlCache()
  try {
    const quote = await resolveYahooQuote('IBM', false, store)
    assert.ok(quote.value.price > 0 && quote.snapshot?.expiresAt! > Date.now())
    assert.equal((await resolveYahooQuote('IBM', false, store)).fromCache, true)
    const request = { symbol: 'IBM', interval: '1d' as const, start: new Date(Date.now() - 40 * 86_400_000) }
    const history = await getYahooSeries(request, store)
    assert.ok(history.rows.length > 10)
    assert.equal((await getYahooSeries(request, store)).fromCache, true)
    assert.equal((await store.stats()).loads, 2, 'Immediate live rereads must not make additional provider loads')
    console.log(`Live Yahoo cache checks passed: IBM quote and ${history.rows.length} daily bars; next quote check ${new Date(quote.snapshot!.expiresAt!).toISOString()}.`)
  } finally {
    await store.close()
    closeYahooWorker()
  }
}

try {
  assert.deepEqual(readCacheSettings(), DEFAULT_CACHE_SETTINGS)
  const customSettings = { ...DEFAULT_CACHE_SETTINGS, rendererMiB: 512, marketMiB: 4096, assetsMiB: 128, retentionDays: 60 }
  await saveCacheSettings(customSettings)
  assert.deepEqual(readCacheSettings(), customSettings, 'Cache preferences must survive a process restart')
  await assert.rejects(saveCacheSettings({ ...customSettings, marketMiB: -1 }), /supported range/)
  await assert.rejects(saveCacheSettings({ ...customSettings, rendererMiB: 256.5 }), /supported range/)
  assert.deepEqual(readCacheSettings(), customSettings, 'Invalid input must not overwrite valid limits')
  await saveCacheSettings(DEFAULT_CACHE_SETTINGS)
  const partitioned = new TtlCache({ path: join(scratch, 'partitioned.sqlite'), maxBytes: 4096, assetMaxBytes: 800, memoryMaxBytes: 0 })
  try {
    await partitioned.set('snapshot:protected', 'market'.repeat(100), 60_000)
    for (let index = 0; index < 8; index++) await partitioned.set(`thumbnail:${index}`, 'image'.repeat(100), 60_000)
    const stats = await partitioned.stats()
    assert.equal((await partitioned.get<string>('snapshot:protected'))?.value, 'market'.repeat(100), 'Image pressure must never evict market data')
    assert.ok(stats.assets.bytes <= 800 && stats.assets.evictions > 0)
    assert.equal(stats.market.evictions, 0)
    await partitioned.configureLimits(500, 800)
    assert.equal(await partitioned.get('snapshot:protected'), null, 'Lowered limits must apply without restarting')
    assert.ok((await partitioned.stats()).market.evictions > 0)
  } finally { await partitioned.close() }
  await persistentCacheChecks()
  await memoryAndOrderingChecks()
  await batchingChecks()
  await workerFailureChecks()
  await incrementalSeriesChecks()
  await rendererPolicyChecks()
  await marketSessionChecks()
  if (process.argv.includes('--live')) await liveMarketChecks()
  const rendererClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  try {
    for (let index = 0; index < 100; index += 1) {
      rendererClient.setQueryData(['history', index], Array.from({ length: 2000 }, (_, day) => ({ day, close: day * 1.234 })))
    }
    const snapshot = { timestamp: Date.now(), buster: 'fixture', clientState: dehydrate(rendererClient) }
    let inputHandled = false
    setTimeout(() => { inputHandled = true }, 0)
    const trimmed = await trimPersistedClientInBackground(snapshot)
    assert.equal(inputHandled, true, 'trimming large histories must yield to queued input')
    assert.deepEqual(trimmed, trimPersistedClient(snapshot))
    assert.equal(await trimPersistedClientInBackground(snapshot, () => true), undefined)
    // Cancellation after trimming starts must abandon the old snapshot as well.
    let cancellationChecks = 0
    assert.equal(await trimPersistedClientInBackground(snapshot, () => ++cancellationChecks > 2), undefined)
  } finally {
    rendererClient.clear()
  }
  console.log('Cache checks passed: restart persistence, serialization, corruption, pruning, single-flight, stale fallback, incremental ranges, bounded memory, batching/touches, worker recovery, clear ordering, shutdown backpressure, cooperative renderer trimming and session-aware stock reuse.')
} finally {
  if (originalAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = originalAppData
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = originalLocalAppData
  rmSync(scratch, { recursive: true, force: true })
}
