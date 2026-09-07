import assert from 'node:assert/strict'
import type { NewsArticle } from '../electron/shared/contract.js'
import { FOREX_PAIRS, forexPair, forexNumber, selectForexNews, usableForexQuote } from '../electron/shared/forex.js'
import { forexLane, getForexQuotes, getForexHistory, getForexNews } from '../electron/services/forex.js'
import { cache } from '../electron/services/cache.js'
import { quoteFromChart } from '../electron/services/yahoo/quotes.js'

if (process.argv.includes('--offline')) {
  assert.deepEqual(FOREX_PAIRS.map((pair) => pair.symbol), ['EURUSD=X', 'GBPUSD=X', 'JPY=X', 'CHF=X', 'AUDUSD=X', 'CAD=X', 'NZDUSD=X', 'SGD=X', 'EURSGD=X', 'SGDJPY=X'])
  assert.throws(() => forexPair('USD/EUR'))
  assert.equal(forexNumber('EUR/USD', 1.234567), '1.23457')
  assert.equal(forexNumber('SGD/JPY', 115.12345), '115.123')
  assert.equal(forexNumber('USD/SGD', null), '—')
  assert.equal(forexNumber('USD/SGD', NaN), '—')
  const quote = quoteFromChart('SGD=X', { quotes: [{ date: new Date('2026-09-01'), close: 1.25 }, { date: new Date('2026-09-02'), close: 1.26 }] })!
  assert.equal(quote.price, 1.26)
  assert.ok(Math.abs(quote.change - 0.8) < 1e-10)
  assert.equal(usableForexQuote(quote), true)
  assert.equal(usableForexQuote({ ...quote, price: 0 }), false)
  assert.equal(usableForexQuote({ ...quote, change: Infinity }), false)
  const article = (title: string, id: string, publishedAt = 1): NewsArticle => ({ id, title, publishedAt, url: `https://example.com/${id}`, summary: '', source: 'Fixture', time: '', ticker: '', category: 'macro', score: null, signals: [], imageUrl: '' })
  const fed = article('Federal Reserve holds rates', 'fed', 3)
  const ecb = article('ECB signals policy shift', 'ecb', 2)
  const yen = article('Yen gains on Bank of Japan decision', 'yen', 4)
  const unrelated = article('Company reports strong earnings', 'stocks')
  assert.deepEqual(selectForexNews('EUR/USD', [fed, { ...fed, id: 'duplicate' }, ecb, yen, unrelated]).map((row) => row.id), ['fed', 'ecb'])
  assert.deepEqual(selectForexNews('SGD/JPY', [fed, ecb, yen, article('Singapore dollar gains', 'sgd')]).map((row) => row.id), ['yen', 'sgd'])
  assert.equal(selectForexNews('EUR/USD', [{ ...fed, url: 'javascript:alert(1)' }]).length, 0)
  assert.equal(selectForexNews('EUR/USD', [unrelated]).length, 0)
  assert.equal(selectForexNews('EUR/USD', Array.from({ length: 30 }, (_, i) => article(`Euro update number ${i}`, String(i), i))).length, 20)
  const first = await forexLane('probe:forex', 60_000, false, 0, async () => 42)
  const stale = await forexLane('probe:forex', 60_000, true, 0, async () => { throw new Error('offline') })
  assert.equal(stale.data, 42)
  assert.equal(stale.meta.freshness, 'stale')
  assert.ok(Math.abs(stale.meta.fetchedAt - first.meta.fetchedAt) < 2)
  cache.clear()
  const unavailable = await forexLane('probe:missing', 60_000, false, null, async () => { throw new Error('offline') })
  assert.equal(unavailable.data, null)
  assert.equal(unavailable.meta.freshness, 'failed')
  // Seed the underlying quote cache: one invalid pair must not blank the other nine.
  FOREX_PAIRS.forEach((pair, index) => cache.set(`quote:${pair.symbol}`, { ...quote, symbol: pair.symbol, price: index ? 1.26 : 0 }, 60_000))
  const partial = await getForexQuotes()
  assert.equal(partial.meta.freshness, 'partial')
  assert.equal(partial.data.rows.filter((row) => row.quote).length, 9)
  assert.equal(partial.data.rows[0].quote, null)
  assert.equal(partial.errors[0].symbol, 'EUR/USD')
  const invalid = await getForexHistory({ pair: 'EUR/USD', range: 'bad' as '1M' })
  assert.equal(invalid.meta.freshness, 'failed')
  cache.clear()
  cache.set('forex:news-feed:EURUSD=X', [ecb], 300_000)
  await forexLane('forex:news-feed:DX-Y.NYB', 300_000, false, [], async () => { throw new Error('Feed offline') })
  const partialNews = await getForexNews({ pair: 'EUR/USD' })
  assert.equal(partialNews.meta.freshness, 'partial')
  assert.deepEqual(partialNews.data.articles.map((row) => row.id), ['ecb'])
  cache.clear()
  console.log('PASS Forex offline: mappings, direction, precision, relevance, deduplication, stale fallback, partial failure, invalid range')
} else {
  const quotes = await getForexQuotes({ force: true })
  for (const row of quotes.data.rows) console.log(`${row.pair}: ${row.quote?.price ?? 'MISSING'} (${row.freshness})`)
  if (quotes.errors.length) console.log(quotes.errors)
  assert.equal(quotes.data.rows.filter((row) => row.quote).length, 10, 'All ten pairs must have quotes')
  for (const pair of FOREX_PAIRS) {
    const history = await getForexHistory({ pair: pair.id, range: '1M' })
    console.log(`${pair.id}: ${history.data.points.length} history points; ${history.meta.freshness}`)
    assert.ok(history.data.points.length > 0, JSON.stringify(history.errors))
  }
  for (const pair of ['EUR/USD', 'USD/SGD', 'SGD/JPY'] as const) {
    const news = await getForexNews({ pair })
    console.log(`${pair}: ${news.data.articles.length} headlines; ${news.meta.freshness}`, news.errors)
    console.log(news.data.articles.slice(0, 3).map((article) => article.title))
    assert.notEqual(news.meta.freshness, 'failed')
    assert.deepEqual(selectForexNews(pair, news.data.articles), news.data.articles)
  }
  console.log('PASS Forex live sources')
}
