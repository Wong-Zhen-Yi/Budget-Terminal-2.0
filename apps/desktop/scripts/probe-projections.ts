import assert from 'node:assert/strict'

import type { ChartsInterval } from '../electron/shared/contract.js'
import type { OptionsExpirationBucket, OptionsRawRow } from '../electron/shared/optionsPage.js'
import { topVolumeRecords } from '../electron/shared/optionsPage.js'
import {
  buildProjectionPaths,
  buildProjectionsExport,
  buildProjectionSummaries,
  combinedProjectionSummary,
  confidenceLabel,
  effectiveOptionPrice,
  liquidityWeight,
  moneynessQualityWeight,
  projectionAggregate,
  projectionChangeText,
  projectionHeadlines,
  projectionPrice,
  projectionRecords,
  projectionSideSummary,
  projectionsRange,
  PROJECTIONS_TIMEFRAMES,
  sectionProjectionLabel,
  spreadQualityWeight,
  weightedPercentile,
  PROXY_MAX_SPREAD_PCT,
  PROXY_MIN_MONEYNESS_WEIGHT,
} from '../electron/shared/projections.js'
import { getProjections } from '../electron/services/yahoo/projections.js'

/**
 * The Projections page probe, run against `mixins/charts_options_top_volume.py` side by
 * side.
 *
 * `--offline` covers everything pure: the quality weights, the weighted median, one
 * whole side summary built from a hand-written chain, the confidence-weighted
 * combination, the weekly path interpolation, the coverage aggregate and the Markdown
 * export.
 *
 * Without it the real load also runs and prints what came back: the chart, every
 * expiration's contract counts, the three headline projections and the coverage tile,
 * so the strip and the panels can be compared against the PySide6 page directly.
 *
 *   npm run probe:projections -- AAPL
 *   npm run probe:projections -- SPY "1 Week"
 *   npm run probe:projections -- --offline
 */

function row(patch: Partial<OptionsRawRow>): OptionsRawRow {
  return {
    ticker: 'TEST',
    type: 'Call',
    strike: 100,
    expiration: '2025-02-21',
    lastPrice: 2,
    bid: 1.9,
    ask: 2.1,
    change: 0,
    volume: 100,
    openInterest: 500,
    impliedVolatility: 0.3,
    inTheMoney: false,
    ...patch,
  }
}

function close(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  )
}

function runOffline(): void {
  // -------------------------------------------------------------- weights
  // `_p28_effective_option_price`: a two-sided quote only, and the spread is a fraction
  // of the midpoint rather than of the ask.
  const priced = effectiveOptionPrice({ bid: 1.9, ask: 2.1 })
  assert.ok(priced)
  close(priced.mid, 2)
  assert.notEqual(priced.spreadPct, null)
  close(priced.spreadPct ?? 0, 0.1)
  assert.equal(effectiveOptionPrice({ bid: 0, ask: 2.1 }), null)
  assert.equal(effectiveOptionPrice({ bid: 2.2, ask: 2.1 }), null)
  assert.equal(effectiveOptionPrice({ bid: null, ask: 2.1 }), null)

  // `_p28_spread_quality_weight`: 0.15 is the floor, and past 60% the row is dropped.
  close(spreadQualityWeight(0).weight, 1)
  close(spreadQualityWeight(0.3).weight, 0.5)
  assert.deepEqual(spreadQualityWeight(0.61), { weight: 0, wide: true })
  assert.deepEqual(spreadQualityWeight(null), { weight: 0, wide: true })
  close(spreadQualityWeight(PROXY_MAX_SPREAD_PCT).weight, 0.15)

  // `_p28_moneyness_quality_weight`: linear to the 35% soft limit, then flat at 0.10.
  close(moneynessQualityWeight(100, 100), 1)
  close(moneynessQualityWeight(117.5, 100), 0.5)
  close(moneynessQualityWeight(200, 100), PROXY_MIN_MONEYNESS_WEIGHT)
  close(moneynessQualityWeight(100, 0), 1)

  // `_p28_liquidity_weight`: sqrt(volume) * (1 + log1p(oi)), then both quality scalars.
  const weighted = liquidityWeight({
    volume: 100,
    openInterest: 0,
    strike: 100,
    spot: 100,
    spreadPct: 0,
  })
  close(weighted.weight, 10)
  assert.equal(
    liquidityWeight({ volume: 100, openInterest: 0, strike: 100, spot: 100, spreadPct: 0.9 })
      .weight,
    0,
  )
  assert.equal(
    liquidityWeight({ volume: 0, openInterest: 0, strike: 100, spot: 100, spreadPct: 0 }).weight,
    0,
  )

  // `_p28_weighted_percentile`: the first value whose cumulative weight crosses the
  // threshold, not an interpolated one.
  assert.equal(weightedPercentile([[10, 1], [20, 1], [30, 1]], 0.5), 20)
  assert.equal(weightedPercentile([[10, 5], [20, 1]], 0.5), 10)
  assert.equal(weightedPercentile([[10, 0]], 0.5), null)
  assert.equal(weightedPercentile([], 0.5), null)

  assert.equal(confidenceLabel(0.7), 'High')
  assert.equal(confidenceLabel(0.45), 'Moderate')
  assert.equal(confidenceLabel(0.44), 'Low')

  // ------------------------------------------------------- side summaries
  // Three tight calls around a $100 spot. Break-evens are 96+2=98, 100+2=102 and
  // 104+2=106; the mid strike carries the most weight, so the weighted median is 102.
  const calls = [
    row({ strike: 96, bid: 1.9, ask: 2.1, volume: 100, openInterest: 100 }),
    row({ strike: 100, bid: 1.9, ask: 2.1, volume: 400, openInterest: 100 }),
    row({ strike: 104, bid: 1.9, ask: 2.1, volume: 100, openInterest: 100 }),
  ]
  const callSummary = projectionSideSummary(calls, {
    side: 'calls',
    expiry: '2025-02-21',
    daysOut: 30,
    currentClose: 100,
  })
  assert.ok(callSummary)
  close(callSummary.projectedPrice, 102)
  close(callSummary.projectedChange, 2)
  close(callSummary.projectedChangePct, 2)
  assert.equal(callSummary.includedContractCount, 3)
  close(callSummary.totalVolume, 600)
  close(callSummary.totalPremium, 2 * 600 * 100)
  close(callSummary.ivCoverage, 1)
  close(callSummary.medianSpreadPct, 0.1)
  assert.equal(callSummary.expirationDisplay, "FEB 21 '25")

  // The same chain read as puts gives break-evens 94, 98 and 102 — the mirror image.
  const putSummary = projectionSideSummary(
    calls.map((entry) => ({ ...entry, type: 'Put' as const })),
    { side: 'puts', expiry: '2025-02-21', daysOut: 30, currentClose: 100 },
  )
  assert.ok(putSummary)
  close(putSummary.projectedPrice, 98)
  close(putSummary.projectedChange, -2)

  // No chart close means no anchor at all, which is what empties the strip.
  assert.equal(
    projectionSideSummary(calls, {
      side: 'calls',
      expiry: '2025-02-21',
      daysOut: 30,
      currentClose: null,
    }),
    null,
  )
  // Every row one-sided: nothing is priced, so there is no summary rather than a zero.
  assert.equal(
    projectionSideSummary(
      calls.map((entry) => ({ ...entry, bid: 0 })),
      { side: 'calls', expiry: '2025-02-21', daysOut: 30, currentClose: 100 },
    ),
    null,
  )

  // A break-even outside 1.5 expected moves is clamped *and* quartered in weight, not
  // dropped: 30d at 30% IV is a 8.60 expected move, so the band ends at 112.90.
  const clamped = projectionSideSummary(
    [row({ strike: 200, bid: 1.9, ask: 2.1, volume: 10_000, openInterest: 0 })],
    { side: 'calls', expiry: '2025-02-21', daysOut: 30, currentClose: 100 },
  )
  assert.ok(clamped)
  close(clamped.projectedPrice, 100 + 1.5 * 100 * 0.3 * Math.sqrt(30 / 365), 1e-9)

  // `_p28_prepare_projection_records`: untraded and zero-strike rows never reach it.
  assert.equal(
    projectionRecords([...calls, row({ volume: 0 }), row({ strike: 0 })]).length,
    calls.length,
  )

  // --------------------------------------------------------- the combined
  // Equal contract counts and equal confidence put the center exactly midway.
  const combined = combinedProjectionSummary(callSummary, putSummary)
  assert.ok(combined)
  close(combined.projectedPrice, 100)
  assert.equal(combined.side, 'combined')
  assert.equal(combined.includedContractCount, 6)
  // The combined confidence is the weaker side's, not the blend of the two.
  close(combined.confidenceScore, Math.min(callSummary.confidenceScore, putSummary.confidenceScore))
  assert.equal(combinedProjectionSummary(callSummary, null), null)

  // ---------------------------------------------------------- whole model
  const buckets: OptionsExpirationBucket[] = [
    { expiry: '2025-02-21', daysOut: 30, rows: [...calls, ...calls.map((entry) => ({ ...entry, type: 'Put' as const }))] },
    {
      expiry: '2025-03-07',
      daysOut: 44,
      rows: [
        row({ expiration: '2025-03-07', strike: 104, bid: 3.9, ask: 4.1 }),
        row({ expiration: '2025-03-07', strike: 104, bid: 3.9, ask: 4.1, type: 'Put' }),
      ],
    },
  ]
  const model = buildProjectionSummaries(buckets, 100)
  assert.deepEqual(model.bucketOrder, ['2025-02-21', '2025-03-07'])
  assert.equal(Object.keys(model.calls).length, 2)
  assert.equal(Object.keys(model.combined).length, 2)

  const headlines = projectionHeadlines(model)
  // "Nearest" is the first expiration in the loaded order, not the highest confidence.
  assert.equal(headlines.calls?.expiration, '2025-02-21')
  close(headlines.calls.projectedPrice, 102)
  assert.equal(headlines.puts?.expiration, '2025-02-21')

  const aggregate = projectionAggregate(model)
  assert.ok(aggregate)
  assert.equal(aggregate.expirationCount, 2)
  // Calls and puts only: the combined anchors are derived from them and are not counted
  // a second time.
  assert.equal(aggregate.includedContractCount, 3 + 3 + 1 + 1)

  assert.equal(
    sectionProjectionLabel(model, '2025-02-21'),
    `Call ${projectionPrice(model.calls['2025-02-21'].projectedPrice)} (${model.calls['2025-02-21'].confidenceLabel})` +
      ` | Put ${projectionPrice(model.puts['2025-02-21'].projectedPrice)} (${model.puts['2025-02-21'].confidenceLabel})` +
      ` | Combined ${projectionPrice(model.combined['2025-02-21'].projectedPrice)}`,
  )
  assert.equal(sectionProjectionLabel(model, 'nope'), 'Options-volume projection unavailable')
  assert.equal(projectionChangeText(headlines.calls), '+$2.00 (+2.00%)')
  assert.equal(projectionChangeText(headlines.puts), '-$2.00 (-2.00%)')
  assert.equal(projectionChangeText(null), 'No chart close')

  // --------------------------------------------------------- weekly paths
  // From 2025-01-31 the seven-day cursor lands on 02-07, 02-14 and 02-21; 02-21 is also
  // an expiration anchor, and the second anchor at 03-07 adds 02-28 and 03-07.
  const paths = buildProjectionPaths(model, 100, '2025-01-31')
  assert.deepEqual(
    paths.calls.map((point) => point.date),
    ['2025-01-31', '2025-02-07', '2025-02-14', '2025-02-21', '2025-02-28', '2025-03-07'],
  )
  close(paths.calls[0].projectedPrice, 100)
  // 21 days of a 21-day span from 100 to 102: the anchor sits exactly on the line.
  close(paths.calls[3].projectedPrice, 102)
  assert.equal(paths.calls[3].isExpirationAnchor, true)
  assert.equal(paths.calls[0].isExpirationAnchor, false)
  // Halfway between the 02-21 and 03-07 anchors, in days rather than in points.
  close(paths.calls[4].projectedPrice, 102 + (108 - 102) * (7 / 14))
  assert.equal(paths.calls[4].leftAnchor, '2025-02-21')
  assert.equal(paths.calls[4].rightAnchor, '2025-03-07')
  // An anchor on or before the origin cannot be interpolated to, so there is no path.
  assert.deepEqual(buildProjectionPaths(model, 100, '2025-03-07').calls, [])
  assert.deepEqual(buildProjectionPaths(model, null, '2025-01-31').calls, [])

  // -------------------------------------------------------------- export
  const markdown = buildProjectionsExport({
    ticker: 'test',
    timeframe: '1 Day',
    typeFilter: 'calls',
    currentClose: 100,
    model,
    buckets: buckets.map((bucket) => ({
      expiry: bucket.expiry,
      rows: topVolumeRecords(bucket.rows, 'calls'),
    })),
    exportedAt: '2025-01-31 09:30:00',
  })
  assert.ok(markdown.startsWith('# Projections Export - TEST\n'))
  assert.ok(markdown.includes('- Chart Timeframe: 1 Day'))
  assert.ok(markdown.includes('- Table Rows: Calls'))
  assert.ok(markdown.includes('- Projection Period: All'))
  assert.ok(markdown.includes('- Current Chart Close: $100.00'))
  assert.ok(markdown.includes("- Nearest Call Projection: FEB 21 '25 $102.00 | +$2.00 (+2.00%)"))
  assert.ok(markdown.includes('| Side | Expiration | Projection |'))
  assert.ok(markdown.includes("| Combined | FEB 21 '25 |"))
  assert.ok(markdown.includes("### FEB 21 '25"))
  assert.ok(markdown.endsWith('\n'))

  const emptyExport = buildProjectionsExport({
    ticker: 'TEST',
    timeframe: '1 Day',
    typeFilter: 'puts',
    currentClose: null,
    model: buildProjectionSummaries([], null),
    buckets: [],
    exportedAt: '2025-01-31 09:30:00',
  })
  assert.ok(emptyExport.includes('- Current Chart Close: Unavailable'))
  assert.ok(emptyExport.includes('- Data Confidence: Unavailable'))
  assert.ok(
    emptyExport.includes(
      'No options-volume projection was available from the loaded option-chain rows.',
    ),
  )

  // ---------------------------------------------------------- timeframes
  // `P28_TIMEFRAME_OPTIONS`, all eight, four-hour bars included.
  assert.equal(PROJECTIONS_TIMEFRAMES.length, 8)
  assert.equal(projectionsRange('1 Day'), '5Y')
  assert.equal(projectionsRange('5 Minutes'), '3M')

  console.log('offline checks passed')
}

async function runLive(symbol: string, timeframe: ChartsInterval): Promise<void> {
  console.log(`\n=== Projections: ${symbol} (${timeframe}) ===`)
  const { payload, failures } = await getProjections(symbol, timeframe, false)
  const currentClose = payload.candles.at(-1)?.close ?? null
  const asOf = payload.candles.at(-1)
    ? new Date(payload.candles[payload.candles.length - 1].time * 1000).toISOString().slice(0, 10)
    : ''
  console.log(
    `candles=${payload.candles.length} interval=${payload.interval || 'none'} ` +
      `close=${currentClose === null ? 'none' : currentClose.toFixed(2)} asOf=${asOf || 'none'}`,
  )
  if (payload.chartError) console.log(`  ! chart: ${payload.chartError}`)
  for (const failure of failures) console.log(`  ! ${failure.block}: ${failure.reason}`)

  const model = buildProjectionSummaries(payload.buckets, currentClose)
  console.log(
    `expirations=${payload.buckets.length} ` +
      `rows=${payload.buckets.reduce((sum, bucket) => sum + bucket.rows.length, 0)} ` +
      `calls=${Object.keys(model.calls).length} puts=${Object.keys(model.puts).length}`,
  )

  const headlines = projectionHeadlines(model)
  for (const [label, summary] of [
    ['call', headlines.calls],
    ['put', headlines.puts],
    ['combined', headlines.combined],
  ] as const) {
    console.log(
      `  nearest ${label.padEnd(8)} ${
        summary
          ? `${summary.expirationDisplay} ${projectionPrice(summary.projectedPrice)} ` +
            `${projectionChangeText(summary)} | ${summary.confidenceLabel} ` +
            `(${Math.round(summary.confidenceScore * 100)}%) | contracts ${summary.includedContractCount}`
          : 'unavailable'
      }`,
    )
  }

  const aggregate = projectionAggregate(model)
  console.log(
    `  coverage ${
      aggregate
        ? `${aggregate.confidenceLabel} (${Math.round(aggregate.confidenceScore * 100)}%) | ` +
          `${aggregate.expirationCount} expirations | ${aggregate.includedContractCount} contracts`
        : 'unavailable'
    }`,
  )

  for (const bucket of payload.buckets.slice(0, 8)) {
    const top = topVolumeRecords(bucket.rows, 'calls')
    console.log(
      `  ${bucket.expiry} (${String(bucket.daysOut).padStart(4)}d) ` +
        `rows=${String(bucket.rows.length).padStart(4)} top10=${top.length} | ` +
        sectionProjectionLabel(model, bucket.expiry),
    )
  }

  if (asOf) {
    const paths = buildProjectionPaths(model, currentClose, asOf)
    for (const side of ['calls', 'puts', 'combined'] as const) {
      const points = paths[side]
      console.log(
        `  path ${side.padEnd(8)} points=${String(points.length).padStart(3)} ` +
          `${points.length ? `${points[0].date} ${projectionPrice(points[0].projectedPrice)} -> ${points[points.length - 1].date} ${projectionPrice(points[points.length - 1].projectedPrice)}` : 'none'}`,
      )
      // The path must start at the latest chart close, or the chart draws a step at the
      // last bar rather than a continuation of it.
      if (points.length && currentClose !== null) close(points[0].projectedPrice, currentClose, 1e-6)
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const offlineOnly = args.includes('--offline')
  const positional = args.filter((arg) => !arg.startsWith('--'))
  const symbol = (positional[0] ?? 'AAPL').toUpperCase()
  const timeframe = (positional[1] ?? '1 Day') as ChartsInterval

  runOffline()
  if (offlineOnly) return
  await runLive(symbol, timeframe)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
