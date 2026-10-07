import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { VST_BLOCKS, vstDocumentUrl, vstHistory, vstPeriod, buildVstSnapshot, discoverVstDocuments, parseVstEarnings, parseVstOperations } from '../electron/shared/vst.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { CHANNELS, TABS } from '../electron/shared/contract.js'
import { createApi } from '../electron/shared/createApi.js'
import { vstFixture, vstReleaseHtml, vstReleaseUrl, vstOperationsHtml, vstOperationsUrl } from './fixtures/vst.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-vst-'))
const savedAppData = process.env.APPDATA
const savedLocalData = process.env.LOCALAPPDATA
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
try {
  const { getVst, loadVstEarnings, loadVstOperations, VST_IR, VST_RESULTS } = await import('../electron/services/vst.js')
  const { TtlCache, cache } = await import('../electron/services/cache.js')
  const fixture = vstFixture()
  assert.equal(workspaceFor('vst')?.id, 'focus')
  assert(startupPages('dashboard', [], []).includes('vst'))
  assert(TABS.some(tab => tab.id === 'vst' && tab.label === 'VST' && tab.implemented))
  let invoked: unknown[] = []
  const api = createApi(async <T>(...args: unknown[]) => {
    invoked = args
    return undefined as T
  }, () => () => {}, 'win32')
  await api.vst({ force: true })
  assert.deepEqual(invoked, [CHANNELS.vst, { force: true }])
  assert.equal(vstPeriod('Vistra Reports Fourth Quarter 2025 and Full-Year Results'), '2025 Q4')
  assert.equal(vstPeriod('Vistra Reports Fourth Quarter and Full-Year 2025 Results'), '2025 Q4')
  const current = `<a href="${vstReleaseUrl}">Vistra Reports Second Quarter 2026 Results</a>`
  const olderUrl = vstReleaseUrl.replace('2026-08-07', '2026-05-07').replace('Second', 'First')
  const older = `<a href="${olderUrl}">Vistra Reports First Quarter 2026 Results</a>`
  assert.equal(discoverVstDocuments(older + current + current)[0].period, '2026 Q2')
  assert.equal(discoverVstDocuments(older + current + current).length, 2)
  for (const url of ['https://example.com/report', 'http://investor.vistracorp.com/report', 'https://www.sec.gov/Archives/edgar/data/1730168/report.htm']) assert.throws(() => vstDocumentUrl(url), /Unexpected/)
  const report = fixture.earnings!
  const value = (id: string) => report.metrics.find(metric => metric.id === id)?.value
  assert.equal(value('netIncome'), 305e6)
  assert.equal(value('ebitda'), 1767e6)
  assert(Math.abs(value('ebitdaGrowth')! - 30.98591549295776) < 1e-6)
  assert.equal(report.segments[0].ebitda, 773e6)
  assert.equal(report.segments[4].ebitda, -27e6)
  assert.equal(report.segments[4].growth, null)
  assert.deepEqual(report.guidance.map(row => [row.year, row.low, row.high]), [['2026', 6800e6, 7600e6], ['2026', 3925e6, 4725e6]])
  assert.deepEqual(report.hedges, [{ year: '2026', percent: 100 }, { year: '2027', percent: 94 }, { year: '2028', percent: 72 }])
  assert.equal(report.hedgeAsOf, '2026-08-03')
  assert.equal(report.publishedAt, '2026-08-07')
  assert.equal(report.periodEnd, '2026-06-30')
  assert.equal(report.warnings.length, 0)
  assert.throws(() => parseVstEarnings(vstReleaseHtml, vstReleaseUrl, '2026 Q1'), /period/)
  assert.throws(() => parseVstEarnings(vstReleaseHtml.replaceAll('June 30', 'March 31'), vstReleaseUrl), /column layout/)
  assert.throws(() => parseVstEarnings(vstReleaseHtml.replace('<span>773</span>', '<span>673</span>'), vstReleaseUrl), /reconcile/)
  assert.throws(() => parseVstEarnings(vstReleaseHtml.replaceAll('Millions of Dollars', 'Dollars').replaceAll('$ in millions', '$'), vstReleaseUrl), /units/)
  const missing = parseVstEarnings(vstReleaseHtml.replace(/<p>As of[^<]*<\/p>/, ''), vstReleaseUrl)
  assert.equal(missing.hedges.length, 0)
  assert(missing.warnings.some(warning => warning.includes('hedge')))
  const negative = parseVstEarnings(vstReleaseHtml.replace('<span>305</span>', '<span>(305)</span>'), vstReleaseUrl)
  assert.equal(negative.metrics.find(metric => metric.id === 'netIncome')?.value, -305e6)
  const loss = parseVstEarnings(vstReleaseHtml.replace('Net income', 'Net income (loss)').replace('<span>305</span>', '<span>(305)</span>'), vstReleaseUrl)
  assert.equal(loss.metrics.find(metric => metric.id === 'netIncome')?.value, -305e6)
  assert.equal(vstHistory(fixture.financials).dates.length, 4)
  assert.equal(JSON.parse(buildVstSnapshot(fixture)).symbol, 'VST')
  const operations = fixture.operations!
  assert.equal(operations.period, '2026 Q2')
  assert.equal(operations.totalRevenue, 4017e6)
  assert.equal(operations.revenues.find(row => row.id === 'wholesale')?.value, 620e6)
  assert.equal(operations.revenues.find(row => row.id === 'unrealized')?.value, -562e6)
  assert.equal(operations.revenues.reduce((total, row) => total + row.value, 0), operations.totalRevenue)
  assert.deepEqual(operations.generation.map(row => [row.name, row.gwh, row.revenue]), [
    ['Natural gas', 27988, null], ['Nuclear', 12410, null], ['Coal & lignite', 9367, null], ['Solar', 492, null], ['Battery storage', null, null],
  ])
  assert.equal(operations.totalGenerationGwh, 50257)
  assert(Math.abs(operations.generation.reduce((sum, row) => sum + (row.share ?? 0), 0) - 100) < 1e-6)
  const parseOperations = (html: string) => parseVstOperations(html, vstOperationsUrl, '2026-06-30', '2026-08-07')
  assert.throws(() => parseOperations(vstOperationsHtml.replaceAll('in millions', 'in billions')), /units/)
  assert.throws(() => parseOperations(vstOperationsHtml.replaceAll('Consolidated', 'Retail')), /column/)
  assert.throws(() => parseOperations(vstOperationsHtml.replaceAll('<span>620</span>', '<span>6210</span>')), /reconcile/)
  assert.throws(() => parseOperations(vstOperationsHtml.replaceAll('2026 2025', '2025 2026').replaceAll('<span>2026</span></td><td><span>2025</span>', '<span>2025</span></td><td><span>2026</span>')), /columns/)
  assert.throws(() => parseOperations(vstOperationsHtml.replaceAll('578', 'N/A')), /volume/)
  assert.throws(() => parseOperations(vstOperationsHtml.replace(/<table>[^<]*<tr><td><span>Three Months Ended June 30,<\/span>[\s\S]*?<\/table>/, '')), /regions/)
  const secUrl = 'https://www.sec.gov/Archives/edgar/data/1692819/000169281926000017/vistra-20260630xearningsre.htm'
  const filing = { form: '8-K', filedDate: '2026-08-07', reportPeriod: '2026-08-07', description: 'Results', items: '2.02', accessionNumber: '0001692819-26-000017', documentUrl: secUrl.replace('xearningsre', '') }
  const olderHtml = vstReleaseHtml.replaceAll('Second Quarter', 'First Quarter').replaceAll('June 30', 'March 31')
  const sources = {
    text: async (url: string) => url === VST_IR ? current : url === VST_RESULTS ? older : url === olderUrl ? olderHtml : vstReleaseHtml,
    filings: async () => ({ filings: [filing], freshness: 'fresh' as const, warnings: [] }),
    secText: async (url: string) => url.endsWith('index.json') ? JSON.stringify({ directory: { item: [{ name: 'vistra-20260630xearningsre.htm' }] } }) : vstReleaseHtml,
  }
  assert.equal((await loadVstEarnings(true, sources)).period, '2026 Q2')
  const fromSec = await loadVstEarnings(true, { ...sources, text: async () => { throw Error('IR blocked') } })
  assert.equal(fromSec.sourceUrl, secUrl)
  const newerSec = await loadVstEarnings(true, { ...sources, text: async url => url === VST_IR || url === VST_RESULTS ? older : olderHtml })
  assert.equal(newerSec.period, '2026 Q2', 'SEC must supersede older investor release')
  const noSec = await loadVstEarnings(true, { ...sources, filings: async () => { throw Error('SEC blocked') } })
  assert(noSec.warnings.some(warning => warning.includes('SEC')))
  await assert.rejects(loadVstEarnings(true, { ...sources, text: async () => '', secText: async () => '<p>New unsupported layout</p>' }), /unavailable/)
  const operationFiling = { ...filing, form: '10-Q', reportPeriod: '2026-06-30', documentUrl: vstOperationsUrl }
  const operationSources = {
    filings: async () => ({ filings: [operationFiling, { ...operationFiling, reportPeriod: '2026-03-31' }], freshness: 'fresh' as const, warnings: [] }),
    secText: async (url: string) => { assert.equal(url, vstOperationsUrl); return vstOperationsHtml },
  }
  assert.equal((await loadVstOperations(true, operationSources)).totalRevenue, 4017e6)
  await assert.rejects(loadVstOperations(true, { ...operationSources, filings: async () => ({ filings: [], freshness: 'fresh', warnings: [] }) }), /unavailable/)
  await assert.rejects(loadVstOperations(true, { ...operationSources, secText: async () => { throw Error('HTTP 503') } }), /503/)
  const staleOperations = await loadVstOperations(true, { ...operationSources, filings: async () => ({ filings: [operationFiling], freshness: 'stale', warnings: [] }) })
  assert(staleOperations.warnings.some(warning => warning.includes('stale')))
  let calls = 0
  const fetchers = {
    market: async (symbol: string) => { assert.equal(symbol, 'VST'); calls++; return { payload: fixture.market!, failures: [] } },
    financials: async (symbol: string) => { assert.equal(symbol, 'VST'); return { payload: fixture.financials!, failures: [], stale: false } },
    earnings: async () => fixture.earnings!,
    operations: async () => fixture.operations!,
  }
  const storage = new TtlCache()
  const loaded = await getVst({}, fetchers, storage)
  assert.equal(loaded.meta.freshness, 'fresh')
  assert.equal((await getVst({ background: true }, fetchers, storage)).meta.freshness, 'cached')
  assert.equal(calls, 1)
  const unavailable = async (): Promise<never> => { throw Error('HTTP 503') }
  const stale = await getVst({ force: true }, { ...fetchers, earnings: unavailable }, storage)
  assert.equal(stale.data.progress.earnings, 'stale')
  assert.equal(stale.data.laneFetchedAt.earnings, loaded.data.laneFetchedAt.earnings)
  const partial = await getVst({}, { ...fetchers, earnings: unavailable }, new TtlCache())
  assert.equal(partial.meta.freshness, 'partial')
  assert(partial.data.market)
  const failed = await getVst({}, { market: unavailable, financials: unavailable, earnings: unavailable, operations: unavailable }, new TtlCache())
  assert.equal(failed.meta.freshness, 'failed')
  assert.equal(failed.errors.length, VST_BLOCKS.length)
  const operationsFailure = await getVst({}, { ...fetchers, operations: unavailable }, new TtlCache())
  assert.equal(operationsFailure.data.progress.operations, 'unavailable')
  assert(operationsFailure.data.earnings && operationsFailure.data.market)
  assert(operationsFailure.errors.some(error => error.symbol === 'operations'))
  const beforeOperationsFailure = await getVst({}, fetchers, storage)
  const cachedOperations = await getVst({ force: true }, { ...fetchers, operations: unavailable }, storage)
  assert.equal(cachedOperations.data.progress.operations, 'stale')
  assert.equal(cachedOperations.data.laneFetchedAt.operations, beforeOperationsFailure.data.laneFetchedAt.operations)
  assert.equal((await getVst({}, { ...fetchers, earnings: async () => missing }, new TtlCache())).data.progress.earnings, 'partial')
  console.log('PASS: VST navigation, IPC, quarterly columns/units, segment/revenue reconciliation, fuel generation, undisclosed revenue, guidance, hedges, SEC discovery and partial/stale/failed states')
  if (process.argv.includes('--live')) {
    const live = await getVst({ force: true })
    assert(live.data.market?.chart.candles.length, live.meta.failureReason ?? 'Market unavailable')
    assert(live.data.financials?.quarterly.revenue.length, live.meta.failureReason ?? 'Financials unavailable')
    assert(live.data.earnings?.metrics.find(metric => metric.id === 'ebitda')?.value, live.meta.failureReason ?? 'Earnings unavailable')
    assert.equal(live.data.earnings?.segments.length, 6)
    assert.equal(live.data.earnings?.guidance.length, 2)
    assert(live.data.earnings?.hedges.length, 'Live hedge disclosure unavailable')
    assert(live.data.operations?.revenues.length, live.meta.failureReason ?? 'Live revenue breakdown unavailable')
    assert(live.data.operations?.generation.some(row => row.name === 'Nuclear' && row.gwh), 'Live fuel generation unavailable')
    assert(live.data.operations?.generation.every(row => row.revenue === null), 'Undisclosed fuel revenue was fabricated')
    console.log(`PASS: live VST providers · ${live.data.earnings?.period} · ${live.meta.freshness} · ${live.meta.failureReason ?? 'all sources loaded'}`)
  }
  cache.close()
} finally {
  if (savedAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = savedAppData
  if (savedLocalData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = savedLocalData
  assert(!relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
