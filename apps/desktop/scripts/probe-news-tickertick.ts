import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { cache } from '../electron/services/cache.js'
import { yahoo } from '../electron/services/yahoo/client.js'
import { yahooProvider } from '../electron/services/provider.js'
import { getTickerNews } from '../electron/services/news/tickers.js'
import { fetchTickerTickMarket, fetchTickerTickNews, parseTickerTickFeed, tickerTickRateGate,
  tickerTickSymbol, TickerTickRateGate } from '../electron/services/news/tickerTick.js'

export async function runTickerTickChecks(): Promise<void> {
  let now = 100_000
  const gate = new TickerTickRateGate(() => now, async ms => { now += ms })
  let admitted = 0
  const first = await Promise.allSettled(Array.from({ length: 6 }, () => gate.run(async () => ++admitted)))
  assert.equal(admitted, 5, 'No more than five requests may start in any 30-second window')
  assert.equal(first.filter(result => result.status === 'rejected').length, 1, 'Overflow must fail fast for fallback')
  now += 30_001
  await Promise.all(Array.from({ length: 5 }, () => gate.run(async () => ++admitted)))
  assert.equal(admitted, 10)
  await assert.rejects(gate.run(async () => ++admitted), /budget busy/)
  now += 30_001
  await gate.run(async () => ++admitted)
  gate.cooldown(60_000)
  await assert.rejects(gate.run(async () => ++admitted), /cooldown/)
  now += 60_001
  await gate.run(async () => ++admitted)
  let waitingNow = 100_000
  const waitingGate = new TickerTickRateGate(() => waitingNow, async ms => { waitingNow += ms })
  await Promise.all(Array.from({ length: 5 }, () => waitingGate.run(async () => {})))
  waitingNow += 25_000
  await waitingGate.run(async () => {})
  assert(waitingNow >= 130_001, 'Near-boundary admission must wait until the rolling window opens')

  assert.equal(tickerTickSymbol('brk-b'), 'brk.b')
  for (const value of ['^VIX', 'CL=F', 'DX-Y.NYB', 'AAPL) (or tt:TSLA', '0700.HK']) {
    assert.equal(tickerTickSymbol(value), null, value)
  }
  const publishedAt = Date.now() - 7 * 86_400_000
  const story = { id: '-6844326865886118959', title: '<b>Company earnings</b>', site: 'publisher.example',
    time: publishedAt, url: 'https://publisher.example/story', description: 'Revenue &amp; profit grow.',
    tags: ['aapl'], tickers: ['msft'], favicon_url: 'https://static.tickertick.com/icon.ico' }
  assert.equal(parseTickerTickFeed({ stories: [story] })[0]!.id, story.id)
  assert.deepEqual(parseTickerTickFeed([story])[0]!.tickers, ['MSFT', 'AAPL'])
  assert.equal(parseTickerTickFeed([story])[0]!.title, 'Company earnings')
  assert.throws(() => parseTickerTickFeed({ error: 'provider unavailable' }), /invalid news feed/)
  for (const url of ['javascript:alert(1)', 'http://127.0.0.1/', 'https://user:password@publisher.example/', 'http://localhost/']) {
    assert.throws(() => parseTickerTickFeed({ stories: [{ ...story, url }] }), /no valid/)
  }
  assert.throws(() => parseTickerTickFeed([{ ...story, time: '2026-11-13' }]), /no valid/)
  assert.throws(() => parseTickerTickFeed([{ ...story, time: Infinity }]), /no valid/)
  assert.deepEqual(parseTickerTickFeed({ stories: [] }), [])

  await cache.clear()
  let requests = 0, searches = 0
  let mode: 'ok' | 'empty' | 'http' | 'malformed' | 'offline' | 'limited' = 'ok'
  let yahooOffline = false
  const urls: URL[] = []
  const rate = mock.method(tickerTickRateGate, 'run', async (task: () => Promise<unknown>) => task())
  const cooldown = mock.method(tickerTickRateGate, 'cooldown')
  const search = mock.method(yahoo, 'search', async (symbol: string) => {
    searches++
    if (yahooOffline) throw new Error('Fixture Yahoo unavailable')
    return { news: [{ uuid: `yahoo-${symbol}`, title: 'Yahoo fallback headline', publisher: 'Yahoo fixture',
      relatedTickers: [symbol], providerPublishTime: new Date(publishedAt), link: `https://publisher.example/yahoo/${symbol}` }] }
  })
  const feed = mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    requests++
    const url = new URL(String(input)); urls.push(url)
    assert.equal(url.origin, 'https://api.tickertick.com')
    assert.equal(url.searchParams.get('n'), '200')
    if (mode === 'offline') throw new Error('Fixture TickerTick unavailable')
    if (mode === 'http') return new Response('Unavailable', { status: 503 })
    if (mode === 'limited') return new Response('Too many requests', { status: 429, headers: { 'retry-after': '60' } })
    if (mode === 'malformed') return Response.json({ error: 'invalid feed' })
    if (mode === 'empty') return Response.json({ stories: [] })
    const symbols = [...url.searchParams.get('q')!.matchAll(/tt:([a-z0-9.]+)/g)].map(match => match[1]!)
    if (!symbols.length) return Response.json({ stories: [story] })
    return Response.json({ stories: symbols.flatMap(symbol => Array.from({ length: 6 }, (_, i) => ({ ...story,
      id: `${story.id}-${symbol}-${i}`, url: `https://publisher.example/${symbol}/${i}`, tags: [symbol], tickers: [symbol] }))) })
  })
  try {
    const [dashboard, searchResult] = await Promise.all([
      yahooProvider.news({ tickers: ['MSFT', 'aapl', 'AAPL'] }),
      yahooProvider.newsTickerSearch({ tickers: ['AAPL', 'MSFT'] }),
    ])
    assert.equal(requests, 1, 'Concurrent Dashboard/search reads share the sorted batch query')
    assert.equal(searches, 0, 'TickerTick coverage avoids unnecessary Yahoo requests')
    assert.equal(urls[0]!.searchParams.get('q'), '(or tt:aapl tt:msft)')
    assert.equal(dashboard.data.items.length, 4, 'Dashboard keeps two headlines per holding')
    assert.equal(searchResult.data.articles.length, 6, 'Search keeps three headlines per ticker')
    assert(searchResult.data.articles.every(article => article.category === 'search' && article.publishedAt === publishedAt
      && article.imageUrl === '' && article.summary === 'Revenue & profit grow.' && article.score === null))
    assert(dashboard.meta.source.includes('TickerTick') && dashboard.meta.freshness === 'fresh')
    await yahooProvider.news({ tickers: ['AAPL', 'MSFT'] })
    assert.equal(requests, 1, 'Normal reads reuse the feed TTL')
    await yahooProvider.news({ tickers: ['AAPL', 'MSFT'], force: true })
    assert.equal(requests, 2, 'Force refresh reaches the underlying TickerTick feed')
    const market = await fetchTickerTickMarket(false)
    assert.equal(market[0]!.publishedAt, publishedAt)
    assert(market[0]!.score !== null && market[0]!.signals.includes('earnings'), 'Market headlines use existing signal scoring')
    const alias = await getTickerNews(['BRK-B'])
    assert.equal(alias[0]!.articles.length, 6, 'Share-class tickers match normalized provider tags')
    assert(alias[0]!.articles.every(article => article.ticker === 'BRK-B'))

    await cache.clear()
    const beforeBatch = requests
    const many = await getTickerNews(Array.from({ length: 26 }, (_, i) => `T${i}`))
    assert.equal(requests - beforeBatch, 2, 'Large portfolios use bounded 25-symbol batches')
    assert(many.every(outcome => outcome.articles.length === 6))

    for (const failure of ['empty', 'http', 'malformed', 'offline', 'limited'] as const) {
      await cache.clear(); mode = failure
      const result = await yahooProvider.newsTickerSearch({ tickers: ['AAPL'], force: true })
      assert.equal(result.data.articles[0]!.source, 'Yahoo fixture', `${failure}: Yahoo must supply fallback coverage`)
      assert.equal(result.data.failed.length, 0)
      if (failure !== 'empty') {
        assert(result.errors.some(error => error.source === 'TickerTick'), `${failure}: retain the failed provider`)
        assert.notEqual(result.meta.freshness, 'fresh', `${failure}: do not silently label fallback fresh`)
      }
    }
    assert.equal(cooldown.mock.calls.at(-1)!.arguments[0], 60_000, '429 respects Retry-After without retrying')
    await cache.clear(); mode = 'ok'
    const beforeUnsupported = requests
    await getTickerNews(['^VIX', '0700.HK'])
    assert.equal(requests, beforeUnsupported, 'Unsupported symbols go directly to Yahoo')
    await cache.clear(); mode = 'offline'; yahooOffline = true
    const failed = await yahooProvider.newsTickerSearch({ tickers: ['AAPL'], force: true })
    assert.deepEqual(failed.data.failed, ['AAPL'])
    assert.deepEqual(failed.data.empty, [], 'An outage must not claim no matching stories exist')
    assert(failed.errors.some(error => error.source === 'TickerTick') && failed.errors.some(error => error.source === 'yahoo search'))
    console.log('PASS: TickerTick batching, cache sharing, forced refresh, normalization, safe parsing, fallbacks, rolling limits and cooldowns')
  } finally {
    feed.mock.restore(); search.mock.restore(); rate.mock.restore(); cooldown.mock.restore(); await cache.clear()
  }
}

export async function runTickerTickLiveChecks(): Promise<void> {
  const [tickers, market] = await Promise.all([
    fetchTickerTickNews(['AAPL', 'MSFT'], true), fetchTickerTickMarket(true),
  ])
  for (const symbol of ['AAPL', 'MSFT']) {
    const articles = tickers.get(symbol)!
    assert(articles.length > 0, `Live TickerTick returned no ${symbol} headlines`)
    assert(articles.every(article => article.source && article.publishedAt > 0 && article.url.startsWith('http')))
    console.log(`PASS: live ${symbol}: ${articles.length} headlines, latest published ${new Date(articles[0]!.publishedAt).toISOString()}`)
  }
  assert(market.length > 0 && market.every(article => article.score !== null))
  console.log(`PASS: live TickerTick market feed: ${market.length} scored headlines`)
}
