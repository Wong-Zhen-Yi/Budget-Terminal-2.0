import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const scratch = await mkdtemp(join(tmpdir(), 'budget-provider-'))
const saved = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
const { cache, TtlCache } = await import('../electron/services/cache.js')
const { yahoo, closeYahooWorker } = await import('../electron/services/yahoo/client.js')
const { defeatBeta } = await import('../electron/services/defeatbeta/client.js')
const { getQuotes } = await import('../electron/services/yahoo/quotes.js')
const { getYahooSeries } = await import('../electron/services/yahoo/series.js')
const { fetchSparkCloses } = await import('../electron/services/yahoo/spark.js')
const { withYahooStatements, withYahooSummary } = await import('../electron/services/yahoo/requests.js')
const { fetchCompanyCalendars } = await import('../electron/services/calendar.js')
const { yahooProvider } = await import('../electron/services/provider.js')

async function offline() {
  const original = { chart: yahoo.chart, quote: yahoo.quote, quoteSummary: yahoo.quoteSummary, _fetch: yahoo._fetch, rows: defeatBeta.rows, fetch: globalThis.fetch }
  let otherProviderCalls = 0
  let alternateQuoteCalls = 0
  defeatBeta.rows = async () => { otherProviderCalls += 1; throw new Error('Unselected provider') }
  const dates = [new Date(Date.now() - 86_400_000), new Date()]
  Object.assign(yahoo, {
    chart: async () => ({ quotes: dates.map((date, index) => ({ date, close: 100 + index, open: 100, high: 102, low: 99, volume: 100 })),
      meta: { regularMarketPrice: 101, regularMarketTime: dates[1], currency: 'USD' } }),
    quote: async () => { alternateQuoteCalls += 1; throw new Error('Do not switch endpoints after failure') },
    quoteSummary: async () => ({ assetProfile: { sector: 'Technology' }, price: { quoteType: 'EQUITY' } }),
    _fetch: async () => ({ TEST: { symbol: 'TEST', timestamp: dates.map(date => date.getTime() / 1000), close: [100, 101] } }),
  })
  try {
    const quotes = await yahooProvider.quotes({ holdings: ['TEST'], force: true })
    assert.equal(quotes.data.holdings.TEST.price, 101)
    assert.equal(quotes.data.holdings.TEST.priceBasis, undefined)
    assert(!quotes.meta.source.includes('DefeatBeta'))
    assert.equal((await fetchSparkCloses(['TEST'], '1y', true)).series.TEST.closes.at(-1), 101)
    await withYahooSummary('TEST', async () => ({ price: { regularMarketPrice: 101 } }))
    const statements = await withYahooStatements('TEST', 'annual', new Date(0), async () => [{ totalRevenue: 100 }])
    assert.equal(statements[0].totalRevenue, 100)
    Object.assign(yahoo, { chart: async () => { throw new Error('Yahoo chart unavailable') } })
    const failed = await getQuotes(['NEVER-CACHED'], true)
    assert.deepEqual(failed.missing, ['NEVER-CACHED'])
    assert.match(failed.errors[0].reason, /Yahoo chart unavailable/)
    await assert.rejects(() => getYahooSeries({ symbol: 'NEVER-CACHED', start: new Date(0), interval: '1d' }, new TtlCache()), /Yahoo chart unavailable/)
    await assert.rejects(() => withYahooSummary('TEST', async () => { throw new Error('Yahoo summary unavailable') }), /Yahoo summary unavailable/)
    await assert.rejects(() => withYahooStatements('TEST', 'annual', new Date(0), async () => []), /no annual statements/)
    assert.equal(otherProviderCalls, 0)
    assert.equal(alternateQuoteCalls, 0)

    const requested: string[] = []
    const calendars = await fetchCompanyCalendars(['IAU', 'DRAM', 'TACK', 'AAPL', 'BROKEN'], {
      quotes: async () => ['IAU', 'DRAM', 'TACK'].map(symbol => ({ symbol, quoteType: 'ETF' as const })),
      calendar: async symbol => {
        requested.push(symbol)
        if (symbol === 'BROKEN') throw new Error('Yahoo calendar unavailable')
        return { calendarEvents: {} }
      },
    })
    assert.deepEqual(requested, ['AAPL', 'BROKEN'])
    assert.equal(calendars.errors.length, 1)
    assert.equal(calendars.errors[0].symbol, 'BROKEN')

    globalThis.fetch = async () => new Response('<script>var ytInitialData = {"contents":[]};</script>')
    const emptySearch = await yahooProvider.youtube({ tickers: ['IAU'], force: true })
    assert.equal(emptySearch.meta.freshness, 'fresh')
    assert.equal(emptySearch.errors.length, 0)
    assert(emptySearch.data.warnings.some(warning => warning.includes('no matching')))
    globalThis.fetch = async () => new Response(`<script>var ytInitialData = ${JSON.stringify({ contents: [{ videoRenderer: {
      videoId: 'abcdefghijk', title: { simpleText: 'Low-view result' }, viewCountText: { simpleText: '999 views' },
    } }] })};</script>`)
    const filteredSearch = await yahooProvider.youtube({ tickers: ['IAU'], force: true })
    assert.equal(filteredSearch.meta.freshness, 'fresh')
    assert.equal(filteredSearch.errors.length, 0)
    assert(filteredSearch.data.warnings.some(warning => warning.includes('met the filter')))
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 })
    const failedSearch = await yahooProvider.youtube({ tickers: ['IAU'], force: true })
    assert.equal(failedSearch.meta.freshness, 'partial')
    assert.equal(failedSearch.errors.length, 1)
    const cachedFailure = await yahooProvider.youtube({ tickers: ['IAU'] })
    assert.equal(cachedFailure.errors.length, 1, 'Persisted failures must not become successful empty searches')
    console.log('PASS: Yahoo-only quotes/history/spark/statements, no provider or quote endpoint switch, ETF calendars, empty searches and persisted YouTube failures')
  } finally {
    Object.assign(yahoo, { chart: original.chart, quote: original.quote, quoteSummary: original.quoteSummary, _fetch: original._fetch })
    defeatBeta.rows = original.rows
    globalThis.fetch = original.fetch
    cache.clear()
  }
}

async function live() {
  const quotes = await yahooProvider.quotes({ holdings: ['DRAM', 'TACK', 'IAU'], force: true })
  assert.deepEqual(quotes.data.missing, [], JSON.stringify(quotes.errors))
  assert(!quotes.meta.source.includes('DefeatBeta'))
  console.log('Live Yahoo quotes:', Object.keys(quotes.data.holdings), quotes.meta.freshness)
  const calendars = await fetchCompanyCalendars(['DRAM', 'TACK', 'IAU'])
  assert.deepEqual(calendars.errors, [])
  assert.deepEqual(calendars.events, [])
  console.log('Live Yahoo calendars: ETF instruments correctly excluded')
  for (const symbol of ['SPCX', 'SKHY']) {
    const history = await getYahooSeries({ symbol, start: new Date(Date.now() - 450 * 86_400_000), interval: '1d', force: true })
    const { recentTechnicalListing } = await import('../electron/shared/technicalScreen.js')
    const reason = recentTechnicalListing(history.rows.flatMap(row => row.close === null ? [] : [{ time: row.time, close: row.close }]),
      (history.meta as { firstTradeDate?: unknown } | undefined)?.firstTradeDate)
    console.log(`Live Yahoo ${symbol}: ${history.rows.length} daily bars. ${reason ?? 'Established listing'}`)
  }
  const { getFundamentalsPage } = await import('../electron/services/yahoo/fundamentalsPage.js')
  const fundamentals = await getFundamentalsPage('NBIS', true)
  console.log('Live NBIS:', JSON.stringify({ annualRevenue: fundamentals.payload.annual.revenue.length,
    quarterlyRevenue: fundamentals.payload.quarterly.revenue.length, failures: fundamentals.failures, sec: fundamentals.payload.sec.warnings }))
  assert(fundamentals.payload.quarterly.revenue.length)
  assert.deepEqual(fundamentals.failures, [])
}

try {
  await offline()
  if (process.argv.includes('--live')) await live()
} finally {
  closeYahooWorker()
  cache.close()
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  assert(!relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
