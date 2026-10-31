import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import type { ChartPayload, CryptoPayload, EquityMarketUpdate, Portfolio, QuotesPayload } from '../electron/shared/contract.js'
import { EQUITY_MARKETS, equityMarket } from '../electron/shared/equityMarkets.js'
import { buildPositionRows, summarizePortfolio } from '../electron/shared/portfolioMath.js'
import { ok } from '../electron/shared/envelope.js'
import { cache } from '../electron/services/cache.js'
import { HyperliquidEquities, hyperliquidEquities, equityQuoteFromContext, parseEquityCandles } from '../electron/services/hyperliquidEquities.js'
import { getQuote, getQuotes } from '../electron/services/yahoo/quotes.js'
import { yahoo, closeYahooWorker } from '../electron/services/yahoo/client.js'
import { getChartsHistory } from '../electron/services/yahoo/chartsPage.js'
import { getMarketSeries } from '../electron/services/marketSeries.js'
import { getChart } from '../electron/services/yahoo/chart.js'
import { captureSources, observeSource } from '../electron/services/sourceHealth.js'
import { markEquityScreenRows } from '../electron/services/equityScreenMarks.js'
import { applyEquityMarketUpdate, mergeStreamCandle } from '../src/api/equityStream.js'
import { HyperliquidRateGate } from '../electron/services/hyperliquidRateGate.js'
import { HyperliquidClient, hyperliquidClient } from '../electron/services/hyperliquid.js'

const market = 'xyz:AAPL'
const context = { markPx: '110', prevDayPx: '100' }
const mark = equityQuoteFromContext('AAPL', market, context, Date.now())
const portfolio: Portfolio = { id: 'fixture', name: 'Fixture', tickers: ['AAPL'],
  holdings: { AAPL: { ticker: 'AAPL', shares: 2, avgPrice: 80, includeInWeight: true } },
  cashBalance: 0, marginDebt: 0, options: [], includeCashInWeight: false, readOnly: false }

class TestSocket extends EventTarget {
  readyState = 0
  sent: Array<Record<string, unknown>> = []
  send(value: string): void { this.sent.push(JSON.parse(value)) }
  open(): void {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }
  message(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })) }
  close(): void {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

async function offline(): Promise<void> {
  const gate = new HyperliquidRateGate({ concurrency: 2 })
  const starts: string[] = []
  let release!: () => void
  const first = gate.run(1, async () => { starts.push('first'); await new Promise<void>(resolve => { release = resolve }) })
  const second = gate.run(1, async () => { starts.push('second') })
  await second
  assert.deepEqual(starts, ['first', 'second'], 'Independent requests must burst without a fixed inter-request delay')
  const background = gate.run(1, async () => { starts.push('background') }, 'background')
  const foreground = gate.run(1, async () => { starts.push('foreground') })
  release()
  await Promise.all([first, background, foreground])
  let quotaNow = 0
  const quotaGate = new HyperliquidRateGate({ weightLimit: 2, windowMs: 45, now: () => quotaNow })
  await quotaGate.run(2, async () => {})
  let extraStarted = false
  const extra = quotaGate.run(1, async () => { extraStarted = true })
  await Promise.resolve()
  assert.equal(extraStarted, false, 'Weighted work above the window budget must wait')
  quotaNow = 45
  await extra
  assert.equal(extraStarted, true, 'Waiting work must resume when the rolling budget frees')
  const serialGate = new HyperliquidRateGate({ concurrency: 1 })
  let unblock!: () => void
  const order: string[] = []
  const occupied = serialGate.run(1, () => new Promise<void>(resolve => { unblock = resolve }))
  await Promise.resolve()
  const queuedBackground = serialGate.run(1, async () => { order.push('background') }, 'background')
  const queuedForeground = serialGate.run(1, async () => { order.push('foreground') })
  unblock()
  await Promise.all([occupied, queuedBackground, queuedForeground])
  assert.deepEqual(order, ['foreground', 'background'], 'Ticker switches must precede queued startup requests')
  const reservedGate = new HyperliquidRateGate({ weightLimit: 5, windowMs: 45 })
  await reservedGate.run(4, async () => {}, 'background')
  const reservedOrder: string[] = []
  const waitingStartup = reservedGate.run(1, async () => { reservedOrder.push('startup') }, 'background')
  await reservedGate.run(1, async () => { reservedOrder.push('ticker') })
  assert.deepEqual(reservedOrder, ['ticker'], 'Startup must leave rate budget for an immediate ticker switch')
  await waitingStartup
  const fairGate = new HyperliquidRateGate({ weightLimit: 10, windowMs: 45 })
  for (let index = 0; index < 4; index++) await fairGate.run(1, async () => {})
  const fairOrder: string[] = []
  const heavyStartup = fairGate.run(5, async () => { fairOrder.push('startup') }, 'background')
  await fairGate.run(1, async () => { fairOrder.push('ticker') })
  assert.deepEqual(fairOrder, ['ticker'], 'Background fairness must not block foreground use of its reserved budget')
  await heavyStartup
  assert.equal(equityMarket(' sofi '), 'para:SOFI')
  assert.equal(equityMarket('VST'), 'para:VST')
  for (const symbol of ['COHR', 'CRDO', 'STX', 'TER', 'CIEN', 'MELI', 'SMCI', 'TTWO', 'CIFR']) assert.equal(equityMarket(symbol), `para:${symbol}`)
  assert.equal(equityMarket('STRC'), 'xyz:STRC')
  for (const symbol of ['CL', 'GOLD', 'BTC', 'JPY', 'SPY', 'GOOG', 'UNKNOWN']) assert.equal(equityMarket(symbol), undefined)
  assert.equal(mark.price, 110)
  assert.equal(mark.change, 10)
  assert.equal(mark.currency, 'USD')
  assert.equal(mark.changeBasis, '24h')
  assert.equal(mark.priceBasis, 'equity-perp-mark')
  assert.throws(() => equityQuoteFromContext('AAPL', market, { markPx: '1', prevDayPx: '0' }, 1), /Incomplete/)
  assert.throws(() => equityQuoteFromContext('AAPL', market, { markPx: '1e300', prevDayPx: '1e-300' }, 1), /Invalid/)
  const barTime = Math.floor(Date.now() / 3600_000) * 3600_000
  const bar = { s: market, i: '1h', t: barTime, o: '100', h: '112', l: '99', c: '110', v: '3' }
  const candle = parseEquityCandles([bar], market, '1h')[0]
  assert.equal(candle.time, barTime / 1000)
  assert.equal(candle.volume, 3, 'Perp volume is contracts/base units, never stock-share volume')
  assert.throws(() => parseEquityCandles([{ ...bar, s: 'xyz:NVDA' }], market, '1h'), /Invalid/)
  assert.throws(() => parseEquityCandles([{ ...bar, h: '90' }], market, '1h'), /Invalid/)

  await cache.clear()
  let now = Date.now()
  let requests = 0
  const sockets: TestSocket[] = []
  const client = new HyperliquidEquities(async (_url, options) => {
    requests += 1
    const body = JSON.parse(String(options?.body))
    assert.ok(options?.signal)
    if (body.type === 'candleSnapshot') return Response.json([bar])
    assert.deepEqual(body, { type: 'metaAndAssetCtxs', dex: 'xyz' })
    return Response.json([{ universe: [{ name: market }, { name: 'xyz:NVDA' }] }, [context, { markPx: '200', prevDayPx: '200' }]])
  }, () => now, () => {
    const socket = new TestSocket()
    sockets.push(socket)
    return socket as unknown as WebSocket
  })
  client.start()
  const [aapl, nvda] = await Promise.all([client.getQuote('AAPL'), client.getQuote('NVDA')])
  assert.equal(aapl.price, 110)
  assert.equal(nvda.price, 200)
  assert.equal(requests, 1, 'All stock quotes on a dex share one metadata/context snapshot')
  sockets[0].open()
  assert.equal(sockets[0].sent.filter(item => item.method === 'subscribe').length, 2)
  let update: EquityMarketUpdate | undefined
  const stop = client.subscribe(value => { update = value })
  sockets[0].message({ channel: 'activeAssetCtx', data: { coin: market, ctx: { markPx: '120', prevDayPx: '100' } } })
  assert.equal((await client.getQuote('AAPL', true)).price, 120, 'Stream marks must bypass REST/cache latency')
  assert.equal(requests, 1)
  const candles = await client.getCandles('AAPL', new Date(barTime), '1h')
  assert.equal(candles.market, market)
  sockets[0].message({ channel: 'candle', data: { ...bar, c: '111' } })
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(update?.quotes[0].price, 120)
  assert.equal(update?.candles[0].candle.close, 111)
  assert.equal((await client.getCandles('AAPL', new Date(barTime), '1h')).candles.at(-1)?.close, 111, 'A cached REST response must not rewind a streamed candle')
  const cryptoMetadata = { universe: [{ name: 'BTC' }] }
  const cryptoContext = { markPx: '101', prevDayPx: '100', funding: '0.00001', openInterest: '3', dayNtlVlm: '500' }
  let cryptoRequests = 0
  const cryptoClient = new HyperliquidClient(async () => {
    cryptoRequests++
    return Response.json([cryptoMetadata, [cryptoContext]])
  }, () => now, undefined, client)
  await cryptoClient.getMarkets()
  assert.equal(sockets.length, 1, 'Crypto and equities must share one connection')
  assert.equal(sockets[0].sent.filter(item => (item.subscription as { type?: string } | undefined)?.type === 'allDexsAssetCtxs').length, 1)
  sockets[0].message({ channel: 'allDexsAssetCtxs', data: { ctxs: [['', [cryptoContext]]] } })
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(update?.hyperliquid?.markets[0].markPrice, 101)
  await cryptoClient.getMarkets()
  assert.equal(cryptoRequests, 1, 'Healthy live contexts must avoid periodic REST polling')
  now += 16_000
  assert.equal(client.getCryptoMarkets(), null, 'Stale contexts must not be returned as live')
  await cryptoClient.getMarkets()
  assert.equal(cryptoRequests, 2, 'Stalled feeds must recover through REST')
  sockets[0].message({ channel: 'allDexsAssetCtxs', data: { ctxs: [['', [cryptoContext, cryptoContext]]] } })
  assert.equal(client.getCryptoMarkets(), null, 'Universe changes require metadata refresh before index alignment')
  sockets[0].message({ channel: 'allDexsAssetCtxs', data: { ctxs: [['', [cryptoContext]]] } })
  sockets[0].close()
  assert.equal(client.getCryptoMarkets(), null, 'Disconnect discards crypto observations')
  assert.equal((await client.getQuote('AAPL')).price, 110, 'Disconnect must discard the old stream observation')
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal(sockets.length, 2)
  sockets[1].open()
  assert.ok(sockets[1].sent.some(item => (item.subscription as { type: string }).type === 'candle'), 'Reconnect restores candle subscriptions')
  assert.ok(sockets[1].sent.some(item => (item.subscription as { type: string }).type === 'allDexsAssetCtxs'), 'Reconnect restores shared crypto contexts')
  stop()
  client.close()
  await assert.rejects(client.getCandles('AAPL', new Date(now - 6_000 * 60_000), '1m'), /5,000/)

  await cache.clear()
  const candleRequests: Array<{ startTime: number }> = []
  let responseBars = [0, 1, 2].map(offset => ({ ...bar, t: barTime - (2 - offset) * 3600_000 }))
  const historyClient = new HyperliquidEquities(async (_url, options) => {
    const body = JSON.parse(String(options?.body))
    candleRequests.push(body.req)
    return Response.json(responseBars)
  }, () => now)
  const firstHistory = await historyClient.getCandles('AAPL', new Date(barTime - 2 * 3600_000), '1h')
  assert.equal(firstHistory.candles.length, 3)
  assert.equal((await historyClient.getCandles('AAPL', new Date(barTime - 3600_000), '1h')).fromCache, true)
  assert.equal(candleRequests.length, 1, 'Ticker revisits and smaller ranges reuse one canonical series')
  const historyKey = `hyperliquid:equities:candles:v2:${market}:1h`
  const document = await cache.get(historyKey)
  await cache.set(historyKey, document!.value, -1)
  now += 3600_000
  responseBars = [{ ...bar, c: '111' }, { ...bar, t: barTime + 3600_000, c: '112' }]
  const extended = await historyClient.getCandles('AAPL', new Date(barTime - 2 * 3600_000), '1h')
  assert.equal(candleRequests.at(-1)?.startTime, barTime - 3600_000, 'Expired histories refresh only an overlapping tail')
  assert.equal(extended.candles.length, 4, 'Incremental updates retain older candles')
  assert.equal(extended.candles.at(-2)?.close, 111, 'Overlapping candles replace old observations')
  const longStart = new Date(barTime - 10 * 3600_000)
  await assert.rejects(historyClient.getCandles('AAPL', longStart, '1h'), /cover/)
  const attempts = candleRequests.length
  await assert.rejects(historyClient.getCandles('AAPL', longStart, '1h'), /cover/)
  assert.equal(candleRequests.length, attempts, 'Known listing boundaries must not redownload on each stock-history fallback')
  assert.ok((await historyClient.getCandles('AAPL', longStart, '1h', false, false)).candles.length)
  historyClient.close()

  await cache.clear()
  const joinedStarts: number[] = []
  let completeNarrow!: () => void
  let narrowStarted!: () => void
  const startedNarrow = new Promise<void>(resolve => { narrowStarted = resolve })
  const joinedClient = new HyperliquidEquities(async (_url, options) => {
    const body = JSON.parse(String(options?.body))
    joinedStarts.push(body.req.startTime)
    if (joinedStarts.length === 1) {
      narrowStarted()
      await new Promise<void>(resolve => { completeNarrow = resolve })
    }
    return Response.json([-3, -2, -1, 0, 1].filter(offset => barTime + offset * 3600_000 >= body.req.startTime)
      .map(offset => ({ ...bar, t: barTime + offset * 3600_000 })))
  }, () => now)
  const narrow = joinedClient.getCandles('AAPL', new Date(barTime), '1h')
  await startedNarrow
  const wide = joinedClient.getCandles('AAPL', new Date(barTime - 3 * 3600_000), '1h')
  completeNarrow()
  const [narrowResult, wideResult] = await Promise.all([narrow, wide])
  assert.equal(narrowResult.candles.length, 3)
  assert.equal(wideResult.candles.length, 5, 'A wider request joining a narrow in-flight load must extend coverage')
  assert.equal(joinedStarts.length, 2, 'Concurrent ranges extend the shared series once')
  joinedClient.close()

  await cache.clear()
  const throttled = new HyperliquidEquities(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }), () => now)
  await assert.rejects(throttled.getQuote('AAPL', true), /429/)
  await cache.clear()
  await assert.rejects(throttled.getQuote('AAPL', true), /cooldown/)
  throttled.close()
  await cache.clear()

  const hQuote = mock.method(hyperliquidEquities, 'getQuote', async (symbol: string) => {
    observeSource({ fetchedAt: Date.now(), expiresAt: Date.now() + 15_000, stale: false, fromCache: false, failures: [] })
    return { ...mark, symbol }
  })
  let yahooCalls = 0
  const yChart = mock.method(yahoo, 'chart', async () => {
    yahooCalls += 1
    return { quotes: [{ date: new Date(Date.now() - 86_400_000), close: 90 }, { date: new Date(), close: 95 }], meta: { regularMarketPrice: 95, previousClose: 90, currency: 'USD' } }
  })
  const hCandles = mock.method(hyperliquidEquities, 'getCandles', async () => {
    observeSource({ fetchedAt: Date.now(), expiresAt: Date.now() + 300_000, stale: false, fromCache: false, failures: [] })
    return { candles: [candle], market, source: mark.source!, fromCache: false, stale: false, cacheAgeSeconds: 0 }
  })
  try {
    const quotes = await getQuotes(['AAPL', 'UNMAPPED'], true)
    assert.equal(quotes.quotes.AAPL.price, 110)
    assert.equal(quotes.quotes.UNMAPPED.price, 95)
    assert.equal(yahooCalls, 1, 'Mapped quotes must not request Yahoo prices')
    const originalRows = [{ ticker: 'AAPL', price: 1, marketCap: 100 }, { ticker: 'UNMAPPED', price: 95, marketCap: 200 }]
    const markedRows = await markEquityScreenRows(originalRows)
    assert.equal(markedRows.rows[0].price, 110)
    assert.equal(markedRows.rows[1].price, 95)
    assert.equal(markedRows.rows[0].marketCap, 100, 'Updating a displayed mark must not rewrite screener fundamentals or ranks')
    assert.equal(originalRows[0].price, 1, 'Cached screener snapshots must remain immutable')
    assert.equal(yahooCalls, 1, 'Unmapped screener prices must not require extra quote requests')
    const rows = buildPositionRows(portfolio, quotes.quotes, {})
    assert.equal(rows[0].marketValue, 220)
    assert.equal(rows[0].dollarGain, 60)
    assert.equal(rows[0].priceSource, mark.source)
    assert.equal(summarizePortfolio(portfolio, rows).stockValue, 220)
    const history = await getChartsHistory({ symbol: 'AAPL', interval: '1 Hour', range: '1D', force: true })
    assert.equal(history.payload.stats?.market, market)
    assert.equal(history.payload.stats?.price, 110)
    assert.equal(yahooCalls, 1, 'A covered perp chart and its indicators must not request Yahoo candles')
    for (const load of [
      () => getChartsHistory({ symbol: 'AAPL', interval: '1 Hour', range: '1D', force: true }),
      () => getChart('AAPL', '1 Hour', true),
    ]) {
      const captured = await captureSources<unknown>(load)
      assert(captured.snapshot!.expiresAt! > Date.now() + 290_000,
        'Independent 15-second header marks must not expire chart history or its indicators')
    }
    const fourHour = await getChartsHistory({ symbol: 'AAPL', interval: '4 Hours', range: '1D', force: true })
    assert.equal(fourHour.payload.interval, '4h')
    assert.equal(fourHour.payload.candles[0].time, candle.time)
    assert.ok(hCandles.mock.calls.some(call => call.arguments[2] === '4h'), 'Perp 4h charts must request native bars, not stock-session aggregation')
    let resolveQuote!: (quote: typeof mark) => void
    hQuote.mock.mockImplementation(() => new Promise<typeof mark>(resolve => { resolveQuote = resolve }))
    const withoutMark = await Promise.race([
      getChartsHistory({ symbol: 'AAPL', interval: '1 Hour', range: '1D', force: true }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Chart blocked on the independent current mark')), 1000).unref()),
    ])
    assert.ok(withoutMark.payload.candles.length, 'A slow current quote must not hold back usable chart history')
    assert.equal(withoutMark.payload.stats?.priceSource, undefined, 'Pending marks must not mislabel a candle close')
    resolveQuote(mark)
    hCandles.mock.mockImplementation(async () => { throw new Error('History does not cover requested start') })
    const long = await getMarketSeries({ symbol: 'AAPL', start: new Date(Date.now() - 5 * 365 * 86400_000), interval: '1d', force: true })
    assert.match((long.meta as { source: string }).source, /Yahoo stock history/)
    assert.ok(long.rows.every(row => row.close !== 110), 'Stock history must remain a separate whole series')
    await assert.rejects(getMarketSeries({ symbol: 'AAPL', start: new Date(), interval: '1d', sourceMarket: market }), /cover/)
    hQuote.mock.mockImplementation(async () => { throw new Error('HTTP 429') })
    const fallback = await getQuote('AAPL', true)
    assert.equal(fallback.price, 95)
    assert.match(fallback.source!, /fallback/)
    assert.match(fallback.fallbackReason!, /429/)
  } finally {
    hQuote.mock.restore()
    hCandles.mock.restore()
    yChart.mock.restore()
  }

  const queryClient = new QueryClient()
  const crypto: CryptoPayload = { fetchedAt: 'old', heatmap: { tiles: [], coverage: { loaded: 0, total: 30 }, updatedAt: 'old' },
    global: null, fearGreed: null, news: [], hyperliquid: null,
    progress: { heatmap: 'unavailable', quotes: 'loaded', market: 'unavailable', news: 'unavailable', hyperliquid: 'unavailable' },
    quotes: {
      BTC: { label: 'BTC', symbol: 'BTC-USD', name: 'Bitcoin', price: 99, changePct: 1, volume: 11, marketCap: 1000, source: 'CoinGecko' },
      ETH: { label: 'ETH', symbol: 'ETH-USD', name: 'Ethereum', price: 10, changePct: 1, volume: 12, marketCap: 2000, source: 'Hyperliquid crypto perp', volumeSource: 'Hyperliquid perpetual 24h volume (USD)' },
    } }
  queryClient.setQueryData(['crypto'], ok(crypto, 'fixture'), { updatedAt: 1000 })
  applyEquityMarketUpdate(queryClient, { quotes: [], candles: [], hyperliquid: { fetchedAt: 'new', markets: ['BTC', 'ETH'].map(symbol => ({ symbol,
    markPrice: 110, changePct: 10, fundingHourlyPct: 0.001, openInterestUsd: 330, volume24hUsd: 500 })) } })
  const streamedCrypto = queryClient.getQueryData<ReturnType<typeof ok<CryptoPayload>>>(['crypto'])!.data
  assert.equal(streamedCrypto.quotes.BTC.price, 99, 'Live perps must not overwrite spot quotes')
  assert.equal(streamedCrypto.quotes.ETH.price, 110)
  assert.equal(streamedCrypto.quotes.ETH.marketCap, 2000, 'Live perps must not overwrite global market cap')
  assert.equal(streamedCrypto.quotes.ETH.volume, 500)
  assert.equal(streamedCrypto.progress.hyperliquid, 'unavailable', 'One live source must not hide a startup stage failure')
  assert.equal(queryClient.getQueryState(['crypto'])?.dataUpdatedAt, 1000)
  const quoteEnvelope = ok<QuotesPayload>({ macro: {}, holdings: { AAPL: mark }, missing: [] }, 'fixture')
  const chart: ChartPayload = { symbol: 'AAPL', timeframe: '1 Hour', interval: '1h', candles: [candle],
    stats: { symbol: 'AAPL', price: 110, change: 10, absChange: 10, open: 100, high: 112, low: 99, close: 110, volume: 3, currency: 'USD', longName: 'AAPL perp', market },
    indicators: { ma200: [], rsi: [], rsiMa: [] } }
  queryClient.setQueryData(['quotes', 'AAPL'], quoteEnvelope, { updatedAt: 1000 })
  queryClient.setQueryData(['chart', 'AAPL', '1 Hour'], ok(chart, 'fixture'))
  queryClient.setQueryData(['marketCap'], ok({ rows: [{ ticker: 'AAPL', price: 100, marketCap: 500 }], source: 'Yahoo candidates' }, 'fixture'))
  const changes = { '1D': 1 }
  queryClient.setQueryData(['heatmap'], ok({ holdings: [{ symbol: 'AAPL', price: 100, changes }] }, 'fixture'))
  applyEquityMarketUpdate(queryClient, { quotes: [{ ...mark, price: 120 }], candles: [{ symbol: 'AAPL', market, interval: '1h', candle: { ...candle, close: 111 } }] })
  assert.equal(queryClient.getQueryData<typeof quoteEnvelope>(['quotes', 'AAPL'])?.data.holdings.AAPL.price, 120)
  assert.equal(queryClient.getQueryState(['quotes', 'AAPL'])?.dataUpdatedAt, 1000, 'Streaming one quote must not extend other cached sources')
  assert.equal(queryClient.getQueryData<{ data: { rows: Array<{ price: number; marketCap: number }> } }>(['marketCap'])?.data.rows[0].price, 120)
  assert.equal(queryClient.getQueryData<{ data: { rows: Array<{ marketCap: number }> } }>(['marketCap'])?.data.rows[0].marketCap, 500)
  assert.equal(queryClient.getQueryData<{ data: { holdings: Array<{ price: number; changes: unknown }> } }>(['heatmap'])?.data.holdings[0].price, 120)
  assert.equal(queryClient.getQueryData<{ data: { holdings: Array<{ changes: unknown }> } }>(['heatmap'])?.data.holdings[0].changes, changes, 'A live perp mark must not fabricate stock historical returns')
  assert.equal(queryClient.getQueryData<ReturnType<typeof ok<ChartPayload>>>(['chart', 'AAPL', '1 Hour'])?.data.candles[0].close, 111)
  queryClient.setQueryData(['chart', 'AAPL', '1 Hour'], ok({ ...chart, stats: { ...chart.stats!, market: undefined } }, 'Yahoo stock history'))
  applyEquityMarketUpdate(queryClient, { quotes: [], candles: [{ symbol: 'AAPL', market, interval: '1h', candle: { ...candle, close: 200 } }] })
  assert.equal(queryClient.getQueryData<ReturnType<typeof ok<ChartPayload>>>(['chart', 'AAPL', '1 Hour'])?.data.candles[0].close, 110, 'A stock chart must reject perp candles')
  assert.equal(mergeStreamCandle([candle], { ...candle, time: candle.time - 1 })[0], candle)
  queryClient.clear()
  console.log('PASS: explicit mappings, mark/24h units, shared snapshots, streaming, reconnect, candle validation, rate limits, quote/history fallbacks, portfolio values and renderer cache provenance.')
}

async function live(): Promise<void> {
  await cache.clear()
  const samples = ['NVDA', 'SOFI', 'VST', 'COHR', 'CRDO', 'STX', 'TER', 'CIEN', 'MELI', 'SMCI', 'TTWO', 'CIFR', 'STRC']
  for (const symbol of samples) {
    const quote = await hyperliquidEquities.getQuote(symbol)
    assert.equal(quote.market, EQUITY_MARKETS[symbol])
    assert.ok(quote.price > 0)
    console.log(`Live quote verified: ${symbol} → ${quote.market}`)
  }
  const history = await hyperliquidEquities.getCandles('NVDA', new Date(Date.now() - 24 * 3600_000), '1h', true)
  assert.ok(history.candles.length >= 24)
  const fourHour = await hyperliquidEquities.getCandles('NVDA', new Date(Date.now() - 24 * 3600_000), '4h', true)
  assert.ok(fourHour.candles.length >= 6)
  assert.ok(fourHour.candles.every(candle => candle.time % (4 * 3600) === 0), 'Native perp bars use UTC opening timestamps')
  const crypto = await hyperliquidClient.getMarkets()
  assert.ok(crypto.markets.some(row => row.symbol === 'BTC'))
  const streamed = new Promise<void>((resolve, reject) => {
    let quoteSeen = false
    let candleSeen = false
    let cryptoSeen = false
    const timer = setTimeout(() => reject(new Error('Live equity stream timed out')), 15_000)
    const stop = hyperliquidEquities.subscribe(update => {
      quoteSeen ||= update.quotes.some(quote => quote.symbol === 'NVDA')
      candleSeen ||= update.candles.some(event => event.symbol === 'NVDA')
      cryptoSeen ||= Boolean(update.hyperliquid?.markets.some(row => row.symbol === 'BTC'))
      if (quoteSeen && candleSeen && cryptoSeen) {
        clearTimeout(timer)
        stop()
        resolve()
      }
    })
  })
  hyperliquidEquities.start()
  await streamed
  console.log(`PASS: live mapped equity prices, ${history.candles.length} NVDA candles, and shared WebSocket equity/crypto/candle updates.`)
}

async function timings(): Promise<void> {
  await cache.clear()
  hyperliquidEquities.start()
  for (const symbol of ['NVDA', 'AAPL', 'NVDA']) {
    const started = performance.now()
    const result = await getChartsHistory({ symbol, interval: '1 Hour', range: '1M' })
    assert.ok(result.payload.candles.length)
    console.log(`Ticker switch ${symbol}: ${Math.round(performance.now() - started)}ms, ${result.payload.candles.length} candles, cached=${result.fromCache}`)
  }
}

try {
  if (process.argv.includes('--timings')) await timings()
  else {
    await offline()
    if (process.argv.includes('--live')) await live()
  }
} finally {
  hyperliquidEquities.close()
  closeYahooWorker()
  await cache.close()
}
