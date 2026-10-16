import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratch = await mkdtemp(join(tmpdir(), 'bt-defeatbeta-'))
const oldAppData = process.env.APPDATA
const oldLocalAppData = process.env.LOCALAPPDATA
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch

const { cache, TtlCache } = await import('../electron/services/cache.js')
const { DefeatBetaClient, defeatBeta, defeatBetaSymbol } = await import('../electron/services/defeatbeta/client.js')
const { closeDefeatBetaDecoder } = await import('../electron/services/defeatbeta/decoder.js')
const { backupPrices, normalizePrices, normalizeStatements } = await import('../electron/services/defeatbeta/data.js')
const { withBackupStatements, withBackupSummary } = await import('../electron/services/yahoo/backup.js')
const { getYahooSeries } = await import('../electron/services/yahoo/series.js')
const { getQuote } = await import('../electron/services/yahoo/quotes.js')
const { yahoo, closeYahooWorker } = await import('../electron/services/yahoo/client.js')
const { withSourceEnvelope, captureSources } = await import('../electron/services/sourceHealth.js')
const { meta } = await import('../electron/shared/envelope.js')
type DataRow = import('../electron/services/defeatbeta/client.js').DataRow

const day = 86_400_000
const recent = (days: number) => new Date(Date.now() - days * day).toISOString().slice(0, 10)
const priceRows: DataRow[] = [
  { symbol: 'TEST', report_date: recent(3), open: 98, high: 102, low: 97, close: 100, volume: 1000n },
  { symbol: 'TEST', report_date: recent(2), open: 100, high: 105, low: 99, close: 104, volume: 1200n },
]
const statementRows: DataRow[] = [
  { report_date: '2025-12-31', period_type: 'annual', item_name: 'total_revenue', item_value: 5000 },
  { report_date: '2025-12-31', period_type: 'annual', item_name: 'diluted_eps', item_value: 5 },
  { report_date: '2026-06-30', period_type: 'quarterly', item_name: 'total_revenue', item_value: 2000 },
  { report_date: 'TTM', period_type: 'quarterly', item_name: 'total_revenue', item_value: 6000 },
  { report_date: 'TTM', period_type: 'quarterly', item_name: 'diluted_eps', item_value: 6 },
]

async function envelope<T>(loader: () => Promise<T>) {
  return withSourceEnvelope(async () => ({ data: await loader(), meta: meta('Yahoo Finance', 'fresh'), errors: [] }))
}

async function offline(): Promise<void> {
  assert.equal(defeatBetaSymbol(' brk-b '), 'BRK-B')
  for (const symbol of ['^GSPC', 'EURUSD=X', 'GC=F', '2330.TW', '../AAPL', '']) {
    assert.throws(() => defeatBetaSymbol(symbol))
  }
  const prices = normalizePrices([...priceRows].reverse().concat([
    { ...priceRows[0], report_date: '2026-02-30' },
    { ...priceRows[0], report_date: recent(1), high: 10 },
    { ...priceRows[0], report_date: recent(1), close: NaN },
  ]))
  assert.equal(prices.length, 2)
  assert.equal(prices[0].volume, 1000)
  assert.equal(prices[0].adjclose, null, 'Never invent a dividend-adjusted price')
  const annual = normalizeStatements(statementRows, 'annual', new Date('2025-01-01'))
  assert.equal(annual.length, 1)
  assert.equal(annual[0].totalRevenue, 5000)
  assert.equal(annual[0].dilutedEPS, 5)
  assert.equal(annual[0].dataSource, 'defeatbeta')
  assert.equal(normalizeStatements(statementRows, 'quarterly', new Date(0)).length, 1, 'TTM is not a fiscal date')

  let specCalls = 0
  let rangeCalls = 0
  const revision = 'a'.repeat(40)
  const badRangeClient = new DefeatBetaClient(async (url, init) => {
    if (String(url).endsWith('spec.json')) {
      specCalls += 1
      return new Response(JSON.stringify({ update_time: new Date().toISOString(), footer_index: {
        'US/stock_prices.parquet': { file_size: 1024 },
      } }), { headers: { 'x-repo-commit': revision } })
    }
    rangeCalls += 1
    assert.ok(String(url).includes(`/resolve/${revision}/`))
    assert.ok(new Headers(init?.headers).get('Range'))
    return new Response('whole file', { status: 200 })
  }, new TtlCache())
  await assert.rejects(() => badRangeClient.rows('stock_prices', 'AAPL'), /did not honor/)
  assert.equal(specCalls, 1)
  assert.equal(rangeCalls, 1, 'A whole-file response must be rejected before parsing')

  const originalRows = defeatBeta.rows
  const originalCompany = defeatBeta.company
  const originalYahoo = { chart: yahoo.chart, quote: yahoo.quote }
  let backupCalls = 0
  defeatBeta.rows = async (table, input) => {
    defeatBetaSymbol(input)
    backupCalls += 1
    const rows = table === 'stock_prices' ? priceRows : table === 'stock_statement' ? statementRows
      : table === 'stock_shares_outstanding' ? [{ report_date: recent(4), shares_outstanding: 100n }]
      : [{ symbol: 'TEST', sector: 'Technology', long_business_summary: 'Fixture company' }]
    return { rows, updatedAt: Date.now() - day }
  }
  defeatBeta.company = async () => ({ ticker: 'TEST', title: 'Test Company', financial_currency: 'USD' })
  try {
    Object.assign(yahoo, { chart: async () => ({ quotes: [], meta: {} }), quote: async () => ({
      regularMarketPrice: 110, regularMarketChange: 2, regularMarketTime: new Date(), currency: 'USD',
    }) })
    cache.clear()
    assert.equal((await getQuote('TEST', true)).price, 110)
    assert.equal(backupCalls, 0, 'Try the second Yahoo endpoint before the backup')
    Object.assign(yahoo, { quote: async () => { throw new Error('primary unavailable') } })
    const backed = await envelope(() => getQuote('TEST', true))
    assert.equal(backed.data.price, 104)
    assert.equal(backed.data.absChange, 4)
    assert.equal(backed.meta.asOf, Date.parse(`${recent(2)}T00:00:00Z`))
    assert.equal(backed.meta.freshness, 'stale')
    assert.match(backed.meta.source, /DefeatBeta/)
    assert.match(backed.meta.failureReason!, /primary unavailable/)
    const calls = backupCalls
    const cached = await envelope(() => getQuote('TEST'))
    assert.equal(backupCalls, calls)
    assert.match(cached.meta.source, /DefeatBeta/)
    assert.equal(cached.meta.asOf, backed.meta.asOf)
    assert.equal(cached.meta.freshness, 'stale')

    const summary = await envelope(() => withBackupSummary('TEST', async () => { throw new Error('summary offline') }))
    const fields = summary.data as { price: { marketCap: number }; financialData: { totalRevenue: number; targetMeanPrice?: number } }
    assert.equal(fields.price.marketCap, 10400)
    assert.equal(fields.financialData.totalRevenue, 6000)
    assert.equal(fields.financialData.targetMeanPrice, undefined)
    assert.match(summary.meta.failureReason!, /Analyst targets/)
    const statements = await envelope(() => withBackupStatements('TEST', 'annual', new Date(0), async () => []))
    assert.equal(statements.data.length, 1, 'Empty primary statements trigger the backup')

    const store = new TtlCache()
    const start = new Date(Date.parse(`${recent(5)}T00:00:00Z`))
    const primaryRow = { ...prices[0], time: prices[0].time + 14 * 3600, close: 999 }
    let primaryFails = false
    const primary = async () => {
      if (primaryFails) throw new Error('history offline')
      return { rows: [primaryRow], currency: 'USD', longName: 'Primary' }
    }
    const options = { symbol: 'TEST', start, interval: '1d' as const, force: true }
    await getYahooSeries(options, store, primary, backupPrices)
    primaryFails = true
    const backup = await envelope(() => getYahooSeries(options, store, primary, backupPrices))
    assert.equal(backup.data.rows.length, 2)
    assert.ok(!backup.data.rows.some(row => row.close === 999), 'Never merge provider representations')
    primaryFails = false
    const recovered = await envelope(() => getYahooSeries(options, store, primary, backupPrices))
    assert.equal(recovered.data.rows.length, 1)
    assert.equal(recovered.data.rows[0].close, 999)
    assert.ok(!recovered.meta.source.includes('DefeatBeta'), 'Recovery must clear fallback provenance')
    assert.equal(recovered.meta.freshness, 'fresh')
    primaryFails = true
    const beforeIntraday = backupCalls
    await assert.rejects(() => getYahooSeries({ ...options, interval: '1m' }, new TtlCache(), primary, backupPrices), /history offline/)
    assert.equal(backupCalls, beforeIntraday, 'Never use daily data for intraday bars')

    const path = join(scratch, 'provenance.sqlite')
    const disk = new TtlCache({ path })
    const observed = await captureSources(() => disk.resolve('backup', 60_000, () => envelope(() => getQuote('TEST'))))
    assert.match(observed.snapshot?.sources?.join(' ') ?? '', /DefeatBeta/)
    disk.close()
    const reopened = new TtlCache({ path })
    const restored = await captureSources(async () => reopened.get('backup'))
    assert.match(restored.snapshot?.sources?.join(' ') ?? '', /DefeatBeta/)
    assert.equal(restored.snapshot?.stale, true)
    reopened.close()

    defeatBeta.rows = async () => { throw new Error('backup offline') }
    const stale = await envelope(() => getQuote('TEST', true))
    assert.equal(stale.data.price, 104, 'Both feeds failing must retain the saved quote')
    assert.match(stale.meta.failureReason!, /backup offline/)
    cache.clear()
    await assert.rejects(() => getQuote('TEST', true), /primary unavailable.*backup offline/)
    console.log('DefeatBeta offline checks passed: validation, bounds, failover, cache provenance, recovery and unsupported intervals.')
  } finally {
    defeatBeta.rows = originalRows
    defeatBeta.company = originalCompany
    Object.assign(yahoo, originalYahoo)
    cache.clear()
  }
}

async function live(symbol: string): Promise<void> {
  const original = { chart: yahoo.chart, quote: yahoo.quote, quoteSummary: yahoo.quoteSummary, fundamentalsTimeSeries: yahoo.fundamentalsTimeSeries }
  const unavailable = async () => { throw new Error('forced Yahoo failure for DefeatBeta live probe') }
  Object.assign(yahoo, { chart: unavailable, quote: unavailable, quoteSummary: unavailable, fundamentalsTimeSeries: unavailable })
  try {
    const quote = await envelope(() => getQuote(symbol, true))
    assert.ok(quote.data.price > 0)
    assert.match(quote.meta.source, /DefeatBeta/)
    assert.equal(quote.meta.freshness, 'stale')
    assert.ok(quote.meta.asOf! < Date.now())
    const series = await envelope(() => getYahooSeries({ symbol, start: new Date(Date.now() - 365 * day), interval: '1d', force: true }))
    assert.ok(series.data.rows.length > 100)
    assert.match(series.meta.source, /DefeatBeta/)
    const summary = await envelope(() => withBackupSummary(symbol, () => yahoo.quoteSummary(symbol, { modules: ['price', 'assetProfile'] })))
    assert.ok(summary.data.assetProfile?.longBusinessSummary)
    const statements = await envelope(() => withBackupStatements(symbol, 'annual', new Date(Date.now() - 5 * 365 * day),
      () => yahoo.fundamentalsTimeSeries(symbol, { period1: new Date(0), type: 'annual', module: 'all' })))
    assert.ok(statements.data.length > 0)
    const cached = await envelope(() => getQuote(symbol))
    assert.match(cached.meta.source, /DefeatBeta/)
    console.log(JSON.stringify({ symbol, price: quote.data.price, asOf: new Date(quote.meta.asOf!).toISOString(),
      dailyBars: series.data.rows.length, company: summary.data.price?.longName, annualPeriods: statements.data.length,
      source: quote.meta.source, freshness: quote.meta.freshness }, null, 2))
    console.log('DefeatBeta live failover checks passed.')
  } finally { Object.assign(yahoo, original) }
}

try {
  await offline()
  if (!process.argv.includes('--offline')) {
    const symbol = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'AAPL'
    await live(symbol.toUpperCase())
  }
} finally {
  closeYahooWorker()
  closeDefeatBetaDecoder()
  cache.close()
  if (oldAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = oldAppData
  if (oldLocalAppData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = oldLocalAppData
  await rm(scratch, { recursive: true, force: true })
}
