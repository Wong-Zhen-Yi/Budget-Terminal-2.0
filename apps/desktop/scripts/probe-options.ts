import assert from 'node:assert/strict'
import { mock } from 'node:test'
import type { Envelope, OptionQuotesPayload, OptionsChainPayload, OptionsExpirationsPayload, OptionsPayload } from '../electron/shared/contract.js'
import { catalog } from '../mcp/catalog.js'
import type { Operation } from '../mcp/operations.js'
import { McpDispatcher } from '../electron/mcp/dispatcher.js'
import { shapeResponse } from '../mcp/response.js'
import { cache } from '../electron/services/cache.js'
import { yahoo } from '../electron/services/yahoo/client.js'
import { yahooProvider } from '../electron/services/provider.js'

import type { OptionsChainRow, OptionsRawRow } from '../electron/shared/optionsPage.js'
import {
  bandScore,
  bestStrategySummary,
  buildChainExport,
  buildExpirationOrder,
  buildOptionsVolumeRanking,
  buildTopVolumeExport,
  calculateGreeks,
  collectStrikes,
  daysToExpiry,
  enrichChain,
  expiryOptionLabel,
  extractDividendYield,
  filterLiveExpiries,
  formatChainValue,
  formatExpiration,
  formatOptionVolume,
  formatStrikeOption,
  impliedVolatility,
  isOptionsExpiryClosed,
  linearScore,
  matchStrike,
  normalCdf,
  normalizeRiskFreeRate,
  optionsMarketDate,
  rankStrategyRows,
  strategyTooltip,
  strikeRecords,
  summaryHighlights,
  topVolumeRecords,
  CHAIN_COLUMNS,
} from '../electron/shared/optionsPage.js'
import { getOptionsChain, getOptionsExpirations } from '../electron/services/yahoo/optionsPage.js'

/**
 * The Options page probe, run against `mixins/options_chain.py` side by side.
 *
 * `--offline` covers everything pure: the market-date rules, the Black-Scholes Greeks
 * and the implied-vol solve (checked against numbers produced by the reference's own
 * `services/options_analysis.py`), the strategy ranking, the two summary-record
 * builders, the highlight ranking and both Markdown exports.
 *
 * Without it the two live loads also run and print what each returned, so the Chain
 * table, the top-volume grid and the strike grid can be compared against the PySide6
 * page directly.
 *
 *   npm run probe:options -- AAPL
 *   npm run probe:options -- --offline
 */

function runOffline(): void {
  // ---------------------------------------------------------- market dates
  // `is_options_expiry_closed`: an expiry dies at 16:00 New York, not at local midnight.
  const beforeClose = new Date('2025-01-17T20:30:00Z') // 15:30 ET
  const afterClose = new Date('2025-01-17T21:30:00Z') // 16:30 ET
  assert.equal(isOptionsExpiryClosed('2025-01-17', beforeClose), false)
  assert.equal(isOptionsExpiryClosed('2025-01-17', afterClose), true)
  assert.equal(isOptionsExpiryClosed('2025-01-16', beforeClose), true)
  assert.equal(isOptionsExpiryClosed('2025-01-24', afterClose), false)
  assert.equal(isOptionsExpiryClosed('not-a-date', afterClose), false)
  // 04:00 UTC on the 18th is still the 17th in New York, which is what a UTC date
  // comparison gets wrong for every user east of the Atlantic.
  assert.equal(optionsMarketDate(new Date('2025-01-18T04:00:00Z')), '2025-01-17')

  assert.deepEqual(
    filterLiveExpiries(['2025-01-10', '2025-01-17', '2025-01-17', '', '2025-01-24'], beforeClose),
    ['2025-01-17', '2025-01-24'],
  )
  assert.equal(daysToExpiry('2025-01-24', beforeClose), 7)
  assert.equal(daysToExpiry('2024-12-01', beforeClose), 0)
  assert.equal(expiryOptionLabel('2025-01-24', beforeClose), '2025-01-24 (7d)')

  // `_p5_build_dynamic_top_volume_bucket_config`: ascending, deduped, dead ones dropped.
  assert.deepEqual(
    buildExpirationOrder(['2025-01-24', '2025-01-10', '2025-01-17'], beforeClose),
    [
      { expiry: '2025-01-17', daysOut: 0 },
      { expiry: '2025-01-24', daysOut: 7 },
    ],
  )

  // ----------------------------------------------------------- formatting
  assert.equal(formatExpiration('2025-01-17'), "JAN 17 '25")
  assert.equal(formatExpiration('2025-12-05'), "DEC 5 '25")
  assert.equal(formatExpiration(''), '')
  assert.equal(formatOptionVolume(null), '0')
  // `_format_volume` truncates through `int()`, it does not round.
  assert.equal(formatOptionVolume(12345.7), '12,345')
  assert.equal(formatStrikeOption(250), '250.0')
  assert.equal(formatStrikeOption(247.25), '247.25')

  const chg = CHAIN_COLUMNS.find((column) => column.label === 'Chg')!
  const iv = CHAIN_COLUMNS.find((column) => column.label === 'IV')!
  const vol = CHAIN_COLUMNS.find((column) => column.label === 'Vol')!
  assert.equal(formatChainValue(1.5, chg), '+1.50')
  assert.equal(formatChainValue(-1.5, chg), '-1.50')
  assert.equal(formatChainValue(31.24, iv), '31.2%')
  assert.equal(formatChainValue(12345, vol), '12,345')
  assert.equal(formatChainValue(null, vol), '')

  // ------------------------------------------------------ Black-Scholes
  // `NormalDist().cdf` to double precision.
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-15)
  assert.ok(Math.abs(normalCdf(1.959963984540054) - 0.975) < 1e-12)
  assert.ok(Math.abs(normalCdf(-3) - 0.0013498980316301) < 1e-12)

  // The three expected blocks below came out of the reference's own
  // `calculate_greeks`/`implied_volatility` with `today=2025-01-02`.
  const asOf = new Date('2025-01-02T15:00:00Z')
  const call = calculateGreeks(100, 105, '2025-04-17', 0.28, 'call', 0.0432, 0.0051, asOf)
  const close = (actual: number | null, expected: number) =>
    assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
  close(call.delta, 0.4291981195)
  close(call.gamma, 0.0261142849)
  close(call.theta, -0.0320102317)
  close(call.vega, 0.210345199)
  close(call.rho, 0.1109282876)
  assert.equal(call.greeksValid, true)

  const put = calculateGreeks(100, 95, '2025-04-17', 0.28, 'put', 0.0432, 0.0051, asOf)
  close(put.delta, -0.3117433796)
  close(put.gamma, 0.0235293667)
  close(put.theta, -0.0216284254)
  close(put.vega, 0.1895242136)
  close(put.rho, -0.0990951195)

  close(impliedVolatility(100, 105, '2025-04-17', 0.0432, 0.0051, 4, 'call', asOf), 0.2628992024)
  // A price that cannot be a Black-Scholes price returns 0, which leaves the cell blank.
  assert.equal(impliedVolatility(100, 105, '2025-04-17', 0.0432, 0.0051, 0, 'call', asOf), 0)
  assert.equal(calculateGreeks(100, 105, '2025-04-17', 0, 'call', 0.04, 0, asOf).greeksValid, false)

  // `extract_dividend_yield` and `_p5_fetch_market_rate` both accept either scale.
  assert.equal(extractDividendYield({ dividendYield: 0.0051 }), 0.0051)
  assert.equal(extractDividendYield({ dividendYield: 2.4 }), 0.024)
  assert.equal(extractDividendYield({}), null)
  assert.equal(normalizeRiskFreeRate(4.32), 0.0432)
  assert.equal(normalizeRiskFreeRate(0.0432), 0.0432)
  assert.equal(normalizeRiskFreeRate(0), null)

  // The IV backfill: a row Yahoo quoted at zero IV gets one solved from its own mid.
  const [backfilled] = enrichChain(
    [row({ type: 'Call', strike: 105, lastPrice: 4, bid: 3.9, ask: 4.1, impliedVolatility: 0 })],
    '2025-04-17',
    100,
    0.0432,
    0.0051,
    asOf,
  )
  assert.ok(backfilled.impliedVolatility > 0.2 && backfilled.impliedVolatility < 0.3)
  assert.ok(Math.abs(backfilled.ivPercent - backfilled.impliedVolatility * 100) < 1e-12)
  assert.equal(backfilled.greeksValid, true)

  // ---------------------------------------------------- summary records
  const chain: OptionsRawRow[] = [
    row({ type: 'Call', strike: 100, volume: 50, openInterest: 10, lastPrice: 5 }),
    row({ type: 'Put', strike: 100, volume: 50, openInterest: 90, lastPrice: 2 }),
    row({ type: 'Call', strike: 105, volume: 900, openInterest: 5, lastPrice: 1 }),
    row({ type: 'Put', strike: 95, volume: 10, openInterest: 5, lastPrice: 3 }),
  ]
  // Volume first, open interest as the tie-break — the two 50-volume rows order by OI.
  assert.deepEqual(
    topVolumeRecords(chain, 'both').map((entry) => [entry.type, entry.strike]),
    [
      ['Call', 105],
      ['Put', 100],
      ['Call', 100],
      ['Put', 95],
    ],
  )
  assert.deepEqual(
    topVolumeRecords(chain, 'puts').map((entry) => entry.strike),
    [100, 95],
  )
  assert.equal(topVolumeRecords(chain, 'both', 2).length, 2)
  const lateLeader = row({ expiration: '2025-02-21', type: 'Put', volume: 10_000 })
  const manyRows = Array.from({ length: 80 }, (_, index) => row({ strike: index + 1, volume: index + 1, openInterest: 100_000 - index }))
  const volumeRanking = buildOptionsVolumeRanking([
    { expiry: '2025-01-17', daysOut: 0, rows: [...manyRows, row({ volume: NaN }), row({ volume: -1 }), row({ volume: 0 })] },
    { expiry: '2025-02-21', daysOut: 35, rows: [lateLeader] },
    { expiry: '2025-03-21', daysOut: 63, rows: [row({ volume: 999_999 })] },
  ], ['2025-03-21'])
  assert.equal(volumeRanking.rows.length, 50, 'Research rankings must be bounded after examining every loaded contract')
  assert.equal(volumeRanking.rows[0], lateLeader, 'A later expiration must outrank earlier rows on its actual volume')
  assert.equal(volumeRanking.rows[1].volume, 80, 'Sorting must happen before sampling/limiting, using volume rather than open interest')
  assert.equal(volumeRanking.totalContracts, 84)
  assert.equal(volumeRanking.contractsWithVolume, 81)
  assert.equal(volumeRanking.expirationsLoaded, 2)
  assert.deepEqual(volumeRanking.failedExpirations, ['2025-03-21'])
  assert.equal(manyRows[0].volume, 1, 'Ranking must not reorder source data')

  // `prepare_strike_records`: calls before puts at one strike.
  assert.deepEqual(
    strikeRecords(chain, 100).map((entry) => entry.type),
    ['Call', 'Put'],
  )
  assert.equal(strikeRecords(chain, 100.5).length, 0)

  assert.deepEqual(collectStrikes([{ expiry: 'x', daysOut: 0, rows: chain }]), [95, 100, 105])
  assert.equal(matchStrike([95, 100, 105], 100.00005), 100)
  assert.equal(matchStrike([95, 100, 105], 101), null)
  assert.equal(matchStrike([95, 100, 105], null), null)

  // `_summary_cell_backgrounds`: two ranks each, and the low ranks exclude the top ones.
  const highlights = summaryHighlights(topVolumeRecords(chain, 'both'))
  assert.deepEqual(highlights[0].volume, { kind: 'top', rank: 0 })
  assert.deepEqual(highlights[1].volume, { kind: 'top', rank: 1 })
  assert.deepEqual(highlights[3].volume, { kind: 'low', rank: 0 })
  // The 105 call is the cheapest and the 100 call the dearest, so no row is both.
  assert.deepEqual(highlights[0].price, { kind: 'low', rank: 0 })
  assert.deepEqual(highlights[2].price, { kind: 'top', rank: 0 })

  // -------------------------------------------------- strategy scoring
  assert.equal(linearScore(0.5, 0, 1), 50)
  assert.equal(linearScore(0.5, 0, 1, true), 50)
  assert.equal(linearScore(2, 0, 1), 100)
  assert.equal(linearScore(1, 1, 1), 0)
  assert.equal(bandScore(0.275, 0.275, 0.15, 0.4), 100)
  assert.equal(bandScore(0.5, 0.275, 0.15, 0.4), 0)
  assert.ok(bandScore(0.2, 0.275, 0.15, 0.4) > 0)

  const spot = 100
  const expiry = '2025-04-17'
  const calls = enrichChain(
    [
      // Near the 0.275 delta target, liquid, tight spread: the pick.
      row({ type: 'Call', strike: 108, bid: 2.4, ask: 2.6, lastPrice: 2.5, volume: 500, openInterest: 900, impliedVolatility: 0.3 }),
      row({ type: 'Call', strike: 120, bid: 0.4, ask: 0.6, lastPrice: 0.5, volume: 40, openInterest: 200, impliedVolatility: 0.3 }),
      // Below spot: a covered call never writes it.
      row({ type: 'Call', strike: 90, bid: 12, ask: 12.4, lastPrice: 12.2, volume: 900, openInterest: 900, impliedVolatility: 0.3 }),
      // Under the 25-contract open-interest floor.
      row({ type: 'Call', strike: 110, bid: 2, ask: 2.2, lastPrice: 2.1, volume: 5, openInterest: 4, impliedVolatility: 0.3 }),
    ],
    expiry,
    spot,
    0.0432,
    0.0051,
    asOf,
  )
  const ranked = rankStrategyRows(calls, 'Covered Call', spot, expiry, asOf)
  assert.equal(ranked.get(0)?.rank, 1)
  assert.equal(ranked.has(2), false, 'a strike below spot is not a covered-call candidate')
  assert.equal(ranked.has(3), false, 'thin open interest is rejected')
  assert.equal(ranked.size, 2)
  const top = ranked.get(0)!
  assert.ok(top.annualizedYield > 0, 'annualized yield is premium/spot scaled to a year')
  assert.ok(top.upsideRoom !== undefined && Math.abs(top.upsideRoom - 0.08) < 1e-12)
  assert.ok(strategyTooltip(top).startsWith('Rank #1 | Score '))
  assert.ok(strategyTooltip(top).includes('Upside room 8.0%'))
  assert.ok(bestStrategySummary('Covered Call', ranked, new Map()).startsWith('strike 108.0, score '))
  // The puts table under a Covered Call ranks nothing rather than scoring the wrong side.
  const puts = enrichChain(
    [row({ type: 'Put', strike: 92, bid: 2, ask: 2.2, lastPrice: 2.1, volume: 400, openInterest: 800, impliedVolatility: 0.3 })],
    expiry,
    spot,
    0.0432,
    0.0051,
    asOf,
  )
  assert.equal(rankStrategyRows(puts, 'Covered Call', spot, expiry, asOf).size, 0)
  assert.equal(rankStrategyRows(puts, 'Cash Secured Put', spot, expiry, asOf).size, 1)
  assert.equal(rankStrategyRows(calls, 'None', spot, expiry, asOf).size, 0)

  // ----------------------------------------------------------- exports
  const chainExport = buildChainExport({
    ticker: 'AAPL',
    expiry,
    spotPrice: spot,
    riskFreeRate: 0.0432,
    rateSource: 'market',
    dividendYield: 0.0051,
    dividendSource: 'ticker',
    strategy: 'Covered Call',
    rows: calls as OptionsChainRow[],
    exportedAt: '2025-01-02 10:00:00',
  })
  assert.ok(chainExport.startsWith('# Options Chain Export - AAPL\n'))
  assert.ok(chainExport.includes('- Risk-Free Rate: 4.32% (market)'))
  assert.ok(chainExport.includes('- Dividend Yield: 0.51% (ticker)'))
  assert.ok(chainExport.includes('## Calls'))
  assert.ok(chainExport.includes('## Puts'))
  assert.ok(chainExport.includes('No rows available.'), 'the empty side still gets a section')
  assert.ok(chainExport.endsWith('\n'))

  const volumeExport = buildTopVolumeExport({
    ticker: 'AAPL',
    typeFilter: 'calls',
    buckets: [
      { expiry: '2025-01-17', rows: topVolumeRecords(chain, 'calls') },
      { expiry: '2025-01-24', rows: [] },
    ],
    exportedAt: '2025-01-02 10:00:00',
  })
  assert.ok(volumeExport.includes('- Option Type Filter: Calls'))
  assert.ok(volumeExport.includes('- Expirations captured: 2'))
  assert.ok(volumeExport.includes("### JAN 17 '25"))
  assert.ok(volumeExport.includes('No top options volume records were available'))

  console.log('offline checks passed')
}

/** A raw chain row with everything defaulted, so each case names only what it varies. */
function row(patch: Partial<OptionsRawRow>): OptionsRawRow {
  return {
    ticker: 'AAPL',
    type: 'Call',
    strike: 100,
    expiration: '2025-04-17',
    lastPrice: 1,
    bid: 0,
    ask: 0,
    change: 0,
    volume: 0,
    openInterest: 0,
    impliedVolatility: 0.3,
    inTheMoney: false,
    ...patch,
  }
}

async function runLive(symbol: string): Promise<void> {
  console.log(`\n=== Chain: ${symbol} ===`)
  const chain = await getOptionsChain(symbol, '', true)
  const payload = chain.payload
  console.log(
    `expiries=${payload.expiries.length} selected=${payload.expiry} spot=${payload.spotPrice.toFixed(2)}`,
  )
  console.log(
    `r=${(payload.riskFreeRate * 100).toFixed(2)}% (${payload.rateSource}) ` +
      `q=${(payload.dividendYield * 100).toFixed(2)}% (${payload.dividendSource})`,
  )
  const calls = payload.rows.filter((entry) => entry.type === 'Call')
  const puts = payload.rows.filter((entry) => entry.type === 'Put')
  const withGreeks = payload.rows.filter((entry) => entry.greeksValid).length
  console.log(`calls=${calls.length} puts=${puts.length} rows with Greeks=${withGreeks}`)
  for (const failure of chain.failures) console.log(`  ! ${failure.block}: ${failure.reason}`)

  for (const strategy of ['Covered Call', 'Cash Secured Put'] as const) {
    const side = strategy === 'Covered Call' ? calls : puts
    const sorted = [...side].sort((a, b) => a.strike - b.strike)
    const ranked = rankStrategyRows(sorted, strategy, payload.spotPrice, payload.expiry)
    const best = bestStrategySummary(
      strategy,
      strategy === 'Covered Call' ? ranked : new Map(),
      strategy === 'Cash Secured Put' ? ranked : new Map(),
    )
    console.log(`${strategy}: ${ranked.size} ranked${best ? ` | #1: ${best}` : ''}`)
  }

  console.log(`\n=== Every expiration: ${symbol} ===`)
  const sweep = await getOptionsExpirations(symbol, true)
  console.log(
    `expirations=${sweep.payload.buckets.length} strikes=${sweep.payload.strikes.length}` +
      ` rows=${sweep.payload.buckets.reduce((sum, bucket) => sum + bucket.rows.length, 0)}`,
  )
  for (const failure of sweep.failures) console.log(`  ! ${failure.block}: ${failure.reason}`)
  const ranking = sweep.payload.topVolume!
  assert(ranking.rows.every((entry, index) => index === 0 || entry.volume <= ranking.rows[index - 1].volume))
  assert.equal(ranking.expirationsRequested, sweep.payload.buckets.length)
  console.log(`Volume ranking: ${ranking.rows.length} leaders from ${ranking.totalContracts} contracts; ${ranking.expirationsLoaded}/${ranking.expirationsRequested} expirations loaded`)
  for (const bucket of sweep.payload.buckets.slice(0, 6)) {
    const top = topVolumeRecords(bucket.rows, 'both')
    const head = top[0]
    console.log(
      `  ${formatExpiration(bucket.expiry).padEnd(11)} (${String(bucket.daysOut).padStart(4)}d) ` +
        `rows=${String(bucket.rows.length).padStart(4)} top=${
          head ? `${head.type} ${head.strike} vol ${head.volume}` : 'none'
        }`,
    )
  }

  const strike = sweep.payload.strikes.find((value) => value >= sweep.payload.spotPrice)
  if (strike !== undefined) {
    const matched = sweep.payload.buckets.reduce(
      (sum, bucket) => sum + strikeRecords(bucket.rows, strike).length,
      0,
    )
    console.log(`by strike ${strike}: ${matched} contract(s) across all expirations`)
  }
}

/** Confirm forced MCP refresh reaches listing/chain/mark caches, not just the envelope. */
async function runRefreshChecks(): Promise<void> {
  cache.clear()
  const dates = [7, 21, 35, 70].map(days => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10))
  let edition = 1, missingExpiry = '', reads = 0
  const provider = mock.method(yahoo, 'options', async (_symbol: string, request?: { date?: string }) => {
    reads++
    const expiry = request?.date ?? dates[0]
    if (expiry === missingExpiry) return { options: [] }
    const calls = Array.from({ length: 80 }, (_, index) => ({ strike: index + 90, lastPrice: edition, bid: edition - 0.1, ask: edition + 0.1, volume: (index + 1) * edition, openInterest: 100_000 - index, impliedVolatility: 0.3, lastTradeDate: new Date() }))
    const puts = [{ ...calls[0], strike: 100, volume: expiry === dates[3] ? edition * 10_000 : edition * 100 }]
    return { expirationDates: dates.map(date => new Date(date + 'T00:00:00Z')), quote: { regularMarketPrice: 100, regularMarketTime: new Date() }, options: [{ calls, puts }] }
  })
  const quote = mock.method(yahoo, 'quote', async () => ({ regularMarketPrice: 4 }))
  const summary = mock.method(yahoo, 'quoteSummary', async () => ({ summaryDetail: { dividendYield: 0.01 } }))
  const routes = new Map<Operation, (request: unknown) => unknown>(catalog.map(entry => [entry.operation, () => { throw new Error('Unexpected fixture route') }]))
  for (const operation of ['options', 'optionsChain', 'optionsExpirations', 'optionQuotes'] as const) {
    routes.set(operation, request => (yahooProvider[operation] as (request: unknown) => unknown)(request))
  }
  const dispatcher = new McpDispatcher({ routes })
  const position = { rowId: 'fixture', ticker: 'TEST', expiry: dates[0], strike: 100, strategy: 'Calls' }
  try {
    await yahooProvider.options({ symbol: 'TEST' })
    await yahooProvider.optionsExpirations({ symbol: 'TEST' })
    await yahooProvider.optionsChain({ symbol: 'TEST', expiry: dates[0] })
    await yahooProvider.optionQuotes({ positions: [position] })
    edition = 2
    const previousReads = reads
    const cached = await yahooProvider.optionsExpirations({ symbol: 'TEST' })
    assert.equal(cached.data.topVolume!.rows[0].volume, 10_000, 'Fixture must start from an unexpired old chain')
    const dashboard = await dispatcher.invoke('budget_terminal_options', { request: { symbol: 'TEST', force: false } }) as Envelope<OptionsPayload>
    assert(dashboard.data.buckets.flatMap(bucket => bucket.rows).every(entry => entry.lastPrice === 2), 'Dashboard option buckets must refresh')
    const chain = await dispatcher.invoke('budget_terminal_options_chain', { request: { symbol: 'TEST', expiry: dates[0] } }, 'agent') as Envelope<OptionsChainPayload>
    assert(chain.data.rows.length > 0 && chain.data.rows.every(entry => entry.lastPrice === 2), 'Chain analysis must refresh underlying rows')
    const marks = await dispatcher.invoke('budget_terminal_option_quotes', { request: { positions: [position], force: false } }) as Envelope<OptionQuotesPayload>
    assert.equal(marks.data.quotes.fixture.currentPrice, 2, 'Recorded contract marks must refresh too')
    const projection = { mode: 'full' as const, fields: ['symbol', 'marketDate', 'topVolume', 'generatedAt'] }
    const result = await dispatcher.invoke('budget_terminal_options_expirations', { request: { symbol: 'TEST', force: false }, response: projection }, 'agent') as Envelope<OptionsExpirationsPayload>
    const ranking = result.data.topVolume!
    assert.equal(ranking.rows[0].expiration, dates[3], 'The leader can be outside the three dashboard expirations')
    assert.equal(ranking.rows[0].volume, 20_000, 'The ranking must use refreshed volumes')
    assert.equal(ranking.totalContracts, 324)
    assert.equal(ranking.expirationsLoaded, 4)
    assert.equal(ranking.rows.length, 50)
    assert(!('buckets' in result.data), 'A compact research response must omit raw chains without sampling its ranking')
    assert(reads > previousReads, 'Refreshed MCP calls must reach the provider')
    missingExpiry = dates[3]
    const partial = await dispatcher.invoke('budget_terminal_options_expirations', { request: { symbol: 'TEST' }, response: projection }) as Envelope<OptionsExpirationsPayload>
    assert.equal(partial.meta.freshness, 'partial', 'A missing returned chain must not be treated as complete coverage')
    assert.deepEqual(partial.data.topVolume!.failedExpirations, [dates[3]])
    assert.equal(partial.data.topVolume!.expirationsLoaded, 3)
    assert(partial.errors.length > 0)
    const large = { data: { ...cached.data, buckets: cached.data.buckets.map(bucket => ({ ...bucket, rows: Array.from({ length: 3000 }, () => bucket.rows[0]) })) }, meta: cached.meta, errors: [] }
    assert((shapeResponse(large) as { data: { omitted: boolean } }).data.omitted, 'The fixture must exceed the normal MCP data budget')
    const compact = shapeResponse(large, projection) as Envelope<OptionsExpirationsPayload>
    assert.equal(compact.data.topVolume!.rows.length, 50, 'Volume leaders must remain accessible when full chains exceed the data budget')
    console.log('PASS: MCP options refresh listing/chain/mark caches, rank all expirations before projection, fit response budgets and disclose missing-chain coverage')
  } finally {
    dispatcher.close(); provider.mock.restore(); quote.mock.restore(); summary.mock.restore(); cache.clear()
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const offlineOnly = args.includes('--offline')
  const symbol = (args.find((arg) => !arg.startsWith('--')) ?? 'AAPL').toUpperCase()

  runOffline()
  await runRefreshChecks()
  if (offlineOnly) return
  await runLive(symbol)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
