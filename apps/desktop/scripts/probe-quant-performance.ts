import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { discoverPairs, buildPairSpread, buildPairDetail, meanReversionStats, hurstExponent, scorePair, MIN_PAIR_OBSERVATIONS, type QuantBar } from '../electron/shared/quant.js'
import type { QuantPairRow } from '../electron/shared/contract.js'
import { discoverPairsInWorker, pairDetailInWorker, closeQuantWorker } from '../electron/services/quantWorker.js'
import { createWorkerRpc } from '../electron/services/workerRpc.js'

function finite(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function cleanBars(input: QuantBar[]): QuantBar[] {
  const byDate = new Map<string, QuantBar>()
  for (const bar of input) {
    const close = finite(bar.close)
    const volume = finite(bar.volume)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || close === null || close <= 0) continue
    byDate.set(bar.date, { date: bar.date, close, volume })
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

function referencePairs(
  histories: Record<string, QuantBar[]>,
  options: { prescreenLimit?: number; resultLimit?: number } = {},
): QuantPairRow[] {
  const tickers = Object.keys(histories).filter((ticker) => cleanBars(histories[ticker]).length >= MIN_PAIR_OBSERVATIONS)
  const prescreened: Array<{ left: string; right: string; correlation: number }> = []
  for (let leftIndex = 0; leftIndex < tickers.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tickers.length; rightIndex += 1) {
      const spread = buildPairSpread(histories[tickers[leftIndex]], histories[tickers[rightIndex]])
      if (spread.correlation !== null) prescreened.push({ left: tickers[leftIndex], right: tickers[rightIndex], correlation: spread.correlation })
    }
  }
  prescreened.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation) || a.left.localeCompare(b.left) || a.right.localeCompare(b.right))
  const rows = prescreened.slice(0, options.prescreenLimit ?? 150).flatMap(({ left, right }) => {
    const spread = buildPairSpread(histories[left], histories[right])
    if (!spread.spread.length) return []
    const reversion = meanReversionStats(spread.spread)
    const hurst = hurstExponent(spread.spread)
    const score = scorePair({ correlation: spread.correlation, halfLife: reversion.halfLife, dickeyFuller: reversion.dickeyFuller, hurst })
    if (score === null) return []
    return [{
      left,
      right,
      correlation: spread.correlation,
      hedgeRatio: spread.hedgeRatio,
      spreadZ: spread.latestZ,
      halfLife: reversion.halfLife,
      hurst,
      dickeyFuller: reversion.dickeyFuller,
      stationaryAt: reversion.stationaryAt,
      score,
      rank: 0,
      observations: spread.observations,
    }]
  })
  return rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.left.localeCompare(b.left) || a.right.localeCompare(b.right))
    .slice(0, options.resultLimit ?? 40)
    .map((row, index) => ({ ...row, rank: index + 1 }))
}


const histories: Record<string, QuantBar[]> = {}
for (let symbol = 0; symbol < 40; symbol++) {
  histories[`FIX${symbol}`] = Array.from({ length: 740 }, (_, day) => ({
    date: new Date(Date.UTC(2022, 0, day + 1)).toISOString().slice(0, 10),
    close: 100 + day * .04 + 8 * Math.sin(day / 19) + Math.sin(day * .71 + symbol) * (1 + symbol / 100),
    volume: 1_000_000,
  }))
}
// Data cleaning, alignment, and degeneracy must preserve the old eligibility/ranking.
const messy = structuredClone(histories)
messy.FIX0 = messy.FIX0.filter((_, i) => i % 7 !== 0).reverse()
messy.FIX1.push({ ...messy.FIX1[10], close: 101 }, { date: 'bad', close: 0, volume: null })
messy.CONSTANT = histories.FIX2.map(bar => ({ ...bar, close: 10 }))
messy.SHORT = histories.FIX3.slice(0, 20)
messy.LATE = histories.FIX4.slice(-60)
assert.deepEqual(discoverPairs(messy), referencePairs(messy))
const timed = (run: () => unknown) => { const started = performance.now(); const value = run(); return { ms: performance.now() - started, value } }
// Warm JIT paths before comparing medians; no machine-dependent speed assertion.
referencePairs(histories); discoverPairs(histories)
const baseline = Array.from({ length: 3 }, () => timed(() => referencePairs(histories)))
const optimized = Array.from({ length: 3 }, () => timed(() => discoverPairs(histories)))
for (const result of optimized) assert.deepEqual(result.value, baseline[0].value)
try {
  let ticks = 0
  let previous = performance.now()
  let largestGap = 0
  const timer = setInterval(() => { const now = performance.now(); largestGap = Math.max(largestGap, now - previous); previous = now; ticks++ }, 5)
  const started = performance.now()
  const rows = await discoverPairsInWorker(histories)
  const workerMs = performance.now() - started
  clearInterval(timer)
  assert.deepEqual(rows, optimized[0].value)
  assert.ok(ticks > 3, 'Worker calculation must leave the main event loop running')
  const detail = await pairDetailInWorker({ left: 'FIX0', right: 'FIX1', leftBars: histories.FIX0, rightBars: histories.FIX1 })
  assert.deepEqual(detail, buildPairDetail('FIX0', 'FIX1', histories.FIX0, histories.FIX1))
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[1]
  const before = median(baseline.map(result => result.ms))
  const after = median(optimized.map(result => result.ms))
  console.log(JSON.stringify({ symbols: 40, observations: 740, candidatePairs: 780,
    baselineMs: Math.round(before), optimizedMs: Math.round(after), improvementPercent: Math.round((1 - after / before) * 100),
    workerMs: Math.round(workerMs), mainThreadLargestGapMs: Math.round(largestGap), ticks }, null, 2))
} finally { closeQuantWorker() }

let starts = 0
const rpc = createWorkerRpc(() => {
  starts++
  return new Worker(`const { parentPort } = require('node:worker_threads'); parentPort.on('message', request => {
    if (request.kind === 'exit') process.exit(1)
    if (request.kind === 'hang') return
    parentPort.postMessage({ id: request.id, value: 42 })
  })`, { eval: true })
}, 200)
try {
  assert.equal(await rpc.call({ kind: 'ok' }), 42)
  await assert.rejects(rpc.call({ kind: 'exit' }), /exited/)
  assert.equal(await rpc.call({ kind: 'ok' }), 42)
  await assert.rejects(rpc.call({ kind: 'hang' }), /timed out/)
  assert.equal(await rpc.call({ kind: 'ok' }), 42)
  assert.equal(starts, 3)
} finally { rpc.close() }
await assert.rejects(rpc.call({ kind: 'ok' }), /closed/)
console.log('PASS: Quant equivalence, worker responsiveness, details, crash/timeout recovery and shutdown')
