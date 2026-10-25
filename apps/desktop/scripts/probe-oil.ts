import assert from 'node:assert/strict'

import type { OilBuildInput } from '../electron/shared/oil.js'
import {
  GALLONS_PER_BARREL,
  OIL_BENCHMARK_SPECS,
  OIL_FLOW_SPECS,
  OIL_STOCK_SPECS,
  buildOilCurve,
  buildOilEiaBlock,
  buildOilPayload,
  buildOilSnapshot,
  crackSpread321,
  emptyOilMarket,
  finiteOrNull,
  nearestPoint,
  oilContractSymbols,
  oilCurveShape,
  oilValue,
  parseEiaSeriesHtml,
  parseOpecBasketXml,
  shiftIsoYears,
  summarizeOilSeries,
} from '../electron/shared/oil.js'
import { oilTesting } from '../electron/services/oil.js'
import { yahooProvider } from '../electron/services/provider.js'
import { captureSources, withSourceEnvelope } from '../electron/services/sourceHealth.js'
import { TtlCache } from '../electron/services/cache.js'
import { ok } from '../electron/shared/envelope.js'

/* ------------------------------------------------------------------ fixtures */

/**
 * The real grid's shape: a `Year-Month` label, then `(MM/DD, value)` pairs, with the four
 * absent-data sentinels EIA actually publishes and a January row carrying a December week.
 */
const eiaFixture = `
<html><head><title>Weekly U.S. Ending Stocks excluding SPR of Crude Oil  (Thousand Barrels)</title></head><body>
<table><tr><td>View History:</td><td>Weekly</td></tr></table>
<table>
<tr><th>Year-Month</th><th>Week 1</th><th>Week 2</th><th>Week 3</th><th>Week 4</th><th>Week 5</th></tr>
<tr><th>End Date</th><th>Value</th><th>End Date</th><th>Value</th><th>End Date</th><th>Value</th><th>End Date</th><th>Value</th><th>End Date</th></tr>
<tr><td>2021-Aug</td><td>08/20</td><td>400,000</td><td>08/27</td><td>401,000</td></tr>
<tr><td>2022-Aug</td><td>08/19</td><td>410,000</td><td>08/26</td><td>411,000</td></tr>
<tr><td>2023-Aug</td><td>08/18</td><td>420,000</td><td>08/25</td><td>421,000</td></tr>
<tr><td>2024-Aug</td><td>08/23</td><td>430,000</td><td>08/30</td><td>431,000</td></tr>
<tr><td>2025-Aug</td><td>08/22</td><td>440,000</td><td>08/29</td><td>NA</td></tr>
<tr><td>2026-Jan</td><td>01/02</td><td>W</td><td>12/26</td><td>390,000</td></tr>
<tr><td>2026-Aug</td><td>08/07</td><td>424,410</td><td>08/14</td><td>-</td><td>08/21</td><td>428,910</td><td></td><td>--</td></tr>
</table>
<table><tr><td>- = No Data Reported; -- = Not Applicable; NA = Not Available; W = Withheld.</td></tr></table>
<table><tr><td>Release Date: 9/2/2026</td></tr><tr><td>Next Release Date: 9/9/2026</td></tr></table>
</body></html>`

const opecFixture = `<?xml version="1.0"?><Basket>
<BasketList data="2026-08-27" val="87.31" />
<BasketList data="2026-08-28" val="89.59" />
<BasketList data="2026-08-31" val="91.98" />
<BasketList data="2026-09-01" val="95.32" />
</Basket>`

function market() {
  const stamp = '2026-09-02T00:00:00'
  return {
    wtiPrice: oilValue(89.55, 'usdPerBbl', stamp, 'Yahoo Finance', 'live'),
    wtiChangePct: oilValue(1.2, 'percent', stamp, 'Yahoo Finance', 'live'),
    brentPrice: oilValue(94.27, 'usdPerBbl', stamp, 'Yahoo Finance', 'live'),
    brentChangePct: oilValue(1.1, 'percent', stamp, 'Yahoo Finance', 'live'),
    gasolinePrice: oilValue(3.181, 'usdPerGal', stamp, 'Yahoo Finance', 'live'),
    gasolineChangePct: oilValue(0.9, 'percent', stamp, 'Yahoo Finance', 'live'),
    dieselPrice: oilValue(4.66, 'usdPerGal', stamp, 'Yahoo Finance', 'live'),
    dieselChangePct: oilValue(1.4, 'percent', stamp, 'Yahoo Finance', 'live'),
  }
}

/* ------------------------------------------------------------------- offline */

function offline(): void {
  /* ---- EIA grid parsing ---- */
  const parsed = parseEiaSeriesHtml(eiaFixture)
  assert(parsed)
  assert.equal(parsed.unit, 'kb')
  assert.equal(parsed.releaseDate, '2026-09-02')
  assert.equal(parsed.nextReleaseDate, '2026-09-09')
  // The four sentinels are absences, not numbers: `-`, `--`, `NA` and `W` are all dropped.
  assert.equal(parsed.points.filter((point) => point.date.startsWith('2026-08')).length, 2)
  assert.equal(parsed.points.at(-1)?.date, '2026-08-21')
  assert.equal(parsed.points.at(-1)?.value, 428_910)
  // A December week filed under the January row keeps its own year.
  assert(parsed.points.some((point) => point.date === '2025-12-26'))
  assert(!parsed.points.some((point) => point.date === '2026-12-26'))
  assert.equal(parseEiaSeriesHtml('<html><title>x</title><table><tr><td>no grid</td></tr></table></html>'), null)

  const perDay = parseEiaSeriesHtml(
    eiaFixture.replace('(Thousand Barrels)', '(Thousand Barrels per Day)'),
  )
  assert.equal(perDay?.unit, 'kbd', 'the per-day parenthetical must not be read as a stock')
  assert.equal(parseEiaSeriesHtml(eiaFixture.replace('(Thousand Barrels)', '(Percent)'))?.unit, 'percent')

  /* ---- date helpers ---- */
  assert.equal(shiftIsoYears('2024-02-29', -1), '2023-02-28', 'a leap day must clamp, not roll into March')
  assert.equal(shiftIsoYears('2026-08-21', -5), '2021-08-21')
  const anniversaries = [
    { date: '2025-08-22', value: 1 },
    { date: '2025-08-29', value: 2 },
  ]
  assert.equal(nearestPoint(anniversaries, '2025-08-21')?.value, 1)
  assert.equal(nearestPoint(anniversaries, '2025-09-10'), null, 'outside tolerance must be null, not the nearest')

  /* ---- series summary ---- */
  const crude = summarizeOilSeries(OIL_STOCK_SPECS[0], parsed.points)
  assert.equal(crude.key, 'crude')
  assert.equal(crude.asOf, '2026-08-21')
  assert.equal(crude.latest, 428_910)
  assert.equal(crude.weekChange, 428_910 - 424_410)
  assert.equal(crude.yearAgo, 440_000, 'the year-ago pair comes from the 2025-08-22 print')
  // All five anniversaries are present, so the mean is the plain average of them.
  assert.equal(crude.fiveYearAverage, (440_000 + 430_000 + 420_000 + 410_000 + 400_000) / 5)
  assert.equal(crude.deviationPct, ((428_910 - 420_000) / 420_000) * 100)

  // Drop one anniversary and the five-year mean must withhold rather than average four.
  const short = summarizeOilSeries(
    OIL_STOCK_SPECS[0],
    parsed.points.filter((point) => !point.date.startsWith('2022-')),
  )
  assert.equal(short.fiveYearAverage, null)
  assert.equal(short.deviationPct, null)
  assert.equal(short.latest, 428_910, 'a missing anniversary must not disturb the latest print')

  const emptyBlock = buildOilEiaBlock([{ ...crude, latest: null }], 'https://example', null, null)
  assert.equal(emptyBlock, null, 'a block whose every series is empty is unavailable')
  const block = buildOilEiaBlock([crude], 'https://example', '2026-09-02', '2026-09-09')
  assert(block)
  assert.equal(block.asOf, '2026-08-21')

  /* ---- OPEC ---- */
  const opec = parseOpecBasketXml(opecFixture, 'https://www.opec.org/basket/basketDayArchives.xml')
  assert(opec)
  assert.equal(opec.asOf, '2026-09-01')
  assert.equal(opec.basketPrice.value, 95.32)
  assert.equal(opec.dayChange.value, 95.32 - 91.98)
  assert.equal(opec.monthAverage.value, 95.32, 'the month average covers only the sessions in that month')
  assert.equal(opec.history.length, 4)
  assert.equal(parseOpecBasketXml('<Basket></Basket>', 'u'), null)
  assert.equal(finiteOrNull(''), null)
  assert.equal(finiteOrNull(null), null, 'Number(null) is 0 and must never reach a price')
  assert.equal(finiteOrNull('0'), 0, 'a real zero still has to survive')

  /* ---- the strip ---- */
  const contracts = oilContractSymbols(new Date(Date.UTC(2026, 8, 2)), 4)
  assert.deepEqual(
    contracts.map((entry) => entry.symbol),
    ['CLX26.NYM', 'CLZ26.NYM', 'CLF27.NYM', 'CLG27.NYM'],
  )
  assert.equal(contracts[3].label, 'Feb 27', 'the strip must roll the year, not the month code alone')
  assert.equal(contracts[0].monthsOut, 1, 'Deferred months are measured from the actual front delivery month')
  assert.equal(oilContractSymbols(new Date('2026-10-20T18:29:00Z'), 1)[0].symbol, 'CLZ26.NYM', 'Before expiry, November is front and December is deferred')
  assert.equal(oilContractSymbols(new Date('2026-10-20T18:30:00Z'), 1)[0].symbol, 'CLF27.NYM', 'Roll at the New York termination time, not midnight UTC')
  assert.deepEqual(oilContractSymbols(new Date('2026-10-24T23:22:39Z'), 3).map(row => row.symbol),
    ['CLF27.NYM', 'CLG27.NYM', 'CLH27.NYM'], 'The reported expired November contract must never be requested')
  assert.equal(oilContractSymbols(new Date('2022-11-21T19:29:00Z'), 1)[0].symbol, 'CLF23.NYM')
  assert.equal(oilContractSymbols(new Date('2022-11-21T19:30:00Z'), 1)[0].symbol, 'CLG23.NYM', 'Thanksgiving is not an expiry business day')
  assert.equal(oilContractSymbols(new Date('2026-12-21T19:30:00Z'), 1)[0].symbol, 'CLH27.NYM', 'Christmas shifts the January expiry and the year rolls correctly')

  assert.equal(oilCurveShape(90, 72), 'backwardation')
  assert.equal(oilCurveShape(72, 90), 'contango')
  assert.equal(oilCurveShape(90, 90.2), 'flat', 'a fraction of a percent is not a term structure')

  const curve = buildOilCurve(
    [
      { symbol: 'CL=F', label: 'Front', monthsOut: 0, price: 90 },
      { symbol: 'CLX26.NYM', label: 'Nov 26', monthsOut: 2, price: 87 },
      { symbol: 'CLU27.NYM', label: 'Sep 27', monthsOut: 12, price: 72 },
      { symbol: 'CLZ27.NYM', label: 'Dec 27', monthsOut: 15, price: null },
    ],
    '2026-09-02T00:00:00',
  )
  assert(curve)
  assert.equal(curve.points.length, 3, 'an unquoted month is dropped, not carried as a gap')
  assert.equal(curve.shape, 'backwardation')
  assert.equal(curve.points[0].premiumPct, null, 'the front contract has no premium over itself')
  assert.equal(curve.points[1].premiumPct, ((87 - 90) / 90) * 100)
  assert.equal(curve.frontToBackSpread.value, 18)
  assert.equal(curve.annualisedRollYield.value, ((90 - 72) / 72) * (12 / 12) * 100)
  assert.equal(buildOilCurve([{ symbol: 'CL=F', label: 'Front', monthsOut: 0, price: 90 }], 'x'), null)

  /* ---- crack spread ---- */
  const crack = crackSpread321(89.55, 3.181, 4.66)
  assert(crack !== null)
  assert.equal(crack, ((2 * 3.181 + 4.66) * GALLONS_PER_BARREL - 3 * 89.55) / 3)
  assert(crack > 0 && crack < 150, `a plausible gross margin, got ${crack}`)
  // Forgetting the 42-gallon conversion collapses the margin to roughly minus the crude
  // price; this is the assertion that catches it.
  assert(crack > (2 * 3.181 + 4.66 - 3 * 89.55) / 3 + 50)
  assert.equal(crackSpread321(89.55, null, 4.66), null)

  /* ---- payload ---- */
  const flows = buildOilEiaBlock(
    OIL_FLOW_SPECS.map((spec, index) =>
      summarizeOilSeries(spec, [
        { date: '2026-08-14', value: 16_000 + index },
        { date: '2026-08-21', value: 16_500 + index },
      ]),
    ),
    'https://example',
    '2026-09-02',
    '2026-09-09',
  )
  assert(flows)

  const benchmarkParsed = parseEiaSeriesHtml(eiaFixture.replace('(Thousand Barrels)', '(Dollars per Barrel)'))
  assert(benchmarkParsed)
  assert.equal(benchmarkParsed.unit, 'usdPerBbl')
  const benchmarkBlock = buildOilEiaBlock(
    OIL_BENCHMARK_SPECS.map((spec) => summarizeOilSeries(spec, benchmarkParsed.points)),
    'https://example',
    '2026-09-02',
    '2026-09-09',
  )
  assert(benchmarkBlock)

  const input: OilBuildInput = {
    fetchedAt: '2026-09-02T00:00:00',
    market: market(),
    curve,
    inventories: block,
    flows,
    benchmarks: { prices: benchmarkBlock, opec },
  }
  const payload = buildOilPayload(input)
  assert(Object.values(payload.progress).every((state) => state === 'loaded'))
  assert.equal(payload.derived.brentWtiSpread.value, 94.27 - 89.55)
  assert.equal(payload.derived.crudeVsFiveYear.value, crude.deviationPct)
  assert.equal(payload.derived.basketToBrent.value, 95.32 - 94.27)
  const refinerInput = flows.series.find((entry) => entry.key === 'refinerInput')
  assert(refinerInput?.latest)
  assert.equal(payload.derived.daysOfSupply.value, 428_910 / refinerInput.latest)
  assert(
    (payload.derived.daysOfSupply.value ?? 0) > 20 && (payload.derived.daysOfSupply.value ?? 0) < 40,
    'thousand barrels over thousand barrels a day must cancel to a plausible days figure',
  )

  // Every derived figure that mixes two sources or two frequencies has to say so.
  for (const key of ['crackSpread321', 'daysOfSupply', 'basketToBrent', 'crudeVsFiveYear'] as const) {
    assert.equal(payload.derived[key].frequency, 'derived', `${key} must be labelled derived`)
    assert(payload.derived[key].note, `${key} must carry a note explaining its basis`)
  }
  assert.equal(payload.derived.brentWtiSpread.frequency, 'live', 'two live quotes stay live')

  const lanes = ['curve', 'inventories', 'flows', 'benchmarks'] as const
  for (const missing of lanes) {
    const partial = buildOilPayload({ ...input, [missing]: null })
    assert.equal(partial.progress[missing], 'unavailable')
    assert.equal(partial.progress.market, 'loaded', 'one dead lane must not take the page down')
  }
  assert.equal(buildOilPayload({ ...input, market: emptyOilMarket() }).progress.market, 'unavailable')
  const noEia = buildOilPayload({ ...input, inventories: null, flows: null })
  assert.equal(noEia.derived.daysOfSupply.value, null)
  assert.equal(noEia.derived.crudeVsFiveYear.value, null)

  const snapshot = buildOilSnapshot(payload)
  assert(snapshot.includes('OIL — PHYSICAL FUNDAMENTALS'))
  assert(snapshot.includes('survey estimates and are revised'))
  assert(snapshot.includes('backwardation'))

  /* ---- specs ---- */
  const ids = [...OIL_STOCK_SPECS, ...OIL_FLOW_SPECS].map((spec) => spec.eiaId)
  assert.equal(new Set(ids).size, ids.length, 'every EIA series id is requested at most once')
  const keys = [...OIL_STOCK_SPECS, ...OIL_FLOW_SPECS].map((spec) => spec.key)
  assert.equal(new Set(keys).size, keys.length)

  console.log('offline: all Oil assertions passed')
}

/* ---------------------------------------------------------------------- live */

async function live(): Promise<void> {
  const { data: payload, errors, meta } = await yahooProvider.oil({ force: true })
  console.log('\n=== Oil live ===')
  console.log(`freshness: ${meta.freshness}${meta.failureReason ? ` · ${meta.failureReason}` : ''}`)
  console.log(`lanes: ${JSON.stringify(payload.progress)}`)
  console.log(`WTI ${payload.market.wtiPrice.value ?? 'unavailable'} · Brent ${payload.market.brentPrice.value ?? 'unavailable'}`)
  console.log(`Brent-WTI ${payload.derived.brentWtiSpread.value?.toFixed(2) ?? 'unavailable'} · crack ${payload.derived.crackSpread321.value?.toFixed(2) ?? 'unavailable'}`)
  console.log(
    `curve: ${payload.curve ? `${payload.curve.shape}, ${payload.curve.points.length} contracts, front-to-back ${payload.curve.frontToBackSpread.value?.toFixed(2)}` : 'unavailable'}`,
  )
  console.log(`EIA week: ${payload.inventories?.asOf ?? 'unavailable'} (next release ${payload.inventories?.nextReleaseDate ?? '--'})`)
  for (const series of payload.inventories?.series ?? []) {
    console.log(
      `  stock ${series.key.padEnd(15)} ${String(series.latest).padStart(10)} ${series.unit}` +
        ` · w/w ${series.weekChange?.toFixed(0) ?? '--'} · vs 5Y ${series.deviationPct?.toFixed(1) ?? '--'}%`,
    )
  }
  for (const series of payload.flows?.series ?? []) {
    console.log(`  flow  ${series.key.padEnd(15)} ${String(series.latest).padStart(10)} ${series.unit} · ${series.asOf}`)
  }
  console.log(`days of supply: ${payload.derived.daysOfSupply.value?.toFixed(1) ?? 'unavailable'}`)
  for (const series of payload.benchmarks?.prices.series ?? []) {
    console.log(`  price ${series.key.padEnd(15)} ${String(series.latest).padStart(10)} ${series.unit} · ${series.asOf}`)
  }
  console.log(
    `OPEC basket: ${payload.benchmarks?.opec?.basketPrice.value ?? 'unavailable (edge refused the client)'}`,
  )
  for (const error of errors) console.log(`warning: ${error.symbol}: ${error.reason}`)

  assert(Object.values(payload.progress).some((state) => state === 'loaded'), 'at least one live lane should load')
  if (payload.curve) {
    assert(payload.curve.points.length >= 2)
    // A monotonic strip is not required, but a contract priced at zero or an order of
    // magnitude out means the symbol resolved to something that is not a WTI month.
    for (const point of payload.curve.points) {
      assert(point.price > 5 && point.price < 500, `implausible strip price for ${point.symbol}: ${point.price}`)
    }
  }
  if (payload.inventories) {
    const crude = payload.inventories.series.find((entry) => entry.key === 'crude')
    assert(crude?.latest, 'the commercial crude series is the one this page cannot do without')
    assert(crude.history.length > 500, 'the EIA grid should carry decades of weekly prints')
  }
  if (payload.benchmarks) {
    const spot = payload.benchmarks.prices.series.find((entry) => entry.key === 'wtiSpot')
    assert(spot?.latest, 'the EIA WTI spot assessment anchors the benchmark panel')
    assert.equal(spot.unit, 'usdPerBbl', 'a dollars-per-barrel title must not be read as an inventory')
    assert(spot.latest > 5 && spot.latest < 500, `implausible spot assessment: ${spot.latest}`)
    // The OPEC basket is optional inside this lane, so its absence is not a failure.
    if (payload.benchmarks.opec) assert(payload.benchmarks.opec.history.length > 100)
  }
  console.log('live: Oil probe completed')
}

async function serviceChecks(): Promise<void> {
  const originalFetch = globalThis.fetch
  try {
    const contracts = oilContractSymbols(new Date('2026-10-24T23:22:39Z'), 13)
    const requested: string[] = []
    const curve = await withSourceEnvelope(async () => ok(await oilTesting.fetchCurve(false, 'fixture', 90, contracts, async symbol => {
      requested.push(symbol)
      assert.notEqual(symbol, 'CLX26.NYM', 'Expired symbols must not reach Yahoo')
      return { symbol, price: 89 - requested.length / 10, change: 0, absChange: 0 }
    }), 'Yahoo Finance'))
    assert.equal(requested.length, 13)
    assert.equal(curve.data.points.length, 14)
    assert.equal(curve.meta.freshness, 'fresh')
    assert.equal(curve.data.points[1].monthsOut, 1)
    await assert.rejects(oilTesting.fetchCurve(false, 'fixture', 90, contracts, async () => { throw new Error('Provider offline') }), /Fewer than two/)
    let requests = 0
    globalThis.fetch = async () => new Response(++requests === 1 ? 'Unavailable' : eiaFixture, { status: requests === 1 ? 503 : 200 })
    assert.equal(await oilTesting.fetchText('https://example.test/eia'), eiaFixture)
    assert.equal(requests, 2, 'Transient upstream errors retry once')
    requests = 0
    globalThis.fetch = async () => { requests += 1; return new Response('Blocked', { status: 403 }) }
    await assert.rejects(oilTesting.fetchText('https://example.test/eia'), /HTTP 403/)
    assert.equal(requests, 1, 'Access denials must not be retried')
    globalThis.fetch = async url => new Response(String(url).includes('s=RWTC&') ? eiaFixture : 'Unavailable', {
      status: String(url).includes('s=RWTC&') ? 200 : 503,
    })
    const { value, snapshot } = await captureSources(() => oilTesting.fetchEiaBlock(OIL_BENCHMARK_SPECS.slice(0, 2)))
    assert.equal(value.series.length, 1, 'Retain the available source during a partial outage')
    assert(snapshot?.failures.some(reason => reason.includes('RBRTE') && reason.includes('503')),
      'Missing EIA series must be recorded even when the block still has usable data')
    const scratchCache = new TtlCache()
    const load = () => withSourceEnvelope(async () => ok((await scratchCache.resolve('oil:fixture', 60_000,
      () => oilTesting.fetchEiaBlock(OIL_BENCHMARK_SPECS.slice(0, 2)))).value, 'EIA'))
    assert.equal((await load()).meta.freshness, 'partial')
    const cached = await load()
    assert.equal(cached.meta.freshness, 'partial', 'Cached partial sources cannot become complete')
    assert(cached.meta.failureReason?.includes('RBRTE'))
    scratchCache.close()
    console.log('Oil service checks passed: bounded transient retries, access denials, partial series and cached warnings.')
  } finally { globalThis.fetch = originalFetch }
}

offline()
await serviceChecks()
if (!process.argv.includes('--offline')) await live()
