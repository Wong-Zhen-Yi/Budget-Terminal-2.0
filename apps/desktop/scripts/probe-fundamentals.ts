import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  FundamentalSeriesPoint,
  FundamentalsPagePayload,
} from '../electron/shared/contract.js'
import {
  buildFundamentalsCharts,
  combineCashAndBonds,
  combineDebt,
  computeGrowth,
  computeHeadlineMetrics,
  filterFundamentalsFilings,
  indexSeriesValues,
  mergeMetricSeries,
  normalizePeriodCount,
  seriesBarGeometry,
  subtractSeries,
} from '../electron/shared/fundamentalsPage.js'
import { clearSecCaches, secTesting } from '../electron/services/secEdgar.js'
import {
  emptyFundamentalsPagePayload,
  fundamentalsPageTesting,
  getFundamentalsPage,
} from '../electron/services/yahoo/fundamentalsPage.js'
import { yahooProvider } from '../electron/services/provider.js'

function point(endDate: string, label: string, value: number, source: FundamentalSeriesPoint['source'] = 'yahoo'): FundamentalSeriesPoint {
  return { endDate, label, value, source }
}

function fixturePayload(symbol = 'AAA'): FundamentalsPagePayload {
  const payload = emptyFundamentalsPagePayload(symbol)
  payload.company.name = `${symbol} Corporation`
  payload.facts = {
    trailingPe: 20,
    forwardPe: 18,
    priceToSales: 4,
    pegRatio: 2,
    earningsGrowth: 0.12,
    enterpriseValue: 1_800,
    ebitda: 180,
    marketCap: 2_000,
    totalRevenue: 500,
    freeCashFlow: 50,
    totalCash: 300,
    totalDebt: 100,
    sharesOutstanding: 100,
    beta: 1.2,
    currentPrice: 20,
  }
  for (const key of Object.keys(payload.annual) as Array<keyof typeof payload.annual>) {
    payload.annual[key] = [
      point('2022-12-31', '2022', key === 'netIncome' ? -10 : 100, 'sec'),
      point('2023-12-31', '2023', key === 'netIncome' ? -5 : 120, 'sec'),
      point('2024-12-31', '2024', key === 'netIncome' ? 5 : 150, 'sec'),
    ]
    payload.quarterly[key] = [
      point('2024-03-31', '2024-Q1', 20, 'sec'),
      point('2024-06-30', '2024-Q2', 25, 'sec'),
      point('2024-09-30', '2024-Q3', 30, 'sec'),
      point('2024-12-31', '2024-Q4', 35, 'derived'),
      point('2025-03-31', '2025-Q1', 40, 'sec'),
    ]
  }
  payload.generatedAt = Date.now()
  return payload
}

async function runOffline(): Promise<void> {
  const merged = mergeMetricSeries(
    [
      point('2023-12-31', '2023', 90),
      point('2024-09-30', '2024', 100),
      point('2025-09-30', '2025', 130),
    ],
    [
      point('2024-09-28', '2024', 110, 'sec'),
      point('2025-10-10', '2025', 125, 'sec'),
    ],
  )
  assert.deepEqual(merged.map((item) => item.label), ['2023', '2024', '2025'])
  assert.equal(merged.find((item) => item.label === '2024')?.value, 110)
  assert.equal(merged.find((item) => item.label === '2025')?.value, 125)
  assert.equal(new Set(merged.map((item) => item.label)).size, merged.length)

  const secFixture = {
    facts: {
      'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              { start: '2024-01-01', end: '2024-03-31', filed: '2024-05-01', form: '10-Q', fp: 'Q1', accn: 'q1', val: 200 },
              { start: '2024-01-01', end: '2024-06-30', filed: '2024-08-01', form: '10-Q', fp: 'Q2', accn: 'q2', val: 450 },
              { start: '2024-01-01', end: '2024-09-30', filed: '2024-11-01', form: '10-Q', fp: 'Q3', accn: 'q3', val: 700 },
              { start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', form: '10-K', fp: 'FY', accn: 'fy', val: 1_000 },
            ],
          },
        },
      },
    },
  }
  const statements = secTesting.normalizeStatements(secFixture)
  assert.deepEqual(statements.quarterly.revenue.map((item) => item.value), [200, 250, 250, 300])
  assert.equal(statements.quarterly.revenue.at(-1)?.source, 'derived')

  assert.deepEqual(
    subtractSeries([point('2024-12-31', '2024', 100)], [point('2024-12-31', '2024', -30)]).map((item) => item.value),
    [70],
  )
  assert.equal(combineCashAndBonds(
    [point('2024-12-31', '2024', 100)],
    [point('2024-12-31', '2024', 70)],
    [point('2024-12-31', '2024', 30)],
    [point('2024-12-31', '2024', 20)],
  )[0]?.value, 120)
  assert.equal(combineDebt(
    [point('2024-12-31', '2024', 95)],
    [point('2024-12-31', '2024', 20)],
    [point('2024-12-31', '2024', 80)],
  )[0]?.value, 95)
  assert.deepEqual(combineDebt(
    [point('2024-12-31', '2024', 95)],
    [point('2023-12-31', '2023', 20)],
    [point('2023-12-31', '2023', 80)],
  ).map((item) => item.value), [100, 95])
  assert.equal(combineDebt(
    [],
    [point('2024-12-31', '2024', 20)],
    [point('2024-12-31', '2024', 80)],
  )[0]?.value, 100)

  assert.equal(normalizePeriodCount(1), 3)
  assert.equal(normalizePeriodCount(30), 16)
  assert.equal(normalizePeriodCount('bad'), 12)
  const priorGrowth = computeGrowth([
    point('2022-12-31', '2022', 0),
    point('2023-12-31', '2023', -10),
    point('2024-12-31', '2024', -5),
  ], 'prior_period')
  assert.deepEqual(priorGrowth.map((item) => item.growth), [null, null, 50])
  const yoyGrowth = computeGrowth([
    point('2024-03-31', '2024-Q1', -10),
    point('2025-03-31', '2025-Q1', -20),
  ], 'year_ago')
  assert.deepEqual(yoyGrowth.map((item) => item.growth), [null, -100])
  assert.deepEqual(indexSeriesValues([0, 5, 10]).values, [0, 100, 200])
  assert.deepEqual(indexSeriesValues([-2, -1]).values, [-100, -50])

  const headlinePayload = fixturePayload()
  headlinePayload.quarterly.revenue = [
    point('2024-03-31', '2024-Q1', 100),
    point('2024-06-30', '2024-Q2', 110),
    point('2024-09-30', '2024-Q3', 120),
    point('2024-12-31', '2024-Q4', 130),
  ]
  headlinePayload.quarterly.freeCashFlow = [
    point('2024-03-31', '2024-Q1', 10),
    point('2024-06-30', '2024-Q2', 11),
    point('2024-09-30', '2024-Q3', 12),
    point('2024-12-31', '2024-Q4', 13),
  ]
  headlinePayload.quarterly.cashAndBonds = [point('2024-12-31', '2024-Q4', 300)]
  headlinePayload.quarterly.totalDebt = [point('2024-12-31', '2024-Q4', 100)]
  const metrics = computeHeadlineMetrics(headlinePayload)
  assert.equal(metrics.fcfMarginPct, 10)
  assert.equal(metrics.evRevenue, 1_800 / 460)
  assert.equal(metrics.netCash, 200)
  headlinePayload.quarterly.revenue[3].endDate = '2026-12-31'
  assert.equal(computeHeadlineMetrics(headlinePayload).evRevenue, 12)

  const primary = fixturePayload('AAA')
  const comparison = fixturePayload('BBB')
  comparison.annual.revenue = [
    point('2022-06-30', '2022', 80),
    point('2023-06-30', '2023', 90),
    point('2024-06-30', '2024', 95),
  ]
  const charts = buildFundamentalsCharts(primary, comparison, {
    period: 'annual',
    periodCount: 3,
    indexed: false,
    growthBasis: 'year_ago',
  })
  assert.equal(charts.length, 6)
  assert.deepEqual(charts[0].labels, ['2022', '2023', '2024'])
  assert.equal(charts[0].series.length, 2)
  assert.equal(charts[0].series[0].filled, true)
  assert.equal(charts[0].series[1].filled, false)
  assert.deepEqual(seriesBarGeometry(2).map((item) => item.offset), [-0.225, 0.225])
  const indexedCharts = buildFundamentalsCharts(primary, null, {
    period: 'annual',
    periodCount: 3,
    indexed: true,
    growthBasis: 'prior_period',
  })
  assert.deepEqual(indexedCharts[1].series[0].points.map((item) => item.value), [-100, -50, 50])

  const filings = secTesting.normalizeFilings({
    filings: { recent: {
      form: ['10-Q', '8-K', 'S-8'],
      filingDate: ['2026-08-01', '2026-07-01', '2026-06-01'],
      reportDate: ['2026-06-30', '2026-07-01', ''],
      accessionNumber: ['0000320193-26-000001', '0000320193-26-000002', '0000320193-26-000003'],
      primaryDocument: ['a10q.htm', 'a8k.htm', 's8.htm'],
      primaryDocDescription: ['Quarterly report', 'Current report', 'Stock plan'],
      items: ['', '2.02', ''],
    } },
  }, '0000320193')
  assert.equal(filings.length, 2)
  assert.ok(filings.every((filing) => filing.documentUrl.startsWith('https://www.sec.gov/Archives/edgar/data/')))
  assert.deepEqual(filterFundamentalsFilings(filings, 'current', '8-K').map((filing) => filing.form), ['8-K'])

  const summaryFixture = fixturePayload('TEST')
  const yahooPartial = await fundamentalsPageTesting.fetchUncached('TEST', false, {
    summary: async () => ({ company: summaryFixture.company, facts: summaryFixture.facts }),
    annual: async () => [{ date: new Date('2024-12-31T00:00:00Z'), totalRevenue: 100 }],
    quarterly: async () => { throw new Error('quarterly fixture unavailable') },
    sec: async () => { throw new Error('SEC fixture unavailable') },
    price: async () => null,
  })
  assert.equal(yahooPartial.payload.annual.revenue[0]?.value, 100)
  assert.equal(yahooPartial.failures.length, 2)

  const secOnlyPayload = fixturePayload('TEST')
  const secOnly = await fundamentalsPageTesting.fetchUncached('TEST', false, {
    summary: async () => { throw new Error('summary fixture unavailable') },
    annual: async () => { throw new Error('annual fixture unavailable') },
    quarterly: async () => { throw new Error('quarterly fixture unavailable') },
    sec: async () => ({
      annual: secOnlyPayload.annual,
      quarterly: secOnlyPayload.quarterly,
      metadata: {
        available: true,
        statementsAvailable: true,
        cik: '0000000001',
        freshness: 'cached',
        statementFreshness: 'cached',
        cacheAgeSeconds: 60,
        filings: [],
        warnings: [],
      },
    }),
    price: async () => null,
  })
  assert.ok(secOnly.payload.annual.revenue.length > 0)
  assert.equal(secOnly.failures.length, 3)

  await checkSecCacheLifecycle()
  await checkYahooRateGateSource()
  console.log('Fundamentals offline checks passed: merge/derivations, metrics, growth/indexing, comparison geometry, filings, partial-provider degradation, provider pacing, and SEC cache lifecycle.')
}

async function checkSecCacheLifecycle(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'budget-terminal-fundamentals-probe-'))
  const previousLocal = process.env.LOCALAPPDATA
  const previousApp = process.env.APPDATA
  const originalFetch = globalThis.fetch
  process.env.LOCALAPPDATA = root
  process.env.APPDATA = root
  const secRoot = secTesting.cacheRoot()
  const target = join(secRoot, 'fixture-key.json')
  try {
    await mkdir(secRoot, { recursive: true })
    await writeFile(target, JSON.stringify({ storedAt: Date.now(), payload: { state: 'fresh-cache' } }), 'utf8')
    const cached = await secTesting.cachedJson('fixture', 'key', 'https://example.test/sec', 60_000, false)
    assert.equal(cached.metadata.freshness, 'cached')
    assert.equal(cached.payload.state, 'fresh-cache')

    globalThis.fetch = async () => new Response('{}', { status: 404 })
    await writeFile(target, JSON.stringify({ storedAt: Date.now() - 2 * 86_400_000, payload: { state: 'stale-cache' } }), 'utf8')
    const stale = await secTesting.cachedJson('fixture', 'key', 'https://example.test/sec', 60_000, true)
    assert.equal(stale.metadata.freshness, 'stale')
    assert.equal(stale.payload.state, 'stale-cache')

    await writeFile(target, JSON.stringify({ storedAt: Date.now() - 8 * 86_400_000, payload: { state: 'expired' } }), 'utf8')
    await assert.rejects(() => secTesting.cachedJson('fixture', 'key', 'https://example.test/sec', 60_000, true))

    await writeFile(target, JSON.stringify({ storedAt: Date.now(), payload: {} }), 'utf8')
    const reset = await yahooProvider.resetCache()
    assert.equal(reset.data.performed, true)
    await assert.rejects(() => access(target))
  } finally {
    globalThis.fetch = originalFetch
    await clearSecCaches()
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previousLocal
    if (previousApp === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousApp
    await rm(root, { recursive: true, force: true })
  }
}

async function checkYahooRateGateSource(): Promise<void> {
  const source = await readFile(new URL('../electron/services/yahoo/fundamentalsPage.ts', import.meta.url), 'utf8')
  const calls = source.split('\n').filter((line) => line.includes('yahoo.') && !line.includes("from './client"))
  assert.ok(calls.length >= 4)
  assert.ok(calls.every((line) => line.includes('paced(')), `Yahoo call bypassed paced(): ${calls.find((line) => !line.includes('paced('))}`)
}

async function runLive(symbol: string): Promise<void> {
  const { payload, failures, stale } = await getFundamentalsPage(symbol, true)
  const charts = buildFundamentalsCharts(payload, null, {
    period: 'annual',
    periodCount: 12,
    indexed: false,
    growthBasis: 'year_ago',
  })
  assert.equal(payload.symbol, symbol)
  assert.ok(payload.company.name)
  assert.ok(payload.facts.currentPrice !== null || charts.some((chart) => chart.series.length))
  assert.equal(charts.length, 6)
  assert.ok(charts.every((chart) => chart.series.some((series) => series.points.length)), 'All six chart families should contain a rendered series.')
  for (const map of [payload.annual, payload.quarterly]) {
    for (const series of Object.values(map)) {
      assert.equal(new Set(series.map((item) => item.label)).size, series.length, 'Statement labels must be unique.')
    }
  }
  assert.ok(payload.sec.filings.length > 0, 'Expected SEC filings for a domestic live probe ticker.')
  assert.ok(payload.sec.filings.every((filing) => /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//.test(filing.documentUrl)))
  assert.ok(payload.sec.cik || !payload.sec.available)
  assert.ok(['fresh', 'cached', 'stale', 'failed', 'unavailable'].includes(payload.sec.freshness))
  console.log(JSON.stringify({
    symbol: payload.symbol,
    company: payload.company.name,
    annualPeriods: Math.max(...Object.values(payload.annual).map((series) => series.length)),
    quarterlyPeriods: Math.max(...Object.values(payload.quarterly).map((series) => series.length)),
    chartFamilies: charts.map((chart) => ({ title: chart.title, series: chart.series.length, labels: chart.labels.length })),
    filings: payload.sec.filings.length,
    sec: payload.sec,
    stale,
    failures,
  }, null, 2))
}

const args = process.argv.slice(2)
await runOffline()
if (!args.includes('--offline')) {
  const symbol = args.find((argument) => !argument.startsWith('--'))?.trim().toUpperCase() || 'AAPL'
  await runLive(symbol)
}
