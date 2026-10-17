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
const { DefeatBetaClient, defeatBetaSymbol } = await import('../electron/services/defeatbeta/client.js')
const { closeDefeatBetaDecoder } = await import('../electron/services/defeatbeta/decoder.js')
const { backupPrices, backupStatements, normalizePrices, normalizeStatements, adjustDividendCloses, publishedAdjustedPrices } = await import('../electron/services/defeatbeta/data.js')
const { DefeatBetaRequestGate } = await import('../electron/services/defeatbeta/requestGate.js')
const { closeYahooWorker } = await import('../electron/services/yahoo/client.js')
const { withSourceEnvelope } = await import('../electron/services/sourceHealth.js')
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
  const gate = new DefeatBetaRequestGate({ intervalMs: 15, maxConcurrency: 2, cooldownMs: 25 })
  const starts: number[] = []
  let active = 0
  let peak = 0
  await Promise.all(Array.from({ length: 6 }, () => gate.run(async () => {
    starts.push(Date.now())
    active += 1
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 25))
    active -= 1
  })))
  assert(peak <= 2, 'DefeatBeta must cap concurrent body reads')
  assert(starts.at(-1)! - starts[0] >= 65, 'DefeatBeta must pace starts without a burst')
  const cooldown = new DefeatBetaRequestGate({ intervalMs: 5, cooldownMs: 25 })
  let networkAttempts = 0
  const limited = cooldown.run(async () => { networkAttempts += 1; throw Object.assign(new Error('HTTP 429'), { status: 429, retryAfterMs: 60 }) })
  const queued = cooldown.run(async () => { networkAttempts += 1 })
  const cancelled = await Promise.allSettled([limited, queued])
  assert(cancelled.every(result => result.status === 'rejected'))
  await assert.rejects(() => cooldown.run(async () => { networkAttempts += 1 }), /cooling down/)
  await new Promise(resolve => setTimeout(resolve, 35))
  await assert.rejects(() => cooldown.run(async () => { networkAttempts += 1 }), /cooling down/, 'Retry-After must override the shorter default cooldown')
  assert.equal(networkAttempts, 1, 'A 429 must cancel queued calls and fail fast without network retries')
  await new Promise(resolve => setTimeout(resolve, 35))
  await cooldown.run(async () => { networkAttempts += 1 })
  assert.equal(networkAttempts, 2, 'Requests may resume after the cooldown')
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
  const adjusted = adjustDividendCloses(prices, [{ report_date: recent(2), amount: 4 }])
  assert.equal(adjusted[0].adjclose, 96)
  assert.equal(adjusted[1].adjclose, 104)
  assert.equal(adjusted[0].close, 100, 'Dividend adjustment must not change price or dollar-volume inputs')
  assert.equal(prices[0].adjclose, null, 'Never mutate cached raw history')
  assert.throws(() => adjustDividendCloses(prices, [{ report_date: recent(2), amount: 101 }]), /Invalid/)
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

  const fixtureClient = { rows: async (table: string) => ({ rows: table === 'stock_prices' ? priceRows : statementRows, updatedAt: Date.now() }) } as unknown as import('../electron/services/defeatbeta/client.js').DefeatBetaClient
  assert.equal((await backupPrices('TEST', new Date(0), undefined, fixtureClient)).rows.length, 2)
  assert.equal((await backupStatements('TEST', 'annual', new Date(0), fixtureClient)).rows.length, 1)
  console.log('DefeatBeta decoder, pacing and normalization checks passed; integration retained but inactive in the application.')
}

async function live(symbol: string): Promise<void> {
  const published = await envelope(() => backupPrices(symbol, new Date(Date.now() - 365 * day)))
  assert(published.data.rows.length > 100)
  const adjusted = await publishedAdjustedPrices(symbol, new Date(Date.now() - 365 * day))
  assert(adjusted.rows.every(row => typeof row.adjclose === 'number' && row.adjclose > 0))
  console.log(`Standalone DefeatBeta: ${symbol}, ${published.data.rows.length} bars`)
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
