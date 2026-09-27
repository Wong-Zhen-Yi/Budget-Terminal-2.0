import assert from 'node:assert/strict'

import { completedTechnicalBars, evaluateTechnicalBars, type TechnicalBar } from '../electron/shared/technicalScreen.js'

const now = Date.UTC(2026, 8, 28, 22)
const day = 86_400_000

function bars(closes: number[]): TechnicalBar[] {
  return closes.map((close, index) => ({
    time: (now - (closes.length - index) * day) / 1000,
    close,
  }))
}

function walk(seed: number): TechnicalBar[] {
  let state = seed
  let close = 100
  return bars(Array.from({ length: 230 }, () => {
    state = (1664525 * state + 1013904223) >>> 0
    close += (state / 0x1_0000_0000 - 0.5) * 3
    return close
  }))
}

assert.equal(evaluateTechnicalBars(bars(Array(200).fill(100)), now), null)

const cross = evaluateTechnicalBars(bars([...Array(200).fill(100), 101]), now)!
assert.equal(cross.matches.goldenCross, true)
assert.equal(cross.matches.aboveSma200, true)
assert.equal(cross.previousSma50, cross.previousSma200)
assert.ok(cross.sma50 > cross.sma200)

const aligned = evaluateTechnicalBars(bars([...Array(141).fill(100), ...Array(60).fill(101)]), now)!
assert.equal(aligned.matches.goldenCross, false)
assert.ok(aligned.sma50 > aligned.sma200)

const rsi = evaluateTechnicalBars(walk(12), now)!
assert.ok(rsi.rsi < 50 && rsi.projectedRsi > 50)
assert.equal(rsi.matches.rsiBreakout, true)

const macd = evaluateTechnicalBars(walk(16), now)!
assert.ok(macd.macdGap < 0 && macd.projectedMacdGap > 0)
assert.equal(macd.matches.macdBreakout, true)

const beforeClose = Date.UTC(2026, 8, 28, 18)
const intraday = [...bars(Array(201).fill(100)), { time: beforeClose / 1000, close: 150 }]
assert.equal(completedTechnicalBars(intraday, beforeClose).length, 201)
assert.equal(evaluateTechnicalBars(intraday, beforeClose)?.matches.goldenCross, false)
assert.equal(evaluateTechnicalBars(bars(Array(201).fill(100)), now + 11 * day), null)

console.log('Technical screen offline checks passed.')
