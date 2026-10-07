import { emptyVstPayload, parseVstEarnings, parseVstOperations } from '../../electron/shared/vst.js'
import type { StocksPayload } from '../../electron/shared/contract.js'
import { emptyFundamentalSeriesMap } from '../../electron/shared/fundamentalsPage.js'

export const vstReleaseUrl = 'https://investor.vistracorp.com/2026-08-07-Vistra-Reports-Second-Quarter-2026-Results'
const row = (cells: string[]) => `<tr>${cells.map(cell => `<td><span>${cell}</span></td>`).join('')}</tr>`
// Selected numeric disclosures from the linked release, preserving quarterly/YTD column order.
export const vstReleaseHtml = `<h1>Vistra Reports Second Quarter 2026 Results</h1>
<p>IRVING, Texas, Aug. 7, 2026</p><h2>Summary of Financial Results</h2><p>(Millions of Dollars)</p>
<table>${row(['', 'Three Months Ended June 30,', 'Six Months Ended June 30,'])}
${row(['', '2026', '2025', '2026', '2025'])}
${row(['Net income', '$', '305', '$', '327', '$', '1,334', '$', '59'])}
${row(['Ongoing operations Adjusted EBITDA<sup>1</sup>', '$', '1,767', '$', '1,349', '$', '3,261', '$', '2,589'])}
${row(['Adjusted EBITDA by Segment'])}
${row(['Retail', '773', '756', '841', '940'])}
${row(['Texas', '311', '142', '897', '632'])}
${row(['East', '642', '418', '1,443', '932'])}
${row(['West', '68', '49', '124', '111'])}
${row(['Corporate and Other', '(27)', '(16)', '(44)', '(26)'])}
${row(['Asset Closure', '(23)', '(17)', '(42)', '(41)'])}</table>
<h2>Guidance</h2><table>${row(['($ in millions)', 'Reaffirmed 2026 Guidance Ranges'])}
${row(['Ongoing Operations Adjusted EBITDA', '$6,800 - $7,600'])}
${row(['Ongoing Operations Adjusted FCFbG', '$3,925 - $4,725'])}</table>
<p>As of Aug. 3, 2026, Vistra had hedged approximately 100% of its expected generation volumes for 2026, approximately 94% for 2027, and approximately 72% for 2028.</p>
<table>${row(['Annual net income', '999,999'])}</table>`

export const vstOperationsUrl = 'https://www.sec.gov/Archives/edgar/data/1692819/000169281926000019/vistra-20260630.htm'
// Selected 10-Q table cells; current/prior and quarter/YTD headers preserve source ordering.
const revenueHeader = row(['Three Months Ended June 30, 2026'])
  + row(['Retail', 'Texas', 'East', 'West', 'Asset Closure', 'Eliminations / Corporate and Other', 'Consolidated']) + row(['(in millions)'])
const revenueRows = [
  ['Revenue from contracts with customers:'],
  ['Retail energy charge in ERCOT', '$', '2,253', '$', '&#8212;', '$', '&#8212;', '$', '&#8212;', '$', '&#8212;', '$', '&#8212;', '$', '2,253'],
  ['Retail energy charge in Northeast/Midwest', '1,091', '-', '-', '-', '-', '-', '1,091'],
  ['Wholesale generation revenue from ISO/RTO', '-', '106', '496', '18', '-', '-', '620'],
  ['Capacity revenue from ISO/RTO (a)', '-', '-', '134', '-', '-', '-', '134'],
  ['Revenue from other wholesale contracts', '-', '97', '144', '61', '-', '1', '303'],
  ['Total revenue from contracts with customers', '3,344', '203', '774', '79', '-', '1', '4,401'],
  ['Other revenues:'],
  ['Transferable PTC revenues (b)', '-', '3', '-', '-', '-', '-', '3'],
  ['Hedging revenues &#8212; realized', '188', '( 36 )', '( 22 )', '24', '-', '-', '154'],
  ['Hedging revenues &#8212; unrealized', '57', '63', '( 650 )', '( 32 )', '-', '-', '( 562 )'],
  ['Business interruption insurance proceeds', '-', '22', '-', '-', '-', '-', '22'],
  ['Intangible amortization and other revenues', '-', '-', '( 1 )', '-', '-', '-', '( 1 )'],
  ['Intersegment sales', '21', '755', '942', '-', '-', '( 1,718 )', '-'],
  ['Intersegment sales &#8212; unrealized', '-', '408', '( 89 )', '-', '-', '( 319 )', '-'],
  ['Total other revenues', '266', '1,215', '180', '( 8 )', '-', '( 2,037 )', '( 384 )'],
  ['Total revenues', '$', '3,610', '$', '1,418', '$', '954', '$', '71', '$', '-', '$', '( 2,036 )', '$', '4,017'],
].map(row).join('')
const production = (rows: string[][]) => `<table>${row(['Three Months Ended June 30,', 'Six Months Ended June 30,'])}
${row(['2026', '2025', '2026', '2025'])}${row(['Production volumes (GWh):'])}${rows.map(row).join('')}
${row(['Capacity factors:'])}${row(['Nuclear facilities', '90.0', '%', '90.7', '%', '91.0', '%', '89.3', '%'])}</table>`
export const vstOperationsHtml = `<h1>Vistra 10-Q</h1>
<table>${revenueHeader.replaceAll('2026', '2025')}${revenueRows.replaceAll('4,017', '4,250')}</table>
<table>${revenueHeader.replace('Three Months', 'Six Months')}${revenueRows.replaceAll('4,017', '9,657')}</table>
<table>${revenueHeader}${revenueRows}</table>
${production([
  ['Natural gas facilities', '11,605', '11,200', '20,864', '20,345'],
  ['Lignite and coal facilities', '6,309', '4,871', '11,729', '10,308'],
  ['Nuclear facilities', '4,456', '4,490', '9,680', '9,719'],
  ['Solar facilities', '278', '213', '512', '375'],
])}
${production([
  ['Natural gas facilities', '15,805', '12,198', '33,255', '26,840'],
  ['Lignite and coal facilities', '3,058', '4,020', '7,472', '9,194'],
  ['Nuclear facilities', '7,954', '8,017', '15,998', '15,696'],
  ['Solar facilities', '214', '67', '269', '111'],
])}
${production([['Natural gas facilities', '578', '545', '965', '1,047']])}`

export function vstFixture() {
  const payload = emptyVstPayload()
  payload.earnings = parseVstEarnings(vstReleaseHtml, vstReleaseUrl, '2026 Q2')
  payload.operations = parseVstOperations(vstOperationsHtml, vstOperationsUrl, '2026-06-30', '2026-08-07')
  const candles = Array.from({ length: 300 }, (_, index) => ({ time: 1767225600 + index * 86400, open: 130 + index / 5, close: 131 + index / 5, high: 135 + index / 5, low: 129 + index / 5, volume: 1e7 }))
  // Synthetic market/statement values for deterministic UI and caching checks.
  payload.market = {
    symbol: 'VST', company: { name: 'Vistra', exchange: 'NYSE', sector: 'Utilities', industry: 'Utilities - Independent Power Producers', description: 'Retail electricity and power generation' },
    metrics: { marketCap: '$60B', revenue: '$18B', netIncome: '$2B', eps: '$5', grossMargin: '40%', operatingMargin: '20%', netMargin: '12%', sharesOutstanding: '336M', pe: '32x', forwardPe: '25x', dividend: '$0.90', exDividendDate: '2026-09-22', volume: '10M', beta: '1.5', earningsDate: '2026-11-06' },
    targets: { low: '$150', mean: '$210', high: '$250', upsideToMean: '+20%', upsidePct: 20, analysts: '20' },
    chart: { candles, mfi: [], stats: { symbol: 'VST', currency: 'USD', longName: 'Vistra', price: 190, change: 1.2, absChange: 2.28, open: 189, high: 192, low: 187, close: 190, volume: 1e7 } },
    news: [{ id: 'vst-news', ticker: 'VST', title: 'Vistra announces generation update', source: 'Vistra', publishedAt: Date.now(), url: 'https://investor.vistracorp.com/news' }], institutional: [], insiders: [], missing: [], generatedAt: Date.now(),
  } as StocksPayload
  const quarterly = emptyFundamentalSeriesMap()
  for (const [index, endDate] of ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'].entries()) {
    for (const key of ['revenue', 'netIncome', 'operatingCashFlow', 'freeCashFlow'] as const) quarterly[key].push({ endDate, label: endDate, value: (index + 1) * (key === 'revenue' ? 1e9 : 0.2e9), source: 'sec' })
  }
  quarterly.netIncome[1].value = -268e6
  quarterly.freeCashFlow[0].value = -100e6
  payload.financials = {
    symbol: 'VST', company: { name: 'Vistra', exchange: 'NYSE', sector: 'Utilities', industry: 'Independent Power Producers', currency: 'USD', website: 'https://vistracorp.com', irWebsite: 'https://investor.vistracorp.com' },
    facts: { trailingPe: 32, forwardPe: 25, priceToSales: 4, pegRatio: 1, earningsGrowth: 0.3, enterpriseValue: 75e9, ebitda: 7e9, marketCap: 60e9, totalRevenue: 18e9, freeCashFlow: 3e9, totalCash: 435e6, totalDebt: 15e9, sharesOutstanding: 336e6, beta: 1.5, currentPrice: 190 },
    quarterly, annual: emptyFundamentalSeriesMap(), sec: { available: true, statementsAvailable: true, cik: '0001692819', freshness: 'fresh', statementFreshness: 'fresh', cacheAgeSeconds: 0,
      filings: [{ form: '8-K', filedDate: '2026-08-07', reportPeriod: '2026-08-07', description: 'Earnings release', items: '2.02', accessionNumber: '0001692819-26-000017', documentUrl: 'https://www.sec.gov/Archives/edgar/data/1692819/000169281926000017/vistra-20260807.htm' }], warnings: [] }, warnings: [], generatedAt: Date.now(),
  }
  payload.progress = { market: 'loaded', financials: 'loaded', earnings: 'loaded', operations: 'loaded' }
  payload.laneFetchedAt = { market: Date.now(), financials: Date.now(), earnings: Date.now(), operations: Date.now() }
  payload.fetchedAt = Date.now()
  return payload
}
