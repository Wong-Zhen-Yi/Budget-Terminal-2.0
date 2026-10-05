import { emptyAvgoPayload, parseAvgoEarnings } from '../../electron/shared/avgo.js'
import type { StocksPayload } from '../../electron/shared/contract.js'
import { emptyFundamentalSeriesMap } from '../../electron/shared/fundamentalsPage.js'

export const avgoReleaseUrl = 'https://investors.broadcom.com/news-releases/news-release-details/broadcom-inc-announces-third-quarter-fiscal-year-2026-financial'
const row = (cells: string[]) => `<tr>${cells.map(cell => `<td><span>${cell}</span></td>`).join('')}</tr>`
// Representative rows and management disclosures from Broadcom's September 2, 2026 release.
export const avgoReleaseHtml = `<h1>Broadcom Inc. Announces Third Quarter Fiscal Year 2026 Financial Results and Quarterly Dividend</h1>
<script type="application/ld+json">{"datePublished":"2026-09-02T16:15:47-0400"}</script>
<p>September 2, 2026. Broadcom reported results for its third quarter of fiscal year 2026, ended August 2, 2026.</p>
<p>"Demand for our custom AI accelerators and networking continues to be very strong. Q3 AI semiconductor revenue of $16.7 billion grew 221% year-over-year, and 54% quarter-over-quarter," said Hock Tan. "In Q4 the momentum continues, and we expect AI semiconductor revenue to accelerate to $21.7 billion, up 236% year-over-year."</p>
<h2>Third Quarter Fiscal Year 2026 Financial Highlights</h2><table>
${row(['', 'GAAP', 'Non-GAAP'])}
${row(['(Dollars in millions, except per share data)', 'Q3 26', 'Q3 25', 'Change', 'Q3 26', 'Q3 25', 'Change'])}
${row(['Net revenue', '$', '29,591', '$', '15,952', '+86', '%', '$', '29,591', '$', '15,952', '+86', '%'])}
${row(['Operating income', '$', '15,955', '$', '5,887', '+171', '%', '$', '20,095', '$', '10,455', '+92', '%'])}
${row(['Net income', '$', '13,088', '$', '4,140', '+216', '%', '$', '16,372', '$', '8,404', '+95', '%'])}
${row(['Earnings per common share - diluted', '$', '2.68', '$', '0.85', '+215', '%', '$', '3.32', '$', '1.69', '+96', '%'])}</table>
<table>${row(['(Dollars in millions)', 'Q3 26', 'Q3 25', 'Change'])}
${row(['Cash flow from operations', '$', '14,197', '$', '7,166', '+98', '%'])}
${row(['Free cash flow', '$', '13,665', '$', '7,024', '+95', '%'])}</table>
<table>${row(['Net revenue by segment'])}${row(['(Dollars in millions)', 'Q3 26', 'Q3 25', 'Change'])}
${row(['Semiconductor solutions', '$', '20,839', '70', '%', '$', '9,166', '57', '%', '+127', '%'])}
${row(['Infrastructure software', '8,752', '30', '6,786', '43', '+29', '%'])}
${row(['Total net revenue', '$', '29,591', '100', '%', '$', '15,952', '100', '%'])}</table>
<h2>Fourth Quarter Fiscal Year 2026 Business Outlook</h2><p>Fourth quarter revenue guidance of approximately $34.8 billion; Fourth quarter non-GAAP operating income guidance of approximately 66 percent of projected revenue.</p>
<h2>Quarterly Dividends</h2><p>The Board approved a quarterly cash dividend of $0.65 per share.</p>
<h2>Annual Financial Statements</h2><table>${row(['Net revenue', '999,999'])}</table>`

export function avgoFixture() {
  const payload = emptyAvgoPayload()
  payload.earnings = parseAvgoEarnings(avgoReleaseHtml, avgoReleaseUrl, 'FY2026 Q3')
  const candles = Array.from({ length: 300 }, (_, index) => ({ time: 1735689600 + index * 86400, open: 200 + index / 2, close: 201 + index / 2, high: 205 + index / 2, low: 199 + index / 2, volume: 1e7 }))
  payload.market = {
    symbol: 'AVGO', company: { name: 'Broadcom', exchange: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', description: 'Semiconductors and infrastructure software' },
    metrics: { marketCap: '$400B', revenue: '$133B', netIncome: '$85B', eps: '$74', grossMargin: '81%', operatingMargin: '75%', netMargin: '64%', sharesOutstanding: '1.1B', pe: '12x', forwardPe: '10.5x', dividend: '$0.60', exDividendDate: '2026-10-14', volume: '10M', beta: '1.5', earningsDate: '2026-12-16' },
    targets: { low: '$300', mean: '$450', high: '$550', upsideToMean: '+28%', upsidePct: 28, analysts: '30' },
    chart: { candles, mfi: [], stats: { symbol: 'AVGO', currency: 'USD', longName: 'Broadcom', price: 350, change: 1.2, absChange: 4.2, open: 349, high: 352, low: 347, close: 350, volume: 1e7 } },
    news: [{ id: 'avgo-news', ticker: 'AVGO', title: 'Broadcom announces AI networking update', source: 'Broadcom', publishedAt: Date.now(), url: 'https://investors.broadcom.com/news/' }], institutional: [], insiders: [], missing: [], generatedAt: Date.now(),
  } as StocksPayload
  const quarterly = emptyFundamentalSeriesMap()
  for (const [index, endDate] of ['2025-11-27', '2026-02-26', '2026-05-28', '2026-09-03'].entries()) {
    for (const key of ['revenue', 'netIncome', 'operatingCashFlow', 'freeCashFlow'] as const) quarterly[key].push({ endDate, label: endDate, value: (index + 1) * (key === 'revenue' ? 10e9 : 4e9), source: 'sec' })
  }
  payload.financials = {
    symbol: 'AVGO', company: { name: 'Broadcom', exchange: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', currency: 'USD', website: 'https://broadcom.com', irWebsite: 'https://investors.broadcom.com' },
    facts: { trailingPe: 12, forwardPe: 10.5, priceToSales: 4, pegRatio: 1, earningsGrowth: 3, enterpriseValue: 300e9, ebitda: 90e9, marketCap: 400e9, totalRevenue: 133e9, freeCashFlow: 62e9, totalCash: 73e9, totalDebt: 5e9, sharesOutstanding: 1e9, beta: 1.5, currentPrice: 350 },
    quarterly, annual: emptyFundamentalSeriesMap(), sec: { available: true, statementsAvailable: true, cik: '0001730168', freshness: 'fresh', statementFreshness: 'fresh', cacheAgeSeconds: 0,
      filings: [{ form: '8-K', filedDate: '2026-09-30', reportPeriod: '2026-09-03', description: 'Earnings release', items: '2.02', accessionNumber: '0001730168-26-000018', documentUrl: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016826000018/avgo-20260902.htm' }], warnings: [] }, warnings: [], generatedAt: Date.now(),
  }
  payload.progress = { market: 'loaded', financials: 'loaded', earnings: 'loaded' }
  payload.laneFetchedAt = { market: Date.now(), financials: Date.now(), earnings: Date.now() }
  payload.fetchedAt = Date.now()
  return payload
}
