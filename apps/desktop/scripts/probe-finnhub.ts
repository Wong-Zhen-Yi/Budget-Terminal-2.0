import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { QueryClient } from '@tanstack/react-query'

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

try {
  let now = Date.now()
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
  now += 31_000
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
  now += 61_000
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
      const timer = setTimeout(() => { child.kill(); reject(Error('Live Finnhub probe timed out')) }, 45_000)
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
