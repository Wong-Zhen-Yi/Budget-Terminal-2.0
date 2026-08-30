import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { QuantScreenRow } from '../electron/shared/contract.js'
import {
  buildPairDetail,
  buildPairSpread,
  buildQuantExport,
  DICKEY_FULLER_CRITICAL_VALUES,
  discoverPairs,
  filterPairRows,
  filterScreenRows,
  hurstExponent,
  meanReversionStats,
  normalizeQuantPageSettings,
  ordinaryLeastSquares,
  rankScreenRows,
  scorePair,
  screenMetrics,
  type QuantBar,
  type QuantCandidate,
} from '../electron/shared/quant.js'
import { yahooProvider } from '../electron/services/provider.js'
import { clearLatestQuant, getLatestQuant, runQuantScan } from '../electron/services/yahoo/quant.js'

function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function normal(random: () => number): number {
  const first = Math.max(random(), Number.EPSILON)
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * random())
}

function randomWalk(count: number, start: number, random: () => number, sigma = 0.012): number[] {
  const values = [start]
  while (values.length < count) values.push(values.at(-1)! * (1 + normal(random) * sigma))
  return values
}

function cointegratedPair(count: number, random: () => number): [number[], number[]] {
  const right = randomWalk(count, 100, random)
  let wobble = 0
  const left = right.map((value) => {
    wobble = 0.85 * wobble + normal(random)
    return 2 * value + wobble
  })
  return [left, right]
}

function bars(values: number[], start = '2022-01-03'): QuantBar[] {
  const first = new Date(`${start}T00:00:00Z`)
  return values.map((close, index) => ({
    date: new Date(first.getTime() + index * 86_400_000).toISOString().slice(0, 10),
    close,
    volume: 1_000_000,
  }))
}

async function offlineChecks(): Promise<void> {
  const x = [1, 2, 3, 4, 5]
  const fit = ordinaryLeastSquares(x.map((value) => 3 + 2 * value), x)
  assert.ok(fit)
  assert.ok(Math.abs(fit.beta - 2) < 1e-9)
  assert.ok(Math.abs(fit.alpha - 3) < 1e-9)
  assert.equal(fit.tStatistic, null)
  assert.equal(ordinaryLeastSquares(x, x.map(() => 1)), null)

  const [left, right] = cointegratedPair(500, rng(7))
  const spread = buildPairSpread(bars(left), bars(right))
  assert.ok(spread.hedgeRatio !== null && Math.abs(spread.hedgeRatio - 2) < 0.1)
  const reversion = meanReversionStats(spread.spread)
  assert.ok(reversion.halfLife !== null && reversion.halfLife > 0 && reversion.halfLife < 30)
  assert.ok(reversion.dickeyFuller !== null && reversion.dickeyFuller < DICKEY_FULLER_CRITICAL_VALUES['5%'])
  assert.ok(['1%', '5%'].includes(reversion.stationaryAt))
  const hurst = hurstExponent(spread.spread)
  assert.ok(hurst !== null && hurst < 0.45)

  const unrelated = randomWalk(500, 50, rng(19))
  const discovered = discoverPairs({ AAA: bars(left), BBB: bars(right), CCC: bars(unrelated) })
  assert.ok(discovered.length)
  assert.deepEqual(new Set([discovered[0].left, discovered[0].right]), new Set(['AAA', 'BBB']))
  assert.ok((discovered[0].score ?? 0) > 60)
  assert.equal(scorePair({ correlation: null, halfLife: 10, dickeyFuller: -4, hurst: 0.2 }), null)

  const rising = Array.from({ length: 400 }, (_, index) => 100 * 1.001 ** index)
  const metrics = screenMetrics(bars(rising))
  assert.equal(metrics.observations, 400)
  assert.ok((metrics.momentum12m ?? 0) > (metrics.momentum1m ?? 0))
  assert.ok(Math.abs(metrics.maxDrawdownPct ?? 1) < 1e-9)
  assert.equal(metrics.rsi, null)

  const template = (ticker: string, values: Partial<QuantScreenRow>): QuantScreenRow => ({
    ticker,
    name: ticker,
    exchange: 'NYSE',
    lastPrice: 100,
    marketCap: 10e9,
    medianDollarVolume: 100e6,
    momentum1m: null,
    momentum3m: null,
    momentum6m: null,
    momentum12m: null,
    volatilityPct: null,
    sharpe: null,
    maxDrawdownPct: null,
    zScore: null,
    rsi: null,
    composite: null,
    rank: 0,
    observations: 400,
    ...values,
  })
  const ranked = rankScreenRows([
    template('AAA', { momentum3m: 10, momentum6m: 20, momentum12m: 30, sharpe: 1.5, volatilityPct: 20, rsi: 70 }),
    template('BBB', { momentum3m: -5, momentum6m: 0, momentum12m: 5, sharpe: 0.2, volatilityPct: 45, rsi: 30 }),
    template('CCC', { momentum3m: 3, volatilityPct: 30 }),
  ])
  assert.equal(ranked[0].ticker, 'AAA')
  assert.equal(ranked[0].composite, 100)
  assert.deepEqual(filterScreenRows(ranked, 'top_quartile').map((row) => row.ticker), ['AAA'])
  assert.deepEqual(filterScreenRows(ranked, 'oversold').map((row) => row.ticker), ['BBB'])
  assert.equal(filterPairRows(discovered, 'fast').every((row) => (row.halfLife ?? 1000) < 20), true)
  assert.deepEqual(normalizeQuantPageSettings({ activeTab: 'bad', screenFilter: 'bad', pairFilter: 'fast', search: ' abc ', pairLeft: ' spy ' }), {
    activeTab: 'screener',
    screenFilter: 'all',
    pairFilter: 'fast',
    search: 'ABC',
    pairLeft: 'SPY',
    pairRight: '',
  })

  const detail = buildPairDetail('AAA', 'BBB', bars(left), bars(right))
  assert.equal(detail.points.length, 500)
  assert.equal(detail.observations, 500)

  const temporary = await mkdtemp(join(tmpdir(), 'budget-terminal-quant-'))
  const previousAppData = process.env.APPDATA
  process.env.APPDATA = temporary
  try {
    const candidates: QuantCandidate[] = [
      { ticker: 'AAA', name: 'AAA', exchange: 'NYSE', marketCap: 10e9, medianDollarVolume: 200e6 },
      { ticker: 'BBB', name: 'BBB', exchange: 'NYSE', marketCap: 9e9, medianDollarVolume: 180e6 },
      { ticker: 'CCC', name: 'CCC', exchange: 'Nasdaq', marketCap: 8e9, medianDollarVolume: 160e6 },
    ]
    const histories = { AAA: bars(left), BBB: bars(right), CCC: bars(unrelated) }
    const payload = await runQuantScan(false, {
      sourceUniverse: async () => ({ candidates, sourcedAt: '2026-08-30T00:00:00.000Z', fromCache: false }),
      fetchHistory: async (symbol) => histories[symbol as keyof typeof histories],
    })
    assert.equal(payload.rows.length, 3)
    assert.ok(payload.pairs.length)
    assert.equal((await getLatestQuant())?.completedAt, payload.completedAt)
    const exported = buildQuantExport(payload, {
      screenRows: payload.rows.slice(0, 1),
      pairRows: payload.pairs.slice(0, 1),
      screenFilterLabel: 'Top quartile',
      pairFilterLabel: 'All pairs',
      search: payload.rows[0].ticker,
      pairDetail: detail,
      generatedAt: new Date('2026-08-30T00:00:00Z'),
    })
    assert.match(exported, /# Quant Screener & Pairs Export/)
    assert.match(exported, /## Inspected pair/)
    assert.match(exported, /1 of 3 rows shown/)
    await clearLatestQuant()
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousAppData
    await rm(temporary, { recursive: true, force: true })
  }

  console.log('Quant offline checks passed: OLS, factor metrics/ranking, cointegration, pair discovery/detail, filters/settings, scan assembly, latest-result cache, and export.')
}

async function liveCheck(left: string, right: string): Promise<void> {
  const envelope = await yahooProvider.quantPair({ left, right, force: true })
  assert.notEqual(envelope.meta.freshness, 'failed', envelope.meta.failureReason ?? '')
  assert.ok(envelope.data && envelope.data.observations > 250)
  console.log(JSON.stringify({
    pair: `${envelope.data.left}/${envelope.data.right}`,
    freshness: envelope.meta.freshness,
    observations: envelope.data.observations,
    correlation: envelope.data.correlation,
    spreadZ: envelope.data.latestZ,
    halfLife: envelope.data.halfLife,
    stationaryAt: envelope.data.stationaryAt || 'no',
    score: envelope.data.score,
  }, null, 2))
}

const args = process.argv.slice(2)
await offlineChecks()
if (!args.includes('--offline')) {
  const symbols = args.filter((argument) => !argument.startsWith('--')).map((symbol) => symbol.trim().toUpperCase())
  await liveCheck(symbols[0] || 'AAPL', symbols[1] || 'MSFT')
}
