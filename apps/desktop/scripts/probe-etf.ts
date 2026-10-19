import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { EtfHoldingRow } from '../electron/shared/contract.js'
import {
  arbitrageClipboard,
  arbitrageStatus,
  buildArbitrage,
  buildDonut,
  etfAum,
  etfDirection,
  etfMoney,
  etfSignedBps,
  etfSignedPct,
  etfWeight,
  filterAumRows,
  filterHoldings,
  finiteOrNull,
  holdingSymbols,
  holdingsClipboard,
  positiveOrNull,
  quoteMovePct,
  sectorBreakdownText,
  type EtfQuote,
} from '../electron/shared/etf.js'
import { decodeCsv, parseCsv, parseCsvRecords } from '../electron/services/etf/csv.js'
import { decodeEntities, headingText, parseTables, textOf } from '../electron/services/etf/html.js'
import { getEtfArbitrage, getEtfAum, getEtfHoldingsPage } from '../electron/services/etfPage.js'
import { parseEtfAssets, parseEtfDirectory, ETF_DIRECTORY_URL } from '../electron/services/etf/directory.js'
import { getIssuerEtfHoldings, parsePublicEtfHoldings, preferredEtfIssuer } from '../electron/services/etf/holdings.js'
import { resolveEtfSnapshot } from '../electron/services/etf/snapshot.js'
import { TtlCache } from '../electron/services/cache.js'
import { captureSources, observeSource } from '../electron/services/sourceHealth.js'

/**
 * The ETF page probe, run against `mixins/etf_analyser.py` (page13) side by side.
 *
 * `--offline` covers everything pure: both formatters' exact strings, the donut's twelve
 * named slices and its uncovered remainder, the arbitrage gap over a partial basket, the
 * two clipboard exports and the CSV and HTML readers the issuer providers stand on.
 * Without it, it loads one ETF end to end through the real issuer chain and prints the
 * summary, the sector line and the top holdings, then runs one arbitrage refresh over
 * the same basket, so both can be compared against the PySide6 page.
 *
 *   npm run probe:etf                 # SPY, live, with the AUM rail
 *   npm run probe:etf -- ARKK         # a different issuer in the chain
 *   npm run probe:etf -- --offline    # the pure checks only
 *   npm run probe:etf -- SPY --no-aum # skip the twelve-page ETF screener sweep
 */

function runOffline(): void {
  /* ---- coercion. `Number(null)` and `Number('')` are both 0; the guards matter. ---- */
  assert.equal(finiteOrNull(null), null)
  assert.equal(finiteOrNull(''), null)
  assert.equal(finiteOrNull('nonsense'), null)
  assert.equal(finiteOrNull(0), 0)
  assert.equal(finiteOrNull('1.5'), 1.5)
  assert.equal(positiveOrNull(0), null)
  assert.equal(positiveOrNull(-1), null)
  assert.equal(positiveOrNull(1), 1)

  /* ---- `_p13_format_*`, to the character. ---- */
  assert.equal(etfMoney(1234.5), '$1,234.50')
  assert.equal(etfMoney(null), '--')
  assert.equal(etfSignedPct(1.234), '+1.23%')
  assert.equal(etfSignedPct(-1.235), '-1.24%')
  // An exact zero takes no sign, in the reference either: `'+' if number > 0 else ''`.
  assert.equal(etfSignedPct(0), '0.00%')
  assert.equal(etfSignedPct(null), '--')
  assert.equal(etfSignedBps(12.34), '+12.3 bps')
  assert.equal(etfSignedBps(-12.36), '-12.4 bps')
  assert.equal(etfWeight(0.0873), '8.73%')
  assert.equal(etfWeight(null), '--')

  // `_p13_format_aum`'s own steps, which are not `compactCurrency`'s.
  assert.equal(etfAum(1.5e12), '$1.5T')
  assert.equal(etfAum(6.42e11), '$642.0B')
  assert.equal(etfAum(4.5e6), '$5M')
  assert.equal(etfAum(940_000), '$940,000')
  assert.equal(etfAum(null), '--')

  // `_p13_value_color_token`: an exact zero is muted, not green.
  assert.equal(etfDirection(0), 'flat')
  assert.equal(etfDirection(1e-15), 'flat')
  assert.equal(etfDirection(0.01), 'up')
  assert.equal(etfDirection(-0.01), 'down')
  assert.equal(etfDirection(null), 'flat')

  assert.equal(
    sectorBreakdownText([
      { sector: 'Technology', percent: 34.21 },
      { sector: 'Financial Services', percent: 12.8 },
    ]),
    'Technology 34.2% | Financial Services 12.8%',
  )

  /* ---- the two filters. ---- */
  const rows: EtfHoldingRow[] = [
    { symbol: 'AAPL', name: 'Apple Inc', weight: 0.07, sector: 'Technology' },
    { symbol: 'MSFT', name: 'Microsoft Corporation', weight: 0.06, sector: 'Technology' },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co', weight: 0.01, sector: 'Financial Services' },
  ]
  assert.equal(filterHoldings(rows, '').length, 3)
  // The needle runs over the name as well as the ticker, so "apple" finds AAPL.
  assert.deepEqual(filterHoldings(rows, 'apple').map((row) => row.symbol), ['AAPL'])
  assert.deepEqual(filterHoldings(rows, 'corp').map((row) => row.symbol), ['MSFT'])
  assert.deepEqual(
    filterAumRows([{ ticker: 'SPY' }, { ticker: 'QQQ' }, { ticker: 'SPLG' }], 'sp').map(
      (row) => row.ticker,
    ),
    ['SPY', 'SPLG'],
  )

  /* ---- `_p13_update_holdings_chart`. ---- */
  // Fifteen equal 4% names: twelve keep a wedge, three fold into Others, and the 40% the
  // book does not account for folds in with them.
  const fifteen: EtfHoldingRow[] = Array.from({ length: 15 }, (_, index) => ({
    symbol: `S${index}`,
    name: `Name ${index}`,
    weight: 0.04,
    sector: '',
  }))
  const donut = buildDonut(fifteen)
  assert.equal(donut.slices.length, 13)
  assert.equal(donut.slices[12].label, 'Others')
  // 3 x 4% below the cut, plus the 40% uncovered remainder.
  assert.ok(Math.abs(donut.othersWeight - 0.52) < 1e-9)
  assert.ok(Math.abs(donut.coveragePct - 60) < 1e-9)
  assert.ok(donut.startAngle < 0)

  // A book that adds to one has no remainder, so twelve names leave no Others at all.
  const twelve = fifteen.slice(0, 12).map((row) => ({ ...row, weight: 1 / 12 }))
  const full = buildDonut(twelve)
  assert.equal(full.slices.length, 12)
  assert.equal(full.othersWeight, 0)
  assert.equal(full.startAngle, 0)
  assert.ok(Math.abs(full.coveragePct - 100) < 1e-9)

  // A zero or negative weight is not a wedge, and an empty book is not a chart.
  assert.equal(buildDonut([{ symbol: 'X', name: '', weight: 0, sector: '' }]).slices.length, 0)
  assert.equal(buildDonut([]).coveragePct, 0)

  /* ---- `_quote_move_pct` and `holding_symbols`. ---- */
  assert.equal(quoteMovePct({ price: 1, changes: { live: 1.5, '1d': 2.5 } }), 1.5)
  assert.equal(quoteMovePct({ price: 1, changes: { '1d': 2.5 } }), 2.5)
  assert.equal(quoteMovePct({ price: 1, changes: {} }), null)
  assert.equal(quoteMovePct(undefined), null)
  assert.deepEqual(
    holdingSymbols([
      { symbol: 'aapl', name: '', weight: 0.5, sector: '' },
      { symbol: 'AAPL', name: '', weight: 0.2, sector: '' },
      { symbol: 'ZERO', name: '', weight: 0, sector: '' },
      { symbol: '', name: '', weight: 0.1, sector: '' },
    ]),
    ['AAPL'],
  )

  /* ---- `build_etf_arbitrage_snapshot`. ---- */
  const basket: EtfHoldingRow[] = [
    { symbol: 'AAA', name: 'Alpha', weight: 0.5, sector: '' },
    { symbol: 'BBB', name: 'Beta', weight: 0.3, sector: '' },
    { symbol: 'CCC', name: 'Gamma', weight: 0.2, sector: '' },
  ]
  const quotes = new Map<string, EtfQuote>([
    ['TEST', { price: 100, changes: { live: 1.0 } }],
    ['AAA', { price: 10, changes: { live: 2.0 } }],
    ['BBB', { price: 20, changes: { live: -1.0 } }],
    // CCC has no quote at all: it must not drag the basket toward zero.
  ])
  const snapshot = buildArbitrage('test', basket, quotes)
  assert.equal(snapshot.ticker, 'TEST')
  assert.equal(snapshot.totalHoldings, 3)
  assert.equal(snapshot.quoteCoverage, 2)
  assert.ok(Math.abs(snapshot.quotedWeight - 0.8) < 1e-12)
  assert.ok(Math.abs(snapshot.loadedWeight - 1.0) < 1e-12)
  // Re-based over 0.8: 0.625 x 2.0 + 0.375 x -1.0 = 0.875.
  assert.ok(Math.abs((snapshot.basketMovePct ?? 0) - 0.875) < 1e-12)
  assert.ok(Math.abs((snapshot.gapPctPoints ?? 0) - 0.125) < 1e-12)
  assert.ok(Math.abs((snapshot.gapBps ?? 0) - 12.5) < 1e-12)
  assert.equal(snapshot.signal, 'ETF rich vs basket')
  assert.ok(
    Math.abs(snapshot.rows.reduce((sum, row) => sum + row.contributionPct, 0) - 0.875) < 1e-12,
  )

  // The other two signal branches, and the no-gap case.
  assert.equal(
    buildArbitrage('TEST', basket, new Map([...quotes, ['TEST', { price: 100, changes: { live: 0.5 } }]]))
      .signal,
    'ETF cheap vs basket',
  )
  assert.equal(
    buildArbitrage('TEST', basket, new Map([...quotes, ['TEST', { price: 100, changes: { live: 0.875 } }]]))
      .signal,
    'No gap',
  )
  // No ETF quote means no gap at all — and the whole strip reads `--` rather than zero.
  const noEtf = buildArbitrage('TEST', basket, new Map([['AAA', { price: 10, changes: { live: 2 } }]]))
  assert.equal(noEtf.gapBps, null)
  assert.equal(noEtf.signal, '--')

  /* ---- `_p13_apply_arbitrage_result`'s three status lines. ---- */
  assert.equal(arbitrageStatus(snapshot).status, 'warning')
  assert.equal(arbitrageStatus(snapshot).text, 'Raw return gap +12.5 bps (ETF rich vs basket); 2/3 holdings covered.')
  assert.equal(arbitrageStatus(noEtf).text, 'Arbitrage quotes incomplete for TEST: 1/3 holdings covered.')
  const covered = buildArbitrage(
    'TEST',
    basket,
    new Map([...quotes, ['CCC', { price: 5, changes: { live: 0 } }]]),
  )
  assert.equal(arbitrageStatus(covered).status, 'positive')
  assert.ok(arbitrageStatus(covered).text.endsWith(').'))

  /* ---- the two clipboard exports. ---- */
  assert.equal(
    holdingsClipboard(rows.slice(0, 1)),
    'Ticker\tName\tWeight\nAAPL\tApple Inc\t7.00%',
  )
  assert.equal(
    arbitrageClipboard(snapshot.rows.slice(0, 1)),
    'Ticker\tName\tWeight\tPrice\tMove\tContribution\nAAA\tAlpha\t50.00%\t$10.00\t+2.00%\t+1.25%',
  )

  /* ---- the CSV reader. iShares quotes names, ARK quotes market values. ---- */
  const parsed = parseCsv('a,b,c\n1,"two, and a half",3\n4,"say ""hi""",6\r\n')
  assert.deepEqual(parsed, [
    ['a', 'b', 'c'],
    ['1', 'two, and a half', '3'],
    ['4', 'say "hi"', '6'],
  ])
  const records = parseCsvRecords('Ticker,Company,Weight (%)\nTSLA,Tesla Inc,"9.50"\n')
  assert.equal(records[0].ticker, 'TSLA')
  assert.equal(records[0]['weight (%)'], '9.50')
  // `utf-8-sig`: the mark must not end up glued to the first header.
  assert.equal(decodeCsv(Buffer.from('﻿date,ticker\n', 'utf8')).slice(0, 4), 'date')

  /* ---- the HTML reader. ---- */
  assert.equal(decodeEntities('AT&amp;T &#38; Co &nbsp;'), 'AT&T & Co  ')
  // A script body is not text; without dropping it, inline JSON lands inside a cell.
  assert.equal(textOf('<p>Hi <script>var x = "no";</script> there</p>'), 'Hi there')
  const tables = parseTables(
    '<table class="holdings-table"><tr><th>Ticker</th><th>Weight</th></tr>' +
      '<tr><td>AAPL</td><td>7.00%</td></tr><tr><td>MSFT</td><td>6.00%</td></tr></table>',
  )
  assert.equal(tables.length, 1)
  assert.deepEqual(tables[0].headers, ['ticker', 'weight'])
  assert.deepEqual(tables[0].rows, [
    ['AAPL', '7.00%'],
    ['MSFT', '6.00%'],
  ])
  assert.ok(tables[0].openTag.includes('holdings-table'))
  assert.equal(headingText('<title>T</title><h1>Fund Name</h1>', 'X'), 'Fund Name')
  assert.equal(headingText('<div>no heading</div>', 'X'), 'X')

  console.log('Offline checks passed.')
}

async function runLive(ticker: string, withAum: boolean, withArbitrage: boolean): Promise<void> {
  const symbol = ticker.trim().toUpperCase()
  console.log(`\nLoading ${symbol} holdings through the issuer chain...`)
  const started = Date.now()
  const { payload, errors } = await getEtfHoldingsPage(symbol)
  console.log(`  took ${((Date.now() - started) / 1000).toFixed(1)}s`)

  console.log(`\nFund          ${payload.fundName || '--'}`)
  console.log(`Issuer        ${payload.issuer || '--'}`)
  console.log(`As Of         ${payload.asOfDate || '--'}`)
  console.log(`Expense Ratio ${payload.expenseRatio}`)
  console.log(`Net Assets    ${payload.netAssets}`)
  console.log(`Holdings      ${payload.holdings.length}`)
  console.log(`Source        ${payload.sourceUrl || '--'}`)
  if (payload.isPartial) console.log(`Partial       ${payload.coverageNote}`)
  for (const error of errors) console.log(`  ! ${error.source}: ${error.reason}`)

  if (payload.sectorBreakdown.length) {
    console.log(`\nSectors: ${sectorBreakdownText(payload.sectorBreakdown)}`)
  }

  const donut = buildDonut(payload.holdings)
  console.log(
    `\nDonut: ${donut.slices.length} slices, Others ${etfWeight(donut.othersWeight)}, ` +
      `coverage ${donut.coveragePct.toFixed(1)}%`,
  )

  console.log('\nTop 15 holdings')
  for (const row of payload.holdings.slice(0, 15)) {
    console.log(
      `  ${row.symbol.padEnd(8)} ${etfWeight(row.weight).padStart(8)}  ${row.sector.padEnd(24)} ${row.name}`,
    )
  }

  if (payload.holdings.length && withArbitrage) {
    console.log('\nRefreshing arbitrage over the same basket...')
    const arbStarted = Date.now()
    const arbitrage = await getEtfArbitrage(symbol)
    console.log(`  took ${((Date.now() - arbStarted) / 1000).toFixed(1)}s`)
    const snapshot = arbitrage.payload
    console.log(`  ETF Price     ${etfMoney(snapshot.etfPrice)}`)
    console.log(`  ETF Move      ${etfSignedPct(snapshot.etfMovePct)}`)
    console.log(`  Basket Move   ${etfSignedPct(snapshot.basketMovePct)}`)
    console.log(`  Gap           ${etfSignedBps(snapshot.gapBps)}`)
    console.log(`  Coverage      ${snapshot.quoteCoverage}/${snapshot.totalHoldings}`)
    console.log(`  Signal        ${snapshot.signal}`)
    console.log(`  ${arbitrageStatus(snapshot).text}`)
    for (const error of arbitrage.errors) console.log(`  ! ${error.source}: ${error.reason}`)

    // The gap is a difference of two moves, so it has to reconcile to the basis point.
    if (snapshot.gapBps !== null && snapshot.etfMovePct !== null && snapshot.basketMovePct !== null) {
      const rebuilt = (snapshot.etfMovePct - snapshot.basketMovePct) * 100
      assert.ok(Math.abs(rebuilt - snapshot.gapBps) < 1e-9, 'gap does not reconcile to the two moves')
    }

    console.log('\n  Top 10 contributors')
    for (const row of [...snapshot.rows].sort((a, b) => b.contributionPct - a.contributionPct).slice(0, 10)) {
      console.log(
        `    ${row.symbol.padEnd(8)} ${etfWeight(row.weight).padStart(8)} ${etfMoney(row.price).padStart(12)} ` +
          `${etfSignedPct(row.movePct).padStart(8)} ${etfSignedPct(row.contributionPct).padStart(8)}`,
      )
    }
  }

  if (!withAum) return
  console.log('\nLoading the cached non-Yahoo ETF directory...')
  const aumStarted = Date.now()
  const aum = await getEtfAum()
  console.log(
    `  took ${((Date.now() - aumStarted) / 1000).toFixed(1)}s — ${aum.rows.length} of ${aum.totalCount} ` +
      `loaded, ${aum.missingCount} unavailable`,
  )
  for (const row of aum.rows.slice(0, 15)) {
    console.log(`  ${row.ticker.padEnd(8)} ${etfAum(row.netAssets).padStart(10)}`)
  }
  const target = aum.rows.find((row) => row.ticker === symbol)
  if (target) {
    console.log(`  ${symbol} ranks #${aum.rows.indexOf(target) + 1} at ${etfAum(target.netAssets)}`)
  }
}

const directoryFixture = '<table><tr><th>Symbol</th><th>Fund Name</th><th>Asset Class</th><th>Assets</th></tr>' +
  '<tr><td>SPY</td><td>SPDR S&amp;P 500 ETF Trust</td><td>Equity</td><td>640.20B</td></tr>' +
  '<tr><td>BND</td><td>Vanguard Total Bond Market</td><td>Fixed Income</td><td>-</td></tr></table>'

async function runCacheChecks(): Promise<void> {
  assert.equal(parseEtfAssets('1.25T'), 1.25e12)
  assert.equal(parseEtfAssets('72.51M'), 72.51e6)
  assert.equal(parseEtfAssets('0'), null)
  assert.equal(parseEtfAssets('-'), null)
  const directory = parseEtfDirectory(directoryFixture)
  assert.equal(directory.rows.length, 2)
  assert.equal(directory.rows[0].name, 'SPDR S&P 500 ETF Trust')
  assert.equal(directory.rows[1].netAssets, null, 'Missing AUM is not zero and must not drop a fund')
  assert.equal(directory.missingCount, 1)
  assert.equal(filterAumRows(directory.rows, 'vanguard').length, 1)
  assert.equal(filterAumRows(directory.rows, 'fixed income').length, 1)
  assert.throws(() => parseEtfDirectory('<html>Consent required</html>'), /fund table/)
  assert.equal(preferredEtfIssuer('SPY'), 'SPDR / State Street')
  assert.equal(preferredEtfIssuer('VOO'), 'Vanguard')
  assert.equal(preferredEtfIssuer('QQQ'), 'Invesco')
  const publicHoldings = parsePublicEtfHoldings('<h1>VOO Holdings</h1><table><tr><th>Symbol</th><th>Name</th><th>% Weight</th></tr><tr><td>MSFT</td><td>Microsoft</td><td>6.20%</td></tr></table>', 'VOO')
  assert.equal(publicHoldings.isPartial, true)
  assert.equal(publicHoldings.fundName, 'VOO')
  assert.equal(publicHoldings.holdings[0].weight, 0.062)
  assert.throws(() => parsePublicEtfHoldings('<html>Paywall</html>', 'VOO'))

  const scratch = await mkdtemp(join(tmpdir(), 'budget-etf-cache-'))
  const previousAppData = process.env.APPDATA
  const previousLocalAppData = process.env.LOCALAPPDATA
  process.env.APPDATA = scratch
  process.env.LOCALAPPDATA = scratch
  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  let store = new TtlCache({ path: join(scratch, 'cache.sqlite') })
  try {
    let calls = 0
    const load = async () => { calls += 1; return { ticker: 'SPY', fetchedAt: now } }
    const options = { store, force: true }
    const results = await Promise.all(Array.from({ length: 8 }, () => resolveEtfSnapshot('fund', 24 * 60 * 60_000, load, options)))
    assert.equal(calls, 1, 'Concurrent forced refreshes coalesce')
    now += 30_000
    await resolveEtfSnapshot('fund', 24 * 60 * 60_000, load, options)
    assert.equal(calls, 1, 'Manual refresh respects minimum age')
    store.close()
    store = new TtlCache({ path: join(scratch, 'cache.sqlite') })
    const restored = await resolveEtfSnapshot('fund', 24 * 60 * 60_000, load, { store })
    assert.equal(restored.fetchedAt, results[0].fetchedAt)
    assert.equal(calls, 1, 'Restart must read the disk cache, not the network')
    now += 31_000
    let failures = 0
    const fail = async (): Promise<{ ticker: string; fetchedAt: number }> => { failures++; throw new Error('Provider offline') }
    const stale = await captureSources(() => resolveEtfSnapshot('fund', 24 * 60 * 60_000, fail, { store, force: true }))
    assert.equal(stale.value.ticker, 'SPY')
    assert.equal(stale.snapshot?.stale, true, 'Retained data must be visibly stale')
    assert.ok(stale.snapshot?.failures.some(reason => reason.includes('Provider offline')))
    store.close()
    store = new TtlCache({ path: join(scratch, 'cache.sqlite') })
    await resolveEtfSnapshot('fund', 24 * 60 * 60_000, fail, { store, force: true })
    assert.equal(failures, 1, 'Failure backoff must survive restarts and forced refreshes')
    const ordinaryRead = await captureSources(() => resolveEtfSnapshot('fund', 24 * 60 * 60_000, load, { store }))
    assert.equal(ordinaryRead.snapshot?.stale, true, 'Normal visits during backoff must not relabel stale data as fresh')
    now += 5 * 60_000 + 1
    await resolveEtfSnapshot('fund', 24 * 60 * 60_000, load, { store, force: true })
    assert.equal(calls, 2, 'Provider can recover after backoff')
    assert.notEqual(store.get<{ fetchedAt: number }>('fund')?.value.fetchedAt, restored.fetchedAt)
    await assert.rejects(() => resolveEtfSnapshot('missing', 1000, fail, { store }), /Provider offline/)
    await assert.rejects(() => resolveEtfSnapshot('missing', 1000, fail, { store, force: true }), /Provider offline/)
    assert.equal(failures, 2, 'Cold failures must also be backed off')
    let dependentLoads = 0
    const dependent = async () => {
      dependentLoads++
      observeSource({ fetchedAt: now - 3_600_000, stale: false, fromCache: true, failures: [] })
      return 'dependent'
    }
    await resolveEtfSnapshot('dependent', 86_400_000, dependent, { store, force: true })
    now += 10_000
    await resolveEtfSnapshot('dependent', 86_400_000, dependent, { store, force: true })
    assert.equal(dependentLoads, 1, 'Old source metadata must not bypass the actual refresh cooldown')
    let quoteCalls = 0
    const quote = async () => { quoteCalls++; return 100 }
    await resolveEtfSnapshot('quotes', 120_000, quote, { store, force: true, minimumAgeMs: 120_000 })
    now += 61_000
    await resolveEtfSnapshot('quotes', 120_000, quote, { store, force: true, minimumAgeMs: 120_000 })
    assert.equal(quoteCalls, 1, 'Basket quote cooldown is two minutes, not one')
    now += 60_000
    await resolveEtfSnapshot('quotes', 120_000, quote, { store, minimumAgeMs: 120_000 })
    assert.equal(quoteCalls, 2, 'Expired quotes can be refreshed')
    now += 86_400_001
    await resolveEtfSnapshot('fund', 86_400_000, load, { store })
    assert.equal(calls, 3, 'Expired daily holdings must refresh normally')
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousAppData
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previousLocalAppData
    Date.now = originalNow
    store.close()
    await rm(scratch, { recursive: true, force: true })
  }

  const originalFetch = globalThis.fetch
  let downloads = 0
  const csv = 'date,ticker,company,weight (%),market value ($)\n2026-01-01,TSLA,Tesla,9.50,950\n'
  globalThis.fetch = async (input) => {
    const url = String(input)
    downloads++
    if (url === ETF_DIRECTORY_URL) return new Response(directoryFixture)
    assert.ok(url.includes('ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv'), `Unexpected network request: ${url}`)
    return new Response(csv)
  }
  try {
    const issuerLoad = getIssuerEtfHoldings('ARKK')
    const funds = await Promise.all([getEtfHoldingsPage('ARKK'), getEtfHoldingsPage('ARKK'), getEtfHoldingsPage('ARKK', true)])
    await issuerLoad
    assert.equal(downloads, 2, 'Concurrent issuer-only and page loads share one download plus one non-Yahoo directory request')
    assert.equal(funds[0].payload.holdings[0].symbol, 'TSLA')
    assert.equal(funds[0].payload.fetchedAt, funds[2].payload.fetchedAt)
    await getEtfHoldingsPage('ARKK', true)
    assert.equal(downloads, 2, 'Repeated force must not redownload or enrich through Yahoo')
    const clock = Date.now
    Date.now = () => clock() + 61_000
    try {
      globalThis.fetch = async () => { downloads++; throw new Error('Issuer down') }
      const retained = await captureSources(() => getEtfHoldingsPage('ARKK', true))
      assert.equal(retained.value.payload.isPartial, false, 'An outage must not replace a full basket with a public top-holdings fallback')
      assert.equal(retained.value.payload.fetchedAt, funds[0].payload.fetchedAt, 'Last-good issuer timestamp is preserved')
      assert.equal(retained.snapshot?.stale, true)
      assert.equal(downloads, 3, 'One failed issuer attempt; no Yahoo or public fan-out during an outage')
    } finally { Date.now = clock }
  } finally { globalThis.fetch = originalFetch }
  console.log('ETF cache checks passed: parsers, direct issuer routing, single-flight, disk restore, refresh cooldown, persistent failure backoff, last-good timestamps and zero Yahoo calls for issuer holdings/directory.')
}

const args = process.argv.slice(2)
runOffline()
if (args.includes('--offline')) await runCacheChecks()
if (!args.includes('--offline')) {
  await runLive(
    args.find((argument) => !argument.startsWith('--')) ?? 'SPY',
    !args.includes('--no-aum'),
    !args.includes('--no-arbitrage'),
  )
}
