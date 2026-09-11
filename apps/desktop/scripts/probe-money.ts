import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MONEY_SERIES, moneyGrowth, moneyWindow, normalizeMoney } from '../electron/shared/money.js'
import { parseFredCsv } from '../electron/services/fred.js'
import { clearMoneyCache, loadMoney } from '../electron/services/money.js'
import { workspaceFor } from '../electron/shared/navigation.js'
import { TABS } from '../electron/shared/contract.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-money-'))
const original = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
try {
  assert.equal(workspaceFor('money')?.id, 'macro')
  assert(TABS.some((tab) => tab.id === 'money' && tab.implemented))
  assert.deepEqual(parseFredCsv('observation_date,M2SL\n2025-02-01,.\n2025-01-01,100\n2025-03-01,\n2025-04-01,0'), [['2025-01-01', 100], ['2025-04-01', 0]])
  assert.deepEqual(normalizeMoney([['2025-01-01', 1_000_000]], 'millions'), [['2025-01-01', 1000]])
  assert.equal(moneyGrowth([['2024-12-01', 100], ['2025-01-01', 110]], 1).at(-1)?.[1]?.toFixed(2), '10.00')
  assert.equal(moneyGrowth([['2024-01-01', 100], ['2025-01-01', 120]], 12).at(-1)?.[1]?.toFixed(2), '20.00')
  assert.equal(moneyGrowth([['2024-12-01', 100], ['2025-02-01', 120]], 1).at(-1)?.[1], null)
  assert.equal(moneyGrowth([['2025-01-01', 0], ['2025-02-01', 120]], 1).at(-1)?.[1], null)
  assert.equal(moneyGrowth([['2025-01-01', 100]], 12)[0][1], null)
  assert.equal(moneyWindow([['2013-01-01', 1], ['2014-01-01', 2], ['2025-01-01', 3]], 11).length, 2)
  const now = Date.UTC(2025, 1, 1)
  let calls = 0
  const download = async () => { calls++; return [['2025-01-01', 1000], ['2025-02-01', 1100]] as Array<[string, number]> }
  const initial = await loadMoney({}, download, now)
  assert.equal(calls, 7)
  assert(initial.data.rows.every((row) => row.status === 'fresh'))
  await loadMoney({}, download, now + 1000)
  assert.equal(calls, 7, 'Fresh cache must avoid downloads')
  const mixed = await loadMoney({ force: true }, async (id) => {
    if (id === 'M2SL') throw Error('fixture outage')
    return download()
  }, now + 2000)
  assert.equal(mixed.meta.freshness, 'partial')
  assert.equal(mixed.data.rows[0].status, 'stale')
  assert.equal(mixed.data.rows[0].fetchedAt, now, 'Failed refresh must not renew old data')
  assert.equal(mixed.data.rows[0].history.length, 2)
  const unavailable = async () => { throw Error('offline') }
  const stale = await loadMoney({}, unavailable, now + 7 * 60 * 60_000)
  assert(stale.data.rows.every((row) => row.status === 'stale'))
  const expired = await loadMoney({}, unavailable, now + 8 * 24 * 60 * 60_000)
  assert.equal(expired.meta.freshness, 'failed')
  assert(expired.data.rows.every((row) => !row.history.length))
  await writeFile(join(directory, 'BudgetTerminalElectron', 'money-cache', 'payload.json'), '{invalid')
  assert.equal((await loadMoney({}, download, now)).meta.freshness, 'fresh')
  await clearMoneyCache()
  console.log('PASS: Money navigation, parsing, units, exact-month growth, cache, partial failures and expiry')
  if (process.argv.includes('--live')) {
    const live = await loadMoney({ force: true })
    for (const row of live.data.rows) console.log(`${row.seriesId}: ${row.status}, ${row.history.length} points, ${row.history.at(-1)?.join(' / ') ?? row.error}`)
    assert.equal(live.data.rows.filter((row) => row.history.length).length, MONEY_SERIES.length, 'All seven live FRED series must load')
    console.log('PASS: all seven live FRED series')
  }
} finally {
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (original[key] === undefined) delete process.env[key]
    else process.env[key] = original[key]
  }
  assert(directory.startsWith(join(tmpdir(), 'budget-money-')))
  await rm(directory, { recursive: true, force: true })
}
