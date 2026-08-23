/**
 * Print the Pre-Market page exactly as it renders, without Electron.
 *
 *   npm run probe:pre-market
 *
 * Run it beside the PySide6 app on its Pre-Market page and compare line by line. Every
 * futures price, all three macro panels including their interpretation sentences, the
 * five Fear & Greed scores and the momentum footer should agree to the decimal. Read
 * both at the same moment — futures and the CNN score both move intraday.
 */
import type { FuturesRow, PreMarketPayload } from '../electron/shared/contract.js'
import { dxyNote, tnxNote } from '../electron/shared/preMarket.js'
import { yahooProvider } from '../electron/services/provider.js'

function num(value: number | null | undefined, places: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return value.toFixed(places)
}

/** The `+0.00` signing the page uses on every change figure. */
function signed(value: number | null | undefined, places: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(places)}`
}

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const value = text.length > width ? `${text.slice(0, width - 1)}…` : text
  return align === 'right' ? value.padStart(width) : value.padEnd(width)
}

function futuresTable(rows: FuturesRow[]): void {
  const columns: Array<[string, number, 'left' | 'right']> = [
    ['Ticker', 8, 'left'],
    ['Name', 14, 'left'],
    ['Price', 12, 'right'],
    ['Chg %', 9, 'right'],
    ['Direction', 10, 'left'],
  ]
  console.log(columns.map(([title, width, align]) => pad(title, width, align)).join(' '))
  console.log(columns.map(([, width]) => '-'.repeat(width)).join(' '))
  if (!rows.length) {
    console.log('  (no futures data)')
    return
  }
  for (const row of rows) {
    console.log(
      [
        pad(row.symbol, 8),
        pad(row.name, 14),
        pad(num(row.price, 2), 12, 'right'),
        pad(`${signed(row.changePct, 2)}%`, 9, 'right'),
        pad(row.direction, 10),
      ].join(' '),
    )
  }
}

function macroBlocks(payload: PreMarketPayload): void {
  const { dxy, tnx, vix } = payload

  console.log('\n== DXY ==')
  if (!dxy) console.log('  (unavailable)')
  else {
    console.log(`  Level: ${num(dxy.level, 2)}`)
    console.log(`  1d Change: ${signed(dxy.changePct, 2)}%`)
    console.log(`  5d Trend: ${dxy.trend}`)
    console.log(`  Note: ${dxyNote(dxy.trend) || '(none)'}`)
    console.log(`  Series: ${dxy.series.values.length} closes to ${dxy.series.dates.at(-1)}`)
  }

  console.log('\n== 10Y Yield ==')
  if (!tnx) console.log('  (unavailable)')
  else {
    console.log(`  Yield: ${num(tnx.yield, 3)}%`)
    console.log(`  1d Change: ${signed(tnx.changeBps, 1)} bps`)
    console.log(`  vs 20d Avg: ${signed(tnx.vsAvg, 3)}%   (20d avg ${num(tnx.avg20d, 3)}%)`)
    console.log(`  Note: ${tnxNote(tnx.changeBps, tnx.vsAvg)}`)
    console.log(`  Series: ${tnx.series.values.length} closes to ${tnx.series.dates.at(-1)}`)
  }

  console.log('\n== VIX ==')
  if (!vix) console.log('  (unavailable)')
  else {
    console.log(`  Level: ${num(vix.level, 2)}`)
    console.log(`  1d Change: ${signed(vix.change, 2)}`)
    console.log(`  Regime: ${vix.regime}`)
    console.log(`  Series: ${vix.series.values.length} closes to ${vix.series.dates.at(-1)}`)
  }
}

async function main(): Promise<void> {
  const started = Date.now()
  const envelope = await yahooProvider.preMarket({})
  const payload = envelope.data

  console.log('== Pre-Market ==')
  console.log(`source     : ${envelope.meta.source}`)
  console.log(`freshness  : ${envelope.meta.freshness}`)
  if (envelope.meta.failureReason) console.log(`failure    : ${envelope.meta.failureReason}`)
  console.log(`elapsed    : ${((Date.now() - started) / 1000).toFixed(1)}s`)

  console.log('\n== Futures ==')
  futuresTable(payload.futures)

  macroBlocks(payload)

  console.log('\n== Fear & Greed ==')
  const fg = payload.fearGreed
  if (!fg) console.log('  (unavailable)')
  else {
    console.log(`  Now: ${num(fg.score, 1)}  ${fg.rating}`)
    for (const row of fg.history) {
      console.log(`  ${pad(row.period, 14)} ${pad(num(row.score, 1), 6, 'right')}  ${row.rating}`)
    }
    console.log(`  Last updated ${fg.timestamp || '(none)'}`)
  }

  console.log('\n== Market Momentum ==')
  const spy = payload.momentum
  if (!spy) console.log('  (unavailable)')
  else {
    const above =
      spy.lastClose !== null && spy.lastMa !== null
        ? spy.lastClose >= spy.lastMa
          ? 'Above MA'
          : 'Below MA'
        : '--'
    const ma = spy.lastMa === null ? '--' : `$${num(spy.lastMa, 2)}`
    console.log(`  SPY: $${num(spy.lastClose, 2)} | 125-day MA: ${ma} | ${above}`)
    console.log(`  Series: ${spy.closes.length} closes, ${spy.dates[0]} to ${spy.dates.at(-1)}`)
  }

  console.log(
    `\n${payload.futures.length} futures row(s); ${payload.missing.length} block(s) unavailable.`,
  )
  for (const block of payload.missing) console.log(`  missing: ${block}`)
  for (const error of envelope.errors) console.log(`  ! ${error.symbol ?? error.operation}: ${error.reason}`)
}

void main()
