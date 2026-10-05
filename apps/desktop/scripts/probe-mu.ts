import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { discoverMuDocuments, muHtmlText, parseMuEarnings, parseMuMemory, buildMuSnapshot, muHistory, muDocumentUrl } from '../electron/shared/mu.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { muDocuments, muFixture, muReleaseHtml, muRemarksPages } from './fixtures/mu.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-mu-'))
const savedAppData = process.env.APPDATA
const savedLocalData = process.env.LOCALAPPDATA
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
try {
  const { getMu, muPdfPages, muTesting } = await import('../electron/services/mu.js')
  const { TtlCache, cache } = await import('../electron/services/cache.js')
  const fixture = muFixture()
  // A small generated PDF verifies real extraction, rather than mocking PDF.js.
  const content = 'BT /F1 12 Tf 20 740 Td (DRAM FQ4-26) Tj 260 0 Td (NAND FQ4-26) Tj ET\nBT /F1 12 Tf 20 720 Td ($39.8 billion) Tj 260 0 Td ($14.1 billion) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  const extracted = await muPdfPages(new TextEncoder().encode(pdf))
  assert.equal(extracted.length, 1)
  assert.match(extracted[0], /DRAM FQ4-26\tNAND FQ4-26/)
  assert.match(extracted[0], /\$39\.8 billion\t\$14\.1 billion/)
  assert.equal(workspaceFor('mu')?.id, 'focus')
  assert(startupPages('dashboard', [], []).includes('mu'))
  const feed = { GetFinancialReportListResult: [
    { ReportYear: 2025, ReportSubType: 'Fourth Quarter', Documents: [{ DocumentCategory: 'remarks', DocumentPath: muDocuments.remarks!.url }] },
    { ReportYear: 2027, ReportSubType: 'First Quarter', Documents: [] },
    { ReportYear: 2026, ReportSubType: 'Fourth Quarter', Documents: [{ DocumentCategory: 'news', DocumentPath: muDocuments.release!.url }, { DocumentCategory: 'remarks', DocumentPath: muDocuments.remarks!.url }, { DocumentCategory: 'presentation', DocumentPath: muDocuments.presentation!.url }] },
  ] }
  assert.deepEqual(discoverMuDocuments(feed), muDocuments)
  assert.throws(() => discoverMuDocuments({}), /schema changed/)
  assert.throws(() => muDocumentUrl('https://example.com/report.pdf'), /Unexpected/)
  const report = parseMuEarnings(muHtmlText(muReleaseHtml), muDocuments.release!)
  assert.equal(report.metrics.find(metric => metric.id === 'revenue')?.value, 54229e6)
  assert.equal(report.metrics.find(metric => metric.id === 'grossMargin')?.value, 86.8)
  assert.equal(report.metrics.find(metric => metric.id === 'nonGaapGrossMargin')?.value, 87)
  assert.equal(report.metrics.find(metric => metric.id === 'eps')?.value, 32.87)
  assert.equal(report.metrics.find(metric => metric.id === 'nonGaapEps')?.value, 33.42)
  assert.equal(report.units.length, 4)
  assert.equal(report.units[0].revenue, 16000e6)
  assert.equal(report.guidancePeriod, 'FY2027 Q1')
  assert.equal(report.guidance[3].nonGaap, '$38.15 ± $1.00')
  const nested = parseMuEarnings(muHtmlText(muReleaseHtml.replace(/<span>/g, '<div><span>').replace(/<\/span>/g, '</span></div>')), muDocuments.release!)
  assert.deepEqual(nested.units, report.units, 'Nested block markup must preserve numeric columns')
  assert.deepEqual(nested.guidance, report.guidance)
  assert.throws(() => parseMuEarnings(muHtmlText(muReleaseHtml.replaceAll('FQ4-26', 'FQ3-26')), muDocuments.release!), /column layout changed/)
  assert.throws(() => parseMuEarnings('Fiscal Q3 2026\nQuarterly Financial Results', muDocuments.release!), /does not identify/)
  assert.throws(() => parseMuEarnings('Fiscal Q4 2026\nNew unsupported layout', muDocuments.release!), /table was not found/)
  const memory = parseMuMemory([{ document: muDocuments.remarks!, pages: muRemarksPages }])
  const metric = (id: string) => memory.metrics.find(row => row.id === id)!
  assert.equal(metric('dramRevenue').value, 39.8e9)
  assert.equal(metric('nandRevenue').value, 14.1e9)
  assert.equal(metric('dramShare').value, 73)
  assert.equal(metric('dramQoq').value, 27)
  assert.match(metric('dramShipments').text, /mid-single-digit/)
  assert.match(metric('nandPricing').text, /approximately 30%/)
  const decimals = parseMuMemory([{ document: muDocuments.remarks!, pages: muRemarksPages.map(page => page.replace('approximately 30%', 'approximately 30.5%')) }])
  assert.match(decimals.metrics.find(row => row.id === 'nandPricing')!.text, /30\.5%/)
  assert.equal(metric('dramShipments').page, 3)
  assert.equal(metric('hbmRevenue').value, null)
  assert.equal(metric('hbmRevenue').text, 'Not disclosed')
  assert.match(metric('hbmGrowth').text, /grew faster/)
  assert.match(metric('hbmSupply').text, /2027/)
  assert.equal(metric('inventoryDays').value, 129)
  assert.equal(metric('capex').value, 10.8e9)
  assert.equal(memory.warnings.length, 0)
  const annualTrap = parseMuMemory([{ document: muDocuments.remarks!, pages: [muRemarksPages[0], "Micron's DRAM revenue for the fiscal year 2026 surpassed $100 billion. HBM, high-capacity SOCAMM and data center SSD products.", ...muRemarksPages.slice(1)] }])
  assert.equal(annualTrap.metrics.find(row => row.id === 'dramRevenue')?.value, 39.8e9)
  assert.match(annualTrap.metrics.find(row => row.id === 'hbmSupply')!.text, /completed agreements/)
  const deck = parseMuMemory([{ document: muDocuments.presentation!, pages: [
    'Performance by Technology\nDRAM FQ4-26\tNAND FQ4-26\n•\t$39.8 billion, representing 73% of total revenue in FQ4-26\t•\t$14.1 billion, representing 26% of total revenue in FQ4-26\n•\tRevenue increased 27% Q/Q\t•\tRevenue increased 42% Q/Q\n•\tBit shipments increased mid-single digit percentage range Q/Q\t•\tBit shipments increased approximately 10% Q/Q\n•\tASPs increased in the high-teens percentage range Q/Q\t•\tASPs increased approximately 30% Q/Q\nDRAM FY-26\tNAND FY-26\n•\t$100.7 billion, representing 76% of total revenue in FY-26\t•\t$31.8 billion, representing 24% of total revenue in FY-26',
  ] }])
  assert.equal(deck.metrics.find(row => row.id === 'dramRevenue')?.value, 39.8e9)
  assert.equal(deck.metrics.find(row => row.id === 'nandShare')?.value, 26)
  assert.equal(deck.metrics.find(row => row.id === 'nandQoq')?.value, 42)
  assert.match(deck.metrics.find(row => row.id === 'dramPricing')!.text, /high-teens/)
  assert.throws(() => parseMuMemory([{ document: muDocuments.remarks!, pages: muRemarksPages }, { document: { ...muDocuments.presentation!, period: 'FY2026 Q3' }, pages: [] }]), /different fiscal periods/)
  const hbm = parseMuMemory([{ document: muDocuments.remarks!, pages: [...muRemarksPages, 'HBM revenue reached $5 billion.'] }])
  assert.equal(hbm.metrics.find(row => row.id === 'hbmRevenue')?.value, 5e9)
  assert.equal(muHistory(fixture.financials).dates.length, 4)
  assert.equal(JSON.parse(buildMuSnapshot(fixture)).symbol, 'MU')
  let calls = 0
  const fetchers = {
    market: async () => { calls++; return { payload: fixture.market!, failures: [] } },
    financials: async () => ({ payload: fixture.financials!, failures: [], stale: false }),
    earnings: async () => fixture.earnings!, memory: async () => fixture.memory!,
  }
  const storage = new TtlCache()
  const loaded = await getMu({}, fetchers, storage)
  assert.equal(loaded.meta.freshness, 'fresh')
  await getMu({}, fetchers, storage)
  assert.equal(calls, 1)
  const cachedTime = loaded.data.laneFetchedAt.memory
  const unavailable = async (): Promise<never> => { throw new Error('HTTP 503') }
  const stale = await getMu({ force: true }, { ...fetchers, memory: unavailable }, storage)
  assert.equal(stale.data.progress.memory, 'stale')
  assert.equal(stale.data.laneFetchedAt.memory, cachedTime)
  assert.equal(calls, 2)
  const partial = await getMu({}, { ...fetchers, memory: unavailable }, new TtlCache())
  assert.equal(partial.meta.freshness, 'partial')
  assert(partial.data.earnings)
  const failed = await getMu({}, { market: unavailable, financials: unavailable, earnings: unavailable, memory: unavailable }, new TtlCache())
  assert.equal(failed.meta.freshness, 'failed')
  assert.equal(failed.errors.length, 4)
  console.log('PASS: Focus membership, startup inclusion, discovery, fiscal matching, units, GAAP columns, qualitative metrics, provenance, missing HBM, schema changes, caching, forced refresh, stale timestamps, partial/total outages')

  if (process.argv.includes('--live')) {
    const documents = await muTesting.discover(true)
    console.log(`Live documents: ${documents.period}`)
    const results = await Promise.allSettled([muTesting.earnings(true), muTesting.memory(true)])
    for (const [index, result] of results.entries()) {
      assert.equal(result.status, 'fulfilled', `${index === 0 ? 'Earnings' : 'Memory'}: ${result.status === 'rejected' ? String(result.reason) : ''}`)
      if (result.status === 'fulfilled') console.log(`${index === 0 ? 'Earnings' : 'Memory'}: ${result.value.period} · ${result.value.metrics.length} metrics`)
    }
    if (documents.remarks) {
      const bytes = new Uint8Array(await (await fetch(documents.remarks.url)).arrayBuffer())
      assert((await muPdfPages(bytes)).length > 1)
    }
    if (process.argv.includes('--inspect') && documents.presentation) {
      const deck = await muTesting.documentPages(documents.presentation, false)
      deck.pages.forEach((page, index) => { if (/(?:DRAM|NAND)[\s\S]{0,100}revenue/i.test(page)) console.log(`Slide ${index + 1}:\n${page}`) })
    }
    const live = await getMu({ force: true })
    assert(live.data.market?.chart.candles.length, live.meta.failureReason ?? 'Market unavailable')
    assert(live.data.financials?.quarterly.revenue.length, live.meta.failureReason ?? 'Financials unavailable')
    assert(live.data.earnings?.metrics.find(row => row.id === 'revenue')?.value, live.meta.failureReason ?? 'Earnings unavailable')
    assert(live.data.memory?.metrics.find(row => row.id === 'dramRevenue')?.value, live.meta.failureReason ?? 'Memory disclosures unavailable')
    assert(live.data.earnings?.units.every(unit => unit.revenue !== null), 'Live business units must have revenue')
    assert(live.data.earnings?.guidance.every(row => row.gaap && row.nonGaap), 'Live guidance must retain both bases')
    console.log(`PASS: live MU providers · ${live.meta.freshness} · ${live.meta.failureReason ?? 'all sources loaded'}`)
  }
  cache.close()
} finally {
  if (savedAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = savedAppData
  if (savedLocalData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = savedLocalData
  assert.ok(!relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
