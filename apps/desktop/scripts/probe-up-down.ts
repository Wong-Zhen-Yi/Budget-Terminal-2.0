import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  analystTargetDisplay,
  calculateUpDownRow,
  normalizeUpDownSymbols,
  sortUpDownRows,
} from '../electron/shared/upDown.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function offlineChecks(): void {
  assert(
    JSON.stringify(normalizeUpDownSymbols('aaa, BBB\ncash 123 aaa')) === JSON.stringify(['AAA', 'BBB']),
    'custom symbols should normalize, filter and de-duplicate',
  )
  assert(normalizeUpDownSymbols(['2602335D', 'CASH', 'BRK.B', 'BRK-B', '0700.HK', 'AAPL']).join(',') === 'BRK.B,BRK-B,0700.HK,AAPL',
    'issuer numeric security IDs and cash must never become equity-history requests')
  const series = {
    dates: ['2025-12-31', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06'],
    values: [100, 110, 100, 100, 120, 108],
  }
  const oneDay = calculateUpDownRow('AAA', series, '1d', 'Alpha')
  const fiveDay = calculateUpDownRow('AAA', series, '5d', 'Alpha')
  const ytd = calculateUpDownRow('AAA', series, 'ytd', 'Alpha')
  assert(oneDay?.tradingDays === 1 && oneDay.daysDown === 1, '1D should use the final close change')
  assert(Math.abs((oneDay?.intervalReturn ?? 0) + 10) < 0.0001, '1D return should use the prior close')
  assert(
    fiveDay?.tradingDays === 5 && fiveDay.daysUp === 2 && fiveDay.daysDown === 2 && fiveDay.flatDays === 1,
    '5D counts should preserve up, down and flat sessions',
  )
  assert(Math.abs((fiveDay?.intervalReturn ?? 0) - 8) < 0.0001, '5D return should use the pre-window base')
  assert(ytd?.tradingDays === 5, 'YTD should select changes by the latest series year')

  const ranked = sortUpDownRows([
    { ...fiveDay!, ticker: 'BBB', daysUp: 3, daysDown: 2 },
    { ...fiveDay!, ticker: 'AAA', daysUp: 3, daysDown: 1 },
    { ...fiveDay!, ticker: 'CCC', daysUp: 2, daysDown: 0 },
  ])
  assert(ranked.map((row) => row.ticker).join(',') === 'AAA,BBB,CCC', 'default ranking should match the reference')
  assert(analystTargetDisplay(100, 120).text === '$120 (+20%)', 'positive target formatting should match')
  assert(analystTargetDisplay(101, 90).text === '$90 (-10.9%)', 'negative target formatting should match')
  assert(analystTargetDisplay(23.8, 31.87).text === '$31.87 (+33.9%)', 'fractional targets should keep cents')
  assert(analystTargetDisplay(100, null).text === 'N/A', 'missing targets should render N/A')
}

async function main(): Promise<void> {
  offlineChecks()
  console.log('Up/Down offline checks passed.')
  if (process.argv.includes('--offline')) return

  const symbol = process.argv.slice(2).find((value) => !value.startsWith('-'))?.toUpperCase() ?? 'AAPL'
  const temporary = await mkdtemp(join(tmpdir(), 'budget-terminal-up-down-'))
  const previousAppData = process.env.APPDATA
  process.env.APPDATA = temporary
  try {
    const { getUpDown, getUpDownTargets } = await import('../electron/services/upDown.js')
    const result = await getUpDown({ source: 'custom', interval: '5d', symbols: [symbol], force: true })
    assert(result.payload.rows.length === 1, `live ${symbol} history should return one row`)
    const row = result.payload.rows[0]
    const targets = await getUpDownTargets([symbol], true)
    assert(targets.resolved === 1 && symbol.toUpperCase() in targets.targets, 'target stage should resolve the ticker')
    console.log(
      `Live ${row.ticker}: close=${row.lastClose} return=${row.intervalReturn?.toFixed(2)}% ` +
      `up=${row.daysUp} down=${row.daysDown} target=${targets.targets[row.ticker] ?? 'N/A'}`,
    )
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousAppData
    await rm(temporary, { recursive: true, force: true })
  }
}

await main()
