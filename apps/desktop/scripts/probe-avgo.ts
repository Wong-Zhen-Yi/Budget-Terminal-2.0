import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { AVGO_BLOCKS, avgoDocumentUrl, avgoHistory, avgoPeriod, buildAvgoSnapshot, discoverAvgoDocuments, parseAvgoEarnings } from '../electron/shared/avgo.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { TABS } from '../electron/shared/contract.js'
import { avgoFixture, avgoReleaseHtml, avgoReleaseUrl } from './fixtures/avgo.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-avgo-'))
const savedAppData = process.env.APPDATA
const savedLocalData = process.env.LOCALAPPDATA
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
try {
  const { getAvgo, loadAvgoEarnings, AVGO_IR, AVGO_RESULTS } = await import('../electron/services/avgo.js')
  const { TtlCache, cache } = await import('../electron/services/cache.js')
  const fixture = avgoFixture()
  assert.equal(workspaceFor('avgo')?.id, 'focus')
  assert(startupPages('dashboard', [], []).includes('avgo'))
  assert(TABS.some(tab => tab.id === 'avgo' && tab.label === 'AVGO' && tab.implemented))
  assert.equal(avgoPeriod('Fourth Quarter and Fiscal Year 2025 Financial Results'), 'FY2025 Q4')
  const link = (period: string, url: string) => `<a href="${url}">Broadcom Inc. Announces ${period} Financial Results and Quarterly Dividend</a>`
  const current = link('Third Quarter Fiscal Year 2026', avgoReleaseUrl)
  const olderUrl = avgoReleaseUrl.replace('third-quarter', 'second-quarter')
  const older = link('Second Quarter Fiscal Year 2026', olderUrl)
  assert.equal(discoverAvgoDocuments(older + current + current)[0].period, 'FY2026 Q3')
  assert.equal(discoverAvgoDocuments(older + current + current).length, 2)
  assert.throws(() => avgoDocumentUrl('https://example.com/report'), /Unexpected/)
  assert.throws(() => avgoDocumentUrl('http://investors.broadcom.com/report'), /Unexpected/)
  assert.equal(discoverAvgoDocuments(link('Third Quarter Fiscal Year 2026', 'https://example.com/report')).length, 0)
  const report = fixture.earnings!
  const value = (id: string) => report.metrics.find(metric => metric.id === id)?.value
  assert.equal(value('revenue'), 29591e6)
  assert.equal(value('nonGaapOperatingIncome'), 20095e6)
  assert.equal(value('eps'), 2.68)
  assert.equal(value('nonGaapEps'), 3.32)
  assert.equal(value('freeCashFlow'), 13665e6)
  assert.equal(value('dividend'), 0.65)
  assert.equal(value('aiRevenue'), 16.7e9)
  assert.equal(value('aiYoy'), 221)
  const lowerBound = parseAvgoEarnings(avgoReleaseHtml.replace('of $16.7 billion', 'of over $16.7 billion'), avgoReleaseUrl)
  assert.equal(lowerBound.metrics.find(metric => metric.id === 'aiRevenue')?.text, 'over')
  assert.equal(value('aiQoq'), 54)
  assert.equal(report.segments[0].revenue, 20839e6)
  assert.equal(report.segments[1].growth, 29)
  assert.equal(report.guidancePeriod, 'FY2026 Q4')
  assert.equal(report.guidance.find(metric => metric.id === 'revenueGuidance')?.value, 34.8e9)
  assert.equal(report.guidance.find(metric => metric.id === 'aiRevenueGuidance')?.value, 21.7e9)
  assert.equal(report.guidance.find(metric => metric.id === 'operatingMarginGuidance')?.value, 66)
  assert.equal(report.publishedAt, '2026-09-02')
  assert.equal(report.periodEnd, '2026-08-02')
  assert(report.commentary[0].includes('custom AI accelerators'))
  assert(report.metrics.every(metric => metric.sourceUrl === avgoReleaseUrl))
  assert.equal(report.warnings.length, 0)
  const smartQuotes = parseAvgoEarnings(avgoReleaseHtml.replaceAll('\"', '&#8220;'), avgoReleaseUrl)
  assert.equal(smartQuotes.guidance.find(metric => metric.id === 'aiRevenueGuidance')?.value, 21.7e9)
  assert.throws(() => parseAvgoEarnings(avgoReleaseHtml, avgoReleaseUrl, 'FY2026 Q2'), /period/)
  assert.throws(() => parseAvgoEarnings(avgoReleaseHtml.replaceAll('Q3 26', 'Q2 26'), avgoReleaseUrl), /column layout/)
  assert.throws(() => parseAvgoEarnings(avgoReleaseHtml.replace('20,839', '19,839'), avgoReleaseUrl), /reconcile/)
  assert.throws(() => parseAvgoEarnings(avgoReleaseHtml.replaceAll('Dollars in millions', 'Dollars'), avgoReleaseUrl), /units/)
  const missing = parseAvgoEarnings(avgoReleaseHtml.replace(/<p>"Demand[\s\S]*?<\/p>/, ''), avgoReleaseUrl)
  assert.equal(missing.metrics.find(metric => metric.id === 'aiRevenue')?.value, null)
  assert(missing.warnings.some(warning => warning.includes('AI semiconductor')))
  const negative = parseAvgoEarnings(avgoReleaseHtml.replace('<span>13,088</span>', '<span>(13,088)</span>'), avgoReleaseUrl)
  assert.equal(negative.metrics.find(metric => metric.id === 'netIncome')?.value, -13088e6)
  const rollover = parseAvgoEarnings(avgoReleaseHtml.replaceAll('Third Quarter Fiscal Year 2026', 'Fourth Quarter Fiscal Year 2026').replaceAll('third quarter of fiscal year 2026', 'fourth quarter of fiscal year 2026').replaceAll('Q3 26', 'Q4 26'), avgoReleaseUrl)
  assert.equal(rollover.guidancePeriod, 'FY2027 Q1')
  assert.equal(avgoHistory(fixture.financials).dates.length, 4)
  assert.equal(JSON.parse(buildAvgoSnapshot(fixture)).symbol, 'AVGO')

  const secUrl = 'https://www.sec.gov/Archives/edgar/data/1730168/000173016826000080/ex991.htm'
  const filing = { form: '8-K', filedDate: '2026-09-02', reportPeriod: '2026-09-02', description: 'Results', items: '2.02', accessionNumber: '0001730168-26-000080', documentUrl: secUrl.replace('ex991.htm', 'avgo.htm') }
  const sources = {
    text: async (url: string) => url === AVGO_IR ? current : url === AVGO_RESULTS ? older : url === olderUrl ? avgoReleaseHtml.replaceAll('Third Quarter Fiscal Year 2026', 'Second Quarter Fiscal Year 2026').replaceAll('third quarter of fiscal year 2026', 'second quarter of fiscal year 2026').replaceAll('Q3 26', 'Q2 26') : avgoReleaseHtml,
    filings: async () => ({ filings: [filing], freshness: 'fresh' as const, warnings: [] }),
    secText: async (url: string) => url.endsWith('index.json') ? JSON.stringify({ directory: { item: [{ name: 'ex991.htm' }] } }) : avgoReleaseHtml,
  }
  assert.equal((await loadAvgoEarnings(true, sources)).period, 'FY2026 Q3', 'Homepage must supersede lagging quarterly index')
  const fromSec = await loadAvgoEarnings(true, { ...sources, text: async () => { throw Error('IR blocked') } })
  assert.equal(fromSec.period, 'FY2026 Q3')
  assert.equal(fromSec.sourceUrl, secUrl)
  const newerSec = await loadAvgoEarnings(true, { ...sources, text: async url => url === AVGO_IR || url === AVGO_RESULTS ? older : sources.text(olderUrl) })
  assert.equal(newerSec.period, 'FY2026 Q3', 'SEC must supersede older investor release')
  const noSec = await loadAvgoEarnings(true, { ...sources, filings: async () => { throw Error('SEC blocked') } })
  assert(noSec.warnings.some(warning => warning.includes('SEC')))
  await assert.rejects(loadAvgoEarnings(true, { ...sources, text: async () => '', secText: async () => '<p>New unsupported layout</p>' }), /unavailable/)
  let calls = 0
  const fetchers = {
    market: async (symbol: string) => { assert.equal(symbol, 'AVGO'); calls++; return { payload: fixture.market!, failures: [] } },
    financials: async () => ({ payload: fixture.financials!, failures: [], stale: false }),
    earnings: async () => fixture.earnings!,
  }
  const storage = new TtlCache()
  const loaded = await getAvgo({}, fetchers, storage)
  assert.equal(loaded.meta.freshness, 'fresh')
  assert.equal((await getAvgo({}, fetchers, storage)).meta.freshness, 'cached')
  assert.equal(calls, 1)
  const unavailable = async (): Promise<never> => { throw Error('HTTP 503') }
  const cachedTime = loaded.data.laneFetchedAt.earnings
  const stale = await getAvgo({ force: true }, { ...fetchers, earnings: unavailable }, storage)
  assert.equal(stale.data.progress.earnings, 'stale')
  assert.equal(stale.data.laneFetchedAt.earnings, cachedTime)
  assert.equal(calls, 2)
  const partial = await getAvgo({}, { ...fetchers, earnings: unavailable }, new TtlCache())
  assert.equal(partial.meta.freshness, 'partial')
  assert(partial.data.market)
  const failed = await getAvgo({}, { market: unavailable, financials: unavailable, earnings: unavailable }, new TtlCache())
  assert.equal(failed.meta.freshness, 'failed')
  assert.equal(failed.errors.length, AVGO_BLOCKS.length)
  const incomplete = await getAvgo({}, { ...fetchers, earnings: async () => missing }, new TtlCache())
  assert.equal(incomplete.data.progress.earnings, 'partial')
  console.log('PASS: AVGO navigation/startup, report discovery, fiscal matching, units, GAAP columns, segments, AI/guidance, provenance, SEC fallback, cache, stale timestamps and partial/total failures')
  if (process.argv.includes('--live')) {
    const live = await getAvgo({ force: true })
    assert(live.data.market?.chart.candles.length, live.meta.failureReason ?? 'Market unavailable')
    assert(live.data.financials?.quarterly.revenue.length, live.meta.failureReason ?? 'Financials unavailable')
    assert(live.data.earnings?.metrics.find(metric => metric.id === 'revenue')?.value, live.meta.failureReason ?? 'Earnings unavailable')
    assert.equal(live.data.earnings?.segments.length, 2)
    assert(live.data.earnings?.metrics.find(metric => metric.id === 'aiRevenue')?.value, 'Live AI revenue unavailable')
    assert(live.data.earnings?.guidance.find(metric => metric.id === 'aiRevenueGuidance')?.value, 'Live AI guidance unavailable')
    assert(live.data.earnings?.commentary.length, 'Live accelerator/networking commentary unavailable')
    console.log(`PASS: live AVGO providers · ${live.data.earnings?.period} · ${live.meta.freshness} · ${live.meta.failureReason ?? 'all sources loaded'}`)
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
