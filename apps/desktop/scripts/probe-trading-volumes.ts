/**
 * Print the Trading Volumes page exactly as it ranks, without Electron.
 *
 *   npm run probe:trading-volumes
 *   npm run probe:trading-volumes -- 30d
 *
 * Run it beside the PySide6 app on its Trading Volumes page and compare line by line.
 * The row order, the market caps and all six ADV columns should agree; so should the
 * fitted trend line, which is the one thing on that page nobody can eyeball.
 *
 * This is the most expensive probe in the repo — a twelve-page screen plus one hundred
 * three-year daily charts, all behind the rate gate. Half a minute is normal.
 */
import assert from 'node:assert/strict'
import type { TradingVolumeInterval, TradingVolumeRow } from '../electron/shared/contract.js'
import { TRADING_VOLUME_INTERVALS } from '../electron/shared/contract.js'
import {
  TRADING_VOLUME_METRICS,
  buildReplayPlan,
  intervalMarketCapHistory,
  isLoggable,
  leastSquares,
  metricValue,
  rankRows,
  removeLowerOutliers,
  replayFrame,
} from '../electron/shared/tradingVolumes.js'
import { yahooProvider } from '../electron/services/provider.js'

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const value = text.length > width ? `${text.slice(0, width - 1)}…` : text
  return align === 'right' ? value.padStart(width) : value.padEnd(width)
}

/** `_p20_format_compact_currency`. */
function compact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'N/A'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  for (const [divisor, suffix] of [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
  ] as const) {
    if (abs >= divisor) return `${sign}$${(abs / divisor).toFixed(1)}${suffix}`
  }
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
}

/** `_p20_format_dollar_volume_m`: the ($m) columns print millions with no unit. */
function millions(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return ''
  return Math.round(value / 1e6).toLocaleString('en-US')
}

function signedPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function table(rows: TradingVolumeRow[], interval: TradingVolumeInterval, limit: number): void {
  const ranked = rankRows(rows, interval)
  const columns: Array<[string, number, 'left' | 'right']> = [
    ['#', 4, 'right'],
    ['Ticker', 8, 'left'],
    ['Name', 24, 'left'],
    ['Market Cap', 11, 'right'],
    ['1D ADV', 10, 'right'],
    ['5D ADV', 10, 'right'],
    ['30D ADV', 10, 'right'],
    ['YTD ADV', 10, 'right'],
    ['1Y ADV', 10, 'right'],
    ['3Y ADV', 10, 'right'],
    ['Return', 9, 'right'],
  ]
  console.log(columns.map(([title, width, align]) => pad(title, width, align)).join(' '))
  console.log(columns.map(([, width]) => '-'.repeat(width)).join(' '))

  for (const row of ranked.slice(0, limit)) {
    const cells = [
      pad(String(row.rank), 4, 'right'),
      pad(row.ticker, 8),
      pad(row.name, 24),
      pad(compact(row.marketCap), 11, 'right'),
      pad(millions(row.oneDayDollarVolume), 10, 'right'),
      pad(millions(row.fiveDayAvgDollarVolume), 10, 'right'),
      pad(millions(row.thirtyDayAvgDollarVolume), 10, 'right'),
      pad(millions(row.ytdAvgDollarVolume), 10, 'right'),
      pad(millions(row.oneYearAvgDollarVolume), 10, 'right'),
      pad(millions(row.threeYearAvgDollarVolume), 10, 'right'),
      pad(signedPct(metricValue(row, TRADING_VOLUME_METRICS[interval].returnField)), 9, 'right'),
    ]
    console.log(cells.join(' '))
  }
}

/**
 * What the dot plot actually draws. The fit is in log10 space on both axes, so these
 * numbers are directly comparable with `_p20_regression_line_data`.
 */
function plotInputs(rows: TradingVolumeRow[], interval: TradingVolumeInterval): void {
  const metric = TRADING_VOLUME_METRICS[interval]
  const points: Array<{ x: number; y: number }> = []
  let dropped = 0

  for (const row of rows) {
    const volume = metricValue(row, metric.volumeField)
    if (!isLoggable(volume) || !isLoggable(row.marketCap)) {
      dropped += 1
      continue
    }
    points.push({ x: Math.log10(volume), y: Math.log10(row.marketCap) })
  }

  console.log(`  plotted    : ${points.length} point(s); ${dropped} dropped as non-loggable`)
  if (!points.length) return

  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  console.log(
    `  x range    : ${compact(10 ** Math.min(...xs))} .. ${compact(10 ** Math.max(...xs))}`,
  )
  console.log(
    `  y range    : ${compact(10 ** Math.min(...ys))} .. ${compact(10 ** Math.max(...ys))}`,
  )

  const fit = leastSquares(points)
  if (!fit) {
    console.log('  trend line : (not fitted)')
    return
  }
  console.log(`  trend line : alpha ${fit.alpha.toFixed(4)}, beta ${fit.beta.toFixed(4)}`)
}

/**
 * What the Replay button animates. The shared timeline and the pinned y range are the two
 * things `_p20_replay_market_cap_animation` computes before it starts its timer, so they
 * are what to compare against the reference.
 */
function replayInputs(rows: TradingVolumeRow[], interval: TradingVolumeInterval): void {
  const plan = buildReplayPlan(rows, interval)
  if (!plan) {
    console.log('  replay     : disabled (no row has two points of interval history)')
    return
  }

  const tickers = Object.keys(plan.series)
  console.log(
    `  timeline   : ${plan.dates.length} date(s), ${plan.dates[0]} .. ${plan.dates.at(-1)}`,
  )
  console.log(`  animated   : ${tickers.length} ticker(s); ${plan.insufficient.length} held still`)
  console.log(
    `  y range    : ${compact(10 ** plan.yMin)} .. ${compact(10 ** plan.yMax)} (log10, padded)`,
  )

  // The last frame must land on the live market cap; `alignMarketCapHistory` forces it,
  // so a mismatch here means the interpolation or the timeline is wrong.
  const first = replayFrame(plan, 0)
  const last = replayFrame(plan, 1)
  console.log(`  frame 0.0  : ${first.date}`)
  console.log(`  frame 1.0  : ${last.date}`)
  console.log('    ticker  pts       start         end   lands on live cap')

  for (const row of rows.filter((entry) => tickers.includes(entry.ticker)).slice(0, 5)) {
    const points = intervalMarketCapHistory(row.marketCapHistory ?? [], interval).length
    const end = compact(last.caps[row.ticker])
    const live = compact(row.marketCap)
    console.log(
      [
        '   ',
        pad(row.ticker, 7),
        pad(String(points), 4, 'right'),
        pad(compact(first.caps[row.ticker]), 11, 'right'),
        pad(end, 11, 'right'),
        end === live ? '   ok' : `   MISMATCH (live ${live})`,
      ].join(' '),
    )
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--offline')) {
    const makeRow = (ticker: string, volume: number | null, cap: number | null): TradingVolumeRow => ({
      ticker, name: ticker, sector: '', marketCap: cap,
      oneDayDollarVolume: volume, fiveDayAvgDollarVolume: cap,
      thirtyDayAvgDollarVolume: null, ytdAvgDollarVolume: null,
      oneYearAvgDollarVolume: null, threeYearAvgDollarVolume: null,
      oneDayPriceReturnPct: null, fiveDayPriceReturnPct: null,
      thirtyDayPriceReturnPct: null, ytdPriceReturnPct: null,
      oneYearPriceReturnPct: null, threeYearPriceReturnPct: null,
      marketCapHistory: [],
    })
    const normal = Array.from({ length: 21 }, (_, i) => makeRow(`N${i}`, 10 ** (6 + i / 10), 10 ** (8 + i / 10)))
    const sample = rankRows([
      ...normal, makeRow('LOW', 1e7, 1e6), makeRow('HIGH', 1e7, 1e12),
      makeRow('NEAR', 1e7, 5e8), makeRow('MISSING', null, null),
      makeRow('ZERO', 0, 0),
    ], '1d')
    const cleaned = removeLowerOutliers(sample, '1d')
    assert.deepEqual(cleaned, sample.filter((row) => row.ticker !== 'LOW'))
    assert.equal(sample.length, 26, 'Input rows remain intact for Restore')
    assert.deepEqual(removeLowerOutliers(sample, '5d'), sample, 'Uses selected interval')
    assert.deepEqual(removeLowerOutliers([], '1d'), [])
    assert.deepEqual(removeLowerOutliers(sample.slice(0, 2), '1d'), sample.slice(0, 2))
    const flat = [makeRow('A', 1e7, 1e9), makeRow('B', 1e7, 1e6), makeRow('C', 1e7, 1e9)]
    assert.deepEqual(removeLowerOutliers(flat, '1d'), flat, 'No removals without a fitted line')
    const nearCutoff = rankRows([
      ...normal, makeRow('GRML', 1e7, 1.35e8), makeRow('KEEP', 1e7, 3e8),
    ], '1d')
    assert.deepEqual(removeLowerOutliers(nearCutoff, '1d'), nearCutoff.filter((row) => row.ticker !== 'GRML'),
      'Catches caps around 13.5% of the line estimate while retaining closer points')
    const multiple = rankRows([
      ...normal, makeRow('SMALL', 2e7, 1e5), makeRow('LARGER', 4e7, 1e6),
      makeRow('MISSING', null, null),
    ], '1d')
    assert.deepEqual(removeLowerOutliers(multiple, '1d', 0), multiple)
    assert.deepEqual(removeLowerOutliers(multiple, '1d', 1), multiple.filter(row => row.ticker !== 'SMALL'),
      'Slider removes the lowest market cap first, regardless of volume rank')
    assert.deepEqual(removeLowerOutliers(multiple, '1d', 2), multiple.filter(row => !['SMALL', 'LARGER'].includes(row.ticker)))
    assert.deepEqual(removeLowerOutliers(multiple, '1d', 999), removeLowerOutliers(multiple, '1d'))
    assert.deepEqual(removeLowerOutliers(multiple, '1d', -1), multiple)
    console.log('Trading Volumes offline outlier checks passed')
    return
  }
  const requested = process.argv[2] as TradingVolumeInterval | undefined
  const interval: TradingVolumeInterval =
    requested && TRADING_VOLUME_INTERVALS.includes(requested) ? requested : '1d'

  const started = Date.now()
  const envelope = await yahooProvider.tradingVolumes({})
  const payload = envelope.data

  console.log('== Trading Volumes ==')
  console.log(`source     : ${envelope.meta.source}`)
  console.log(`freshness  : ${envelope.meta.freshness}`)
  console.log(`as of      : ${payload.asOf || '--'}`)
  console.log(`rows       : ${payload.rows.length}`)
  console.log(`interval   : ${TRADING_VOLUME_METRICS[interval].label}`)
  console.log(`elapsed    : ${((Date.now() - started) / 1000).toFixed(1)}s`)

  console.log(`\n== Top 20 by ${TRADING_VOLUME_METRICS[interval].label} ADV (values in $m) ==`)
  table(payload.rows, interval, 20)

  console.log(`\n== Dot plot (${TRADING_VOLUME_METRICS[interval].axisLabel} vs Market Cap) ==`)
  plotInputs(payload.rows, interval)

  console.log(`\n== Replay (${TRADING_VOLUME_METRICS[interval].label}) ==`)
  replayInputs(payload.rows, interval)

  console.log(`\n${payload.missing.length} symbol(s) had no daily history.`)
  for (const symbol of payload.missing) console.log(`  missing: ${symbol}`)
  for (const error of envelope.errors.slice(0, 10)) {
    console.log(`  ! ${error.symbol ?? error.operation}: ${error.reason}`)
  }
}

void main()
