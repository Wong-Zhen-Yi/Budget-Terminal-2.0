import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const scratch = mkdtempSync(join(tmpdir(), 'bt-correctness-'))
const prior = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch

const { TtlCache, cache, TTL } = await import('../electron/services/cache.js')
const { withSourceEnvelope, observeSource } = await import('../electron/services/sourceHealth.js')
const { ok } = await import('../electron/shared/envelope.js')
const { buildPositionRows, buildPortfolioRows, summarizePortfolio } = await import('../electron/shared/portfolioMath.js')
const { portfolioBreakdown, totalsSeries, totalsCenter, goalNetWorth, optionsEquity } = await import('../electron/shared/financeMath.js')
const { parseTenYearTenor, fetchRiskFreeSnapshot, clearRiskFreeCache } = await import('../electron/services/riskFree.js')
const { parseNyfedRates } = await import('../electron/services/economic.js')
const { ECONOMIC_SERIES } = await import('../electron/shared/economic.js')
const { yahooProvider } = await import('../electron/services/provider.js')
const { getForexQuotes } = await import('../electron/services/forex.js')
const { FOREX_PAIRS } = await import('../electron/shared/forex.js')
const { fetchSparkCloses } = await import('../electron/services/yahoo/spark.js')
const { yahoo } = await import('../electron/services/yahoo/client.js')
const { quoteFromChart } = await import('../electron/services/yahoo/quotes.js')
const realNow = Date.now
const chart = yahoo.chart
const options = yahoo.options
const yahooFetch = yahoo._fetch
const originalFetch = globalThis.fetch
const opened: InstanceType<typeof TtlCache>[] = []

try {
  assert.deepEqual(parseTenYearTenor('Date,10 Yr\n10/05/2026,4.2\n10/06/2026,'), { asOf: '2026-10-05', rate: 4.2 })
  assert.equal(parseTenYearTenor('Date,10 YR\n10/06/2026,N/A'), null)
  assert.deepEqual(parseTenYearTenor('Date,10 YR\n10/06/2026,-0.25'), { asOf: '2026-10-06', rate: -0.25 })
  assert.deepEqual(parseNyfedRates('{"refRates":[{"effectiveDate":"2026-10-06","percentRate":null}]}'), [])
  const ppi = ECONOMIC_SERIES.find(series => series.providerKey === 'WPUFD4')!
  assert.equal(ppi.seriesId, 'PPIFID')
  assert.match(ppi.note!, /not seasonally adjusted/)

  const year = new Date().getFullYear()
  let treasuryNow = Date.UTC(year, 9, 7)
  Date.now = () => treasuryNow
  globalThis.fetch = async input => {
    const url = String(input)
    if (url.includes(`.csv/${year}/`)) return new Response('unavailable', { status: 503 })
    return new Response(`Date,10 Yr\n12/31/${year - 1},4.2`)
  }
  await clearRiskFreeCache()
  const oldTreasury = await withSourceEnvelope(async () => ok(await fetchRiskFreeSnapshot(true)))
  assert.equal(oldTreasury.data?.freshness, 'stale', 'A failed current-year Treasury request cannot label last year fresh')
  assert.equal(oldTreasury.meta.freshness, 'stale')
  assert.equal(oldTreasury.meta.asOf, Date.UTC(year - 1, 11, 31))
  assert.match(oldTreasury.meta.failureReason!, /503/)
  treasuryNow += 5000
  const treasuryMemo = await withSourceEnvelope(async () => ok(await fetchRiskFreeSnapshot()))
  assert.equal(treasuryMemo.meta.fetchedAt, oldTreasury.meta.fetchedAt)
  assert.equal(treasuryMemo.meta.cacheAgeSeconds, 5)
  await clearRiskFreeCache()
  const treasuryDir = join(scratch, 'BudgetTerminalElectron', 'cache', 'risk-free')
  mkdirSync(treasuryDir, { recursive: true })
  writeFileSync(join(treasuryDir, 'us_treasury.json'), JSON.stringify({ version: 1, storedAt: treasuryNow - 6000,
    payload: { riskFreeRate: 4.3, realRate: 1.8, breakevenInflation: 2.5, asOf: `${year}-10-06`,
      tenor: '10Y', freshness: 'fresh', source: 'US Treasury fixture' } }))
  const diskTreasury = await withSourceEnvelope(async () => ok(await fetchRiskFreeSnapshot()))
  assert.equal(diskTreasury.meta.cacheAgeSeconds, 6, 'Treasury disk hits must preserve collection age')
  assert.equal(diskTreasury.meta.asOf, Date.UTC(year, 9, 6))
  assert.equal(diskTreasury.meta.freshness, 'cached')
  await clearRiskFreeCache()
  globalThis.fetch = originalFetch
  Date.now = realNow

  const portfolio = { id: 'fixture', name: 'Fixture', tickers: ['AAPL'], holdings: {
    AAPL: { ticker: 'AAPL', shares: 10, avgPrice: 100, includeInWeight: true },
  }, cashBalance: 25, marginDebt: 0, options: [], includeCashInWeight: true, readOnly: false }
  const rows = buildPositionRows(portfolio, {})
  for (const key of ['price', 'marketValue', 'dollarGain', 'growth', 'weight'] as const) assert.equal(rows[0][key], null)
  const summary = summarizePortfolio(portfolio, rows)
  assert.equal(summary.complete, false)
  assert.deepEqual(summary.missingTickers, ['AAPL'])
  assert.equal(summary.total, 25, 'Only the known cash subtotal is available')
  const weightFixture = { ...portfolio, tickers: ['AVGO', 'OTHER', 'BMNR'], cashBalance: 500,
    holdings: {
      AVGO: { ticker: 'AVGO', shares: 1, avgPrice: 500, includeInWeight: true },
      OTHER: { ticker: 'OTHER', shares: 1, avgPrice: 1000, includeInWeight: true },
      BMNR: { ticker: 'BMNR', shares: 1, avgPrice: 1000, includeInWeight: false },
    } }
  const weightQuotes = Object.fromEntries([['AVGO', 753.02], ['OTHER', 4232.19], ['BMNR', 44108.10]]
    .map(([symbol, price]) => [symbol, { symbol: String(symbol), price: Number(price), change: 0, absChange: 0, currency: 'USD' }]))
  for (const includeCashInWeight of [true, false]) {
    const fixture = { ...weightFixture, includeCashInWeight }
    const expectedWeight = 753.02 / (4985.21 + (includeCashInWeight ? 500 : 0)) * 100
    for (const quotes of [weightQuotes, { AVGO: weightQuotes.AVGO, OTHER: weightQuotes.OTHER }]) {
      const positionRows = buildPositionRows(fixture, quotes)
      const dashboardRows = buildPortfolioRows(fixture, quotes)
      assert.ok(Math.abs(positionRows.find(row => row.ticker === 'AVGO')!.weight! - expectedWeight) < 1e-10)
      assert.equal(dashboardRows.find(row => row.ticker === 'AVGO')!.weight, positionRows.find(row => row.ticker === 'AVGO')!.weight)
      assert.equal(positionRows.find(row => row.ticker === 'BMNR')!.weight, null)
      assert.equal(dashboardRows.find(row => row.ticker === 'BMNR')!.weight, null)
      assert.equal(summarizePortfolio(fixture, positionRows).complete, true, 'Excluded missing quotes cannot invalidate included allocation')
    }
  }
  for (const currency of ['EUR', 'GBp']) {
    const native = { AAPL: { symbol: 'AAPL', price: 100, change: 0, absChange: 0, currency } }
    const nativeRows = buildPositionRows(portfolio, native)
    assert.equal(nativeRows[0].marketValue, null, `${currency} must not be counted as USD`)
    assert.equal(nativeRows[0].dollarGain, null)
    assert.equal(nativeRows[0].weight, null)
    assert.match(nativeRows[0].unavailableReason!, new RegExp(currency))
    assert.equal(summarizePortfolio(portfolio, nativeRows).complete, false)
    const silo = portfolioBreakdown([portfolio], native)[0]
    assert.equal(silo.complete, false)
    assert.equal(silo.stocks, 0)
    assert.match(silo.missingMarks![0], new RegExp(currency))
  }
  const book = { cash: [], debt: [], recurringBills: [], goal: { title: 'Goal', targetAmount: 100, currency: 'USD' as const } }
  assert.equal(goalNetWorth(book, portfolioBreakdown([portfolio], {}), 'USD', null).available, false)
  const negative = [{ id: 'p', name: 'P', stocks: 100, cash: 0, options: 0, marginDebt: 150 }]
  assert.equal(totalsCenter(totalsSeries(book, negative, 'USD', null)), -50)
  assert.equal(goalNetWorth(book, negative, 'USD', null).value, -50)
  const optionFixture = { rowId: 'o', ticker: 'AAPL', expiry: `${year}-12-18`, strike: 100, strategy: 'Covered Call',
    contracts: 1, premium: 10, currentPrice: 3, hasMarketMark: true, note: '', status: 'Open',
    openDate: `${year}-09-01`, volume: 0, openInterest: 0, impliedVolatility: 0 }
  const reconciledPortfolio = { ...portfolio, options: [optionFixture] }
  const optionSummary = summarizePortfolio(reconciledPortfolio, buildPositionRows(reconciledPortfolio,
    { AAPL: { symbol: 'AAPL', price: 120, change: 0, absChange: 0, currency: 'USD' } }))
  const optionSilo = portfolioBreakdown([reconciledPortfolio], { AAPL: { symbol: 'AAPL', price: 120, change: 0, absChange: 0, currency: 'USD' } })
  assert.equal(goalNetWorth(book, optionSilo, 'USD', null).value,
    optionSummary.total + optionsEquity(reconciledPortfolio.options), 'Stock/cash/margin subtotal plus option equity reconciles to Finance net worth')

  let now = realNow()
  Date.now = () => now
  const path = join(scratch, 'provenance.sqlite')
  const first = new TtlCache({ path })
  opened.push(first)
  await first.set('base', 7, 1000)
  now += 60_000
  const initial = await withSourceEnvelope(async () => ok((await first.resolve('derived', 100_000,
    async () => (await first.resolveWithStaleFallback('base', 1000, async () => { throw new Error('fixture offline') })).value)).value))
  assert.equal(initial.meta.freshness, 'stale')
  assert.equal(initial.meta.cacheAgeSeconds, 60)
  assert.match(initial.meta.failureReason!, /fixture offline/)
  await first.set('derived:repaired-fault', 41, 12 * 3600_000, { fetchedAt: now, stale: false,
    fromCache: false, failures: ["signals:liquidity-v5:NVDA:1d:90: Cannot read properties of undefined (reading 'coveredFrom')"] })
  await first.close()
  now += 1000
  const reopened = new TtlCache({ path })
  opened.push(reopened)
  assert.equal(await reopened.get('derived:repaired-fault'), null, 'Repaired software faults must not persist as valid derived degradation after restart')
  const recoveredFault = await withSourceEnvelope(async () => ok((await reopened.resolve('derived:repaired-fault', 12 * 3600_000, async () => 42)).value))
  assert.equal(recoveredFault.data, 42)
  assert.equal(recoveredFault.meta.freshness, 'fresh')
  assert.equal(recoveredFault.errors.length, 0)
  const restored = await withSourceEnvelope(async () => ok((await reopened.resolveWithStaleFallback('derived', 100_000, async () => { throw new Error('derived refresh offline') })).value))
  assert.equal(restored.data, 7)
  assert.equal(restored.meta.freshness, 'stale', 'Derived cache hits must retain failed source health after restart')
  assert.equal(restored.meta.cacheAgeSeconds, 61)
  const childScript = `
    Date.now = () => ${now};
    const { TtlCache, cache } = await import(${JSON.stringify(new URL('../electron/services/cache.ts', import.meta.url).href)});
    const { withSourceEnvelope } = await import(${JSON.stringify(new URL('../electron/services/sourceHealth.ts', import.meta.url).href)});
    const { ok } = await import(${JSON.stringify(new URL('../electron/shared/envelope.ts', import.meta.url).href)});
    const store = new TtlCache({ path: ${JSON.stringify(path)} });
    const envelope = await withSourceEnvelope(async () => ok((await store.resolveWithStaleFallback('derived', 100000, async () => { throw new Error('restart offline'); })).value));
    console.log(JSON.stringify(envelope)); await store.close(); await cache.close();
  `
  const restarted = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childScript], { encoding: 'utf8', timeout: 10_000 })
  assert.equal(restarted.status, 0, restarted.stderr)
  const restartedEnvelope = JSON.parse(restarted.stdout)
  assert.equal(restartedEnvelope.meta.fetchedAt, initial.meta.fetchedAt)
  assert.equal(restartedEnvelope.meta.freshness, 'stale')
  assert.equal(restartedEnvelope.meta.cacheAgeSeconds, 61)
  const fresh = await withSourceEnvelope(async () => ok((await reopened.resolve('fresh', 100_000, async () => 8)).value))
  const nested = await withSourceEnvelope(async () => {
    const child = await withSourceEnvelope(async () => {
      observeSource({ fetchedAt: now - 5000, asOf: now - 10_000, expiresAt: now + 1000,
        stale: true, fromCache: true, failures: ['nested source unavailable'] })
      return ok(9)
    })
    return ok(child.data)
  })
  assert.equal(nested.meta.freshness, 'stale', 'Nested source envelope provenance must reach the parent context')
  assert.equal(nested.meta.asOf, now - 10_000)
  assert.match(nested.meta.failureReason!, /nested source unavailable/)
  const swallowedFailure = () => withSourceEnvelope(async () => {
    await reopened.resolve('backoff-fixture', 1000, async () => { throw new Error('missing source fixture') }).catch(() => null)
    return ok('primary available')
  })
  assert.equal((await swallowedFailure()).meta.freshness, 'partial')
  const backedOff = await swallowedFailure()
  assert.equal(backedOff.meta.freshness, 'partial', 'Memoized failures must retain partial source health when swallowed')
  assert.match(backedOff.meta.failureReason!, /missing source fixture/)
  now += 5000
  const freshCached = await withSourceEnvelope(async () => ok((await reopened.resolve('fresh', 100_000, async () => 9)).value))
  assert.equal(freshCached.meta.fetchedAt, fresh.meta.fetchedAt)
  assert.equal(freshCached.meta.cacheAgeSeconds, 5)
  assert.equal(freshCached.meta.freshness, 'cached')
  await reopened.set('short-source', 10, 1000)
  const derived = await withSourceEnvelope(async () => ok((await reopened.resolve('long-derived', 12 * 3600_000,
    async () => (await reopened.resolve('short-source', 1000, async () => 10)).value)).value))
  assert.equal(derived.meta.expiresAt, now + 1000)
  now += 2000
  assert.equal(await reopened.get('long-derived'), null, 'A long derived TTL cannot extend its quote dependency')
  const refreshed = await withSourceEnvelope(async () => ok((await reopened.resolve('long-derived', 12 * 3600_000,
    async () => (await reopened.resolve('short-source', 1000, async () => 11)).value)).value))
  assert.equal(refreshed.data, 11)
  assert.equal(refreshed.meta.freshness, 'fresh')
  const explicitStale = await withSourceEnvelope(async () => {
    await reopened.get('short-source')
    return ok(11, 'fixture', { freshness: 'stale' })
  })
  assert.equal(explicitStale.meta.freshness, 'stale', 'Explicit service staleness is never downgraded')
  const isolated = await Promise.all([false, true].map(async stale => withSourceEnvelope(async () => {
    observeSource({ fetchedAt: now, stale, fromCache: false, failures: stale ? ['one context only'] : [] })
    await Promise.resolve()
    return ok(1)
  })))
  assert.equal(isolated[0].meta.freshness, 'fresh')
  assert.equal(isolated[0].errors.length, 0)
  assert.equal(isolated[1].meta.freshness, 'stale')
  await reopened.close()

  FOREX_PAIRS.forEach(pair => cache.set(`quote:yahoo-only:${pair.symbol}`, { symbol: pair.symbol, price: 1.25, change: 0, absChange: 0 }, TTL.quotes,
    { fetchedAt: now, asOf: now - 60_000, expiresAt: now + TTL.quotes, stale: false, fromCache: false, failures: [] }))
  const forexQuotes = await getForexQuotes()
  assert.equal(forexQuotes.meta.expiresAt, now + TTL.quotes, 'Forex aggregate cannot extend 30-second quote dependencies to its own 60-second TTL')
  assert.equal(forexQuotes.meta.asOf, now - 60_000)
  cache.clear()
  Reflect.set(yahoo, '_fetch', async () => ({ SPARKFIX: { symbol: 'SPARKFIX', timestamp: [Math.floor(now / 1000)], close: [100] } }))
  const initialSpark = await withSourceEnvelope(async () => ok(await fetchSparkCloses(['SPARKFIX'])))
  assert.equal(initialSpark.meta.expiresAt, now + 120_000, 'Initial manual spark storage must contribute its actual source expiry')
  Reflect.set(yahoo, '_fetch', yahooFetch)
  cache.clear()
  const historicalQuotes = [
    { date: new Date('2026-10-05T13:30:00Z'), open: 774, high: 776, low: 773, close: 774.83, volume: 1_000 },
    { date: new Date('2026-10-06T13:30:00Z'), open: 778.15, high: 781.62, low: 777.96, close: 779.09, volume: 2_000 },
    { date: new Date('2026-10-07T20:00:00Z'), open: 777.22, high: 777.22, low: 777.22, close: 777.22, volume: 0 },
  ]
  const historicalResult = { quotes: historicalQuotes,
    meta: { currency: 'USD', longName: 'Historical Fixture', regularMarketPrice: 777.22,
      regularMarketTime: new Date('2026-10-07T20:00:00Z') } }
  Reflect.set(yahoo, 'chart', async () => historicalResult)
  const chartSession = await yahooProvider.chart({ symbol: 'SESSIONFIX', timeframe: '1 Day', force: true })
  const currentSession = quoteFromChart('SESSIONFIX', historicalResult)!
  assert.equal(chartSession.data.stats?.price, 779.09, 'The chart header remains the last usable OHLC bar, rather than a synthetic flat live quote')
  assert.equal(chartSession.data.candles.at(-1)?.time, Date.parse('2026-10-06T13:30:00Z') / 1000)
  assert.ok(Math.abs(chartSession.data.stats!.absChange - 4.26) < 1e-10)
  assert.equal(currentSession.price, 777.22)
  assert.ok(Math.abs(currentSession.change - (-1.87 / 779.09 * 100)) < 1e-10,
    'Current quotes compare against the previous historical close, independently from the chart candle-to-candle change')
  cache.clear()
  cache.set('quote:yahoo-only:SGD=X', { symbol: 'SGD=X', price: 1.25, change: 0, absChange: 0 }, TTL.quotes)
  const rateFetchedAt = now
  now += 3600_000
  Reflect.set(yahoo, 'chart', async () => { throw new Error('fixture offline') })
  const fx = await yahooProvider.fx({ force: true })
  assert.equal(fx.data.collectedAt, rateFetchedAt)
  assert.equal(fx.meta.freshness, 'stale')
  assert.equal(fx.meta.cacheAgeSeconds, 3600)
  const day = 24 * 3600_000
  const seriesRows = [3, 2, 1].map((ago, index) => ({ time: Math.floor((now - ago * day) / 1000), open: 100 + index,
    high: 100 + index, low: 100 + index, close: 100 + index, adjclose: 100 + index, volume: 100 }))
  cache.set('series:yahoo-only:adjusted:FIX:1d', { rows: seriesRows, coveredFrom: Math.floor((now - 60 * day) / 1000),
    refreshedAt: now, fullSyncAt: now, currency: 'USD', longName: 'Fixture' }, TTL.chartDaily)
  now += 3600_000
  const returns = await yahooProvider.returns({ tickers: ['FIX'], window: '1mo', force: true })
  assert.equal(returns.meta.freshness, 'stale', 'Adjusted history metadata survives bare close-series wrappers')
  assert.equal(returns.meta.cacheAgeSeconds, 3600)
  assert.equal(returns.data.returns.FIX, 2)
  Reflect.set(yahoo, 'options', async () => { throw new Error('fixture options offline') })
  const marks = await yahooProvider.optionQuotes({ positions: [{ rowId: 'p', ticker: 'AAPL', expiry: '2026-12-18', strike: 200, strategy: 'Calls' }] })
  assert.equal(marks.meta.freshness, 'failed')
  assert.deepEqual(marks.data.missing, ['p'])
  assert.ok(marks.errors.length >= 2)
  cache.clear()
  const oldTrade = now - 8 * day
  Reflect.set(yahoo, 'options', async () => ({ expirationDates: [new Date('2026-12-18T00:00:00Z')],
    options: [{ calls: [{ strike: 200, lastPrice: 3.5, lastTradeDate: new Date(oldTrade),
      volume: 1, openInterest: 2, impliedVolatility: 0.25 }], puts: [] }] }))
  const oldOption = await yahooProvider.optionQuotes({ positions: [{ rowId: 'old', ticker: 'AAPL', expiry: '2026-12-18', strike: 200, strategy: 'Calls' }] })
  assert.equal(oldOption.data.quotes.old.currentPrice, 3.5, 'Aged last trades remain usable with explicit provenance')
  assert.equal(oldOption.data.quotes.old.asOf, oldTrade)
  assert.equal(oldOption.data.quotes.old.source, 'Yahoo Finance last trade')
  assert.equal(oldOption.data.quotes.old.markStale, true)
  assert.equal(oldOption.meta.asOf, oldTrade)
  assert.equal(oldOption.meta.freshness, 'stale')
  assert.match(oldOption.meta.failureReason!, /more than seven days/)
  now += 5000
  const oldOptionCached = await yahooProvider.optionQuotes({ positions: [{ rowId: 'old', ticker: 'AAPL', expiry: '2026-12-18', strike: 200, strategy: 'Calls' }] })
  assert.equal(oldOptionCached.meta.asOf, oldTrade)
  assert.equal(oldOptionCached.meta.fetchedAt, oldOption.meta.fetchedAt)
  assert.equal(oldOptionCached.meta.cacheAgeSeconds, 5)
  assert.equal(oldOptionCached.meta.freshness, 'stale', 'Cached contracts retain original trade age and degradation')
  const recentTrade = now - 60_000
  Reflect.set(yahoo, 'options', async () => ({ expirationDates: [new Date('2026-12-18T00:00:00Z')],
    options: [{ calls: [{ strike: 200, lastPrice: 0, lastTradeDate: new Date(recentTrade),
      volume: 1, openInterest: 2, impliedVolatility: 0.25 }], puts: [] }] }))
  const recentOption = await yahooProvider.optionQuotes({ positions: [{ rowId: 'old', ticker: 'AAPL', expiry: '2026-12-18', strike: 200, strategy: 'Calls' }], force: true })
  assert.equal(recentOption.data.quotes.old.currentPrice, 0, 'A genuine zero last trade remains a usable mark')
  assert.equal(recentOption.data.quotes.old.markStale, false)
  assert.equal(recentOption.meta.asOf, recentTrade)
  assert.equal(recentOption.meta.freshness, 'fresh')
  console.log('PASS: nullable marks, incomplete subtotal, signed net worth, Treasury sentinels/provenance, PPI identity, process restart provenance, dependency expiry, stale precedence, ageing, context isolation, stale FX/history, option failures and old/recent last trades')
} finally {
  Date.now = realNow
  globalThis.fetch = originalFetch
  Reflect.set(yahoo, 'chart', chart)
  Reflect.set(yahoo, 'options', options)
  Reflect.set(yahoo, '_fetch', yahooFetch)
  await cache.close()
  for (const store of opened) await store.close()
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (prior[key] === undefined) delete process.env[key]
    else process.env[key] = prior[key]
  }
  rmSync(scratch, { recursive: true, force: true })
}
