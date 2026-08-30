import assert from 'node:assert/strict'

import type { InstitutionActivityPayload } from '../electron/shared/contract.js'
import {
  institutionActivityClipboard,
  institutionManagersClipboard,
} from '../electron/shared/institutions.js'
import {
  parseAllInstitutionActivity,
  parseDataromaHoldPrice,
  parseManagerActivityRows,
  parseTickerActivityRows,
} from '../electron/services/institutions.js'
import { yahooProvider } from '../electron/services/provider.js'

const allActivityHtml = `
  <table id="grid"><thead><tr><td>Manager</td><td>Period</td><td>Activity</td></tr></thead><tbody>
  <tr><td><a href="/m/m_activity.php?m=EXM&amp;typ=a">Example Manager</a></td><td>Q1 2026</td>
  <td><a class="buy" href="/m/activity.php?sym=AAA&amp;typ=a">AAA</a>
  <div>Alpha | Beta<br>Add 20.00%<br>Change to portfolio: 15.26%</div></td></tr>
  </tbody></table>`

const managerHtml = `
  <table id="grid"><thead><tr><td>History</td><td>Stock</td><td>Activity</td><td>Shares</td><td>%</td></tr></thead><tbody>
  <tr class="q_chg"><td colspan="5"><b>Q1</b>&nbsp<b>2026</b></td></tr>
  <td class="hist"><a href="/m/hist/hist.php?f=EXM&amp;s=AAA">history</a></td>
  <td class="stock"><a href="/m/stock.php?sym=AAA">AAA<span> - Alpha | Beta</span></a></td>
  <td class="buy">Add 20.00%</td><td class="buy">1,000</td><td>15.26</td></tr>
  </tbody></table>`

const tickerHtml = `
  <table id="grid"><thead><tr><td>History</td><td>Portfolio Manager</td><td>Activity</td><td>Shares</td><td>%</td></tr></thead><tbody>
  <tr class="q_chg"><td colspan="5"><b>Q1</b>&nbsp<b>2026</b></td></tr>
  <tr><td class="hist"><a href="/m/hist/hist.php?f=EXM&amp;s=AAA">history</a></td>
  <td><a href="/m/holdings.php?m=EXM">Example Manager</a></td><td>Add 20.00%</td><td>1,000</td><td>15.26</td></tr>
  </tbody></table>`

function offlineChecks(): void {
  const summary = parseAllInstitutionActivity(allActivityHtml)
  assert.equal(summary.managers.length, 1)
  assert.equal(summary.managers[0]?.managerId, 'EXM')
  assert.equal(summary.activity[0]?.company, 'Alpha | Beta')
  assert.equal(summary.activity[0]?.changeToPortfolioPct, 15.26)

  const managerRows = parseManagerActivityRows(managerHtml, 'Example Manager', 'EXM')
  assert.equal(managerRows.length, 1)
  assert.equal(managerRows[0]?.period, 'Q1 2026')
  assert.equal(managerRows[0]?.shareChangeValue, 1_000)
  assert.equal(managerRows[0]?.historyUrl, 'https://www.dataroma.com/m/hist/hist.php?f=EXM&s=AAA')

  const tickerRows = parseTickerActivityRows(tickerHtml, 'AAA')
  assert.equal(tickerRows.length, 1)
  assert.equal(tickerRows[0]?.manager, 'Example Manager')
  assert.equal(tickerRows[0]?.changeToPortfolio, '15.26%')

  const holdPrice = parseDataromaHoldPrice(
    '<table><tr id="hold_price"><td>Hold Price * :</td><td id="price">$134.00</td></tr></table>',
  )
  assert.deepEqual(holdPrice, { text: '$134.00', value: 134 })

  managerRows[0].holdPrice = holdPrice.text
  managerRows[0].approxFlowValue = managerRows[0].shareChangeValue * holdPrice.value
  managerRows[0].approxFlow = '$134.0K'
  const payload: InstitutionActivityPayload = {
    periods: ['Q1 2026'],
    activePeriod: 'Q1 2026',
    buyRows: managerRows,
    sellRows: [],
    managerRows: summary.managers,
    sourceUrls: { activity: 'https://www.dataroma.com/m/allact.php?typ=a' },
    warnings: [],
    fetchedAt: '2026-01-01T00:00:00',
  }
  const activityExport = institutionActivityClipboard(payload, new Date('2026-01-01T00:00:00Z'))
  assert.match(activityExport, /# Institutions Buys\/Sells Export/)
  assert.match(activityExport, /Alpha \/ Beta/)
  assert.match(activityExport, /\$134\.0K/)
  const managerExport = institutionManagersClipboard(payload, new Date('2026-01-01T00:00:00Z'))
  assert.match(managerExport, /# Institutions Superinvestors Export/)
  assert.match(managerExport, /Example Manager \| EXM \| Q1 2026/)

  console.log('Institutions offline checks passed: DATAROMA summary, manager and ticker parsing, malformed row repair, numeric fields, hold price, and exports.')
}

async function liveChecks(symbol: string): Promise<void> {
  const activity = await yahooProvider.institutionActivity({ limit: 10 })
  assert.notEqual(activity.meta.freshness, 'failed', activity.meta.failureReason ?? '')
  assert.ok(activity.data.activePeriod)
  assert.ok(activity.data.buyRows.length)
  assert.ok(activity.data.sellRows.length)
  assert.ok(activity.data.managerRows.length)
  assert.ok(activity.data.buyRows.some((row) => row.approxFlow))

  const alternatePeriod = activity.data.periods[1]
  const alternate = alternatePeriod
    ? await yahooProvider.institutionActivity({ limit: 10, quarter: alternatePeriod })
    : null
  if (alternatePeriod && alternate) {
    assert.notEqual(alternate.meta.freshness, 'failed', alternate.meta.failureReason ?? '')
    assert.equal(alternate.data.activePeriod, alternatePeriod)
    assert.ok(alternate.data.buyRows.length || alternate.data.sellRows.length)
  }

  const ticker = await yahooProvider.institutionTickerActivity({ symbol })
  assert.notEqual(ticker.meta.freshness, 'failed', ticker.meta.failureReason ?? '')
  assert.equal(ticker.data.symbol, symbol)
  assert.ok(ticker.data.activityRows.length)

  console.log(JSON.stringify({
    period: activity.data.activePeriod,
    freshness: activity.meta.freshness,
    buys: activity.data.buyRows.length,
    sells: activity.data.sellRows.length,
    managers: activity.data.managerRows.length,
    sampleInflow: activity.data.buyRows[0]?.approxFlow,
    sampleOutflow: activity.data.sellRows[0]?.approxFlow,
    alternatePeriod: alternate?.data.activePeriod ?? '',
    ticker: ticker.data.symbol,
    tickerActivity: ticker.data.activityRows.length,
  }, null, 2))
}

offlineChecks()
const args = process.argv.slice(2)
if (!args.includes('--offline')) {
  await liveChecks(args.find((argument) => !argument.startsWith('--'))?.trim().toUpperCase() || 'MSFT')
}
