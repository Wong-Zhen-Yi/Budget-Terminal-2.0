import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { discoverHoodDocument, hoodNumber, hoodRevenueMix, parseHoodReport } from '../electron/shared/hood.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { TABS } from '../electron/shared/contract.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-hood-'))
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
try {
  assert.equal(workspaceFor('hood')?.id, 'focus')
  assert(TABS.some(tab => tab.id === 'hood' && tab.label === 'HOOD' && tab.implemented))
  assert(startupPages('dashboard', [], []).includes('hood'))
  const index = '<h2>2025</h2><h3>Monthly Metrics PDF</h3><a href="/static-files/old">Dec</a><h2>2026</h2><h3>Monthly Metrics PDF</h3><a href="/static-files/new">Aug</a><h3>Monthly Metrics Dashboard</h3><a href="/static-files/wrong">Sep</a>'
  assert.deepEqual(discoverHoodDocument(index, 'monthly'), { period: '2026-08', url: 'https://investors.robinhood.com/static-files/new' })
  assert.throws(() => discoverHoodDocument('<h2>2026</h2><h3>Press Release</h3><a href="https://example.com/bad">Q2</a>', 'quarterly'))
  assert.equal(hoodNumber('($8)', 1e6), -8e6)
  assert.equal(hoodNumber('—'), null)
  assert.equal(hoodNumber('NM'), null)
  const monthly = parseHoodReport(`September 10, 2026
Funded Customers1\t28.6\t28.5\t-\t26.7\t+7%
Total Platform Assets1\t$383.7\t$355.0\t+8%\t$303.9\t+26%
Net Deposits1,2\t$4.0\t$5.6\tNM\t$4.8\tNM
Total Trading Volumes
Equity ($B)\t$335.4\t$332.8\t+1%\t$199.2\t+68%
Options Contracts (M)\t292.5\t324.2\t(10%)\t195.5\t+50%
Crypto ($B)\t$17.5\t$10.9\t+61%\t$28.1\t(38%)
Robinhood App ($B)\t$7.4\t$4.3\t+72%\t$13.7\t(46%)
Bitstamp ($B)\t$10.1\t$6.6\t+53%\t$14.4\t(30%)
Event Contracts (B)\t4.7\t6.1\t(23%)\t0.3\t+15x
Average Daily Trading Volumes
Equity ($B)\t$16\t$15.1\t+6%\t$9.5\t+68%
Interest Earning Assets ($B)
Margin Book\t$21.5\t$20.7\t+4%\t$12.5\t+72%
Cash and Deposits4\t$19.6\t$19.5\t+1%\t$14.3\t+37%
Cash Sweep4\t$31.2\t$29.2\t+7%\t$34.1\t(9%)`, { period: '2026-08', url: 'https://investors.robinhood.com/static-files/month' }, 'monthly')
  const metric = (id: string) => monthly.metrics.find(metric => metric.id === id)!
  assert.equal(metric('assets').value, 383.7e9)
  assert.equal(metric('customers').value, 28.6e6)
  assert.equal(metric('equities').value, 335.4e9)
  assert.equal(metric('events').yearChange, '+15x')
  assert.equal(metric('deposits').change, 'NM')
  assert.equal(metric('options').change, '-10%')
  assert.equal(metric('crypto').yearChange, '-38%')
  assert.equal(metric('appCrypto').value! + metric('bitstamp').value!, metric('crypto').value)
  assert.equal(monthly.previousPeriod, '2026-07')
  const quarterly = parseHoodReport(`July 29, 2026
Total net revenues\t$\t989\t$\t1,308\t32%\t$\t1,041\t26%
Transaction-based revenues\t$\t539\t$\t776\t44%\t$\t623\t25%
Net interest revenues\t357\t389\t9%\t359\t8%
Other revenues\t93\t143\t54%\t59\t142%
Net income\t$\t387\t$\t573\t48%\t$\t346\t66%
Diluted EPS\t$\t0.42\t$\t0.62\t48%\t$\t0.38\t63%
Adjusted EBITDA (non-GAAP)\t$\t549\t$\t741\t35%\t$\t580\t28%
Gold Subscribers (M)\t3.5\t4.8\t39%\t4.5\t7%
ARPU\t$\t151\t$\t187\t24%\t$\t153\t22%`, { period: '2026-06', url: 'https://investors.robinhood.com/static-files/quarter' }, 'quarterly')
  assert.equal(quarterly.metrics.find(metric => metric.id === 'revenue')!.value, 1308e6)
  assert.equal(quarterly.metrics.find(metric => metric.id === 'eps')!.value, 0.62)
  assert.equal(quarterly.metrics.find(metric => metric.id === 'events')!.value, null)
  assert.equal(hoodRevenueMix(quarterly).reduce((sum, row) => sum + row.value, 0), 1308e6)
  assert.equal(quarterly.previousPeriod, '2026-03')
  const statement = parseHoodReport(`Net income attributable to Robinhood common stockholders:
Diluted\t386\t561\t350
Net income per share attributable to Robinhood common stockholders:
Diluted\t$\t0.42\t$\t0.62\t$\t0.38
Weighted-average shares used to compute net income per share:
Diluted\t909\t912\t915
Adjusted EBITDA\t$\t549\t$\t741\t$\t580`, { period: '2026-06', url: quarterly.sourceUrl }, 'quarterly')
  assert.equal(statement.metrics.find(metric => metric.id === 'eps')!.value, 0.62, 'EPS must not come from net income or diluted share counts')
  assert.equal(statement.metrics.find(metric => metric.id === 'eps')!.previous, 0.38)
  assert.equal(statement.metrics.find(metric => metric.id === 'ebitda')!.value, 741e6)
  const proseReport = parseHoodReport(`Net Deposits were a record $22 billion, and Robinhood Gold Subscribers reached a record 4.8 million
Second Quarter Results
Transaction-based revenues increased 44% year-over-year to $776 million, primarily driven by event
contracts revenue of $156 million, up over 10x, options revenue of $342 million, up 29%, and equities
revenue of $129 million, up 95%, partially offset by cryptocurrencies revenue of $100 million, down 38%.
Net Deposits were $21.7 billion, an annualized growth rate of 28%.
Robinhood Gold Subscribers increased by 1.4 million, or 39%, year-over-year to 4.8 million.
Average Revenue Per User (“ARPU”) increased 24% year-over-year to $187.
Highlights`, { period: '2026-06', url: quarterly.sourceUrl }, 'quarterly')
  for (const [id, value] of [['deposits', 21.7e9], ['gold', 4.8e6], ['arpu', 187], ['events', 156e6], ['options', 342e6], ['crypto', 100e6], ['equities', 129e6]] as const) {
    assert.equal(proseReport.metrics.find(metric => metric.id === id)!.value, value, `${id} must use precise results prose, including wrapped lines and decimal changes`)
  }
  const { getHood, hoodTesting } = await import('../electron/services/hood.js')
  const { cache } = await import('../electron/services/cache.js')
  if (process.argv.includes('--live')) {
    const result = await getHood({ force: true })
    console.log(JSON.stringify({ meta: result.meta, progress: result.data.progress, monthly: result.data.monthly, quarterly: result.data.quarterly, chartRows: result.data.market?.chart.candles.length, financialQuarters: result.data.financials?.quarterly.revenue.length, errors: result.errors }, null, 2))
    assert(result.data.monthly, 'Live monthly report failed')
    assert(result.data.quarterly, 'Live quarterly report failed')
    assert(result.data.market?.chart.candles.length, 'Live market data failed')
    assert(result.data.financials?.quarterly.revenue.length, 'Live financial statements failed')
    assert(result.data.monthly.metrics.every(metric => metric.value !== null), 'Live monthly report has missing core metrics')
    assert(result.data.quarterly.metrics.every(metric => metric.value !== null), 'Live quarterly report has missing core metrics')
  } else if (process.argv.includes('--reports')) {
    for (const kind of ['monthly', 'quarterly'] as const) console.log(JSON.stringify(await hoodTesting.fetchReport(kind), null, 2))
  } else {
    const fail = async (): Promise<never> => { throw new Error('Fixture offline') }
    const first = await getHood({ force: true }, { market: fail, financials: fail, report: async kind => kind === 'monthly' ? monthly : quarterly })
    assert.equal(first.meta.freshness, 'partial')
    assert.equal(first.data.progress.market, 'unavailable')
    assert.equal(first.data.progress.monthly, 'loaded')
    const stale = await getHood({ force: true }, { market: fail, financials: fail, report: fail })
    assert.equal(stale.meta.freshness, 'stale')
    assert.equal(stale.data.progress.monthly, 'stale')
    assert.deepEqual(stale.data.monthly, monthly)
    cache.clear()
    const failed = await getHood({ force: true }, { market: fail, financials: fail, report: fail })
    assert.equal(failed.meta.freshness, 'failed')
  }
  console.log('HOOD checks passed: discovery, units, comparisons, periods, composition and independent failures.')
} finally {
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
