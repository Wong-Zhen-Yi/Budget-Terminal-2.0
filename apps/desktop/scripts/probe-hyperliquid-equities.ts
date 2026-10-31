import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import type { ChartPayload, EquityMarketUpdate, Portfolio, QuotesPayload } from '../electron/shared/contract.js'
import { EQUITY_MARKETS, equityMarket } from '../electron/shared/equityMarkets.js'
import { buildPositionRows, summarizePortfolio } from '../electron/shared/portfolioMath.js'
import { ok } from '../electron/shared/envelope.js'
import { cache } from '../electron/services/cache.js'
import { HyperliquidEquities, hyperliquidEquities, equityQuoteFromContext, parseEquityCandles } from '../electron/services/hyperliquidEquities.js'
import { getQuote, getQuotes } from '../electron/services/yahoo/quotes.js'
import { yahoo, closeYahooWorker } from '../electron/services/yahoo/client.js'
import { getChartsHistory } from '../electron/services/yahoo/chartsPage.js'
import { getMarketSeries } from '../electron/services/marketSeries.js'
import { applyEquityMarketUpdate, mergeStreamCandle } from '../src/api/equityStream.js'

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
  open(): void { this.readyState = 1; this.dispatchEvent(new Event('open')) }
  message(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })) }
  close(): void { this.readyState = 3; this.dispatchEvent(new Event('close')) }
}

async function offline(): Promise<void> {
  assert.equal(equityMarket(' sofi '), 'para:SOFI')
  assert.equal(equityMarket('VST'), 'para:VST')
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
  }, () => now, () => { const socket = new TestSocket(); sockets.push(socket); return socket as unknown as WebSocket }, async ms => { now += ms })
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
  sockets[0].close()
  assert.equal((await client.getQuote('AAPL')).price, 110, 'Disconnect must discard the old stream observation')
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal(sockets.length, 2)
  sockets[1].open()
  assert.ok(sockets[1].sent.some(item => (item.subscription as { type: string }).type === 'candle'), 'Reconnect restores candle subscriptions')
  stop()
  client.close()
  await assert.rejects(client.getCandles('AAPL', new Date(now - 6_000 * 60_000), '1m'), /5,000/)

  await cache.clear()
  const throttled = new HyperliquidEquities(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }), () => now)
  await assert.rejects(throttled.getQuote('AAPL', true), /429/)
  await cache.clear()
  await assert.rejects(throttled.getQuote('AAPL', true), /cooldown/)
  throttled.close()
  await cache.clear()

  const hQuote = mock.method(hyperliquidEquities, 'getQuote', async (symbol: string) => ({ ...mark, symbol }))
  let yahooCalls = 0
  const yChart = mock.method(yahoo, 'chart', async () => {
    yahooCalls += 1
    return { quotes: [{ date: new Date(Date.now() - 86_400_000), close: 90 }, { date: new Date(), close: 95 }], meta: { regularMarketPrice: 95, previousClose: 90, currency: 'USD' } }
  })
  const hCandles = mock.method(hyperliquidEquities, 'getCandles', async () => ({ candles: [candle], market, source: mark.source!, fromCache: false, stale: false, cacheAgeSeconds: 0 }))
  try {
    const quotes = await getQuotes(['AAPL', 'UNMAPPED'], true)
    assert.equal(quotes.quotes.AAPL.price, 110)
    assert.equal(quotes.quotes.UNMAPPED.price, 95)
    assert.equal(yahooCalls, 1, 'Mapped quotes must not request Yahoo prices')
    const rows = buildPositionRows(portfolio, quotes.quotes, {})
    assert.equal(rows[0].marketValue, 220)
    assert.equal(rows[0].dollarGain, 60)
    assert.equal(rows[0].priceSource, mark.source)
    assert.equal(summarizePortfolio(portfolio, rows).stockValue, 220)
    const history = await getChartsHistory({ symbol: 'AAPL', interval: '1 Hour', range: '1D', force: true })
    assert.equal(history.payload.stats?.market, market)
    assert.equal(history.payload.stats?.price, 110)
    assert.equal(yahooCalls, 1, 'A covered perp chart and its indicators must not request Yahoo candles')
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
  const quoteEnvelope = ok<QuotesPayload>({ macro: {}, holdings: { AAPL: mark }, missing: [] }, 'fixture')
  const chart: ChartPayload = { symbol: 'AAPL', timeframe: '1 Hour', interval: '1h', candles: [candle],
    stats: { symbol: 'AAPL', price: 110, change: 10, absChange: 10, open: 100, high: 112, low: 99, close: 110, volume: 3, currency: 'USD', longName: 'AAPL perp', market },
    indicators: { ma200: [], rsi: [], rsiMa: [] } }
  queryClient.setQueryData(['quotes', 'AAPL'], quoteEnvelope, { updatedAt: 1000 })
  queryClient.setQueryData(['chart', 'AAPL', '1 Hour'], ok(chart, 'fixture'))
  applyEquityMarketUpdate(queryClient, { quotes: [{ ...mark, price: 120 }], candles: [{ symbol: 'AAPL', market, interval: '1h', candle: { ...candle, close: 111 } }] })
  assert.equal(queryClient.getQueryData<typeof quoteEnvelope>(['quotes', 'AAPL'])?.data.holdings.AAPL.price, 120)
  assert.equal(queryClient.getQueryState(['quotes', 'AAPL'])?.dataUpdatedAt, 1000, 'Streaming one quote must not extend other cached sources')
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
  const samples = ['NVDA', 'SOFI', 'VST']
  for (const symbol of samples) {
    const quote = await hyperliquidEquities.getQuote(symbol)
    assert.equal(quote.market, EQUITY_MARKETS[symbol])
    assert.ok(quote.price > 0)
    console.log(`Live quote verified: ${symbol} → ${quote.market}`)
  }
  const history = await hyperliquidEquities.getCandles('NVDA', new Date(Date.now() - 24 * 3600_000), '1h', true)
  assert.ok(history.candles.length >= 24)
  const streamed = new Promise<void>((resolve, reject) => {
    let quoteSeen = false
    let candleSeen = false
    const timer = setTimeout(() => reject(new Error('Live equity stream timed out')), 15_000)
    const stop = hyperliquidEquities.subscribe(update => {
      quoteSeen ||= update.quotes.some(quote => quote.symbol === 'NVDA')
      candleSeen ||= update.candles.some(event => event.symbol === 'NVDA')
      if (quoteSeen && candleSeen) {
        clearTimeout(timer)
        stop()
        resolve()
      }
    })
  })
  hyperliquidEquities.start()
  await streamed
  console.log(`PASS: live mapped equity prices, ${history.candles.length} NVDA candles, and shared WebSocket quote/candle updates.`)
}

try {
  await offline()
  if (process.argv.includes('--live')) await live()
} finally {
  hyperliquidEquities.close()
  closeYahooWorker()
  await cache.close()
}
