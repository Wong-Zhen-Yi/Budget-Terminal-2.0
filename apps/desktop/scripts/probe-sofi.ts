import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StocksPayload } from '../electron/shared/contract.js'
import { SOFI_METRICS, combineSofiReports, emptySofiPayload, emptySofiQuarter, parseSofiReport, sofiBookRatios, sofiNumber, sofiReportWarnings } from '../electron/shared/sofi.js'
import type { SofiReports } from '../electron/shared/sofi.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'

const url = 'https://www.sec.gov/Archives/edgar/data/1818874/000181887426000050/a2026q2earningsrelease.htm'
const html = await readFile(new URL('./fixtures/sofi-2026-q2.html', import.meta.url), 'utf8')
const report = parseSofiReport(html, url, '2026-07-29')
const quarters = combineSofiReports([report])
const latest = quarters.at(-1)!
assert.equal(workspaceFor('sofi')?.id, 'focus')
assert(startupPages('dashboard', [], []).includes('sofi'))
assert.equal(quarters.length, 8)
assert.equal(quarters[0].endDate, '2024-09-30')
assert.equal(latest.endDate, '2026-06-30')
assert.equal(latest.values.members, 15_814_418)
assert.equal(latest.values.products, 24_380_974)
assert.equal(latest.values.deposits, 45_543_160_000)
assert.equal(latest.values.personalOriginations, 10_718_359_000)
assert.equal(latest.values.studentOriginations, 2_686_760_000)
assert.equal(latest.values.homeOriginations, 1_393_375_000)
assert.equal(latest.values.totalOriginations, 14_798_494_000)
assert.equal(latest.values.revenue, 1_218_676_000, 'Quarterly revenue must not use YTD or segment revenue')
assert.equal(latest.values.netIncome, 156_592_000)
assert.equal(latest.values.eps, 0.12, 'Per-share values must not scale by thousands')
assert.equal(latest.values.adjustedEbitda, 357_821_000)
assert.equal(latest.values.technologyAccounts, 134_804_238)
assert.equal(latest.values.lendingRevenue, 724_798_000)
assert.equal(latest.values.financialServicesProfit, 212_676_000)
assert.equal(latest.values.technologyProfit, 11_772_000)
assert.equal(latest.values.bookValuePerShare, 8.58)
assert.equal(latest.values.tangibleBookValuePerShare, 7.34)
assert.equal(latest.values.commonShares, 1_290_312_000)
assert.equal(latest.values.equity! + latest.values.goodwill! + latest.values.intangibles! + latest.values.deferredTaxes!, latest.values.tangibleEquity)
assert.equal(latest.sources.members?.url, url)
assert.equal(latest.values.productsPerMember, latest.values.products! / latest.values.members!)
assert(report.notes.some(note => /revised/.test(note)))
assert.equal(parseSofiReport(html.replace(/Members<\/td>/g, 'Members .............</td>'), url, '2026-07-29').quarters.at(-1)!.values.members,
  15_814_418, 'Older PDF dot leaders must not change metric matching')
const unitsFixture = `<table><tr><td>June 30, 2026</td><td>June 30, 2025</td></tr><tr><td>In millions</td></tr>
  <tr><td>Members</td><td>15.8</td><td>11.7</td></tr><tr><td>Total Products</td><td>24.4</td><td>17.1</td></tr></table>
  <table><tr><td>Three Months Ended</td><td>Six Months Ended</td></tr>
  <tr><td>($ in millions)</td><td>June 30, 2026</td><td>June 30, 2025</td><td>June 30, 2026</td><td>June 30, 2025</td></tr>
  <tr><td>Total net revenue</td><td>12.5</td><td>10.5</td><td>25</td><td>21</td></tr>
  <tr><td>Earnings per share attributable to common stockholders – diluted</td><td>—</td><td>0.08</td><td>0.24</td><td>0.14</td></tr></table>`
const scaled = parseSofiReport(unitsFixture, url, '2026-07-29')
assert.equal(scaled.quarters.at(-1)!.values.members, 15_800_000)
assert.equal(scaled.quarters.at(-1)!.values.revenue, 12_500_000, 'Full date headers must not let YTD overwrite quarterly revenue')
assert.equal(scaled.quarters.at(-1)!.values.eps, null, 'A missing first column must not shift year-ago or YTD values')
assert.equal(scaled.quarters[0].values.eps, 0.08)
assert.equal(sofiNumber(' (1,230) ', 1000), -1_230_000)
assert.equal(sofiNumber('—'), null)
assert.equal(sofiNumber('0'), 0)
assert.equal(sofiNumber('NM'), null)
assert.throws(() => parseSofiReport('<table><tr><td>unsupported</td></tr></table>', url, ''), /could not be read/)

const revised = emptySofiQuarter(latest.endDate)
revised.values.members = 16_000_000
revised.sources.members = { url: 'https://www.sec.gov/revised', publishedAt: '2026-08-01' }
const merged = combineSofiReports([{ url: 'revised', publishedAt: '2026-08-01', quarters: [revised], notes: [] }, report]).at(-1)!
assert.equal(merged.values.members, 16_000_000)
assert.equal(merged.values.deposits, latest.values.deposits, 'Incomplete restatements must retain earlier reported metrics')
assert.equal(merged.sources.members?.publishedAt, '2026-08-01')
assert.equal(sofiBookRatios(25, latest).priceToBook, 25 / 8.58)
assert.equal(sofiBookRatios(25, latest).priceToTangibleBook, 25 / 7.34)
for (const value of [null, 0, -1, NaN, Infinity]) {
  const bad = emptySofiQuarter('2026-06-30')
  bad.values.bookValuePerShare = value
  bad.values.tangibleBookValuePerShare = value
  assert.equal(sofiBookRatios(25, bad).priceToBook, null)
  assert.equal(sofiBookRatios(25, bad).priceToTangibleBook, null)
  assert.equal(sofiBookRatios(value, latest).priceToBook, null)
}
assert.equal(sofiBookRatios(25, undefined).bookAsOf, null)

const scratch = await mkdtemp(join(tmpdir(), 'budget-sofi-probe-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
try {
  const { cache } = await import('../electron/services/cache.js')
  const { getSofi, discoverSofiExhibits, discoverSofiInvestorLinks, discoverSofiInvestorFeed, sofiTesting } = await import('../electron/services/sofi.js')
  assert.deepEqual(discoverSofiExhibits('<table><tr><td>EX-99.1</td><td><a href="a2026q2earningsrelease.htm">Release</a></td></tr></table>', url), [url])
  assert.deepEqual(discoverSofiExhibits('<tr><td>EX-99.1</td><a href="https://evil.example/release.htm">Release</a></tr>', url), [])
  assert.deepEqual(discoverSofiInvestorLinks('<a href="/files/q2-earnings-release.pdf">Earnings release</a>'), ['https://investors.sofi.com/files/q2-earnings-release.pdf'])
  assert.deepEqual(discoverSofiInvestorFeed({ GetFinancialReportListResult: [{ ReportYear: 2026, ReportDate: '06/30/2026', Documents: [
    { DocumentTitle: 'Earnings Presentation', DocumentPath: 'https://investors.sofi.com/presentation.pdf' },
    { DocumentTitle: 'Press Release', DocumentPath: 'https://s27.q4cdn.com/749715820/release.pdf' },
    { DocumentTitle: 'Press Release', DocumentPath: 'https://evil.example/release.pdf' },
  ] }] }), ['https://s27.q4cdn.com/749715820/release.pdf'])
  assert.throws(() => discoverSofiInvestorFeed({}), /schema unavailable/)
  const fixtureQuarter = emptySofiQuarter('2026-06-30')
  for (const [metric] of SOFI_METRICS) { fixtureQuarter.values[metric] = 10; fixtureQuarter.sources[metric] = { url, publishedAt: '2026-07-29' } }
  fixtureQuarter.values.bookValuePerShare = 8.58
  fixtureQuarter.values.tangibleBookValuePerShare = 7.34
  const dates = ['2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30']
  const fixtureReports: SofiReports = { quarters: dates.map(endDate => ({ ...fixtureQuarter, endDate })), releases: [], filings: [], notes: [], warnings: [] }
  const fixtureMarket = { stock: null as StocksPayload | null, price: 25, changePct: 2, priceAsOf: Date.now(), warnings: [], stale: false }
  let calls = 0
  const forces: boolean[] = []
  const fetchers = {
    market: async (force: boolean) => { calls++; forces.push(force); return fixtureMarket },
    reports: async (force: boolean) => { calls++; forces.push(force); return fixtureReports },
  }
  const clear = () => { cache.delete('sofi:v1:market'); cache.delete('sofi:v1:reports') }
  clear()
  assert.equal((await getSofi({}, fetchers)).meta.freshness, 'fresh')
  const cached = await getSofi({}, fetchers)
  assert.equal(calls, 2)
  assert.equal(cached.meta.freshness, 'cached')
  const forced = await getSofi({ force: true }, fetchers)
  assert.equal(calls, 4)
  assert.deepEqual(forces, [false, false, true, true])
  assert.equal(forced.data.valuation.priceToBook, 25 / 8.58)
  const outage = async () => { throw new Error('Provider unavailable') }
  const stale = await getSofi({ force: true }, { market: outage, reports: outage })
  assert.equal(stale.meta.freshness, 'stale')
  assert.equal(stale.data.price, 25)
  assert.equal(stale.data.reports?.quarters.length, 8)
  assert(stale.errors.some(error => /cached/.test(error.reason)))
  clear()
  const partial = await getSofi({ force: true }, { market: fetchers.market, reports: outage })
  assert.equal(partial.meta.freshness, 'partial')
  assert.equal(partial.data.price, 25)
  assert.equal(partial.data.progress.reports, 'unavailable')
  assert.equal(partial.data.valuation.priceToBook, null)
  clear()
  const failed = await getSofi({ force: true }, { market: outage, reports: outage })
  assert.equal(failed.meta.freshness, 'failed')
  assert.equal(failed.errors.length, 2)
  assert.deepEqual(failed.data.progress, emptySofiPayload().progress)
  const missing = structuredClone(fixtureReports)
  missing.quarters.at(-1)!.values.deposits = null
  assert(sofiReportWarnings(missing).some(warning => warning.includes('2026-06-30: unavailable Deposits')))
  clear()
  const incomplete = await getSofi({ force: true }, { market: fetchers.market, reports: async () => missing })
  assert.equal(incomplete.meta.freshness, 'partial')
  assert.equal(incomplete.data.progress.reports, 'partial')
  clear()
  console.log('PASS: SOFI navigation, official tables, units, quarter alignment, restatements, provenance, book ratios, caching, forced refresh and outages')
  if (process.argv.includes('--live')) {
    const live = await getSofi({ force: true })
    await writeFile(join(import.meta.dirname, '../out/sofi-live.json'), JSON.stringify(live, null, 2))
    console.log(JSON.stringify({ freshness: live.meta.freshness, progress: live.data.progress, price: live.data.price,
      valuation: live.data.valuation, quarters: live.data.reports?.quarters.map(quarter => ({ date: quarter.endDate,
        missing: SOFI_METRICS.filter(([metric]) => quarter.values[metric] === null).map(([metric]) => metric) })), errors: live.errors }, null, 2))
    assert.equal(live.data.reports?.quarters.length, 8)
    assert(live.data.price !== null, 'Live SOFI market price unavailable')
    assert(live.data.valuation.priceToBook !== null, 'Live reported book ratio unavailable')
    assert(live.data.valuation.priceToTangibleBook !== null, 'Live tangible book ratio unavailable')
    console.log('PASS: live SOFI provider and eight-quarter earnings retrieval')
  }
  if (process.argv.includes('--live-ir')) {
    const fallback = await sofiTesting.fetchInvestorReports()
    assert.equal(fallback.length, 8, 'All eight official earnings PDFs must parse')
    const historical = combineSofiReports(fallback)
    assert.equal(historical.length, 8)
    const current = historical.at(-1)!
    assert(current.values.bookValuePerShare! > 0)
    assert(current.values.tangibleBookValuePerShare! > 0)
    assert(current.values.members! > 0)
    assert.deepEqual(sofiReportWarnings({ quarters: historical, releases: [], filings: [], notes: [], warnings: [] }), [],
      'Official PDF fallback must populate every requested historical metric')
    console.log(JSON.stringify({ reports: fallback.length, quarters: historical.map(quarter => quarter.endDate),
      latest: current.values, warnings: sofiReportWarnings({ quarters: historical, releases: [], filings: [], notes: [], warnings: [] }) }, null, 2))
    console.log('PASS: live official SoFi archive discovery and PDF fallback')
  }
} finally {
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
