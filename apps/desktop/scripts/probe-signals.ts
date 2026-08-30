import assert from 'node:assert/strict'

import type { SignalCandidate } from '../electron/shared/contract.js'
import {
  alignBenchmark,
  buildRisk,
  calculateIndicators,
  classifySignal,
  completedMedianDollarVolume,
  evaluateDailySignalAtIndex,
  evaluateSignal,
  rankSignalCandidates,
  relativeReadAt,
  scoreRegime,
  signalBacktestSamples,
  signalCandidateFromQuote,
  signalVisible,
  summarizeBacktestSamples,
  summarizeSignals,
  SIGNAL_MAX_SCORE,
  type SignalBar,
  type SignalFrames,
} from '../electron/shared/signals.js'
import { yahooProvider } from '../electron/services/provider.js'

const NOW = Date.UTC(2026, 7, 12, 17, 30)

function frame(
  closes: number[],
  intervalMs: number,
  options: { volumes?: number[]; end?: number; highs?: number[] } = {},
): SignalBar[] {
  const end = options.end ?? NOW
  const start = end - (closes.length - 1) * intervalMs
  return closes.map((close, index) => ({
    timestamp: start + index * intervalMs,
    open: close - 0.08,
    high: options.highs?.[index] ?? close + 0.12,
    low: close - 0.18,
    close,
    volume: options.volumes?.[index] ?? 1_000,
  }))
}

function linear(start: number, end: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + (end - start) * index / (count - 1))
}

/** A clean uptrend with a live breakout, elevated volume and a benchmark that is falling. */
function bullishFrames(extended = false): SignalFrames {
  const momentum = Array.from(
    { length: 90 },
    (_, index) => 120 + index * 0.035 + Math.sin(index / 2.5) * 0.55,
  )
  // The intraday frames continue the daily frame's own price, as a real ticker's would.
  const setup = linear(168, 170, 45)
  setup[setup.length - 1] = Math.max(...setup.slice(0, -1)) + 1
  const setupVolume = Array(45).fill(1_000)
  setupVolume[setupVolume.length - 1] = 2_000
  const entry = linear(170, 170.4, 30)
  if (extended) entry[entry.length - 1] = 180
  const trendCloses = linear(100, 170, 320)
  return {
    trend: frame(trendCloses, 86_400_000, { volumes: Array(320).fill(1_000) }),
    momentum: frame(momentum, 3_600_000),
    setup: frame(setup, 300_000, { volumes: setupVolume }),
    entry: frame(entry, 60_000),
  }
}

function weakFrames(): SignalFrames {
  return {
    trend: frame(linear(170, 100, 320), 86_400_000),
    momentum: frame(linear(130, 110, 90), 3_600_000),
    setup: frame(linear(120, 115, 45), 300_000),
    entry: frame(linear(116, 114, 30), 60_000),
  }
}

/** A falling benchmark, so the fixture's alpha is unambiguously positive. */
function benchmarkFrame(): SignalBar[] {
  return frame(linear(100, 70, 320), 86_400_000)
}

function risingBenchmark(): SignalBar[] {
  return frame(linear(100, 160, 320), 86_400_000)
}

function quote(ticker: string, overrides: Record<string, unknown> = {}) {
  return {
    symbol: ticker,
    quoteType: 'EQUITY',
    exchange: 'NMS',
    regularMarketPrice: 100,
    marketCap: 10e9,
    averageDailyVolume3Month: 1_000_000,
    shortName: `${ticker} Inc`,
    ...overrides,
  }
}

function candidate(ticker: string, overrides: Partial<SignalCandidate> = {}): SignalCandidate {
  return {
    ticker,
    name: ticker,
    exchange: 'Nasdaq',
    price: 100,
    marketCap: 20e9,
    estimatedDollarVolume: 100e6,
    medianDollarVolume: 40e6,
    dailyPreScore: 0,
    qualityRank: 1,
    reasons: [],
    ...overrides,
  }
}

function universeChecks(): void {
  assert.equal(signalCandidateFromQuote(quote('AAA'))?.exchange, 'Nasdaq')
  assert.equal(signalCandidateFromQuote(quote('ETF', { quoteType: 'ETF' })), null)
  assert.equal(signalCandidateFromQuote(quote('OTC', { exchange: 'PNK' })), null)
  assert.equal(signalCandidateFromQuote(quote('LOW', { regularMarketPrice: 4.99 })), null)
  assert.equal(signalCandidateFromQuote(quote('SMALL', { marketCap: 1.99e9 })), null)

  // The prefilter reads the screener's own average volume, so it costs no request.
  assert.equal(signalCandidateFromQuote(quote('AAA'))?.estimatedDollarVolume, 100e6)
  assert.equal(
    signalCandidateFromQuote(quote('THIN', { averageDailyVolume3Month: undefined, averageDailyVolume10Day: 50_000 }))?.estimatedDollarVolume,
    5e6,
  )
  assert.equal(
    signalCandidateFromQuote(quote('NOVOL', { averageDailyVolume3Month: undefined }))?.estimatedDollarVolume,
    0,
  )

  const liquidityBars = frame(Array(21).fill(100), 86_400_000, {
    volumes: [...Array(20).fill(400_000), 100_000_000],
    end: Date.UTC(2026, 7, 15),
  })
  assert.equal(completedMedianDollarVolume(liquidityBars, '2026-08-15'), 40_000_000)

  // Liquidity still breaks ties, but the daily sub-model decides the order.
  const byLiquidity = rankSignalCandidates([
    candidate('AAA', { medianDollarVolume: 40e6 }),
    candidate('BBB', { medianDollarVolume: 100e6, marketCap: 10e9 }),
  ])
  assert.deepEqual(byLiquidity.map((entry) => entry.ticker), ['BBB', 'AAA'])
  assert.deepEqual(byLiquidity.map((entry) => entry.qualityRank), [1, 2])

  const bySetup = rankSignalCandidates([
    candidate('AAA', { medianDollarVolume: 40e6, dailyPreScore: 0.9 }),
    candidate('BBB', { medianDollarVolume: 100e6, dailyPreScore: 0.1 }),
  ])
  assert.deepEqual(bySetup.map((entry) => entry.ticker), ['AAA', 'BBB'])
}

function scoringChecks(): void {
  const benchmark = benchmarkFrame()
  const regime = scoreRegime(risingBenchmark(), frame(linear(30, 14, 300), 86_400_000), 'SPY', NOW)
  assert.equal(regime.label, 'RISK_ON')
  assert.equal(regime.longThreshold, 0.6)

  const strong = evaluateSignal('TEST', bullishFrames(), { benchmark, benchmarkSymbol: 'SPY', regime, now: NOW })
  // The denominator never moves, with or without a benchmark.
  assert.equal(strong.maxScore, SIGNAL_MAX_SCORE)
  assert.equal(strong.maxScore, 100)
  assert.equal(strong.tradeStatus, 'VALID_LONG')
  assert.ok(strong.rawScore / strong.maxScore >= 0.6, `${strong.rawScore}/${strong.maxScore}`)
  assert.ok(strong.relativeScore > 0.95 * strong.relativeMaxScore, `relative ${strong.relativeScore}`)
  assert.equal(strong.regimeScore, regime.score)
  assert.ok(strong.reasons.every((reason) => reason.description && reason.weight > 0))
  assert.ok(strong.risk && strong.risk.stop !== null && strong.risk.stop < (strong.risk.entry ?? 0))

  const weak = evaluateSignal('WEAK', weakFrames(), { now: NOW })
  assert.equal(weak.signal, 'NONE')
  assert.equal(weak.maxScore, SIGNAL_MAX_SCORE)
  assert.ok(weak.rawScore / weak.maxScore <= 0.3, `${weak.rawScore}/${weak.maxScore}`)

  // A missing benchmark scores zero rather than shrinking the denominator, and can no
  // longer promote a result the way dividing by 84 did.
  const unbenchmarked = evaluateSignal('TEST', bullishFrames(), { regime, now: NOW })
  assert.equal(unbenchmarked.maxScore, SIGNAL_MAX_SCORE)
  assert.equal(unbenchmarked.relativeScore, 0)
  assert.ok(['WATCH', 'NONE'].includes(unbenchmarked.signal), unbenchmarked.signal)
  assert.ok(unbenchmarked.warnings.some((warning) => warning.includes('capped at WATCH')))

  const extended = evaluateSignal('TEST', bullishFrames(true), { benchmark, benchmarkSymbol: 'SPY', regime, now: NOW })
  assert.equal(extended.tradeStatus, 'TOO_EXTENDED')
  // The VWAP curve fades, so an extended price now scores less than a controlled one.
  assert.ok(extended.entryScore < strong.entryScore, `${extended.entryScore} !< ${strong.entryScore}`)

  const missing = bullishFrames()
  missing.trend = []
  assert.equal(evaluateSignal('MISS', missing, { now: NOW }).tradeStatus, 'DATA_ERROR')
  const tooNew = bullishFrames()
  tooNew.trend = tooNew.trend.slice(-40)
  assert.equal(evaluateSignal('NEWCO', tooNew, { now: NOW }).tradeStatus, 'INSUFFICIENT_HISTORY')

  // A three-hour-old entry bar is not a live read: no VWAP or breakout points, and the
  // result reports STALE_DATA instead of claiming a live setup.
  const stale = bullishFrames()
  const staleEnd = NOW - 3 * 60 * 60 * 1000
  stale.entry = frame(stale.entry.map((bar) => bar.close), 60_000, { end: staleEnd })
  stale.setup = frame(stale.setup.map((bar) => bar.close), 300_000, {
    volumes: stale.setup.map((bar) => bar.volume ?? 0),
    end: staleEnd,
  })
  const staleResult = evaluateSignal('STALE', stale, { benchmark, benchmarkSymbol: 'SPY', regime, now: NOW })
  assert.equal(staleResult.tradeStatus, 'STALE_DATA')
  assert.equal(staleResult.entryScore, 0)
  assert.ok(staleResult.timeframeStatus.entry.startsWith('Stale'))
  assert.notEqual(staleResult.signal, 'STRONG_LONG')

  assert.equal(classifySignal(39.99, 22, 100), 'NONE')
  assert.equal(classifySignal(40, 22, 100), 'WATCH')
  assert.equal(classifySignal(60, 22, 100), 'LONG')
  assert.equal(classifySignal(80, 22, 100), 'STRONG_LONG')
  assert.equal(classifySignal(100, 8, 100), 'WATCH')
  // A risk-off regime raises the bar: the same 62 points is a long in one tape, not the other.
  assert.equal(classifySignal(62, 22, 100, 0.6, 0.8), 'LONG')
  assert.equal(classifySignal(62, 22, 100, 0.68, 0.85), 'WATCH')

  const forming = bullishFrames()
  const formingNow = NOW + 2 * 60 * 1000
  forming.setup = frame(
    forming.setup.map((bar) => bar.close),
    300_000,
    { volumes: forming.setup.map((bar) => bar.volume ?? 0), end: formingNow - 120_000 },
  )
  const scored = evaluateSignal('FORMING', forming, { now: formingNow })
  assert.equal(scored.timeframeBars.setup.partial, true)
  assert.equal(scored.timeframeBars.setup.dropped, true)
  assert.equal(scored.timeframeStatus.setup, 'Available (last closed bar)')
}

function indicatorChecks(): void {
  // ADX separates a trend from a chop, which nothing in the reference's score could do.
  const trending = calculateIndicators(frame(linear(100, 200, 200), 86_400_000))
  const choppy = calculateIndicators(frame(
    Array.from({ length: 200 }, (_, index) => 100 + Math.sin(index / 2) * 3),
    86_400_000,
  ))
  const trendingAdx = trending[trending.length - 1].adx ?? 0
  const choppyAdx = choppy[choppy.length - 1].adx ?? 100
  assert.ok(trendingAdx > 30, `trending ADX ${trendingAdx}`)
  assert.ok(choppyAdx < 25, `choppy ADX ${choppyAdx}`)
  assert.ok((trending[trending.length - 1].diPlus ?? 0) > (trending[trending.length - 1].diMinus ?? 0))

  // A missing ATR scores zero. The reference gave full credit for any positive distance.
  const flat = calculateIndicators(frame(Array(60).fill(100), 86_400_000).map((bar) => ({ ...bar, high: null, low: null })))
  const noAtrRow = flat[flat.length - 1]
  assert.equal(noAtrRow.atr, null)
  const noAtrFrames: SignalFrames = { ...bullishFrames(), trend: frame(linear(100, 170, 320), 86_400_000).map((bar) => ({ ...bar, high: null, low: null })) }
  const noAtr = evaluateSignal('NOATR', noAtrFrames, { now: NOW })
  assert.equal(noAtr.trendScore, 0)
  assert.ok(noAtr.warnings.some((warning) => warning.includes('Daily ATR is unavailable')))

  // Beta-adjusted alpha strips out what is only leverage on the benchmark. The clone earns
  // 1.5x the benchmark's daily return and nothing else, so its alpha should be near zero
  // even though the raw excess the reference scored is large and positive.
  const marketCloses = linear(100, 150, 200)
  const clonedCloses = marketCloses.reduce<number[]>((series, close, index) => {
    if (!index) return [100]
    const step = close / marketCloses[index - 1] - 1
    return [...series, series[index - 1] * (1 + 1.5 * step)]
  }, [])
  const market = frame(marketCloses, 86_400_000)
  const leveraged = frame(clonedCloses, 86_400_000)
  const aligned = alignBenchmark(leveraged, market)
  const read = relativeReadAt(aligned, aligned.ticker.length - 1)
  assert.ok(read.beta !== null && Math.abs(read.beta - 1.5) < 0.05, `beta ${read.beta}`)
  const rawExcess = (clonedCloses[199] / clonedCloses[136] - marketCloses[199] / marketCloses[136]) * 100
  assert.ok(rawExcess > 4, `raw excess ${rawExcess}`)
  assert.ok(
    read.alphaLong !== null && Math.abs(read.alphaLong) < 0.3 * rawExcess,
    `alpha ${read.alphaLong} against raw excess ${rawExcess}`,
  )

  // Slot normalisation removes the U-shape: an ordinary opening bar reads about 1.0 where a
  // flat trailing mean reads it as heavily elevated.
  const session = [9_000, 3_000, 2_000, 2_000, 2_500, 3_500, 8_000]
  const slotBars = Array.from({ length: 12 }, (_, day) =>
    session.map((volume, slot) => ({
      timestamp: Date.UTC(2026, 6, 1 + day, 13, 30) + slot * 300_000,
      open: 100,
      high: 100.1,
      low: 99.9,
      close: 100,
      volume,
    })),
  ).flat()
  const slotRows = calculateIndicators(slotBars, { slotVolume: true })
  const openingBar = slotRows.findLast((row) => row.slotRelativeVolume !== null && (row.volume ?? 0) === 9_000)
  assert.ok(openingBar, 'expected a slot-scored opening bar')
  assert.ok(Math.abs((openingBar!.slotRelativeVolume ?? 0) - 1) < 0.05, `slot relvol ${openingBar!.slotRelativeVolume}`)
  assert.ok((openingBar!.relativeVolume ?? 0) > 1.5, `flat relvol ${openingBar!.relativeVolume}`)
}

function riskChecks(): void {
  const rows = calculateIndicators(frame(linear(100, 170, 320), 86_400_000))
  const row = rows[rows.length - 1]
  const risk = buildRisk(row.close, row)
  assert.ok(risk, 'expected a trade plan')
  assert.ok(risk!.stop !== null && risk!.stop < row.close)
  assert.ok(risk!.target !== null && risk!.target > row.close)
  assert.ok(risk!.rewardToRisk !== null && risk!.rewardToRisk > 0)
  assert.ok(risk!.positionSizePct !== null && risk!.positionSizePct > 0 && risk!.positionSizePct <= 100)
  assert.equal(buildRisk(null, row), null)
  assert.equal(buildRisk(100, null), null)

  // Reward to risk reads entry quality: a pullback to the EMA beats a stretched price.
  const pullback = buildRisk(row.close, { ...row, emaFast: row.close - 0.1, atr: 1 })
  const stretched = buildRisk(row.close, { ...row, emaFast: row.close - 40, atr: 1 })
  assert.ok(pullback && stretched && (pullback.rewardToRisk ?? 0) > (stretched.rewardToRisk ?? 0))
  assert.ok(Math.abs((stretched!.rewardToRisk ?? 0) - 2) < 1e-9, `stretched R:R ${stretched?.rewardToRisk}`)
}

function backtestChecks(): void {
  const rows = calculateIndicators(frame(linear(100, 400, 500), 86_400_000, { volumes: Array(500).fill(1_000) }))
  const aligned = alignBenchmark(rows, frame(linear(100, 90, 500), 86_400_000))

  // Lookahead safety: rewriting every bar after the scored index must not move the score.
  const index = 400
  const before = evaluateDailySignalAtIndex(rows, index, aligned)
  const poisoned = rows.map((row, position) => position > index ? { ...row, close: 1e6, high: 1e6, low: 1e6, volume: 1e12 } : row)
  const after = evaluateDailySignalAtIndex(poisoned, index, aligned)
  assert.deepEqual(after, before)

  const samples = signalBacktestSamples(rows, aligned, 10)
  assert.ok(samples.length > 0)
  assert.ok(samples.length <= rows.length - 10 - 252)
  const summary = summarizeBacktestSamples(samples, 10, 1)
  assert.equal(summary.horizonSessions, 10)
  assert.equal(summary.samples, samples.length)
  assert.equal(summary.bands.reduce((sum, band) => sum + band.samples, 0), samples.length)
  const top = summary.bands.find((band) => band.band === '75-100%')
  assert.ok(top && top.samples > 0, 'a monotonic advance should reach the top band')
  assert.equal(top!.hitRate, 1)
  assert.ok(top!.meanForwardReturn > 0)
}

function presentationChecks(): void {
  const benchmark = benchmarkFrame()
  const regime = scoreRegime(risingBenchmark(), frame(linear(30, 14, 300), 86_400_000), 'SPY', NOW)
  const strong = evaluateSignal('TEST', bullishFrames(), { benchmark, benchmarkSymbol: 'SPY', regime, now: NOW })
  const weak = evaluateSignal('WEAK', weakFrames(), { now: NOW })
  const blocked = { ...strong, tradeStatus: 'TOO_EXTENDED' as const }
  const stale = { ...strong, tradeStatus: 'STALE_DATA' as const }

  assert.equal(signalVisible(blocked, 'strong', ''), false)
  assert.equal(signalVisible(blocked, 'long', ''), false)
  assert.equal(signalVisible(blocked, 'blocked', ''), true)
  assert.equal(signalVisible(stale, 'stale', ''), true)
  assert.equal(signalVisible(stale, 'long', ''), false)
  assert.equal(signalVisible(strong, 'all', 'TE'), true)
  assert.equal(signalVisible(strong, 'all', 'ZZ'), false)

  const summary = summarizeSignals([strong, weak, blocked, stale])
  assert.equal(summary.blocked, 1)
  assert.equal(summary.stale, 1)
  assert.equal(summary.errors, 0)
}

async function offlineChecks(): Promise<void> {
  universeChecks()
  scoringChecks()
  indicatorChecks()
  riskChecks()
  backtestChecks()
  presentationChecks()
  console.log(
    'Signals offline checks passed: screener-field prefilter, completed-session liquidity, setup-weighted ranking, ' +
    'the fixed 100-point denominator, ADX, beta-adjusted alpha, slot-normalised volume, the null-ATR guard, ' +
    'stale intraday handling, regime-shifted thresholds, the trade plan, and a lookahead-safe walk-forward.',
  )
}

async function main(): Promise<void> {
  const offline = process.argv.includes('--offline')
  await offlineChecks()
  if (offline) return

  const started = Date.now()
  const envelope = await yahooProvider.signals({
    forceMarketRefresh: false,
    forceUniverseRefresh: false,
  })
  assert.notEqual(envelope.meta.freshness, 'failed', envelope.meta.failureReason ?? '')
  assert.ok(envelope.data)
  assert.ok(envelope.data.candidates.length <= 30)
  assert.equal(envelope.data.candidates.length, envelope.data.results.length)
  assert.deepEqual(
    envelope.data.candidates.map((candidate) => candidate.qualityRank),
    envelope.data.candidates.map((_, index) => index + 1),
  )
  assert.ok(envelope.data.results.every((result) => result.maxScore === SIGNAL_MAX_SCORE))

  const payload = envelope.data
  console.log('\n== Signals ==')
  console.log(`source      : ${payload.source}`)
  console.log(`elapsed     : ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log(`screened    : ${payload.sourceCandidateCount}`)
  console.log(`prefiltered : ${payload.prefilteredCount}`)
  console.log(`confirmed   : ${payload.confirmedCount}`)
  console.log(`shortlisted : ${payload.candidates.length}`)
  console.log(`errors      : ${Object.keys(payload.errors).length}`)
  console.log(
    `regime      : ${payload.regime.label} ${payload.regime.score.toFixed(1)}/${payload.regime.maxScore} ` +
    `· long ${payload.regime.longThreshold} · strong ${payload.regime.strongThreshold}`,
  )
  for (const result of payload.results.slice(0, 12)) {
    console.log(
      `${result.ticker.padEnd(7)} ${result.rawScore.toFixed(1).padStart(5)}/${String(result.maxScore).padEnd(4)} ` +
      `R:R ${(result.risk?.rewardToRisk?.toFixed(2) ?? '  --').padStart(5)}  ` +
      `${result.signal.padEnd(12)} ${result.tradeStatus}`,
    )
  }
  for (const entry of payload.validation) {
    console.log(`\n-- ${entry.horizonSessions}-session forward return (${entry.tickers} tickers, ${entry.samples} samples)`)
    for (const band of entry.bands) {
      console.log(
        `   ${band.band.padEnd(9)} n=${String(band.samples).padStart(5)}  ` +
        `hit ${(band.hitRate * 100).toFixed(1).padStart(5)}%  ` +
        `mean ${band.meanForwardReturn.toFixed(2).padStart(6)}%  median ${band.medianForwardReturn.toFixed(2).padStart(6)}%`,
      )
    }
  }
}

await main()
