import assert from 'node:assert/strict'
import { pltrHistory } from '../electron/shared/pltr.js'
import { pltrFixture } from './fixtures/pltr.js'

const { financials } = pltrFixture()
financials.quarterly.sharesOutstanding.push({ endDate: '2026-10-14', label: 'Current', source: 'yahoo', value: 2.2e9 })
const rows = pltrHistory(financials)
assert.equal(rows.length, 8)
assert.equal(rows.at(-1)?.revenue, 1.2e9)
assert.equal(rows.at(-1)?.endDate, '2025-12-31', 'Current market-date shares must not replace the latest fiscal quarter')
assert.equal(rows.at(-1)?.fcfMargin, 30)
assert.equal(rows[0].revenueGrowth, 400, 'Year-ago comparison must include periods outside the displayed eight')
assert.equal(rows.at(-1)?.revenueGrowth, 50)
assert.equal(rows.at(-1)?.shareGrowth, (2.11e9 / 2.07e9 - 1) * 100)
assert.deepEqual(pltrHistory(null), [])
financials.quarterly.revenue = financials.quarterly.revenue.filter(point => point.endDate !== rows.at(-1)!.endDate)
const missing = pltrHistory(financials).at(-1)!
assert.equal(missing.revenue, null)
assert.equal(missing.netMargin, null)
assert.equal(missing.fcfMargin, null)
assert.equal(missing.revenueGrowth, null)
assert.equal(missing.freeCashFlow, 360e6, 'Missing revenue must preserve aligned cash flow')
financials.quarterly.revenue.push({ endDate: missing.endDate, label: '', value: 0, source: 'sec' })
assert.equal(pltrHistory(financials).at(-1)?.fcfMargin, null, 'Zero revenue must not produce Infinity')
financials.quarterly.revenue.at(-1)!.value = NaN
assert.equal(pltrHistory(financials).at(-1)?.revenue, null)
console.log('PASS: PLTR fiscal alignment, eight-quarter window, Y/Y, margins, missing and nonfinite data')
