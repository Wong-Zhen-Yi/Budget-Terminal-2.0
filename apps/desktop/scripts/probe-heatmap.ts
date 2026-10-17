import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { HeatmapHolding, HeatmapInterval } from '../electron/shared/contract.js'
import {
  HEATMAP_ETFS,
  buildHeatmapDetail,
  buildHeatmapRows,
  buildHeatmapSummary,
  buildIntervalSummaries,
  changesFromCloses,
  etfLabel,
  etfTicker,
  formatHeatmapPct,
  formatHeatmapWeightPct,
  formatHoldingSummary,
  heatmapTileColor,
  intervalLabel,
  isUsableHoldingSymbol,
  mixHex,
  normalizeEtfKey,
  normalizeSector,
  selectHeatmapRow,
  weightedChangeFromRows,
  weightedMove,
} from '../electron/shared/heatmap.js'
import { excelColumnToIndex } from '../electron/services/etf/xlsx.js'
import { getIssuerEtfHoldings } from '../electron/services/etf/holdings.js'
import { resolveSector } from '../electron/services/etf/sectorMap.js'
import { fetchHeatmap, getHeatmap, HEATMAP_SOURCE } from '../electron/services/heatmap.js'
import { cache } from '../electron/services/cache.js'
import { closeDefeatBetaDecoder } from '../electron/services/defeatbeta/decoder.js'
import { closeYahooWorker, yahoo } from '../electron/services/yahoo/client.js'
import { defeatBeta } from '../electron/services/defeatbeta/client.js'

/**
 * The Heatmap page probe, run against `mixins/spy_heatmap.py` side by side.
 *
 * `--offline` covers everything pure: the seven interval returns off a synthetic close
 * series, the summary and detail builders, the tile colour ramp and the symbol filter.
 * Without it, it loads one index end to end and prints the holdings count, the coverage
 * per interval and the sector split, so the map can be compared against the PySide6 page.
 *
 *   npm run probe:heatmap                # SPY, live
 *   npm run probe:heatmap -- NDX         # the Nasdaq 100 button
 *   npm run probe:heatmap -- --offline   # the pure checks only
 */

function runOffline(): void {
  // `_p17_normalize_etf_symbol` accepts the key, the fetch ticker or the label.
  assert.equal(normalizeEtfKey('NDX'), 'NDX')
  assert.equal(normalizeEtfKey('qqq'), 'NDX')
  assert.equal(normalizeEtfKey('Dow 30'), 'DJI')
  assert.equal(normalizeEtfKey('nonsense'), 'SPY')
  assert.equal(etfTicker('NDX'), 'QQQ')
  assert.equal(etfLabel('DJI'), 'Dow 30')
  assert.equal(intervalLabel('ytd'), 'YTD')

  // `format_heatmap_pct` / `format_heatmap_weight_pct`: weights are fractions.
  assert.equal(formatHeatmapPct(1.234), '1.23%')
  assert.equal(formatHeatmapPct(1.235, true), '+1.24%')
  assert.equal(formatHeatmapPct(-0.001, true), '-0.00%')
  assert.equal(formatHeatmapPct(null), '--')
  assert.equal(formatHeatmapWeightPct(0.0873), '8.73%')
  assert.equal(formatHeatmapWeightPct(null), '--')

  // `_is_usable_symbol`: a Bloomberg placeholder and SSGA's cash dash are not tickers.
  assert.equal(isUsableHoldingSymbol('AAPL'), true)
  assert.equal(isUsableHoldingSymbol('BRK.B'), true)
  assert.equal(isUsableHoldingSymbol('BF-B'), true)
  assert.equal(isUsableHoldingSymbol('2602335D'), false)
  assert.equal(isUsableHoldingSymbol('-'), false)
  assert.equal(isUsableHoldingSymbol(''), false)

  // `_normalize_sector`: SSGA writes a literal dash where it has no sector.
  assert.equal(normalizeSector('-'), '')
  assert.equal(normalizeSector('N/A'), '')
  assert.equal(normalizeSector(' Information Technology '), 'Information Technology')

  // Current State Street workbooks contain the Sector column but publish literal
  // dashes. Missing issuer classification must use the constituent map, including
  // Yahoo's hyphen spelling for a share class; genuine unknowns remain unknown.
  const sectorMap = { NVDA: 'Information Technology', 'BRK.B': 'Financials' }
  assert.equal(resolveSector('NVDA', normalizeSector('-'), sectorMap), 'Information Technology')
  assert.equal(resolveSector('NVDA', normalizeSector('N/A'), sectorMap), 'Information Technology')
  assert.equal(resolveSector('BRK-B', '', sectorMap), 'Financials')
  assert.equal(resolveSector('NVDA', 'Issuer-provided sector', sectorMap), 'Issuer-provided sector')
  assert.equal(resolveSector('UNKNOWN', '', sectorMap), '', 'Unavailable sectors must not be fabricated')

  // `excel_col_to_index`.
  assert.equal(excelColumnToIndex('A'), 0)
  assert.equal(excelColumnToIndex('Z'), 25)
  assert.equal(excelColumnToIndex('AA'), 26)

  /*
   * `_changes_from_close` over a series with a known shape: one close per calendar day
   * across a year and a bit, priced at 100 + the day index. Every window's base is then
   * predictable, which is what makes the arithmetic checkable without a fixture file.
   */
  const dates: string[] = []
  const closes: number[] = []
  for (let index = 0; index <= 400; index += 1) {
    const day = new Date(Date.UTC(2025, 6, 1) + index * 24 * 60 * 60 * 1000)
    dates.push(day.toISOString().slice(0, 10))
    closes.push(100 + index)
  }
  const changes = changesFromCloses(dates, closes)
  const latest = closes[closes.length - 1]
  const at = (isoDate: string) => closes[dates.indexOf(isoDate)]
  const pct = (base: number) => ((latest - base) / base) * 100

  // Last bar is 2026-08-05 (2025-07-01 plus 400 days).
  assert.equal(dates[dates.length - 1], '2026-08-05')
  // live and 1d are the same pair, as the reference computes them from one comparison.
  assert.equal(changes.live, changes['1d'])
  assert.equal(changes.live, pct(closes[closes.length - 2]))
  assert.equal(changes['1w'], pct(at('2026-07-29')))
  assert.equal(changes['1m'], pct(at('2026-07-05')))
  assert.equal(changes['3m'], pct(at('2026-05-05')))
  assert.equal(changes['1y'], pct(at('2025-08-05')))
  // YTD's base is the last close *before* January 1st, not the first close of the year.
  assert.equal(changes.ytd, pct(at('2025-12-31')))

  // A window that reaches past the start of the series falls back to the first bar.
  const short = changesFromCloses(['2026-08-04', '2026-08-05'], [100, 110])
  assert.equal(short.live, 10)
  assert.equal(short['1y'], 10)
  // A single bar reports a flat move rather than dropping the tile.
  assert.deepEqual(changesFromCloses(['2026-08-05'], [100]), {
    live: 0,
    '1d': 0,
    '1w': 0,
    '1m': 0,
    '3m': 0,
    '1y': 0,
    ytd: 0,
  })
  assert.deepEqual(changesFromCloses([], []), {})

  const holdings: HeatmapHolding[] = [
    { symbol: 'AAA', name: 'Alpha', sector: 'Tech', weight: 0.5, price: 10, changes: { live: 2, '1y': 40 } },
    { symbol: 'BBB', name: 'Beta', sector: 'Tech', weight: 0.3, price: 20, changes: { live: -1 } },
    { symbol: 'CCC', name: 'Gamma', sector: 'Energy', weight: 0.2, price: 30, changes: {} },
  ]

  // `_weighted_move`: the denominator is only the weights that had a change.
  assert.equal(weightedMove(holdings, 'live'), (0.5 * 2 + 0.3 * -1) / 0.8)
  assert.equal(weightedMove(holdings, '1y'), 40)
  assert.equal(weightedMove(holdings, '3m'), null)

  // `_interval_summary`: coverage is per interval, which is what makes an unquoted
  // window visible rather than silently averaging over fewer names.
  const summaries = buildIntervalSummaries(holdings)
  assert.equal(summaries.live.quoteCoverage, 2)
  assert.equal(summaries['1y'].quoteCoverage, 1)
  assert.equal(summaries['3m'].quoteCoverage, 0)
  assert.equal(summaries.live.strongest?.symbol, 'AAA')
  assert.equal(summaries.live.weakest?.symbol, 'BBB')
  assert.equal(summaries['3m'].strongest, null)

  const payload = {
    etf: 'SPY' as const,
    ticker: 'SPY',
    fundName: 'SPDR S&P 500 ETF Trust',
    issuer: 'SPDR / State Street',
    asOfDate: '27-Aug-2026',
    sourceUrl: 'https://example.invalid/spy.xlsx',
    holdings,
    holdingsLoaded: 3,
    quoteCoverage: summaries.live.quoteCoverage,
    weightedDayMove: summaries.live.weightedMove,
    strongest: summaries.live.strongest,
    weakest: summaries.live.weakest,
    intervalSummaries: summaries,
    fetchedAt: Date.now(),
  }

  // `build_spy_heatmap_rows`: an unquoted interval leaves `changePct` null, not zero —
  // collapsing it to zero would paint a missing quote as a genuine flat move.
  const rows = buildHeatmapRows(payload, 'SPY', 'live')
  assert.equal(rows.length, 3)
  assert.equal(rows[2].changePct, null)
  assert.equal(rows[0].changeLabel, 'Live Change')
  assert.equal(rows[2].sector, 'Energy')
  assert.equal(buildHeatmapRows(payload, 'SPY', '3m')[0].changePct, null)

  // `weighted_change_from_heatmap_rows` recomputes the same mean off what is displayed.
  assert.equal(weightedChangeFromRows(rows), weightedMove(holdings, 'live'))

  // `select_heatmap_row`: keep the symbol across an interval change, drop it across ETFs.
  assert.equal(selectHeatmapRow(rows, null, 'SPY')?.symbol, 'AAA')
  assert.equal(selectHeatmapRow(rows, rows[1], 'SPY')?.symbol, 'BBB')
  assert.equal(selectHeatmapRow(rows, { ...rows[1], etf: 'NDX' }, 'SPY')?.symbol, 'AAA')
  assert.equal(selectHeatmapRow([], rows[1], 'SPY'), null)

  // `build_heatmap_summary` reads the interval's own block, falling back to `live`.
  assert.equal(buildHeatmapSummary(payload, '1y').quoteCoverage, 1)
  assert.equal(buildHeatmapSummary(undefined, 'live').holdingsLoaded, 0)
  assert.equal(formatHoldingSummary(summaries.live.strongest), 'AAA +2.00%')
  assert.equal(formatHoldingSummary(null), '--')

  // `build_heatmap_detail`, empty and populated.
  const empty = buildHeatmapDetail(null, 'live')
  assert.equal(empty.symbol, 'Select a holding')
  assert.equal(empty.changeText, 'Change: --')
  const detail = buildHeatmapDetail(rows[0], 'live')
  assert.equal(detail.weight, 'Weight: 50.00%')
  assert.equal(detail.price, 'Price: $10.00')
  assert.equal(detail.changeText, 'Live Change: +2.00%')
  // The row carries its own change label, so the detail strip names the interval the
  // row was built for rather than whatever is selected now.
  assert.equal(
    buildHeatmapDetail(buildHeatmapRows(payload, 'SPY', '3m')[2], '3m').changeText,
    '3M Change: --',
  )

  // `_mix_color` truncates each channel, exactly as Python's `int()` does.
  assert.equal(mixHex('#000000', '#ffffff', 0.5), 'rgb(127, 127, 127)')
  assert.equal(mixHex('#000000', '#ffffff', 2), 'rgb(255, 255, 255)')
  // `_heat_color`: neutral for no quote, and saturating at a 4% move rather than 5%.
  const palette = { neutral: '#121b2b', up: '#26c281', down: '#f0554e' }
  assert.equal(heatmapTileColor(null, palette), palette.neutral)
  assert.equal(heatmapTileColor(4, palette), heatmapTileColor(40, palette))
  assert.notEqual(heatmapTileColor(2, palette), heatmapTileColor(4, palette))
  assert.notEqual(heatmapTileColor(1, palette), heatmapTileColor(-1, palette))

  console.log('offline checks passed')
}

async function runLive(etfArgument: string): Promise<void> {
  const key = normalizeEtfKey(etfArgument)
  const ticker = etfTicker(key)

  console.log(`\n=== ${etfLabel(key)} (${ticker}) ===`)
  const started = Date.now()
  const source = await getIssuerEtfHoldings(ticker)
  console.log(
    `holdings file: ${source.issuer} | ${source.holdings.length} rows | as of ${
      source.asOfDate || '--'
    }${source.isPartial ? ' | TOP-HOLDINGS FALLBACK, not the full book' : ''}`,
  )
  console.log(`  ${source.sourceUrl}`)

  const { payload, errors } = await getHeatmap(key, true)
  assert(payload.quoteCoverage > 0, JSON.stringify(errors))
  assert.equal(payload.priceSource, 'Yahoo Finance')
  assert(payload.priceAsOfDate)
  assert.equal(payload.publishedAt, undefined)
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  const bySector = new Map<string, { count: number; weight: number }>()
  for (const holding of payload.holdings) {
    const bucket = bySector.get(holding.sector) ?? { count: 0, weight: 0 }
    bucket.count += 1
    bucket.weight += holding.weight
    bySector.set(holding.sector, bucket)
  }

  console.log(
    JSON.stringify(
      {
        fundName: payload.fundName,
        issuer: payload.issuer,
        asOfDate: payload.asOfDate,
        priceAsOfDate: payload.priceAsOfDate,
        holdingsLoaded: payload.holdingsLoaded,
        elapsedSeconds: Number(seconds),
        weightSum: Number(
          payload.holdings.reduce((total, holding) => total + holding.weight, 0).toFixed(4),
        ),
        errors: errors.map((error) => `${error.source}: ${error.reason}`),
      },
      null,
      2,
    ),
  )

  console.log('\nInterval  Coverage    Weighted   Strongest              Weakest')
  for (const entry of HEATMAP_ETFS.length ? Object.keys(payload.intervalSummaries) : []) {
    const interval = entry as HeatmapInterval
    const summary = payload.intervalSummaries[interval]
    console.log(
      `${intervalLabel(interval).padEnd(9)} ${`${summary.quoteCoverage}/${payload.holdingsLoaded}`.padEnd(11)} ${formatHeatmapPct(
        summary.weightedMove,
        true,
      ).padStart(8)}   ${formatHoldingSummary(summary.strongest).padEnd(22)} ${formatHoldingSummary(
        summary.weakest,
      )}`,
    )
  }

  console.log('\nSector split (as the map groups it)')
  for (const [sector, bucket] of [...bySector.entries()].sort((a, b) => b[1].weight - a[1].weight)) {
    console.log(`  ${sector.padEnd(26)} ${String(bucket.count).padStart(4)}  ${formatHeatmapWeightPct(bucket.weight).padStart(8)}`)
  }

  console.log('\nTop 15 holdings, latest day')
  for (const row of buildHeatmapRows(payload, key, 'live').slice(0, 15)) {
    console.log(
      `  ${row.symbol.padEnd(7)} ${formatHeatmapWeightPct(row.weight).padStart(7)} ${formatHeatmapPct(
        row.changePct,
        true,
      ).padStart(8)}  ${row.sector.padEnd(24)} ${row.name}`,
    )
  }

  const unquoted = payload.holdings.filter((holding) => holding.changes.live === undefined)
  if (unquoted.length) {
    console.log(
      `\n${unquoted.length} unquoted (drawn as dashed no-data tiles): ${unquoted
        .slice(0, 20)
        .map((holding) => holding.symbol)
        .join(', ')}${unquoted.length > 20 ? ', ...' : ''}`,
    )
  }
}

async function runProviderChecks(): Promise<void> {
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
  const source = { ticker: 'SPY', fundName: 'S&P 500', issuer: 'Issuer fixture', asOfDate: day(1),
    expenseRatio: '--', netAssets: '--', sourceUrl: 'https://example.invalid/holdings', sectorBreakdown: [],
    isPartial: false, coverageNote: '', holdings: [
      { symbol: 'AAA', name: 'Alpha', sector: '', weight: 0.5 },
      { symbol: 'BRK.B', name: 'Berkshire', sector: 'Financials', weight: 0.3 },
      { symbol: 'OLD', name: 'Old session', sector: '', weight: 0.1 },
      { symbol: 'MISS', name: 'Missing', sector: '', weight: 0.1 },
      { symbol: '-', name: 'Cash', sector: '', weight: 0.01 },
    ] }
  let observedForce = false
  const deps = {
    holdings: async () => source,
    sectors: async () => ({ AAA: 'Information Technology' }),
    prices: async (symbols: string[], range = '1y', force = false) => {
      assert.deepEqual(symbols, ['AAA', 'BRK-B', 'OLD', 'MISS'])
      assert.equal(range, '1y')
      observedForce = force
      return { series: {
        AAA: { dates: [day(2), day(1)], closes: [100, 110] },
        'BRK-B': { dates: [day(2), day(1)], closes: [200, 180] },
      }, missing: ['OLD', 'MISS'] }
    },
  }
  const result = await fetchHeatmap('SPY', true, deps)
  assert(observedForce, 'Refresh must force Yahoo history reads')
  assert.equal(result.payload.holdingsLoaded, 4)
  assert.equal(result.payload.quoteCoverage, 2)
  assert.equal(result.payload.priceAsOfDate, day(1))
  assert.equal(result.payload.asOfDate, source.asOfDate)
  assert.equal(result.payload.holdings[0].sector, 'Information Technology')
  assert.equal(result.payload.holdings[1].symbol, 'BRK.B')
  assert.equal(result.payload.holdings[1].price, 180)
  assert.equal(result.payload.holdings[2].price, null)
  assert.equal(result.payload.holdings[3].changes.live, undefined)
  assert.equal(result.payload.weightedDayMove, (0.5 * 10 + 0.3 * -10) / 0.8)
  assert(result.errors[0].reason.includes('OLD, MISS'))
  assert.equal(buildHeatmapRows(result.payload, 'SPY', 'live')[0].changeLabel, 'Live Change')
  assert.equal(result.payload.priceSource, 'Yahoo Finance')
  assert.equal(result.payload.publishedAt, undefined)
  await assert.rejects(() => fetchHeatmap('SPY', true, { ...deps, prices: async () => { throw new Error('Yahoo offline') } }), /Yahoo offline/)
  const empty = await fetchHeatmap('SPY', true, { ...deps, prices: async () => ({ series: {}, missing: ['AAA', 'BRK-B', 'OLD', 'MISS'] }) })
  assert.equal(empty.payload.quoteCoverage, 0)
  assert(empty.errors.length)
  assert(HEATMAP_SOURCE.includes('Yahoo Finance'))
  assert(!HEATMAP_SOURCE.includes('DefeatBeta'))

  // Exercise the real Yahoo batching path during success and failure. DefeatBeta
  // methods remain guarded throughout this probe, including a Yahoo outage.
  const originalSpark = yahoo._fetch
  Object.assign(yahoo, { _fetch: async () => ({
    AAA: { symbol: 'AAA', timestamp: [Date.parse(day(2)) / 1000, Date.parse(day(1)) / 1000], close: [100, 110] },
    'BRK-B': { symbol: 'BRK-B', timestamp: [Date.parse(day(2)) / 1000, Date.parse(day(1)) / 1000], close: [200, 180] },
  }) })
  try {
    const { fetchSparkCloses } = await import('../electron/services/yahoo/spark.js')
    const actual = await fetchHeatmap('SPY', true, { ...deps, prices: fetchSparkCloses })
    assert.equal(actual.payload.quoteCoverage, 2)
    Object.assign(yahoo, { _fetch: async () => { throw new Error('Yahoo offline') } })
    const unavailable = await fetchHeatmap('SPY', true, { ...deps, prices: fetchSparkCloses })
    assert.equal(unavailable.payload.quoteCoverage, 0)
    assert(unavailable.errors.every(error => error.source === 'Yahoo Finance'))
  } finally { Object.assign(yahoo, { _fetch: originalSpark }) }

  // Issuer outages must never initiate Yahoo enrichment or a top-ten fallback.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Issuer offline') }
  try { await assert.rejects(() => getIssuerEtfHoldings('HEATMAPTEST', true), /Issuer not yet supported/) }
  finally { globalThis.fetch = originalFetch }
  console.log('Yahoo heatmap checks passed: dates, share classes, partial coverage and no DefeatBeta requests during outages')
}

const scratch = await mkdtemp(join(tmpdir(), 'bt-heatmap-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
const defeatBetaMethods = ['rows', 'priceRows', 'companies', 'company'] as const
const originalDefeatBeta = Object.fromEntries(defeatBetaMethods.map(method => [method, defeatBeta[method]]))
let defeatBetaCalls = 0
Object.assign(defeatBeta, Object.fromEntries(defeatBetaMethods.map(method => [method,
  async () => { defeatBetaCalls += 1; throw new Error('DefeatBeta is inactive') }])))
try {
  const args = process.argv.slice(2)
  runOffline()
  await runProviderChecks()
  if (!args.includes('--offline')) await runLive(args.find(argument => !argument.startsWith('--')) ?? 'SPY')
  assert.equal(defeatBetaCalls, 0)
} finally {
  Object.assign(defeatBeta, originalDefeatBeta)
  closeDefeatBetaDecoder()
  closeYahooWorker()
  cache.close()
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
  if (scratch.startsWith(join(tmpdir(), 'bt-heatmap-'))) await rm(scratch, { recursive: true, force: true })
}
