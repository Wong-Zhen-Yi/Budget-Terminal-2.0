import assert from 'node:assert/strict'
import { rollingBeta } from '../electron/shared/tradingBeta.js'
import { fetchCloseVolume } from '../electron/services/yahoo/history.js'

const dates = Array.from({ length: 100 }, (_, i) => new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10))
function series(beta: number) {
  const values = [100]
  for (let i = 1; i < dates.length; i++) values.push(values[i - 1] * (1 + beta * ((i % 7 - 3) / 1000)))
  return { dates, values }
}
const market = series(1)
for (const beta of [-1, 0, 1, 2]) {
  const result = rollingBeta(series(beta), market)
  assert.equal(result.length, 40)
  assert.equal(result[0].date, dates[60])
  assert.ok(result.every((p) => Math.abs(p.value - beta) < 1e-10))
}
assert.deepEqual(rollingBeta(series(1), series(0)), [])
assert.deepEqual(rollingBeta({ dates: dates.slice(0, 60), values: market.values.slice(0, 60) }, market), [])
const gap = series(2)
gap.values[50] = NaN
assert.deepEqual(rollingBeta(gap, market), [])
const future = series(2)
future.values[99] *= 2
assert.deepEqual(rollingBeta(future, market).slice(0, -1), rollingBeta(series(2), market).slice(0, -1))
console.log('PASS: known positive/zero/negative betas, warmup, gaps, zero variance and no lookahead')
if (!process.argv.includes('--offline')) {
  const start = new Date(Date.now() - 200 * 86400000)
  const [stock, benchmark] = await Promise.all([fetchCloseVolume('AAPL', start), fetchCloseVolume('^GSPC', start)])
  const result = rollingBeta({ dates: stock.dates, values: stock.adjustedCloses ?? [] }, { dates: benchmark.dates, values: benchmark.adjustedCloses ?? [] })
  assert.ok(result.length > 0, 'Yahoo histories must provide usable adjusted returns')
  console.log('PASS: live AAPL vs S&P 500', result.at(-1))
}
