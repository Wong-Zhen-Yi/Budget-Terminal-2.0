import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { QueryClient } from '@tanstack/react-query'
import { createEquityQueryIndex } from '../src/api/equityQueryIndex.js'

const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
const keyPath = join(previous.APPDATA ?? '', 'budget-terminal-desktop', 'market-api-keys.bin')
const directory = await mkdtemp(join(tmpdir(), 'bt-finnhub-'))
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const { FinnhubQuotes, finnhubQuotes } = await import('../electron/services/finnhubQuotes.js')
const { cache } = await import('../electron/services/cache.js')
const { getQuote, getQuotes } = await import('../electron/services/yahoo/quotes.js')
const { yahoo, closeYahooWorker } = await import('../electron/services/yahoo/client.js')
const { hyperliquidEquities } = await import('../electron/services/hyperliquidEquities.js')
const { captureSources } = await import('../electron/services/sourceHealth.js')
const original = { fetch, quote: hyperliquidEquities.getQuote, chart: yahoo.chart }

class TestSocket extends EventTarget {
  readyState = 0
  sent: Array<{ type: string; symbol: string }> = []
  send(value: string): void { this.sent.push(JSON.parse(value)) }
  open(): void { this.readyState = 1; this.dispatchEvent(new Event('open')) }
  message(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })) }
  close(): void { this.readyState = 3; this.dispatchEvent(new Event('close')) }
}

async function probeRefreshPolicy(): Promise<void> {
  let now = Date.parse('2026-11-13T15:00:00Z')
  let foreground = true
  const calls: string[] = []
  const socket = new TestSocket()
  const client = new FinnhubQuotes(async () => 'fixture', async input => {
    calls.push(new URL(String(input)).searchParams.get('symbol')!)
    return Response.json({ c: 110, pc: 100, t: now / 1000 - 1 })
  }, () => now, () => socket as unknown as WebSocket)
  client.setForegroundLoader(() => foreground)
  client.setVisibleSymbols(['AAPL'])
  client.start()
  try {
    await client.resolve('AAPL')
    await client.resolve('BACK')
    socket.open()
    const initial = calls.length
    for (let i = 0; i < 9; i += 1) {
      now += 31_000
      socket.message({ type: 'trade', data: [{ s: 'AAPL', p: 120, t: now }] })
      await client.poll()
      await client.resolve('AAPL')
    }
    assert.equal(calls.length, initial, 'Healthy streaming or background reads caused early REST calls')
    now += 22_000
    socket.message({ type: 'trade', data: [{ s: 'AAPL', p: 121, t: now }] })
    await client.poll()
    assert.equal(calls.at(-1), 'AAPL', 'Visible reference was not maintained after five minutes')
    await client.poll()
    assert.equal(calls.at(-1), 'BACK', 'Background did not refresh after five minutes')
    socket.close()
    now += 31_000
    await client.resolve('AAPL')
    assert.equal(calls.at(-1), 'AAPL', 'Quiet/disconnected visible stock did not resume fallback polling')
    foreground = false
    const beforeIdle = calls.length
    now += 31_000
    await client.resolve('AAPL')
    await client.resolve('BACK')
    await client.poll()
    assert.equal(calls.length, beforeIdle, 'Minimized app kept fast REST polling')
    foreground = true
    now = Date.parse('2026-11-13T22:00:00Z')
    await client.resolve('AAPL')
    const extended = calls.length
    now += 31_000
    await client.resolve('AAPL')
    assert.equal(calls.length, extended, 'After-hours fallback ignored slower cadence')
    now += 30_000
    await client.resolve('AAPL')
    assert.equal(calls.length, extended + 1, 'After-hours fallback stopped entirely')
    now = Date.parse('2026-11-14T15:00:00Z')
    await client.resolve('AAPL')
    const closed = calls.length
    now += 5 * 60_000
    await client.resolve('AAPL')
    await client.poll()
    assert.equal(calls.filter(symbol => symbol === 'AAPL').length, calls.slice(0, closed).filter(symbol => symbol === 'AAPL').length, 'Weekend retained fast polling')
    now += 10 * 60_000
    await client.resolve('AAPL')
    assert.equal(calls.at(-1), 'AAPL')
    // Summer pre-market begins at 08:00 UTC, winter at 09:00 UTC.
    for (const start of ['2027-07-12T08:00:00Z', '2026-11-16T09:00:00Z']) {
      now = Date.parse(start)
      await client.resolve('AAPL', true)
      const before = calls.length
      now += 61_000
      await client.resolve('AAPL')
      assert.equal(calls.length, before + 1, 'DST pre-market treated as closed')
    }
  } finally { client.close() }
  console.log('PASS: streaming reference cadence, visible/background priorities, stream fallback, minimized, weekend and extended-hours/DST policies')
}

async function probeStream(): Promise<void> {
  let now = Date.parse('2026-11-13T10:00:00Z')
  let reference = { c: 110, pc: 100, t: Date.parse('2026-11-12T21:00:00Z') / 1_000 }
  const sockets: TestSocket[] = []
  const updates: import('../electron/shared/contract.js').Quote[] = []
  let finishRest: ((response: Response) => void) | undefined
  let rateLimited = false
  const client = new FinnhubQuotes(async () => 'fixture-stream-secret', async () => rateLimited ? new Response('', { status: 429 }) : finishRest
    ? new Promise<Response>(done => { finishRest = done }) : Response.json(reference), () => now, url => {
    assert.equal(new URL(url).origin, 'wss://ws.finnhub.io')
    const socket = new TestSocket()
    sockets.push(socket)
    return socket as unknown as WebSocket
  })
  client.subscribe(quote => updates.push(quote))
  client.start()
  try {
    await client.resolve('AAPL')
    await new Promise(done => setImmediate(done))
    assert.equal(sockets.length, 1, 'Consumers opened duplicate authenticated connections')
    const socket = sockets[0]
    socket.open()
    assert.deepEqual(socket.sent, [{ type: 'subscribe', symbol: 'AAPL' }])
    socket.message({ type: 'trade', data: [{ s: 'AAPL', p: 121, t: now - 100 }] })
    const pre = await client.resolve('AAPL')
    assert.equal(pre?.value.price, 121)
    assert.equal(pre?.value.asOf, now - 100)
    assert(Math.abs(pre!.value.change - 10) < 1e-9, 'Pre-market used the day-before-yesterday close')
    assert.equal(pre?.value.absChange, 11)
    assert.equal(pre?.value.source, 'Finnhub')
    assert.equal(pre?.value.priceBasis, undefined)
    await client.resolve('AAPL', true)
    assert.equal((await client.resolve('AAPL'))?.value.price, 121, 'REST close overwrote a pre-market trade')
    for (const row of [{ s: 'AAPL', p: -1, t: now }, { s: 'AAPL', p: 999, t: now + 60_000 },
      { s: 'AAPL', p: 999, t: now - 1000 }, { s: 'UNKNOWN', p: 999, t: now }, { s: 'AAPL', p: '999', t: now }]) {
      socket.message({ type: 'trade', data: [row] })
    }
    socket.message(null)
    socket.message({ type: 'trade', data: null })
    assert.equal((await client.resolve('AAPL'))?.value.price, 121)
    // A trade received while the first reference request is in flight is retained.
    finishRest = () => {}
    const early = client.resolve('MSFT')
    await new Promise(done => setImmediate(done))
    socket.message({ type: 'trade', data: [{ s: 'MSFT', p: 132, t: now }] })
    finishRest!(Response.json(reference))
    finishRest = undefined
    assert.equal((await early)?.value.price, 132)
    // Late REST completions cannot erase a trade received during the refresh.
    finishRest = () => {}
    const race = client.resolve('AAPL', true)
    await new Promise(done => setImmediate(done))
    socket.message({ type: 'trade', data: [{ s: 'AAPL', p: 122, t: now }] })
    finishRest!(Response.json(reference))
    finishRest = undefined
    assert.equal((await race)?.value.price, 122)
    await new Promise(done => setTimeout(done, 300))
    assert(updates.some(quote => quote.symbol === 'AAPL' && quote.price === 122), 'Live price never reached renderer subscribers')
    assert(!JSON.stringify(updates).includes('fixture-stream-secret'))
    rateLimited = true
    const freshStream = await client.resolve('AAPL', true)
    assert.equal(freshStream?.stale, false, 'REST rate limit marked a current streamed trade stale')
    assert.equal(freshStream?.value.price, 122)
    rateLimited = false
    // Refresh the REST reference even if continuous trades keep the cache warm.
    now = Date.parse('2026-11-13T15:00:00Z')
    reference = { c: 125, pc: 110, t: now / 1_000 - 1 }
    socket.message({ type: 'trade', data: [{ s: 'AAPL', p: 126, t: now }] })
    await client.poll()
    assert(Math.abs((await client.resolve('AAPL'))!.value.change - (126 / 110 - 1) * 100) < 1e-9)
    socket.close()
    await client.poll()
    assert.equal(sockets.length, 1, 'Reconnect ignored backoff')
    now += 1_001
    await client.poll()
    assert.equal(sockets.length, 2)
    sockets[1].open()
    assert(sockets[1].sent.some(row => row.symbol === 'AAPL'), 'Reconnect did not restore subscriptions')
    now = Date.parse('2026-11-13T22:00:00Z')
    reference = { c: 150, pc: 110, t: Date.parse('2026-11-13T21:00:00Z') / 1_000 }
    await client.resolve('AAPL', true)
    sockets[1].message({ type: 'trade', data: [{ s: 'AAPL', p: 154, t: now }] })
    assert(Math.abs((await client.resolve('AAPL'))!.value.change - 40) < 1e-9, 'Same-day trade did not use REST previous close')
    now += 10
    sockets[1].message({ type: 'trade', data: [{ s: 'AAPL', p: 155, t: now }] })
    reference = { c: 156, pc: 110, t: (now + 1) / 1_000 }
    await client.resolve('AAPL', true)
    await new Promise(done => setTimeout(done, 300))
    assert.equal(updates.at(-1)?.price, 156, 'Queued trade overwrote a newer REST emission')
    // Same rules operate after the DST transition (New York summer time).
    now = Date.parse('2027-07-12T12:00:00Z')
    reference = { c: 140, pc: 130, t: Date.parse('2027-07-09T20:00:00Z') / 1_000 }
    await client.resolve('AAPL', true)
    sockets[1].message({ type: 'trade', data: [{ s: 'AAPL', p: 154, t: now }] })
    assert(Math.abs((await client.resolve('AAPL'))!.value.change - 10) < 1e-9, 'Summer pre-market/holiday gap baseline failed')
    client.credentialsChanged()
    sockets[1].message({ type: 'trade', data: [{ s: 'AAPL', p: 999, t: now + 1 }] })
    assert.equal(sockets[1].readyState, 3)
    const emissions = updates.length
    await new Promise(done => setTimeout(done, 300))
    assert.equal(updates.length, emissions, 'Removed key emitted queued trades')
  } finally { client.close() }

  const budgetSockets: TestSocket[] = []
  const budget = new FinnhubQuotes(async () => 'fixture', async () => Response.json(reference), () => now, () => {
    const socket = new TestSocket()
    budgetSockets.push(socket)
    return socket as unknown as WebSocket
  })
  budget.start()
  try {
    await Promise.all(Array.from({ length: 55 }, (_, i) => budget.resolve(`TEST${i}`)))
    await budget.resolve('BRK-B')
    await budget.resolve('BRK.B')
    budgetSockets[0].open()
    let active = new Set<string>()
    const apply = (rows: TestSocket['sent']) => {
      for (const row of rows) {
        if (row.type === 'subscribe') active.add(row.symbol)
        else active.delete(row.symbol)
        assert(active.size <= 50, 'Feed subscription budget exceeded')
      }
    }
    apply(budgetSockets[0].sent)
    const first = [...active]
    budgetSockets[0].sent = []
    now += 31_000
    await budget.poll()
    apply(budgetSockets[0].sent)
    assert.notDeepEqual([...active], first, 'Large startup universe did not rotate')
    assert(active.has('BRK.B'))
    budgetSockets[0].message({ type: 'trade', data: [{ s: 'BRK.B', p: 155, t: now }] })
    assert.equal((await budget.resolve('BRK-B'))?.value.price, 155)
    assert.equal((await budget.resolve('BRK.B'))?.value.price, 155)
  } finally { budget.close() }
  console.log('PASS: pre-market streaming, close reference/DST, early trades, REST races, validation, batching, reconnect, key removal, aliases and bounded subscription rotation')
}

async function probePortfolioPriority(): Promise<void> {
  let now = Date.parse('2026-11-13T10:00:00Z')
  const reference = { c: 110, pc: 100, t: now / 1_000 - 1 }
  const calls: string[] = []
  let holdings = [' aapl ', 'BRK-B', 'BRK.B', 'BTC-USD', '^GSPC']
  let release: (() => void) | undefined
  let gate: Promise<void> | undefined
  const sockets: TestSocket[] = []
  const client = new FinnhubQuotes(async () => 'fixture', async input => {
    calls.push(new URL(String(input)).searchParams.get('symbol')!)
    if (gate) await gate
    return Response.json(reference)
  }, () => now, () => {
    const socket = new TestSocket()
    sockets.push(socket)
    return socket as unknown as WebSocket
  })
  client.setPortfolioLoader(async () => holdings)
  client.start()
  try {
    await client.poll()
    assert.deepEqual(calls, ['AAPL', 'BRK.B'], 'Startup must seed all portfolios, normalize aliases and exclude other instruments')
    sockets[0].open()
    const active = new Set<string>()
    const apply = () => {
      for (const row of sockets[0].sent.splice(0)) {
        if (row.type === 'subscribe') active.add(row.symbol)
        else active.delete(row.symbol)
        assert(active.size <= 50)
      }
    }
    await Promise.allSettled(Array.from({ length: 55 }, (_, i) => client.resolve(`OTHER${i}`)))
    apply()
    assert(active.has('AAPL') && active.has('BRK.B'))
    for (let i = 0; i < 3; i += 1) {
      now += 31_000
      sockets[0].message({ type: 'ping' })
      await client.poll()
      const removed = sockets[0].sent.filter(row => row.type === 'unsubscribe').map(row => row.symbol)
      assert(!removed.includes('AAPL') && !removed.includes('BRK.B'), 'Background rotation evicted a portfolio live/pre-market feed')
      apply()
    }
    // A newly added stock takes the next free REST slot ahead of queued screeners.
    now += 61_000
    gate = new Promise<void>(done => { release = done })
    const background = Array.from({ length: 10 }, (_, i) => client.resolve(`QUEUE${i}`, true))
    await new Promise(done => setImmediate(done))
    const before = calls.length
    holdings = ['MSFT']
    client.portfolioChanged()
    const added = client.resolve('MSFT', true)
    await new Promise(done => setImmediate(done))
    release!()
    gate = undefined
    await Promise.all([...background, added])
    assert.equal(calls[before], 'MSFT', 'Portfolio request stayed behind queued background requests')
    apply()
    assert(active.has('MSFT'), 'Portfolio edits did not update the live feed')
    // Frequent cached reads must not postpone the portfolio reference refresh.
    for (let i = 0; i < 2; i += 1) { now += 10_000; await client.resolve('MSFT') }
    now += 41_000
    const refreshed = calls.length
    await client.poll()
    assert.equal(calls[refreshed], 'MSFT')
  } finally { release?.(); client.close() }

  const budgetCalls: string[] = []
  const budget = new FinnhubQuotes(async () => 'fixture', async input => {
    budgetCalls.push(new URL(String(input)).searchParams.get('symbol')!)
    return Response.json(reference)
  }, () => now)
  budget.setPortfolioLoader(async () => ['AAPL', 'MSFT'])
  await Promise.allSettled(Array.from({ length: 65 }, (_, i) => budget.resolve(`SCREEN${i}`)))
  assert.equal(budgetCalls.length, 56, 'Background pages consumed reserved portfolio refresh capacity')
  await Promise.all(['AAPL', 'MSFT'].map(symbol => budget.resolve(symbol)))
  now += 31_000
  await Promise.all(['AAPL', 'MSFT'].map(symbol => budget.resolve(symbol, true)))
  assert.equal(budgetCalls.length, 60)
  assert.deepEqual(budgetCalls.slice(-4), ['AAPL', 'MSFT', 'AAPL', 'MSFT'])
  await budget.resolve('AAPL', true)
  assert.equal(budgetCalls.length, 60, 'Priority bypassed the shared provider budget')
  budget.setPortfolioLoader(async () => [])
  now += 61_000
  await budget.resolve('SCREEN99')
  assert.equal(budgetCalls.at(-1), 'SCREEN99', 'Clearing portfolios did not release reserved capacity')

  const largeSocket = new TestSocket()
  const large = new FinnhubQuotes(async () => 'fixture', async () => Response.json(reference), () => now,
    () => largeSocket as unknown as WebSocket)
  large.setPortfolioLoader(async () => Array.from({ length: 55 }, (_, i) => `HELD${i}`))
  large.start()
  try {
    await large.poll()
    await large.resolve('BACKGROUND').catch(() => undefined)
    largeSocket.open()
    const first = largeSocket.sent.filter(row => row.type === 'subscribe').map(row => row.symbol)
    assert.equal(first.length, 50)
    assert(first.every(symbol => symbol.startsWith('HELD')))
    largeSocket.sent = []
    now += 31_000
    await large.poll()
    assert(largeSocket.sent.some(row => row.type === 'subscribe' && row.symbol === 'HELD54'), 'Oversized portfolios failed to rotate')
    assert(largeSocket.sent.every(row => row.symbol.startsWith('HELD')), 'Background symbols displaced an oversized portfolio')
  } finally { large.close() }
  console.log('PASS: portfolio startup seeding, REST queue priority/reservation, cached-read refreshes, live subscription pinning/rotation and portfolio edits')
}

try {
  const visibleClient = new QueryClient()
  const visibleIndex = createEquityQueryIndex(visibleClient)
  visibleClient.setQueryData(['stocks', 'AAPL'], { data: { symbol: 'AAPL' } })
  visibleClient.setQueryData(['stocks', 'MSFT'], { data: { symbol: 'MSFT' } })
  visibleClient.setQueryData(['marketCap'], { data: { rows: [{ ticker: 'NVDA' }, { ticker: 'AAPL' }] } })
  assert.deepEqual(visibleIndex.symbolsFor([['stocks', 'AAPL']]), ['AAPL'])
  assert.deepEqual(visibleIndex.symbolsFor([['stocks', 'MSFT'], ['marketCap']]), ['MSFT', 'NVDA', 'AAPL'])
  visibleClient.removeQueries({ queryKey: ['stocks', 'AAPL'], exact: true })
  assert.deepEqual(visibleIndex.symbolsFor([['stocks', 'AAPL']]), [])
  visibleIndex.stop()
  visibleClient.clear()
  await probeRefreshPolicy()
  await probeStream()
  await probePortfolioPriority()
  let now = Date.parse('2026-11-13T15:00:00Z')
  let calls = 0
  let currentKey: string | undefined = 'fixture-finnhub-secret'
  const timestamps: number[] = []
  const client = new FinnhubQuotes(async () => currentKey, async (input, init) => {
    calls += 1
    const url = new URL(String(input))
    assert.equal(url.origin, 'https://finnhub.io')
    assert(!url.href.includes('secret') && !url.searchParams.has('token'), 'Credential leaked into URL')
    assert.equal(new Headers(init?.headers).get('X-Finnhub-Token'), currentKey)
    assert.equal(init?.redirect, 'error')
    return Response.json({ c: 110, pc: 100, t: Math.floor((now - 90_000) / 1_000) })
  }, () => now)
  client.subscribe(quote => timestamps.push(quote.asOf!))
  for (const symbol of ['BTC-USD', '^GSPC', 'GC=F', 'AAPL-PERP', 'VOD.L', '7203.T', 'EURUSD=X']) {
    assert.equal(await client.resolve(symbol), null)
  }
  assert.equal(calls, 0)
  const batch = await Promise.all(Array.from({ length: 20 }, () => client.resolve('AAPL')))
  assert.equal(calls, 1, 'Startup consumers must coalesce')
  assert(batch.every(result => result?.value.price === 110))
  assert.equal(batch[0]?.value.source, 'Finnhub')
  assert.equal(batch[0]?.value.priceBasis, undefined, 'Stock quote mislabeled as perpetual')
  assert(Math.abs(batch[0]!.value.change - 10) < 1e-10)
  assert.equal(batch[0]?.value.absChange, 10)
  assert.equal(timestamps.length, 1)
  assert(timestamps[0] < now, 'Retrieval time replaced actual trade time')
  assert(client.prefers('AAPL'))
  const captured = await captureSources(() => client.resolve('AAPL'))
  assert(captured.value?.fromCache)
  assert(captured.snapshot?.sources?.includes('Finnhub'))
  assert.equal(calls, 1)
  now += 301_000
  await client.poll()
  assert.equal(calls, 2, 'Automatic poll did not refresh requested stock')
  currentKey = undefined
  client.credentialsChanged()
  assert(!client.prefers('AAPL'))
  assert.equal(await client.resolve('AAPL'), null, 'Removed key still used')
  assert.equal(calls, 2)
  currentKey = 'fixture-replacement-secret'
  client.credentialsChanged()
  await client.resolve('AAPL')
  assert.equal(calls, 3)

  let active = 0
  let maximumActive = 0
  let portfolioCalls = 0
  const largePortfolio = new FinnhubQuotes(async () => 'fixture', async () => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    portfolioCalls += 1
    await new Promise(done => setImmediate(done))
    active -= 1
    return Response.json({ c: 110, pc: 100, t: now / 1_000 })
  }, () => now)
  const portfolioQuotes = await Promise.all(Array.from({ length: 24 }, (_, index) => largePortfolio.resolve(`STOCK${index}`)))
  assert.equal(portfolioCalls, 24, 'Large portfolios dropped Finnhub requests after the concurrency cap')
  assert.equal(maximumActive, 4, 'Concurrent requests exceeded the limit')
  assert(portfolioQuotes.every(result => result?.value.source === 'Finnhub'))
  now += 61_000
  assert(largePortfolio.prefers('STOCK0'), 'Aging quotes must not hand control back to the perp stream')

  let outage = false
  const retained = new FinnhubQuotes(async () => 'fixture', async () => outage
    ? new Response('', { status: 429 }) : Response.json({ c: 110, pc: 100, t: now / 1_000 }), () => now)
  const lastGood = await retained.resolve('AAPL')
  now += 301_000
  outage = true
  const stale = await captureSources(() => retained.resolve('AAPL'))
  assert.equal(stale.value?.value.source, 'Finnhub')
  assert.equal(stale.value?.value.asOf, lastGood?.value.asOf)
  assert.equal(stale.value?.stale, true)
  assert.equal(stale.snapshot?.stale, true)
  assert(stale.snapshot?.failures.length)
  assert(retained.prefers('AAPL'), 'Rate limits must not enable perp overwrites')

  let limitedCalls = 0
  const limited = new FinnhubQuotes(async () => 'fixture', async () => {
    limitedCalls += 1
    return new Response('', { status: 429, headers: { 'Retry-After': '120' } })
  }, () => now)
  await assert.rejects(limited.resolve('AAPL'), /Finnhub/)
  now += 119_000
  await assert.rejects(limited.resolve('AAPL', true), /cooldown/)
  assert.equal(limitedCalls, 1)
  now += 2_000
  await assert.rejects(limited.resolve('AAPL', true))
  assert.equal(limitedCalls, 2)
  for (const invalid of [{ c: 0, pc: 0, t: 0 }, { c: 100, pc: null, t: now / 1_000 },
    { c: 100, pc: 90, t: now / 1_000 + 600 }, { error: 'fixture-secret' }]) {
    const invalidClient = new FinnhubQuotes(async () => 'fixture', async () => Response.json(invalid), () => now)
    await assert.rejects(invalidClient.resolve('AAPL'), error => error instanceof Error && !error.message.includes('fixture-secret'))
  }
  const network = new FinnhubQuotes(async () => 'fixture', async () => { throw Error('fixture-secret-in-request') })
  await assert.rejects(network.resolve('AAPL'), error => error instanceof Error && !error.message.includes('fixture-secret'))

  let budgetCalls = 0
  const budget = new FinnhubQuotes(async () => 'fixture', async () => {
    budgetCalls += 1
    return Response.json({ c: 110, pc: 100, t: now / 1_000 })
  }, () => now)
  for (let index = 0; index < 60; index += 1) await budget.resolve('AAPL', true)
  budget.credentialsChanged()
  await assert.rejects(budget.resolve('AAPL', true), /budget/)
  assert.equal(budgetCalls, 60, 'Key change bypassed minute budget')

  let complete!: (response: Response) => void
  const racing = new FinnhubQuotes(async () => 'fixture', () => new Promise(done => { complete = done }))
  let oldEmissions = 0
  racing.subscribe(() => { oldEmissions += 1 })
  const pending = racing.resolve('AAPL')
  await new Promise(done => setImmediate(done))
  racing.credentialsChanged()
  complete(Response.json({ c: 110, pc: 100, t: Date.now() / 1_000 }))
  await assert.rejects(pending)
  assert.equal(oldEmissions, 0, 'Old credential request emitted after key change')

  let fallbackCalls = 0
  hyperliquidEquities.getQuote = async symbol => {
    fallbackCalls += 1
    return { symbol, price: 90, change: 0, absChange: 0, source: 'Hyperliquid fixture', priceBasis: 'equity-perp-mark' }
  }
  globalThis.fetch = async () => Response.json({ c: 110, pc: 100, t: Date.now() / 1_000 })
  finnhubQuotes.setCredentialLoader(async () => 'fixture-only-key')
  assert.equal((await getQuote(' aapl ', true)).source, 'Finnhub')
  assert.equal(fallbackCalls, 0, 'Finnhub did not take precedence over mapped equity provider')
  const { yahooProvider } = await import('../electron/services/provider.js')
  const envelope = await yahooProvider.quotes({ holdings: ['AAPL'], includeMacro: false, includeSectors: false })
  assert.match(envelope.meta.source, /Finnhub/)
  assert(!JSON.stringify(envelope).includes('fixture-only-key'))
  const { markEquityScreenRows } = await import('../electron/services/equityScreenMarks.js')
  const screen = await markEquityScreenRows([{ ticker: 'TEST', price: 1 }])
  assert.equal(screen.rows[0].priceSource, 'Finnhub', 'Unmapped stocks must also use Finnhub')
  assert.equal(screen.rows[0].price, 110)
  const { applyEquityMarketUpdate } = await import('../src/api/equityStream.js')
  const renderer = new QueryClient()
  const snapshot = { data: { rows: [{ ticker: 'AAPL', price: 90 }], source: 'Yahoo stock screen' }, meta: envelope.meta, errors: [] }
  renderer.setQueryData(['marketCap', 'fixture'], snapshot)
  const update = { quotes: [await getQuote('AAPL')], candles: [] }
  applyEquityMarketUpdate(renderer, update)
  const firstUpdate = renderer.getQueryData<typeof snapshot>(['marketCap', 'fixture'])!
  assert.equal(firstUpdate.data.rows[0].price, 110)
  assert.match(firstUpdate.data.source, /Finnhub/)
  applyEquityMarketUpdate(renderer, update)
  assert.equal(renderer.getQueryData<typeof snapshot>(['marketCap', 'fixture'])!.data.source, firstUpdate.data.source, 'Repeated ticks grew source text')
  renderer.clear()
  globalThis.fetch = async () => new Response('fixture-only-key', { status: 401 })
  const fallback = await getQuotes(['AAPL'], true)
  assert.equal(fallback.quotes.AAPL.source, 'Finnhub')
  assert.equal(fallback.staleCount, 1, 'Failed refresh must visibly retain the last stock quote')
  assert.match(fallback.errors[0].reason, /Finnhub/)
  assert(!JSON.stringify(fallback).includes('fixture-only-key'))
  Object.assign(yahoo, { chart: async () => ({ quotes: [], meta: { regularMarketPrice: 105,
    regularMarketTime: new Date(), chartPreviousClose: 100, currency: 'USD' } }) })
  const stockFallback = await getQuotes(['MSFT'], true)
  assert.equal(stockFallback.quotes.MSFT.source, 'Yahoo Finance')
  assert.equal(stockFallback.quotes.MSFT.priceBasis, undefined, 'Finnhub-enabled fallback must be a stock quote')
  assert.equal(fallbackCalls, 0, 'Finnhub-enabled stocks requested a perpetual fallback')
  finnhubQuotes.setCredentialLoader(async () => undefined)
  assert.equal((await getQuote('AAPL', true)).source, 'Hyperliquid fixture')
  console.log('PASS: Finnhub precedence, large portfolio queuing, stale stock retention, perp overwrite protection, stock-only fallback, key removal/replacement, automatic updates, provenance, coalescing, budget/cooldown and secret redaction')

  if (process.argv.includes('--live')) {
    const entry = join(directory, 'live.cjs')
    const profile = join(directory, 'live-profile')
    const portfolioSymbols: string[] = []
    if (process.argv.includes('--portfolio')) {
      const document = JSON.parse(await readFile(join(previous.APPDATA ?? '', 'BudgetTerminalElectron', 'portfolio.json'), 'utf8'))
      const books = document.portfolios as Record<string, { tickers?: string[] }>
      const selected = books[document.activeId] ?? books[document.mainId]
      const symbols = selected?.tickers ?? Object.values(books).flatMap(book => book.tickers ?? [])
      portfolioSymbols.push(...[...new Set(symbols)].slice(0, 12))
    }
    // Windows safeStorage needs its profile's encrypted OS key. Copy only that
    // encrypted section into the temporary probe profile, never browser data.
    try {
      const state = JSON.parse(await readFile(join(dirname(keyPath), 'Local State'), 'utf8'))
      if (state.os_crypt) {
        await mkdir(profile, { recursive: true })
        await writeFile(join(profile, 'Local State'), JSON.stringify({ os_crypt: state.os_crypt }))
      }
    } catch { /* Missing profiles are reported as no saved key below. */ }
    await build({ stdin: { contents: `
      import { app, safeStorage } from 'electron'
      import { MarketApiKeyStore } from './electron/services/marketApiKeys.ts'
      import { FinnhubQuotes } from './electron/services/finnhubQuotes.ts'
      app.setPath('userData', ${JSON.stringify(profile)})
      app.whenReady().then(async () => {
        let stage = 'encrypted key read'
        try {
          const store = new MarketApiKeyStore({ path: () => ${JSON.stringify(keyPath)}, available: () => safeStorage.isEncryptionAvailable(),
            encrypt: value => safeStorage.encryptString(value), decrypt: bytes => safeStorage.decryptString(bytes) })
          const key = await store.getForService('finnhub')
          if (!key) { console.log('SKIP live Finnhub: no saved key'); app.exit(0); return }
          stage = 'authenticated quote request'
          const liveClient = new FinnhubQuotes(async () => key, async (...args) => {
            const response = await fetch(...args)
            console.log('Live Finnhub HTTP status: ' + response.status)
            return response
          })
          const quote = await liveClient.resolve('AAPL', true)
          if (!quote || quote.value.price <= 0) throw Error('No live quote')
          console.log('PASS live Finnhub: AAPL quote, timestamp and authentication validated; key redacted')
          if (${process.argv.includes('--stream')}) {
            stage = 'live WebSocket trades'
            liveClient.start()
            const poll = setInterval(() => { void liveClient.poll() }, 1_200)
            const seen = new Map()
            const stop = liveClient.subscribe(value => {
              if (value.asOf > quote.value.asOf && value.price > 0) seen.set(value.symbol, value.asOf)
            })
            try {
              await Promise.all(['AAPL', 'NVDA', 'TSLA'].map(symbol => liveClient.resolve(symbol)))
              await new Promise(done => setTimeout(done, 45_000))
              if (!seen.size) throw Error('No live trade received during observation window')
              console.log('PASS live stream: newer trades received for ' + [...seen.keys()].join(', ') + '; timestamps ' + [...seen.values()].map(time => new Date(time).toISOString()).join(', '))
              const latest = await liveClient.resolve('AAPL')
              const refreshed = await liveClient.resolve('AAPL', true)
              if (refreshed.value.asOf < latest.value.asOf) throw Error('REST overwrote a newer trade')
              console.log('PASS live stream: REST refresh retains newest trade')
            } finally { stop(); clearInterval(poll); liveClient.close() }
          }
          const symbols = ${JSON.stringify(portfolioSymbols)}
          if (symbols.length) {
            stage = 'portfolio stock quotes'
            const settled = await Promise.allSettled(symbols.map(symbol => liveClient.resolve(symbol)))
            const quotes = settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value.value] : [])
            const perps = quotes.filter(quote => quote.priceBasis === 'equity-perp-mark').length
            const preferred = quotes.filter(quote => quote.source === 'Finnhub').length
            console.log('Live portfolio sample: ' + preferred + '/' + symbols.length + ' Finnhub quotes, ' + perps + ' perpetual marks, ' + (symbols.length - quotes.length) + ' unavailable')
            if (perps || preferred !== symbols.length) throw Error('Portfolio sample incomplete')
            console.log('PASS live portfolio: concurrent holdings use Finnhub stock quotes')
          }
          app.exit(0)
        } catch { console.error('FAIL live Finnhub: ' + stage + ' unavailable'); app.exit(1) }
      })
    `, resolveDir: resolve('.') }, outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' })
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
      const child = spawn(createRequire(import.meta.url)('electron'), [entry], { env, windowsHide: true })
      let output = ''
      child.stdout.on('data', data => { output += data })
      child.stderr.on('data', data => { output += data })
      const timer = setTimeout(() => { child.kill(); reject(Error('Live Finnhub probe timed out')) }, process.argv.includes('--stream') ? 90_000 : 45_000)
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('exit', code => { clearTimeout(timer); done({ code, output }) })
    })
    assert.equal(result.code, 0, result.output)
    console.log(result.output)
  }
} finally {
  globalThis.fetch = original.fetch
  Object.assign(yahoo, { chart: original.chart })
  hyperliquidEquities.getQuote = original.quote
  finnhubQuotes.setCredentialLoader(async () => undefined)
  closeYahooWorker()
  await cache.close()
  for (const name of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (previous[name] === undefined) delete process.env[name]
    else process.env[name] = previous[name]
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
