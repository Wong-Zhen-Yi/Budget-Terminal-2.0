import assert from 'node:assert/strict'
import { buildScorecardRow, DEFAULT_SCORECARD_COLUMNS, DEFAULT_SCORECARD_SYMBOLS, normalizeScorecardPreferences, parseScorecardSymbols, scorecardBarDomain, SCORECARD_METRICS } from '../electron/shared/scorecard.js'
import { scorecardFixture } from './fixtures/scorecard.js'

assert.deepEqual(parseScorecardSymbols('amzn, msft; googl AMZN').symbols, DEFAULT_SCORECARD_SYMBOLS)
assert(parseScorecardSymbols('AMZN, MSFT').error)
assert(parseScorecardSymbols('A B C D E F G').error)
assert(parseScorecardSymbols('AAPL MSFT <script>').error)
assert.deepEqual(parseScorecardSymbols('BRK-B RDS.A 0700.HK').symbols, ['BRK-B', 'RDS.A', '0700.HK'], 'Support exchange suffixes and numeric-leading company tickers')

const input = scorecardFixture('AMZN')
const original = JSON.stringify(input)
const row = buildScorecardRow('AMZN', input)
assert.equal(row.fiscalEnd, '2025-12-31')
assert.equal(row.values.revenueGrowth, 25)
assert.equal(row.values.netMargin, 20)
assert.equal(row.values.fcfMargin, 16)
assert.equal(row.values.fcfYield, 4, 'Use annual FCF, not the provider TTM cash flow')
assert.equal(row.values.evEbitda, 12)
assert.equal(row.values.netCash, 20e9)
assert.equal(row.values.revenue, 125e9, 'Use annual revenue, not the provider TTM revenue')
assert.deepEqual(row.statementSources.sort(), ['derived', 'sec'])
assert.equal(JSON.stringify(input), original, 'Derivation must not mutate the shared Fundamentals cache')
assert(Object.values(buildScorecardRow('OTHER', input).values).every(value => value === null), 'Never display another ticker’s values')
assert(Object.values(buildScorecardRow('AMZN', { ...input, currencyVersion: undefined }).values).every(value => value === null), 'Unnormalized currency snapshots must be hidden')

const mismatched = scorecardFixture('MISMATCH')
mismatched.annual.netIncome[0].endDate = '2024-12-31'
mismatched.annual.freeCashFlow[0].endDate = '2024-12-31'
const unavailable = buildScorecardRow('MISMATCH', mismatched)
assert.equal(unavailable.values.netMargin, null)
assert.equal(unavailable.values.fcfMargin, null)
assert.equal(unavailable.values.fcfYield, null)

const loss = scorecardFixture('LOSS')
loss.annual.freeCashFlow[0].value = -20e9
loss.annual.netIncome[0].value = -25e9
loss.facts.trailingPe = -5
loss.facts.forwardPe = 0
loss.facts.ebitda = -1
const lossRow = buildScorecardRow('LOSS', loss)
assert.equal(lossRow.values.netMargin, -20)
assert.equal(lossRow.values.fcfYield, -4)
assert.equal(lossRow.values.trailingPe, null)
assert.equal(lossRow.values.forwardPe, null)
assert.equal(lossRow.values.evEbitda, null)

const gaps = scorecardFixture('GAPS')
gaps.annual.revenue[0].endDate = '2023-12-31'
assert.equal(buildScorecardRow('GAPS', gaps).values.revenueGrowth, null, 'Do not call two-year growth YoY')
gaps.annual.revenue[0].endDate = '2024-12-25'
assert.equal(buildScorecardRow('GAPS', gaps).values.revenueGrowth, 25, 'Allow 52/53-week fiscal years')
gaps.annual.revenue[0].value = 0
assert.equal(buildScorecardRow('GAPS', gaps).values.revenueGrowth, null)
gaps.annual.revenue[0].value = NaN
gaps.facts.marketCap = Infinity
assert.equal(buildScorecardRow('GAPS', gaps).values.marketCap, null)
assert.equal(buildScorecardRow('GAPS', gaps).values.fcfYield, null)
gaps.annual.revenue.push({ endDate: '9999-12-31', label: 'Current', value: 1e30, source: 'yahoo' })
assert.equal(buildScorecardRow('GAPS', gaps).fiscalEnd, '2025-12-31')

assert.deepEqual(scorecardBarDomain([-20, 30, null]), { min: -20, max: 30, zero: 40 })
assert.deepEqual(scorecardBarDomain([null, 0]), { min: 0, max: 1, zero: 0 })
assert.deepEqual(scorecardBarDomain([-10, -5]), { min: -10, max: 0, zero: 100 })

const restored = normalizeScorecardPreferences({ symbols: ['aapl', 'msft', 'nvda'], columns: ['netMargin', 'unknown', 'netMargin'], chartMetric: 'netMargin',
  selectedId: 'a', comparisons: [{ id: 'a', name: ' Ideas ', symbols: ['AAPL', 'MSFT', 'NVDA'], columns: ['netMargin'], chartMetric: 'fcfYield' },
    { id: 'b', name: 'ideas', symbols: [] }, { id: 'a', name: 'Duplicate ID' }, { id: 'c', name: '' }] })
assert.deepEqual(restored.symbols, ['AAPL', 'MSFT', 'NVDA'])
assert.deepEqual(restored.columns, ['netMargin'])
assert.equal(restored.comparisons.length, 1)
assert.equal(restored.comparisons[0].name, 'Ideas')
assert.equal(restored.selectedId, 'a')
const invalid = normalizeScorecardPreferences({ symbols: {}, columns: [], selectedId: 'missing', chartMetric: '__proto__', comparisons: [null, 5] })
assert.deepEqual(invalid.symbols, DEFAULT_SCORECARD_SYMBOLS)
assert.deepEqual(invalid.columns, DEFAULT_SCORECARD_COLUMNS)
assert.equal(invalid.selectedId, '')
assert.equal(SCORECARD_METRICS.length, new Set(SCORECARD_METRICS.map(metric => metric.key)).size)
console.log('PASS: Scorecard fiscal-period alignment, YoY gaps, signed cash flow, missing/invalid currency data, meaningful ratios, chart domains, ticker validation, and persisted settings')
