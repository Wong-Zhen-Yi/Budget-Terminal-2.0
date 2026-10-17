import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFEATBETA_SECTIONS, statementPeriods, terminalDcf, terminalPricePoints, terminalYoY } from '../electron/shared/defeatbetaTerminal.js'
import type { TerminalRow } from '../electron/shared/defeatbetaTerminal.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'

const directory = await mkdtemp(join(tmpdir(), 'bt-terminal-'))
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const { getDefeatBetaTerminal } = await import('../electron/services/defeatbeta/terminal.js')
const { closeDefeatBetaDecoder } = await import('../electron/services/defeatbeta/decoder.js')
const { cache } = await import('../electron/services/cache.js')
try {
  assert.equal(workspaceFor('defeatbeta')?.id, 'research')
  assert(startupPages('dashboard', [], []).includes('defeatbeta'))
  const prices: TerminalRow[] = Array.from({ length: 210 }, (_, index) => ({
    report_date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: index + 1, high: index + 3, low: index + 0.5, close: index + 2, volume: index * 100,
  }))
  const points = terminalPricePoints([...prices].reverse())
  assert.equal(points.length, 210)
  assert.deepEqual(points[0].ohlc, { open: 1, high: 3, low: 0.5, close: 2 })
  assert.equal(points[8].averages[0], null)
  assert.equal(points[9].averages[0], 6.5)
  assert.equal(points.at(-1)!.averages[2], 111.5)
  assert.equal(terminalPricePoints([prices[0], prices[0]]).length, 1)
  assert.equal(terminalPricePoints([{ ...prices[0], high: 0 }])[0].ohlc, null, 'Invalid ranges must not become invented candles')
  assert.equal(terminalPricePoints([{ ...prices[0], open: null }])[0].ohlc, null, 'Missing open must remain missing')
  assert.equal(terminalPricePoints([{ ...prices[0], report_date: '2025-02-30' }]).length, 0)
  assert.equal(terminalPricePoints([{ ...prices[0], volume: -1 }])[0].volume, null)
  const rows: TerminalRow[] = [
    { item_name: 'total_revenue', report_date: '2024-09-28', period_type: 'annual', item_value: 100 },
    { item_name: 'total_revenue', report_date: '2025-09-27', period_type: 'annual', item_value: 120 },
    { item_name: 'total_revenue', report_date: 'TTM', period_type: 'quarterly', item_value: 130 },
  ]
  assert.deepEqual(statementPeriods(rows, 'annual'), ['2025-09-27', '2024-09-28'])
  assert(Math.abs(terminalYoY(rows, 'total_revenue', '2025-09-27', 'annual')! - 20) < 1e-9)
  assert.equal(terminalYoY([{ ...rows[0], item_value: -100 }, rows[1]], 'total_revenue', '2025-09-27', 'annual'), null)
  const model = terminalDcf(100, 10, 0, 0, 10, 0)!
  assert(Math.abs(model.perShare - 100) < 1e-9, 'Level perpetuity must equal FCF / discount / shares')
  assert.equal(terminalDcf(100, 10, 5, 5, 2, 3), null)
  assert.equal(terminalDcf(-100, 10, 5, 5, 10, 3), null)
  assert.equal(terminalDcf(100, 0, 5, 5, 10, 3), null)
  assert.equal(terminalDcf(100, 10, NaN, 5, 10, 3), null)
  let forced: boolean | undefined
  const fixture = {
    rows: async (_table: unknown, symbol: string, force?: boolean) => {
      assert.equal(symbol, 'AAPL'); forced = force
      return { rows: [{ report_date: '2026-10-16', volume: 123n, nested: [{ content: 'Transcript' }] }], updatedAt: Date.now() }
    },
    company: async () => ({ financial_currency: 'USD', title: 'Apple' }),
  }
  const result = await getDefeatBetaTerminal({ symbol: ' aapl ', section: 'profile', force: true }, fixture)
  assert.equal(result.meta.freshness, 'fresh')
  assert.equal(result.data.rows[0].volume, 123)
  assert.equal(result.data.companyName, 'Apple')
  assert.equal(forced, true)
  assert.doesNotThrow(() => JSON.stringify(result), 'BigInts must be safe for browser transport')
  assert.equal((await getDefeatBetaTerminal({ symbol: '../x', section: 'prices' }, fixture)).meta.freshness, 'failed')
  const unavailable = await getDefeatBetaTerminal({ symbol: 'AAPL', section: 'news' }, { ...fixture, rows: async () => { throw new Error('Offline') } })
  assert.equal(unavailable.meta.freshness, 'failed')
  assert.match(unavailable.meta.failureReason!, /Offline/)
  const stale = await getDefeatBetaTerminal({ symbol: 'AAPL', section: 'prices' }, { ...fixture, rows: async () => ({ rows: [], updatedAt: 1 }) })
  assert.equal(stale.meta.freshness, 'stale')
  if (process.argv.includes('--live')) {
    for (const section of DEFEATBETA_SECTIONS) {
      const live = await getDefeatBetaTerminal({ symbol: 'AAPL', section })
      console.log(section, live.meta.freshness, live.data.rows.length, Object.keys(live.data.rows[0] ?? {}).join(','), live.meta.failureReason ?? '')
      assert.notEqual(live.meta.freshness, 'failed', `${section}: ${live.meta.failureReason}`)
      assert.doesNotThrow(() => JSON.stringify(live))
    }
  }
  console.log('PASS: navigation, fiscal YoY, DCF, section envelopes, serialization, refresh and stale/failure states')
} finally {
  closeDefeatBetaDecoder()
  cache.close()
  assert(directory.startsWith(join(tmpdir(), 'bt-terminal-')))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
