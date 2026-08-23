/**
 * Print the Global page exactly as it renders, without Electron.
 *
 *   npm run probe:global
 *
 * Run it beside the PySide6 app on its Global page and compare line by line. The
 * closes and interval returns should agree to the decimal; the Market and Session
 * columns are clock-dependent, so read both at the same moment.
 */
import {
  CLOCK_COUNTRIES,
  GLOBAL_INTERVALS,
  type GlobalIndexRow,
  type GlobalInterval,
} from '../electron/shared/contract.js'
import { formatMarketTiming } from '../electron/shared/globalMarkets.js'
import { yahooProvider } from '../electron/services/provider.js'

function close(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** `_p26_pct`: the sign appears above zero only, so an exact 0.00% prints unsigned. */
function pct(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const value = text.length > width ? `${text.slice(0, width - 1)}…` : text
  return align === 'right' ? value.padStart(width) : value.padEnd(width)
}

function intervalCell(row: GlobalIndexRow, interval: GlobalInterval): string {
  const payload = row.intervals[interval]
  return payload?.available ? pct(payload.changePct) : '--'
}

async function main(): Promise<void> {
  const settings = (await yahooProvider.settings()).data
  const zone =
    CLOCK_COUNTRIES.find((entry) => entry.code === settings.clockCountry)?.zone ??
    CLOCK_COUNTRIES[0].zone

  const started = Date.now()
  const envelope = await yahooProvider.globalMarkets({})
  const payload = envelope.data
  const now = Date.now() / 1000

  console.log(`Global markets  (${Math.round((Date.now() - started) / 100) / 10}s)`)
  console.log(`  source     ${payload.source}`)
  console.log(`  generated  ${payload.generatedAt}`)
  console.log(`  clock      ${settings.clockCountry} / ${zone} / ${settings.time12h ? '12h' : '24h'}`)
  console.log(`  freshness  ${envelope.meta.freshness}${envelope.meta.failureReason ? ` — ${envelope.meta.failureReason}` : ''}`)
  console.log()

  const columns: Array<[string, number, 'left' | 'right']> = [
    ['Region', 14, 'left'],
    ['Country', 12, 'left'],
    ['Index', 30, 'left'],
    ['Symbol', 11, 'left'],
    ['Market', 8, 'left'],
    ['Session (Clock TZ)', 30, 'left'],
    ['Last Close', 12, 'right'],
    ['Start Close', 12, 'right'],
    ['End Close', 12, 'right'],
    ['Perf %', 9, 'right'],
    ['Last Date', 11, 'left'],
  ]
  console.log(columns.map(([label, width, align]) => pad(label, width, align)).join('  '))
  console.log(columns.map(([, width]) => '-'.repeat(width)).join('  '))

  // The table opens on 1D, the store's default interval.
  for (const row of payload.rows) {
    const status = formatMarketTiming(row.marketTiming, zone, { now, use12h: settings.time12h })
    const performance = row.intervals['1D']
    const cells: string[] = [
      row.region,
      row.country,
      row.name,
      row.symbol,
      status.market,
      status.session,
      close(row.lastClose),
      performance?.available ? close(performance.startClose) : '--',
      performance?.available ? close(performance.endClose) : '--',
      performance?.available ? pct(performance.changePct) : '--',
      row.lastDate || '--',
    ]
    console.log(cells.map((cell, index) => pad(cell, columns[index][1], columns[index][2])).join('  '))
  }

  console.log()
  console.log('Every interval')
  console.log(
    `${pad('Country', 14)}${pad('Index', 12)}${GLOBAL_INTERVALS.map((label) => pad(label, 10, 'right')).join('')}`,
  )
  for (const row of payload.rows) {
    console.log(
      `${pad(row.country, 14)}${pad(row.shortName, 12)}${GLOBAL_INTERVALS.map((label) =>
        pad(intervalCell(row, label), 10, 'right'),
      ).join('')}`,
    )
  }

  console.log()
  console.log(`Loaded ${payload.rows.length} global index row(s).`)
  if (payload.missing.length) console.log(`Unavailable: ${payload.missing.join(', ')}`)
  for (const error of envelope.errors) console.log(`  ! ${error.symbol ?? error.source}: ${error.reason}`)
}

void main()
