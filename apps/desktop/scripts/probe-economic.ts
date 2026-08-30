import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { EconomicPoint, EconomicRow } from '../electron/shared/contract.js'
import {
  alignDifference,
  applyTransform,
  buildRow,
  buildYieldCurve,
  describeCurve,
  describeFreshness,
  ECONOMIC_SERIES,
  formatEconomicChange,
  formatEconomicValue,
  historySeries,
  missingSummary,
  SERIES_BY_ID,
  summarizeHeadlines,
  trimHistory,
  YIELD_CURVE_SERIES,
  yoyChange,
} from '../electron/shared/economic.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function close(actual: number | null, expected: number, message: string): void {
  assert(actual !== null && Math.abs(actual - expected) < 1e-6, `${message} (got ${actual})`)
}

function monthly(start: string, values: number[]): EconomicPoint[] {
  const [year, month] = start.split('-').map(Number)
  return values.map((value, index) => {
    const stamp = new Date(Date.UTC(year, month - 1 + index, 1))
    return [stamp.toISOString().slice(0, 10), value] as EconomicPoint
  })
}

function catalogChecks(): void {
  assert(ECONOMIC_SERIES.length === 49, `catalog should carry 49 series, saw ${ECONOMIC_SERIES.length}`)
  assert(new Set(ECONOMIC_SERIES.map((s) => s.seriesId)).size === ECONOMIC_SERIES.length, 'series ids must be unique')
  assert(YIELD_CURVE_SERIES.length === 11, 'eleven tenors should draw the treasury curve')
  assert(
    YIELD_CURVE_SERIES.every((series, index, all) => index === 0 || all[index - 1].tenorYears! <= series.tenorYears!),
    'curve tenors should be in catalog order, shortest first',
  )
  assert(SERIES_BY_ID.get('CPIAUCSL')?.provider === 'bls', 'CPI should resolve from BLS, not FRED')
  assert(
    SERIES_BY_ID.get('T10YIE')?.providerKey === '10 Yr|10 YR',
    'the 10Y breakeven key should pair the nominal and TIPS column spellings',
  )
}

function transformChecks(): void {
  const level = monthly('2025-01', [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 110])
  assert(applyTransform(level, 'level').length === 13, 'level should pass every observation through')

  const yoy = applyTransform(level, 'yoy_pct', 'monthly')
  assert(yoy.length === 1 && yoy[0][0] === '2026-01-01', 'YoY should start one year in')
  close(yoy[0][1], 10, 'YoY of 100 -> 110 should be +10%')
  close(yoyChange(level, 'monthly'), 10, 'yoyChange should match the last transformed point')

  const momPct = applyTransform(monthly('2025-01', [100, 110, 99]), 'mom_pct')
  close(momPct[0][1], 10, 'MoM percent should be +10%')
  close(momPct[1][1], -10, 'MoM percent should be -10%')

  const momDiff = applyTransform(monthly('2025-01', [150_000, 150_250]), 'mom_diff')
  close(momDiff[0][1], 250, 'MoM difference should subtract, not divide')

  const saar = applyTransform(monthly('2025-01', [100, 101]), 'qoq_saar', 'quarterly')
  close(saar[0][1], ((1.01) ** 4 - 1) * 100, 'QoQ SAAR should compound the quarterly rate four times')

  // A reporting gap must not pair a month with the wrong year-ago partner.
  const gapped: EconomicPoint[] = [
    ['2025-01-01', 100],
    ['2025-06-01', 104],
    ['2026-01-01', 110],
  ]
  const gappedYoy = applyTransform(gapped, 'yoy_pct', 'monthly')
  assert(gappedYoy.length === 1, 'a gapped series should only yield the pairs within tolerance')
  close(gappedYoy[0][1], 10, 'the gapped YoY should still pair 2025-01 with 2026-01')

  // A zero base has no percent change, and a sentinel row is dropped rather than plotted.
  assert(applyTransform(monthly('2025-01', [0, 5]), 'mom_pct').length === 0, 'a zero base yields no percent change')
  assert(
    applyTransform([['2025-01-01', Number.NaN], ['2025-02-01', 5]] as EconomicPoint[], 'level').length === 1,
    'non-finite observations should be dropped',
  )
}

function differenceChecks(): void {
  const nominal: EconomicPoint[] = [['2026-01-02', 4.5], ['2026-01-05', 4.6], ['2026-01-06', 4.55]]
  const real: EconomicPoint[] = [['2026-01-02', 2.1], ['2026-01-06', 2.15]]
  const spread = alignDifference(nominal, real)
  assert(spread.length === 2, 'a breakeven is only defined where both curves have a value')
  close(spread[0][1], 2.4, 'the first breakeven should be nominal less real')
  close(spread[1][1], 2.4, 'the last breakeven should be nominal less real')
}

function formattingChecks(): void {
  assert(formatEconomicValue(2.5, 'percent', 1) === '2.5%', 'percent formatting should carry its sign character')
  assert(formatEconomicValue(159_432, 'thousands', 0) === '159,432K', 'thousands should group and suffix K')
  assert(formatEconomicValue(7_100_000, 'millions', 0) === '$7,100.0B', 'millions should print as billions')
  assert(formatEconomicValue(219_000, 'count', 0) === '219,000', 'counts should group without a suffix')
  assert(formatEconomicValue(null, 'percent', 1) === '—', 'a missing value should be an em dash')
  assert(formatEconomicChange(0.2, 'percent', 1) === '+0.2 pp', 'a percent change should read in pp')
  assert(formatEconomicChange(-0.2, 'percent', 1) === '-0.2 pp', 'a negative pp change should keep its sign')
  assert(formatEconomicChange(-250, 'thousands', 0) === '-250K', 'a non-percent change should sign the magnitude')
}

function rowChecks(): EconomicRow[] {
  const cpi = SERIES_BY_ID.get('CPIAUCSL')!
  const row = buildRow(cpi, monthly('2025-01', [300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313]))
  assert(row.available && row.transform === 'yoy_pct', 'a populated CPI row should be available')
  close(row.latest, ((313 / 301) - 1) * 100, 'the CPI latest should be the YoY of the last observation')
  assert(row.rawLatest === 313, 'rawLatest should report the untransformed observation')
  assert(row.source === 'BLS CUSR0000SA0', 'the source label should name the provider and its key')

  const empty = buildRow(SERIES_BY_ID.get('PCEPI')!, [])
  assert(!empty.available && empty.latest === null && empty.history.length === 0, 'an empty series must not fabricate a row')

  // Ten years of history, trimmed.
  const long = monthly('2010-01', Array.from({ length: 200 }, (_, index) => 100 + index))
  assert(trimHistory(long).length < long.length, 'trimHistory should drop observations past ten years')
  assert(trimHistory(long).at(-1)?.[0] === long.at(-1)?.[0], 'trimHistory should keep the newest observation')

  const sparse = historySeries(row, 1)
  assert(sparse.dates.length === sparse.values.length, 'historySeries should return parallel lists')

  return [row, empty]
}

function curveChecks(): void {
  const rates: EconomicRow[] = [
    buildRow(SERIES_BY_ID.get('DGS3MO')!, [['2026-01-06', 4.30]]),
    buildRow(SERIES_BY_ID.get('DGS2')!, [['2026-01-06', 4.10]]),
    buildRow(SERIES_BY_ID.get('DGS10')!, [['2026-01-06', 4.05]]),
  ]
  const curve = buildYieldCurve(rates)
  assert(curve.tenors.map((item) => item.label).join(',') === '3M,2Y,10Y', 'tenors should sort by maturity')
  close(curve.spread10y2y, -0.05, '10Y-2Y should be the tenor difference')
  close(curve.spread10y3m, -0.25, '10Y-3M should be the tenor difference')
  assert(curve.inverted2s10s && curve.inverted3m10y, 'a negative spread should flag the inversion')
  assert(describeCurve(curve).includes('inverted'), 'the summary should name an inverted curve')

  const flat = buildYieldCurve([
    buildRow(SERIES_BY_ID.get('DGS2')!, [['2026-01-06', 4.0]]),
    buildRow(SERIES_BY_ID.get('DGS10')!, [['2026-01-06', 4.1]]),
  ])
  assert(describeCurve(flat).includes('flat'), 'a spread under 0.15 pp should read as flat')
  assert(describeCurve(null) === 'Treasury curve unavailable.', 'an absent curve should say so')
}

function statusChecks(rows: EconomicRow[]): void {
  const today = new Date().toISOString().slice(0, 19)
  const healthy = describeFreshness({
    generatedAt: today,
    source: 'test',
    groups: ['Inflation'],
    rows,
    missing: [],
    unreachable: [],
    yieldCurve: buildYieldCurve(rows),
  })
  assert(healthy.tone === 'positive', 'a payload with no gaps should read positive')
  assert(healthy.text.startsWith('1 of 2 series loaded'), `unexpected freshness line: ${healthy.text}`)
  assert(healthy.text.includes('refreshed today'), 'a payload built today should say so')

  const degraded = {
    generatedAt: today,
    source: 'test',
    groups: ['Inflation'] as const,
    rows,
    missing: ['PCEPI'],
    unreachable: ['fred'] as const,
    yieldCurve: buildYieldCurve(rows),
  }
  const line = describeFreshness({ ...degraded, groups: [...degraded.groups], unreachable: [...degraded.unreachable] })
  assert(line.tone === 'warning', 'an unreachable provider should read as a warning')
  assert(line.text.includes('unreachable: FRED'), 'the freshness line should name the provider by label')

  const summary = missingSummary({
    ...degraded,
    groups: [...degraded.groups],
    unreachable: [...degraded.unreachable],
  })
  assert(summary.includes('1 series unavailable'), `unexpected missing summary: ${summary}`)
  assert(summary.includes('FRED (1)'), 'the missing summary should attribute the gap to its provider')

  assert(describeFreshness(null).tone === 'muted', 'an unloaded page should read muted')

  const headlines = summarizeHeadlines({
    generatedAt: today,
    source: 'test',
    groups: [],
    rows,
    missing: [],
    unreachable: [],
    yieldCurve: buildYieldCurve(rows),
  })
  assert(Object.keys(headlines).length === 7, 'the headline strip should always carry seven tiles')
  assert(headlines.UNRATE === '—', 'a headline with no row should render an em dash rather than vanish')
}

async function parserChecks(): Promise<void> {
  const { parseFredCsv, parseTreasuryCsv, parseBlsPayload, parseNyfedRates, parseUmichCsv } =
    await import('../electron/services/economic.js')

  const fred = parseFredCsv('observation_date,PCEPI\n2026-01-01,125.4\n2026-02-01,.\n2026-03-01,126.0\n')
  assert(fred.length === 2, "FRED's `.` sentinel must not land in the series as a zero")
  close(fred[1][1], 126.0, 'the FRED parser should keep the finite observations')

  const treasury = parseTreasuryCsv(
    'Date,"1 Mo","2 Yr","10 Yr"\n01/06/2026,4.35,,4.05\n01/05/2026,4.34,4.10,4.06\n',
  )
  assert(treasury.get('10 Yr')?.length === 2, 'treasury columns should be read by name')
  assert(treasury.get('2 Yr')?.length === 1, 'an unauctioned tenor should be skipped, not zeroed')
  assert(treasury.get('10 Yr')?.[0][0] === '2026-01-05', 'treasury MM/DD/YYYY dates should sort ascending as ISO')

  const bls = parseBlsPayload({
    Results: {
      series: [
        {
          seriesID: 'CUSR0000SA0',
          data: [
            { year: '2026', period: 'M13', value: '319.0' },
            { year: '2026', period: 'M02', value: '318.5' },
            { year: '2026', period: 'M01', value: '318.0' },
          ],
        },
        { seriesID: 'GDP', data: [{ year: '2025', period: 'Q04', value: '1,234.5' }] },
      ],
    },
  })
  assert(bls.get('CUSR0000SA0')?.length === 2, 'M13 is the annual average and must not join the monthly series')
  assert(bls.get('CUSR0000SA0')?.[0][0] === '2026-01-01', 'BLS periods should decode to the first of the month')
  close(bls.get('GDP')?.[0][1] ?? null, 1234.5, 'BLS values carry thousands separators')
  assert(bls.get('GDP')?.[0][0] === '2025-12-01', 'a quarter should decode to its closing month')

  const nyfed = parseNyfedRates(
    JSON.stringify({ refRates: [{ effectiveDate: '2026-01-06', percentRate: 4.33, type: 'EFFR' }] }),
  )
  assert(nyfed.length === 1 && nyfed[0][0] === '2026-01-06', 'the NY Fed parser should read effectiveDate')
  assert(parseNyfedRates('not json').length === 0, 'a malformed NY Fed body should be empty, not thrown')

  const umich = parseUmichCsv('Month,YYYY,ICS_ALL\nJanuary,2026,71.8\nFebruary,2026,72.4\nTotal,,\n')
  assert(umich.length === 2, 'the UMich parser should skip rows without a month name')
  assert(umich[1][0] === '2026-02-01', 'UMich months should decode to the first of the month')
}

async function main(): Promise<void> {
  catalogChecks()
  transformChecks()
  differenceChecks()
  formattingChecks()
  const rows = rowChecks()
  curveChecks()
  statusChecks(rows)
  await parserChecks()
  console.log('Economic offline checks passed.')
  if (process.argv.includes('--offline')) return

  // A live run writes its cache into a scratch APPDATA so a probe never disturbs the app's
  // own six-hour payload.
  const temporary = await mkdtemp(join(tmpdir(), 'budget-terminal-economic-'))
  const previousAppData = process.env.APPDATA
  process.env.APPDATA = temporary
  try {
    const { getEconomic } = await import('../electron/services/economic.js')
    const started = Date.now()
    const result = await getEconomic({ force: true })
    const payload = result.payload
    const loaded = payload.rows.filter((row) => row.available)
    console.log(
      `Live load: ${loaded.length}/${payload.rows.length} series in ${((Date.now() - started) / 1000).toFixed(1)}s` +
      ` (${describeFreshness(payload).text})`,
    )
    assert(payload.rows.length === ECONOMIC_SERIES.length, 'a live load should build one row per catalog entry')
    assert(loaded.length > 0, 'every provider was unreachable; the page would render empty')

    const byProvider = new Map<string, { loaded: number; total: number }>()
    for (const row of payload.rows) {
      const bucket = byProvider.get(row.provider) ?? { loaded: 0, total: 0 }
      bucket.total += 1
      if (row.available) bucket.loaded += 1
      byProvider.set(row.provider, bucket)
    }
    for (const [provider, counts] of [...byProvider].sort()) {
      console.log(`  ${provider.padEnd(20)} ${counts.loaded}/${counts.total}`)
    }

    for (const seriesId of ['CPIAUCSL', 'UNRATE', 'FEDFUNDS', 'DGS10', 'T10Y2Y']) {
      const row = payload.rows.find((entry) => entry.seriesId === seriesId)
      console.log(
        `  ${seriesId.padEnd(12)} ${formatEconomicValue(row?.latest ?? null, row?.units ?? '', row?.decimals ?? 1).padStart(12)}` +
        ` as of ${row?.latestDate ?? '—'} (${row?.history.length ?? 0} points)`,
      )
    }
    console.log(`  Curve: ${describeCurve(payload.yieldCurve)} (${payload.yieldCurve.tenors.length} tenors)`)
    if (payload.missing.length) console.log(`  ${missingSummary(payload)}`)

    // The second call must come off the disk cache rather than paying for the fan-out again.
    const cached = await getEconomic({})
    assert(cached.fromCache, 'a second load inside the TTL should serve the cached payload')
    console.log(`  Cache: served at ${cached.cacheAgeSeconds.toFixed(1)}s old without refetching.`)
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousAppData
    await rm(temporary, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
