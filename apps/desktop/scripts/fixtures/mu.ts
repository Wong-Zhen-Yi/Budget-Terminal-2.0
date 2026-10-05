import { emptyMuPayload, muHtmlText, parseMuEarnings, parseMuMemory } from '../../electron/shared/mu.js'
import type { MuDocuments } from '../../electron/shared/mu.js'
import type { StocksPayload } from '../../electron/shared/contract.js'
import { emptyFundamentalSeriesMap } from '../../electron/shared/fundamentalsPage.js'

export const muDocuments: MuDocuments = {
  period: 'FY2026 Q4',
  release: { period: 'FY2026 Q4', kind: 'release', url: 'https://investors.micron.com/news/press-release/2026/results/' },
  remarks: { period: 'FY2026 Q4', kind: 'remarks', url: 'https://s25.q4cdn.com/621799436/files/remarks.pdf' },
  presentation: { period: 'FY2026 Q4', kind: 'presentation', url: 'https://s25.q4cdn.com/621799436/files/deck.pdf' },
}
const row = (cells: string[]) => `<tr>${cells.map(cell => `<td><span>${cell}</span></td>`).join('')}</tr>`
export const muReleaseHtml = `<h1>Micron Reports Fiscal Fourth-Quarter 2026 Results</h1><p>September 30, 2026</p>
  <h2>Quarterly Financial Results</h2><p>(in millions, except per share amounts)</p><table>
  ${row(['', 'FQ4-26', 'FQ3-26', 'FQ4-25', 'FQ4-26', 'FQ3-26', 'FQ4-25'])}
  ${row(['Revenue', '$', '54,229', '$', '41,456', '$', '11,315', '$', '54,229', '$', '41,456', '$', '11,315'])}
  ${row(['Gross margin', '47,047', '35,056', '5,054', '47,204', '35,199', '5,169'])}
  ${row(['Percent of revenue', '86.8', '%', '84.6', '%', '44.7', '%', '87.0', '%', '84.9', '%', '45.7', '%'])}
  ${row(['Diluted earnings per share', '$', '32.87', '$', '24.67', '$', '2.83', '$', '33.42', '$', '25.11', '$', '3.03'])}</table>
  <h2>Annual Financial Results</h2><table>${row(['Revenue', '133,188', '37,378'])}</table>
  <h2>Quarterly Business Unit Financial Results</h2><table>
  ${['Cloud Memory', 'Core Data Center', 'Mobile and Client', 'Automotive and Embedded'].map((name, index) => `${row([`${name} Business Unit`])}${row(['Revenue', String(16000 - index * 2000), '10000', '4000'])}${row(['Gross margin', '83', '%', '80', '%', '40', '%'])}${row(['Operating margin', '76', '%', '70', '%', '30', '%'])}`).join('')}</table>
  <h2>Business Outlook</h2><p>The following table presents Micron's guidance for the first quarter of 2027:</p><table>
  ${row(['FQ1-27', 'GAAP Outlook', 'Non-GAAP Outlook'])}
  ${row(['Revenue', '$61.5 billion ± $1.5 billion', '$61.5 billion ± $1.5 billion'])}
  ${row(['Gross margin', 'Approximately 85.95%', 'Approximately 86.25%'])}
  ${row(['Operating expenses', 'Approximately $2.31 billion', 'Approximately $2.06 billion'])}
  ${row(['Diluted earnings per share', '$37.84 ± $1.00', '$38.15 ± $1.00'])}</table><p>Further information regarding Micron's business outlook is included in the prepared remarks.</p>`

export const muRemarksPages = [
  'Micron Technology, Inc. Fiscal Q4 2026 Earnings Call Prepared Remarks September 30, 2026',
  'In HBM, our revenue in fiscal Q4 2026 grew faster than total company revenue in the quarter, as we ramp HBM shipments. We have completed agreements for the vast majority of our calendar 2027 HBM bit supply with significant price increases year over year.',
  'DRAM Fiscal Q4 DRAM revenue was a record $39.8 billion, up 343% year over year, and represented 73% of total revenue. Sequentially, DRAM revenue increased 27%. Bit shipments were up mid-single-digit percentage range. Prices increased high-teens percentage range, driven by tight DRAM industry conditions. NAND Fiscal Q4 NAND revenue was a record $14.1 billion, up 526% year over year, and represented 26% of total revenue. Sequentially, NAND revenue increased 42%. Bit shipments increased approximately 10%. Prices increased approximately 30%, driven by tight NAND industry conditions. Gross margin',
  'In fiscal Q4, operating cash flows were $44.0 billion. Capital expenditures were $10.8 billion, resulting in free cash flow of $33.2 billion. Ending inventory for fiscal Q4 was $10.4 billion, with days of inventory (DIO) at 129, an increase of nine days sequentially.',
]

export function muFixture() {
  const payload = emptyMuPayload()
  payload.earnings = parseMuEarnings(muHtmlText(muReleaseHtml), muDocuments.release!)
  payload.memory = parseMuMemory([{ document: muDocuments.remarks!, pages: muRemarksPages }])
  const candles = Array.from({ length: 300 }, (_, index) => ({ time: 1735689600 + index * 86400, open: 200 + index / 2, close: 201 + index / 2, high: 205 + index / 2, low: 199 + index / 2, volume: 1e7 }))
  payload.market = {
    symbol: 'MU', company: { name: 'Micron Technology', exchange: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', description: 'Memory and storage' },
    metrics: { marketCap: '$400B', revenue: '$133B', netIncome: '$85B', eps: '$74', grossMargin: '81%', operatingMargin: '75%', netMargin: '64%', sharesOutstanding: '1.1B', pe: '12x', forwardPe: '10.5x', dividend: '$0.60', exDividendDate: '2026-10-14', volume: '10M', beta: '1.5', earningsDate: '2026-12-16' },
    targets: { low: '$300', mean: '$450', high: '$550', upsideToMean: '+28%', upsidePct: 28, analysts: '30' },
    chart: { candles, mfi: [], stats: { symbol: 'MU', currency: 'USD', longName: 'Micron Technology', price: 350, change: 1.2, absChange: 4.2, open: 349, high: 352, low: 347, close: 350, volume: 1e7 } },
    news: [{ id: 'mu-news', ticker: 'MU', title: 'Micron announces memory technology update', source: 'Micron', publishedAt: Date.now(), url: 'https://investors.micron.com/news/' }], institutional: [], insiders: [], missing: [], generatedAt: Date.now(),
  } as StocksPayload
  const quarterly = emptyFundamentalSeriesMap()
  for (const [index, endDate] of ['2025-11-27', '2026-02-26', '2026-05-28', '2026-09-03'].entries()) {
    for (const key of ['revenue', 'netIncome', 'operatingCashFlow', 'freeCashFlow'] as const) quarterly[key].push({ endDate, label: endDate, value: (index + 1) * (key === 'revenue' ? 10e9 : 4e9), source: 'sec' })
  }
  payload.financials = {
    symbol: 'MU', company: { name: 'Micron', exchange: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', currency: 'USD', website: 'https://micron.com', irWebsite: 'https://investors.micron.com' },
    facts: { trailingPe: 12, forwardPe: 10.5, priceToSales: 4, pegRatio: 1, earningsGrowth: 3, enterpriseValue: 300e9, ebitda: 90e9, marketCap: 400e9, totalRevenue: 133e9, freeCashFlow: 62e9, totalCash: 73e9, totalDebt: 5e9, sharesOutstanding: 1e9, beta: 1.5, currentPrice: 350 },
    quarterly, annual: emptyFundamentalSeriesMap(), sec: { available: true, statementsAvailable: true, cik: '0000723125', freshness: 'fresh', statementFreshness: 'fresh', cacheAgeSeconds: 0,
      filings: [{ form: '8-K', filedDate: '2026-09-30', reportPeriod: '2026-09-03', description: 'Earnings release', items: '2.02', accessionNumber: '0000723125-26-000018', documentUrl: 'https://www.sec.gov/Archives/edgar/data/723125/000072312526000018/mu-20260930.htm' }], warnings: [] }, warnings: [], generatedAt: Date.now(),
  }
  payload.progress = { market: 'loaded', financials: 'loaded', earnings: 'loaded', memory: 'loaded' }
  payload.laneFetchedAt = { market: Date.now(), financials: Date.now(), earnings: Date.now(), memory: Date.now() }
  payload.fetchedAt = Date.now()
  return payload
}
