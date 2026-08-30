import assert from 'node:assert/strict'

import type { SignalCandidate } from '../electron/shared/contract.js'
import {
  classifySignal,
  completedMedianDollarVolume,
  evaluateSignal,
  rankSignalCandidates,
  signalCandidateFromQuote,
  signalVisible,
  summarizeSignals,
  type SignalBar,
  type SignalFrames,
} from '../electron/shared/signals.js'
import { yahooProvider } from '../electron/services/provider.js'

function frame(
  closes: number[],
  intervalMs: number,
  options: { volumes?: number[]; end?: number } = {},
): SignalBar[] {
  const end = options.end ?? Date.UTC(2025, 7, 1, 16)
  const start = end - (closes.length - 1) * intervalMs
  return closes.map((close, index) => ({
    timestamp: start + index * intervalMs,
    open: close - 0.08,
    high: close + 0.12,
    low: close - 0.18,
    close,
    volume: options.volumes?.[index] ?? 1_000,
  }))
}

function linear(start: number, end: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + (end - start) * index / (count - 1))
}

function bullishFrames(extended = false): SignalFrames {
  const momentum = Array.from(
    { length: 90 },
    (_, index) => 120 + index * 0.035 + Math.sin(index / 2.5) * 0.55,
  )
  const setup = linear(130, 132, 45)
  setup[setup.length - 1] = Math.max(...setup.slice(0, -1)) + 1
  const setupVolume = Array(45).fill(1_000)
  setupVolume[setupVolume.length - 1] = 2_000
  const entry = linear(132, 132.8, 30)
  if (extended) entry[entry.length - 1] = 142
  return {
    trend: frame(linear(100, 170, 240), 86_400_000),
    momentum: frame(momentum, 3_600_000),
    setup: frame(setup, 300_000, { volumes: setupVolume }),
    entry: frame(entry, 60_000),
  }
}

function weakFrames(): SignalFrames {
  return {
    trend: frame(linear(170, 100, 240), 86_400_000),
    momentum: frame(linear(130, 110, 90), 3_600_000),
    setup: frame(linear(120, 115, 45), 300_000),
    entry: frame(linear(116, 114, 30), 60_000),
  }
}

function quote(ticker: string, overrides: Record<string, unknown> = {}) {
  return {
    symbol: ticker,
    quoteType: 'EQUITY',
    exchange: 'NMS',
    regularMarketPrice: 100,
    marketCap: 10e9,
    shortName: `${ticker} Inc`,
    ...overrides,
  }
}

async function offlineChecks(): Promise<void> {
  assert.equal(signalCandidateFromQuote(quote('AAA'))?.exchange, 'Nasdaq')
  assert.equal(signalCandidateFromQuote(quote('ETF', { quoteType: 'ETF' })), null)
  assert.equal(signalCandidateFromQuote(quote('OTC', { exchange: 'PNK' })), null)
  assert.equal(signalCandidateFromQuote(quote('LOW', { regularMarketPrice: 4.99 })), null)
  assert.equal(signalCandidateFromQuote(quote('SMALL', { marketCap: 1.99e9 })), null)

  const liquidityBars = frame(Array(21).fill(100), 86_400_000, {
    volumes: [...Array(20).fill(400_000), 100_000_000],
    end: Date.UTC(2026, 7, 15),
  })
  assert.equal(completedMedianDollarVolume(liquidityBars, '2026-08-15'), 40_000_000)

  const candidates: SignalCandidate[] = [
    { ticker: 'AAA', name: 'AAA', exchange: 'Nasdaq', price: 100, marketCap: 20e9, medianDollarVolume: 40e6, qualityRank: 1, reasons: [] },
    { ticker: 'BBB', name: 'BBB', exchange: 'NYSE', price: 50, marketCap: 10e9, medianDollarVolume: 100e6, qualityRank: 1, reasons: [] },
  ]
  const ranked = rankSignalCandidates(candidates)
  assert.deepEqual(ranked.map((candidate) => candidate.ticker), ['BBB', 'AAA'])
  assert.deepEqual(ranked.map((candidate) => candidate.qualityRank), [1, 2])

  const benchmark = frame(linear(100, 70, 240), 86_400_000)
  const strong = evaluateSignal('TEST', bullishFrames(), { benchmark, benchmarkSymbol: 'SPY' })
  assert.equal(strong.maxScore, 100)
  assert.equal(strong.signal, 'STRONG_LONG')
  assert.equal(strong.tradeStatus, 'VALID_LONG')
  assert.ok(strong.rawScore / strong.maxScore >= 0.8, `${strong.rawScore}/${strong.maxScore}`)
  assert.equal(strong.relativeScore, strong.relativeMaxScore)
  assert.ok(strong.reasons.every((reason) => reason.description && reason.weight > 0))

  const weak = evaluateSignal('WEAK', weakFrames())
  assert.equal(weak.signal, 'NONE')
  assert.equal(weak.tradeStatus, 'NONE')
  assert.ok(weak.rawScore / weak.maxScore <= 0.3, `${weak.rawScore}/${weak.maxScore}`)

  const extended = evaluateSignal('TEST', bullishFrames(true), { benchmark, benchmarkSymbol: 'SPY' })
  assert.equal(extended.rawScore, strong.rawScore)
  assert.equal(extended.signal, strong.signal)
  assert.equal(extended.tradeStatus, 'TOO_EXTENDED')

  const missing = bullishFrames()
  missing.entry = []
  assert.equal(evaluateSignal('MISS', missing).tradeStatus, 'DATA_ERROR')
  const tooNew = bullishFrames()
  tooNew.trend = tooNew.trend.slice(-40)
  assert.equal(evaluateSignal('NEWCO', tooNew).tradeStatus, 'INSUFFICIENT_HISTORY')

  assert.equal(classifySignal(39.99, 24, 100), 'NONE')
  assert.equal(classifySignal(40, 24, 100), 'WATCH')
  assert.equal(classifySignal(60, 24, 100), 'LONG')
  assert.equal(classifySignal(80, 24, 100), 'STRONG_LONG')
  assert.equal(classifySignal(100, 8, 100), 'WATCH')
  assert.equal(classifySignal(68, 24, 84), 'STRONG_LONG')

  const forming = bullishFrames()
  const now = Date.UTC(2026, 7, 15, 14, 32)
  forming.setup = frame(
    forming.setup.map((bar) => bar.close),
    300_000,
    { volumes: forming.setup.map((bar) => bar.volume ?? 0), end: now },
  )
  const scored = evaluateSignal('FORMING', forming, { now })
  assert.equal(scored.timeframeBars.setup.partial, true)
  assert.equal(scored.timeframeBars.setup.dropped, true)
  assert.equal(scored.timeframeStatus.setup, 'Available (last closed bar)')

  const blocked = { ...strong, tradeStatus: 'TOO_EXTENDED' as const }
  assert.equal(signalVisible(blocked, 'strong', ''), false)
  assert.equal(signalVisible(blocked, 'long', ''), false)
  assert.equal(signalVisible(blocked, 'blocked', ''), true)
  assert.equal(signalVisible(strong, 'all', 'TE'), true)
  assert.equal(signalVisible(strong, 'all', 'ZZ'), false)
  const summary = summarizeSignals([strong, weak, blocked])
  assert.deepEqual(
    { validLong: summary.validLong, blocked: summary.blocked, errors: summary.errors },
    { validLong: 1, blocked: 1, errors: 0 },
  )

  console.log('Signals offline checks passed: universe filters, completed-session liquidity, ranking, scoring, benchmark fallback, extension blocking, controlled data states, live-bar handling, filters, and metrics.')
}

async function main(): Promise<void> {
  const offline = process.argv.includes('--offline')
  await offlineChecks()
  if (offline) return

  const envelope = await yahooProvider.signals({
    forceMarketRefresh: false,
    forceUniverseRefresh: false,
  })
  assert.notEqual(envelope.meta.freshness, 'failed', envelope.meta.failureReason ?? '')
  assert.ok(envelope.data)
  assert.ok(envelope.data.candidates.length <= 25)
  assert.equal(envelope.data.candidates.length, envelope.data.results.length)
  assert.deepEqual(
    envelope.data.candidates.map((candidate) => candidate.qualityRank),
    envelope.data.candidates.map((_, index) => index + 1),
  )
  console.log('\n== Signals ==')
  console.log(`source      : ${envelope.data.source}`)
  console.log(`screened    : ${envelope.data.sourceCandidateCount}`)
  console.log(`passed      : ${envelope.data.passedFilterCount}`)
  console.log(`shortlisted : ${envelope.data.candidates.length}`)
  console.log(`errors      : ${Object.keys(envelope.data.errors).length}`)
  for (const result of envelope.data.results.slice(0, 10)) {
    console.log(`${result.ticker.padEnd(7)} ${result.rawScore.toFixed(1).padStart(5)}/${String(result.maxScore).padEnd(3)} ${result.signal.padEnd(12)} ${result.tradeStatus}`)
  }
}

await main()
