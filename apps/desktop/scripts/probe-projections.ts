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
  plausibleImpliedVolatility,
  plausibleIvSample,
  projectionAggregate,
  projectionChangeText,
  projectionCoverageWarning,
  projectionHeadlines,
  projectionPrice,
  projectionRecords,
  projectionSideSummary,
  projectionsRange,
  PROJECTIONS_TIMEFRAMES,
  sampleCappedConfidenceLabel,
  sectionProjectionLabel,
  spreadQualityWeight,
  weightedPercentile,
  PROXY_IV_RANGE_MULTIPLIER,
  PROXY_MAX_PLAUSIBLE_IV,
  PROXY_MAX_SPREAD_PCT,
  PROXY_MIN_MONEYNESS_WEIGHT,
  PROXY_MIN_PRICE_QUALITY_WEIGHT,
  PROXY_MIN_PLAUSIBLE_IV,
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
  // `_p28_effective_option_price`: a midpoint wins even when a last trade is present,
  // and its spread is a fraction of the midpoint rather than of the ask.
  const priced = effectiveOptionPrice({ bid: 1.9, ask: 2.1 })
  assert.ok(priced)
  close(priced.mid, 2)
  assert.equal(priced.source, 'midpoint')
  assert.notEqual(priced.spreadPct, null)
  close(priced.spreadPct ?? 0, 0.1)
  assert.equal(effectiveOptionPrice({ bid: 0, ask: 2.1 }), null)
  assert.equal(effectiveOptionPrice({ bid: 2.2, ask: 2.1 }), null)
  assert.equal(effectiveOptionPrice({ bid: null, ask: 2.1 }), null)
  const preferredMidpoint = effectiveOptionPrice(
    { bid: 1.9, ask: 2.1, lastPrice: 99, lastTradeDate: '2025-01-31', volume: 10 },
    '2025-01-31',
  )
  assert.ok(preferredMidpoint)
  assert.equal(preferredMidpoint.source, 'midpoint')
  close(preferredMidpoint.mid, 2)

  const freshTrade = effectiveOptionPrice(
    { bid: 0, ask: 0, lastPrice: 2, lastTradeDate: '2025-01-31', volume: 10 },
    '2025-01-31',
  )
  assert.ok(freshTrade)
  assert.equal(freshTrade.source, 'same-session-last')
  close(freshTrade.mid, 2)
  assert.equal(freshTrade.spreadPct, null)
  assert.equal(
    effectiveOptionPrice(
      { bid: 0, ask: 0, lastPrice: 2, lastTradeDate: '2025-01-30', volume: 10 },
      '2025-01-31',
    ),
    null,
  )
  assert.equal(
    effectiveOptionPrice(
      { bid: 0, ask: 0, lastPrice: 2, lastTradeDate: '2025-01-31', volume: 0 },
      '2025-01-31',
    ),
    null,
  )

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
  close(
    liquidityWeight({
      volume: 100,
      openInterest: 0,
      strike: 100,
      spot: 100,
      spreadPct: null,
      priceSource: 'same-session-last',
    }).weight,
    10 * PROXY_MIN_PRICE_QUALITY_WEIGHT,
  )
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
  // Four tight calls around a $100 spot. Break-evens are 96+2=98, 100+2=102, 104+2=106
  // and 108+2=110; the mid strike carries the most weight, so the weighted median is
  // 102. Four is `PROXY_MIN_ANCHOR_CONTRACTS`, the smallest sample that has a median at
  // all — three used to be enough, and one contract used to print "Moderate".
  const calls = [
    row({ strike: 96, bid: 1.9, ask: 2.1, volume: 100, openInterest: 100 }),
    row({ strike: 100, bid: 1.9, ask: 2.1, volume: 400, openInterest: 100 }),
    row({ strike: 104, bid: 1.9, ask: 2.1, volume: 100, openInterest: 100 }),
    row({ strike: 108, bid: 1.9, ask: 2.1, volume: 100, openInterest: 100 }),
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
  assert.equal(callSummary.includedContractCount, 4)
  assert.equal(callSummary.midpointContractCount, 4)
  assert.equal(callSummary.fallbackContractCount, 0)
  close(callSummary.totalVolume, 700)
  close(callSummary.totalPremium, 2 * 700 * 100)
  close(callSummary.ivCoverage, 1)
  // Every row carries a plausible 30% reading of its own, so the band never reaches a
  // fallback and nothing had to be dragged into it.
  close(callSummary.bandCoverage, 1)
  close(callSummary.clampedShare, 0)
  close(callSummary.medianSpreadPct, 0.1)
  assert.equal(callSummary.expirationDisplay, "FEB 21 '25")
  // Under the count term's own saturation sample the top label is withheld whatever the
  // other four terms award — a four-contract median is not "High" evidence.
  assert.equal(sampleCappedConfidenceLabel(0.95, 4), 'Moderate')
  assert.equal(sampleCappedConfidenceLabel(0.95, 12), 'High')
  assert.equal(sampleCappedConfidenceLabel(0.5, 4), 'Moderate')
  assert.equal(sampleCappedConfidenceLabel(0.2, 4), 'Low')

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

  // Too few contracts to take a median of: the side is withheld rather than anchored on
  // a single print. This is the shape that used to render "$224.41 | Contracts 1".
  assert.equal(
    projectionSideSummary(calls.slice(0, 3), {
      side: 'calls',
      expiry: '2025-02-21',
      daysOut: 30,
      currentClose: 100,
    }),
    null,
  )

  // A break-even outside 1.5 expected moves is clamped *and* quartered in weight, not
  // dropped: 30d at 30% IV is an 8.60 expected move, so the band ends at 112.90. One far
  // strike against three tight ones is a minority, so the side still stands — and the
  // quartered weight is what stops the lottery strike moving the median off 102.
  const bandEdge = 100 + PROXY_IV_RANGE_MULTIPLIER * 100 * 0.3 * Math.sqrt(30 / 365)
  const minorityClamped = projectionSideSummary(
    [
      ...calls.slice(0, 3),
      row({ strike: 200, bid: 1.9, ask: 2.1, volume: 10_000, openInterest: 0 }),
    ],
    { side: 'calls', expiry: '2025-02-21', daysOut: 30, currentClose: 100 },
  )
  assert.ok(minorityClamped)
  const clampedOutlierWeight =
    liquidityWeight({
      volume: 10_000,
      openInterest: 0,
      strike: 200,
      spot: 100,
      spreadPct: 0.1,
    }).weight * 0.25
  const tightWeights = calls.slice(0, 3).reduce(
    (sum, entry) =>
      sum +
      liquidityWeight({
        volume: entry.volume,
        openInterest: entry.openInterest,
        strike: entry.strike,
        spot: 100,
        spreadPct: 0.1,
      }).weight,
    0,
  )
  close(
    minorityClamped.clampedShare,
    clampedOutlierWeight / (tightWeights + clampedOutlierWeight),
  )
  close(minorityClamped.projectedPrice, 102)
  assert.ok(minorityClamped.projectedPrice < bandEdge)

  // Past `PROXY_MAX_CLAMPED_SHARE` every surviving candidate sits on the same band edge,
  // so the "projection" is the edge rather than the market: the side is withheld. This
  // is what a chain of nonsense quotes rendered as calls and puts agreeing to the cent.
  assert.equal(
    projectionSideSummary(
      [200, 300, 400, 500].map((strike) =>
        row({ strike, bid: 1.9, ask: 2.1, volume: 10_000, openInterest: 0 }),
      ),
      { side: 'calls', expiry: '2025-02-21', daysOut: 30, currentClose: 100 },
    ),
    null,
  )

  // Row counts do not drive a weighted median. Five tiny far strikes outnumber four
  // strong near-money rows, but their post-clamp signal weight is nowhere near half, so
  // they cannot force the anchor onto the band edge and must not veto the side.
  const lowInfluenceOutliers = projectionSideSummary(
    [
      ...calls,
      ...[200, 300, 400, 500, 600].map((strike) =>
        row({ strike, bid: 1.9, ask: 2.1, volume: 1, openInterest: 0 }),
      ),
    ],
    { side: 'calls', expiry: '2025-02-21', daysOut: 30, currentClose: 100 },
  )
  assert.ok(lowInfluenceOutliers)
  assert.ok(lowInfluenceOutliers.clampedShare < 0.5)

  // A Yahoo-shaped chain with zero bid/ask fields is recoverable only when its trades
  // belong to the same underlying session. Both sides at one expiry restore Combined.
  const fallbackRows = [
    ...calls.map((entry) => ({
      ...entry,
      bid: 0,
      ask: 0,
      lastTradeDate: '2025-01-31',
    })),
    ...calls.map((entry) => ({
      ...entry,
      type: 'Put' as const,
      bid: 0,
      ask: 0,
      lastTradeDate: '2025-01-31',
    })),
  ]
  const fallbackModel = buildProjectionSummaries(
    [{ expiry: '2025-02-21', daysOut: 30, rows: fallbackRows }],
    100,
    '2025-01-31',
  )
  assert.equal(Object.keys(fallbackModel.calls).length, 1)
  assert.equal(Object.keys(fallbackModel.puts).length, 1)
  assert.equal(Object.keys(fallbackModel.combined).length, 1)
  assert.equal(fallbackModel.calls['2025-02-21'].midpointContractCount, 0)
  assert.equal(fallbackModel.calls['2025-02-21'].fallbackContractCount, 4)
  assert.ok(fallbackModel.calls['2025-02-21'].confidenceScore < callSummary.confidenceScore)
  assert.equal(fallbackModel.coverage.quotedContractCount, 0)
  assert.equal(fallbackModel.coverage.fallbackContractCount, 8)
  assert.ok(projectionCoverageWarning(fallbackModel)?.includes('8 same-session last trades'))

  // ------------------------------------------------- implied-volatility sentinels
  // Yahoo's three non-readings all pass a bare `iv > 0`, and each corrupted the anchor a
  // different way. None of them is allowed to size the band.
  assert.equal(plausibleImpliedVolatility(0.3), 0.3)
  assert.equal(plausibleImpliedVolatility(0.00001), null) // its "not computed" floor
  assert.equal(plausibleImpliedVolatility(0), null)
  assert.equal(plausibleImpliedVolatility(5.44), null) // 544%, seen on live LEAPS rows
  assert.equal(plausibleImpliedVolatility(null), null)
  assert.equal(plausibleImpliedVolatility(PROXY_MIN_PLAUSIBLE_IV), PROXY_MIN_PLAUSIBLE_IV)
  assert.equal(plausibleImpliedVolatility(PROXY_MAX_PLAUSIBLE_IV), PROXY_MAX_PLAUSIBLE_IV)

  // The 1e-5 floor used to collapse the band to zero width and clamp every candidate to
  // exactly the spot. Treated as absent, the rows keep their own break-evens and the
  // median is the 102 the readings actually support.
  const sentinelCalls = calls.map((entry) => ({ ...entry, impliedVolatility: 0.00001 }))
  const sentinelSummary = projectionSideSummary(sentinelCalls, {
    side: 'calls',
    expiry: '2025-02-21',
    daysOut: 30,
    currentClose: 100,
    fallbackIv: 0.3,
  })
  assert.ok(sentinelSummary)
  close(sentinelSummary.projectedPrice, 102)
  // The reading was a sentinel, so coverage says so — but the fallback still banded it.
  close(sentinelSummary.ivCoverage, 0)
  close(sentinelSummary.bandCoverage, 1)

  // A zero used to skip the clamp altogether, which is how a $200 strike's $202
  // break-even reached the median at full weight on a $100 spot. With no fallback to
  // reach, no row is banded and the side is withheld rather than anchored unchecked.
  assert.equal(
    projectionSideSummary(
      calls.map((entry) => ({ ...entry, impliedVolatility: 0 })),
      { side: 'calls', expiry: '2025-02-21', daysOut: 30, currentClose: 100 },
    ),
    null,
  )

  // `plausibleIvSample` reads a whole chain's readings, both sides together, and skips
  // every sentinel class on the way.
  assert.deepEqual(
    plausibleIvSample([
      row({ impliedVolatility: 0.25 }),
      row({ impliedVolatility: 0.00001 }),
      row({ impliedVolatility: 0, type: 'Put' }),
      row({ impliedVolatility: 6, type: 'Put' }),
      row({ impliedVolatility: 0.35, type: 'Put' }),
    ]),
    [0.25, 0.35],
  )

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
  assert.equal(combined.includedContractCount, 8)
  // The combined confidence is the weaker side's, not the blend of the two.
  close(combined.confidenceScore, Math.min(callSummary.confidenceScore, putSummary.confidenceScore))
  assert.equal(combinedProjectionSummary(callSummary, null), null)

  // ---------------------------------------------------------- whole model
  const buckets: OptionsExpirationBucket[] = [
    { expiry: '2025-02-21', daysOut: 30, rows: [...calls, ...calls.map((entry) => ({ ...entry, type: 'Put' as const }))] },
    {
      expiry: '2025-03-07',
      daysOut: 44,
      // Four a side, the sample floor. Identical rows, so the weighted median is their
      // shared break-even: 104+4=108 for the calls and 104-4=100 for the puts.
      rows: [
        ...Array.from({ length: 4 }, () =>
          row({ expiration: '2025-03-07', strike: 104, bid: 3.9, ask: 4.1 }),
        ),
        ...Array.from({ length: 4 }, () =>
          row({ expiration: '2025-03-07', strike: 104, bid: 3.9, ask: 4.1, type: 'Put' }),
        ),
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
  assert.equal(aggregate.includedContractCount, 4 + 4 + 4 + 4)
  // The denominators the tile needs to stay honest: it can only count what survived the
  // quality filters, so without these a chain that publishes nothing reads as coverage.
  assert.equal(aggregate.coverage.expirationCount, 2)
  assert.equal(aggregate.coverage.anchoredExpirationCount, 2)
  assert.equal(aggregate.coverage.contractCount, 16)
  assert.equal(aggregate.coverage.quotedContractCount, 16)
  assert.equal(aggregate.coverage.fallbackContractCount, 0)
  assert.equal(aggregate.coverage.plausibleIvCount, 16)
  // Nothing is wrong with this chain, so there is no warning to print.
  assert.equal(projectionCoverageWarning(model), null)

  // A chain answering with the sentinels Yahoo currently returns: rows are there, quotes
  // are not, and the page has to say so rather than anchor on the handful that survive.
  const degraded = buildProjectionSummaries(
    [
      {
        expiry: '2025-02-21',
        daysOut: 30,
        rows: Array.from({ length: 20 }, (_, index) =>
          row({ strike: 90 + index, bid: 0, ask: 0, impliedVolatility: 0.00001 }),
        ),
      },
    ],
    100,
  )
  assert.equal(Object.keys(degraded.calls).length, 0)
  assert.equal(degraded.coverage.contractCount, 20)
  assert.equal(degraded.coverage.quotedContractCount, 0)
  assert.equal(degraded.coverage.fallbackContractCount, 0)
  assert.equal(degraded.coverage.anchoredExpirationCount, 0)
  const warning = projectionCoverageWarning(degraded)
  assert.ok(warning)
  assert.ok(warning.includes('20 of 20 contracts had no two-sided quote'))
  assert.ok(warning.includes('1 of 1 expirations could not be anchored'))
  assert.equal(projectionAggregate(degraded), null)

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
  assert.ok(markdown.includes('| Price Inputs |'))
  assert.ok(markdown.includes('4 midpoint / 0 session trade'))
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
      `close=${currentClose === null ? 'none' : currentClose.toFixed(2)} ` +
      `asOf=${asOf || 'none'} marketDate=${payload.marketDate || 'none'}`,
  )
  if (payload.chartError) console.log(`  ! chart: ${payload.chartError}`)
  for (const failure of failures) console.log(`  ! ${failure.block}: ${failure.reason}`)

  const model = buildProjectionSummaries(payload.buckets, currentClose, payload.marketDate)
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
  // What the chain offered against what survived. Every other figure printed here is
  // computed over the survivors, so this is the only line that can report a bad feed.
  const chain = model.coverage
  console.log(
    `  chain     ${chain.anchoredExpirationCount}/${chain.expirationCount} expirations anchored | ` +
      `${chain.quotedContractCount} midpoint + ${chain.fallbackContractCount} session trade / ` +
      `${chain.contractCount} contracts | ` +
      `${chain.plausibleIvCount} with a usable IV`,
  )
  const coverageWarning = projectionCoverageWarning(model)
  if (coverageWarning) console.log(`  warning   ${coverageWarning}`)

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
