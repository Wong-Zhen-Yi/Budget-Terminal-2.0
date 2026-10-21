import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { serialize } from 'node:v8'
import { dehydrate, QueryClient } from '@tanstack/react-query'

import { TtlCache } from '../electron/services/cache.js'
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
  first.set('snapshot:fixture', saved, 60_000)
  first.close()

  const reopened = new TtlCache({ path: databasePath, maxBytes: 4_096 })
  const restored = reopened.get<typeof saved>('snapshot:fixture')
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

  reopened.set('stale', { usable: true }, -1)
  const fallback = await reopened.resolveWithStaleFallback(
    'stale',
    -1,
    async () => { throw new Error('offline') },
    { force: true },
  )
  assert.equal(fallback.stale, true)
  reopened.close()

  const degradedPath = join(scratch, 'degraded.sqlite')
  const degraded = new TtlCache({ path: degradedPath })
  const fetchedAt = Date.now()
  degraded.set('partial', { rows: [1] }, 43_200_000,
    { fetchedAt, stale: false, fromCache: false, failures: ['HTTP 503'] })
  degraded.close()
  // Also cover incomplete entries persisted by an older build with the full TTL.
  const oldPartial = new DatabaseSync(degradedPath)
  oldPartial.prepare('UPDATE cache_entries SET ttl_ms = ?').run(43_200_000)
  oldPartial.close()
  const recoveredStore = new TtlCache({ path: degradedPath })
  const originalNow = Date.now
  try {
    Date.now = () => fetchedAt + 10_001
    assert.equal(recoveredStore.get('partial'), null, 'Persisted partial data must not block recovery for hours')
    assert.deepEqual(recoveredStore.get('partial', { allowStale: true })?.value, { rows: [1] })
    let loads = 0
    const refreshed = await recoveredStore.resolve('partial', 43_200_000, async () => { loads++; return { rows: [1, 2] } })
    assert.equal(loads, 1)
    assert.deepEqual(refreshed.value.rows, [1, 2])
    assert.deepEqual(recoveredStore.get('partial')?.snapshot?.failures, [], 'Recovery must clear cached failure provenance')
  } finally {
    Date.now = originalNow
    recoveredStore.close()
  }

  const database = new DatabaseSync(databasePath)
  const sizePlan = database.prepare('EXPLAIN QUERY PLAN SELECT COALESCE(SUM(size_bytes), 0) AS total FROM cache_entries').all()
  assert.ok(sizePlan.some(step => String(step.detail).includes('COVERING INDEX')),
    'Per-write cache accounting must avoid scanning the table containing large payloads')
  database.prepare('UPDATE cache_entries SET value = ? WHERE key = ?').run(serialize({ rows: [], coveredFrom: 1 }), 'snapshot:fixture')
  database.close()
  const legacy = new TtlCache({ path: databasePath, maxBytes: 4_096 })
  const barePayload = legacy.get('snapshot:fixture', { allowStale: true })
  const validWrapped = legacy.get<number>('single-flight')?.value
  legacy.set('snapshot:fixture', saved, 60_000)
  legacy.set('malformed-wrapper', 1, 60_000)
  legacy.close()
  assert.equal(barePayload, null, 'A bare legacy payload is not a usable wrapped cache entry')
  assert.equal(validWrapped, 1, 'Valid wrapped entries remain available')
  const malformed = new DatabaseSync(databasePath)
  malformed.prepare('UPDATE cache_entries SET value = ? WHERE key = ?').run(serialize({ value: undefined, snapshot: undefined }), 'malformed-wrapper')
  malformed.close()
  const invalid = new TtlCache({ path: databasePath, maxBytes: 4_096 })
  const undefinedPayload = invalid.get('malformed-wrapper')
  invalid.close()
  assert.equal(undefinedPayload, null, 'An undefined decoded payload must trigger reload, not a truthy cache hit')
  const broken = new DatabaseSync(databasePath)
  broken.prepare('UPDATE cache_entries SET value = ? WHERE key = ?').run(Buffer.from([0, 1, 2]), 'snapshot:fixture')
  broken.close()
  const corrupt = new TtlCache({ path: databasePath, maxBytes: 4_096 })
  assert.equal(corrupt.get('snapshot:fixture', { allowStale: true }), null)
  for (let index = 0; index < 8; index += 1) corrupt.set(`snapshot:${index}`, 'x'.repeat(900), 60_000)
  corrupt.close()
  const pruned = new DatabaseSync(databasePath)
  const size = pruned.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM cache_entries').get() as { total: number }
  assert.ok(size.total <= 4_096)
  pruned.close()
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
    store.set('series:yahoo-only:ohlcv:BAD:1d', { rows: [] }, 60_000)
    const recovered = await getYahooSeries({ symbol: 'BAD', start, interval: '1d' }, store, loader)
    assert.ok(recovered.rows.length >= 30, 'Malformed canonical history is discarded and reloaded')
    calls.length = 0
    const cold = await getYahooSeries({ symbol: 'FIX', start, interval: '1d' }, store, loader)
    assert.ok(cold.rows.length >= 30)
    assert.equal(calls.length, 1)
    await getYahooSeries({ symbol: 'FIX', start, interval: '1d' }, store, loader)
    assert.equal(calls.length, 1, 'a fresh covered series makes no request')

    now += 6 * 60_000
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

    now += 6 * 60_000
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

try {
  await persistentCacheChecks()
  await incrementalSeriesChecks()
  await rendererPolicyChecks()
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
  console.log('Cache checks passed: restart persistence, serialization, corruption, pruning, single-flight, stale fallback, incremental ranges, cooperative renderer trimming and cancellation.')
} finally {
  if (originalAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = originalAppData
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = originalLocalAppData
  rmSync(scratch, { recursive: true, force: true })
}
