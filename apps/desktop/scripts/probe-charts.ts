import assert from 'node:assert/strict'

import type { Candle, ChartsComparePayload, ChartsSeriesPoint } from '../electron/shared/contract.js'
import { CHART_PATTERN_CATALOG } from '../electron/shared/chartPatterns.js'
import {
  aggregateFourHourCandles,
  buildCompareModel,
  buildRelationshipPayload,
  calculateFibonacci,
  calculateMfi,
  calculateSupportResistance,
  rangeForInterval,
  relationshipRangeKey,
  validateRelationshipSymbols,
} from '../electron/shared/charts.js'
import { failed, ok, partial, err } from '../electron/shared/envelope.js'
import { cache as sharedCache, TtlCache } from '../electron/services/cache.js'
import { alignBackward, rsi, sma, toPoints } from '../electron/services/indicators.js'
import { yahooProvider } from '../electron/services/provider.js'
import { yahoo } from '../electron/services/yahoo/client.js'
import { DEFAULT_CHARTS_STATE, normalizeChartsState } from '../src/stores/charts.js'

function candle(time: number, close: number, volume = 1_000): Candle {
  return { time, open: close - 0.5, high: close + 1, low: close - 1, close, volume }
}

async function runOffline(): Promise<void> {
  const normalized = normalizeChartsState({
    symbol: ' aapl ',
    interval: '1 Minute',
    range: '5Y',
    pollSeconds: 99,
    fibLookback: 9_999,
    watchlist: ['spy', 'SPY', ' qqq '],
    relationshipSymbols: ['spy', 'spy'],
    drawingsByContext: {
      'AAPL|1 Minute': [{ id: 'fixture', type: 'trend', anchors: [{ time: 1, price: 10 }, { time: 2, price: 12 }], text: '', color: '#fff', width: 1 }],
    },
  })
  assert.equal(normalized.symbol, 'AAPL')
  assert.equal(normalized.range, '5D')
  assert.equal(normalized.pollSeconds, 0)
  assert.equal(normalized.fibLookback, 500)
  assert.deepEqual(normalized.watchlist, ['SPY', 'QQQ'])
  assert.deepEqual(normalized.relationshipSymbols, ['QQQ', 'SPY'])
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.drawingsByContext)), normalized.drawingsByContext)
  assert.equal(DEFAULT_CHARTS_STATE.symbol, 'SPY')
  assert.equal(DEFAULT_CHARTS_STATE.playbackSpeed, '5x')
  assert.equal(rangeForInterval('1 Month', '1D'), '5Y')
  assert.equal(rangeForInterval('4 Hours', '6M'), '6M')

  const hour = 3_600
  const sessionOne = Array.from({ length: 7 }, (_, index) => candle(1_800_000_000 + index * hour, 100 + index, 10 + index))
  const sessionTwo = Array.from({ length: 5 }, (_, index) => candle(1_800_086_400 + index * hour, 110 + index, 20 + index))
  const fourHour = aggregateFourHourCandles([...sessionTwo].reverse().concat([...sessionOne].reverse()))
  assert.equal(fourHour.length, 4)
  assert.equal(fourHour[0].open, sessionOne[0].open)
  assert.equal(fourHour[0].close, sessionOne[3].close)
  assert.equal(fourHour[0].volume, sessionOne.slice(0, 4).reduce((sum, row) => sum + row.volume, 0))
  assert.equal(fourHour[2].open, sessionTwo[0].open)

  const candles = Array.from({ length: 260 }, (_, index) => candle(1_700_000_000 + index * 86_400, 90 + index * 0.22 + Math.sin(index / 3) * 4, 1_000 + index * 20))
  const rsiValues = rsi(candles.map((row) => row.close), 14)
  const rsiAverage = sma(rsiValues, 14)
  assert.equal(toPoints(candles, rsiValues)[0].time, candles[14].time)
  assert.ok(toPoints(candles, rsiAverage).length > 200)
  const dailyMa = toPoints(candles, sma(candles.map((row) => row.close), 200))
  const intradayTimes = [candles[220].time + 3_600, candles[221].time + 3_600]
  assert.deepEqual(alignBackward(intradayTimes, dailyMa).map((point) => point.value), [dailyMa[21].value, dailyMa[22].value])
  assert.ok(calculateMfi(candles).every((point) => point.value >= 0 && point.value <= 100))
  const levels = calculateSupportResistance(candles)
  assert.ok(levels.support !== null && levels.resistance !== null && levels.support < levels.resistance)
  const fib = calculateFibonacci(candles, 120)
  assert.equal(fib?.levels.length, 7)
  assert.equal(calculateFibonacci(candles, 120, { start: { time: 1, price: 100 }, end: { time: 2, price: 200 } })?.levels[3].price, 150)

  const times = Array.from({ length: 16 }, (_, index) => 1_700_000_000 + index * 86_400)
  const comparePayload: ChartsComparePayload = {
    symbols: ['AAA', 'BBB', 'SHORT'], interval: '1 Day', range: '1M', missing: [],
    series: {
      AAA: times.map((time, index) => ({ time, close: 100 + index })),
      BBB: times.map((time, index) => ({ time, close: 50 + index / 2 })),
      SHORT: times.slice(0, 5).map((time, index) => ({ time, close: 20 + index })),
    },
  }
  const compare = buildCompareModel(comparePayload)
  assert.equal(compare.normalized.AAA[0].value, 0)
  assert.ok(Math.abs(compare.normalized.AAA.at(-1)!.value - 15) < 1e-10)
  assert.ok(Math.abs(compare.correlations[0][1]! - 1) < 1e-10)
  assert.equal(compare.correlations[0][2], null)
  assert.equal(compare.intervalChanges.AAA.length, 15)

  const left: ChartsSeriesPoint[] = [{ time: times[0], close: 100 }]
  const right: ChartsSeriesPoint[] = [{ time: times[0], close: 100 }]
  for (let index = 1; index < times.length; index += 1) {
    const xReturn = (index % 5 - 2) * 0.35 + 0.15
    right.push({ time: times[index], close: right.at(-1)!.close * (1 + xReturn / 100) })
    left.push({ time: times[index], close: left.at(-1)!.close * (1 + (0.1 + 1.5 * xReturn) / 100) })
  }
  const relationship = buildRelationshipPayload(['AAA', 'BBB'], [...left].reverse(), [...right].reverse(), '1Y', 30)
  assert.equal(relationship.points.length, times.length)
  assert.ok(Math.abs(relationship.stats.beta! - 1.5) < 1e-10)
  assert.ok(Math.abs(relationship.stats.alphaDailyPct! - 0.1) < 1e-10)
  assert.ok(Math.abs(relationship.stats.rSquared! - 1) < 1e-10)
  assert.equal(relationship.stats.observations, 15)
  assert.equal(relationshipRangeKey('Max'), 'max')
  assert.throws(() => validateRelationshipSymbols(['SPY', 'spy']), /exactly|different/)

  assert.equal(CHART_PATTERN_CATALOG.length, 24)
  assert.equal(new Set(CHART_PATTERN_CATALOG.map((pattern) => pattern.id)).size, 24)
  assert.deepEqual([...new Set(CHART_PATTERN_CATALOG.map((pattern) => pattern.family))].sort(), ['Channel', 'Compression', 'Continuation', 'Reversal'])
  for (const pattern of CHART_PATTERN_CATALOG) {
    assert.ok(pattern.path.length >= 2)
    assert.ok(pattern.recognition && pattern.confirmation && pattern.invalidation && pattern.target)
  }

  const cache = new TtlCache()
  let calls = 0
  const first = await cache.resolve('fixture', 60_000, async () => { calls += 1; return { value: 7 } })
  const cached = await cache.resolve('fixture', 60_000, async () => { calls += 1; return { value: 8 } })
  assert.equal(first.fromCache, false)
  assert.equal(cached.fromCache, true)
  assert.equal(calls, 1)
  cache.set('stale', { value: 9 }, -1)
  const stale = await cache.resolveWithStaleFallback('stale', -1, async () => { throw new Error('fixture refresh failed') }, { force: true })
  assert.equal(stale.stale, true)
  await assert.rejects(cache.resolveWithStaleFallback('failed', 10, async () => { throw new Error('total fixture failure') }), /total fixture failure/)
  const freshEnvelope = ok({ rows: [1] }, 'fixture')
  const partialEnvelope = partial({ rows: [1] }, [err('fixture', 'BBB failed', 'compare', 'BBB')], 'fixture')
  const failedEnvelope = failed({ rows: [] as number[] }, 'all fixtures failed', 'fixture')
  assert.equal(freshEnvelope.meta.freshness, 'fresh')
  assert.equal(partialEnvelope.meta.freshness, 'partial')
  assert.equal(partialEnvelope.errors[0].symbol, 'BBB')
  assert.equal(failedEnvelope.meta.freshness, 'failed')

  const chartClient = yahoo as unknown as { chart: (symbol: string) => Promise<unknown> }
  const originalChart = yahoo.chart.bind(yahoo) as unknown as (symbol: string) => Promise<unknown>
  const fixtureQuotes = Array.from({ length: 240 }, (_, index) => ({
    date: new Date((1_700_000_000 + index * 86_400) * 1000),
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    adjclose: 100.5 + index,
    volume: 1_000 + index,
  })).reverse()
  try {
    sharedCache.clear()
    chartClient.chart = async () => ({ quotes: fixtureQuotes, meta: { currency: 'USD', longName: 'Fixture Corp' } })
    const injectedFresh = await yahooProvider.chartsHistory({ symbol: 'FIXTURE', interval: '1 Day', range: '1Y', force: true })
    assert.equal(injectedFresh.meta.freshness, 'fresh')
    assert.equal(injectedFresh.data.candles.length, 240)
    assert.ok(injectedFresh.data.candles.every((row, index, rows) => index === 0 || row.time > rows[index - 1].time))
    const injectedCached = await yahooProvider.chartsHistory({ symbol: 'FIXTURE', interval: '1 Day', range: '1Y' })
    assert.equal(injectedCached.meta.freshness, 'cached')
    chartClient.chart = async () => { throw new Error('injected provider outage') }
    const injectedStale = await yahooProvider.chartsHistory({ symbol: 'FIXTURE', interval: '1 Day', range: '1Y', force: true })
    assert.equal(injectedStale.meta.freshness, 'stale')
    assert.equal(injectedStale.data.candles.length, 240)
    const injectedFailed = await yahooProvider.chartsHistory({ symbol: 'NEVER-CACHED', interval: '1 Day', range: '1Y', force: true })
    assert.equal(injectedFailed.meta.freshness, 'failed')
    chartClient.chart = async (symbol) => {
      if (symbol === 'FAIL') throw new Error('injected symbol failure')
      return { quotes: fixtureQuotes, meta: { currency: 'USD', longName: symbol } }
    }
    const injectedPartial = await yahooProvider.chartsCompare({ symbols: ['OK', 'FAIL'], interval: '1 Day', range: '1M', force: true })
    assert.equal(injectedPartial.meta.freshness, 'partial')
    assert.deepEqual(injectedPartial.data.missing, ['FAIL'])
    assert.ok(injectedPartial.data.series.OK.length > 0)
  } finally {
    chartClient.chart = originalChart
    sharedCache.clear()
  }

  console.log('Charts offline checks passed: state, ranges, 4h aggregation, indicators, levels, drawings, compare, relationship, injected provider/cache/error states, out-of-order rows, and 24 patterns.')
}

async function runLive(ticker: string): Promise<void> {
  const peer = ticker === 'SPY' ? 'QQQ' : 'SPY'
  const [history, compare, relationship] = await Promise.all([
    yahooProvider.chartsHistory({ symbol: ticker, interval: '1 Day', range: '1Y', force: true }),
    yahooProvider.chartsCompare({ symbols: [ticker, peer, 'QQQ'], interval: '1 Day', range: '3M', force: true }),
    yahooProvider.chartsRelationship({ symbols: [ticker, peer], range: '3M', rollingWindow: 30, force: true }),
  ])
  assert.ok(history.data.candles.length > 20, history.meta.failureReason ?? 'Charts history was empty.')
  assert.ok(Object.keys(compare.data.series).length >= 2, compare.meta.failureReason ?? 'Fewer than two comparison series loaded.')
  assert.ok(relationship.data.points.length > 20, relationship.meta.failureReason ?? 'Relationship history was empty.')
  const cachedHistory = await yahooProvider.chartsHistory({ symbol: ticker, interval: '1 Day', range: '1Y' })
  assert.equal(cachedHistory.meta.freshness, 'cached')
  console.log(JSON.stringify({
    ticker,
    history: { freshness: history.meta.freshness, candles: history.data.candles.length, interval: history.data.interval },
    compare: { freshness: compare.meta.freshness, healthy: Object.keys(compare.data.series), missing: compare.data.missing },
    relationship: { freshness: relationship.meta.freshness, pair: relationship.data.symbols, observations: relationship.data.stats.observations, beta: relationship.data.stats.beta },
  }, null, 2))
}

const args = process.argv.slice(2)
await runOffline()
if (!args.includes('--offline')) {
  await runLive(args.find((argument) => !argument.startsWith('--'))?.trim().toUpperCase() || 'AAPL')
}
