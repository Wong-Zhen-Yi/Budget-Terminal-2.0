import assert from 'node:assert/strict'

import { periodLabel } from '../electron/shared/fundamentalsPage.js'
import {
  BMNR_ETH_SHOCKS,
  bmnrFiscalPeriod,
  bmnrQuarterLabel,
  buildBmnrPayload,
  buildBmnrSnapshot,
  buildComposition,
  buildFiledTreasury,
  buildHistory,
  emptyBmnrPayload,
  factAt,
  factRank,
  finiteOrNull,
  growthPct,
  latestFact,
  parseLiveTreasury,
  pickTreasuryRow,
  presentSum,
  ratio,
  reportedOrNull,
  selectInstantFacts,
  type BmnrSecInput,
} from '../electron/shared/bmnr.js'
import type { BmnrValue } from '../electron/shared/contract.js'
import { secTesting } from '../electron/services/secEdgar.js'
import { getBmnr } from '../electron/services/bmnr.js'

/**
 * The BMNR page probe.
 *
 * `--offline` covers everything pure, against fixtures taken from BMNR's real
 * `companyfacts` document and CoinGecko's real treasury response: the XBRL unit-bucket
 * hazard, amendment precedence, the fair-value double-count trap, the composition residual,
 * the NAV identity, every derived formula and the null-propagation rules. Without it, it
 * also runs the three live lanes and prints what each returned.
 */

/* ------------------------------------------------------------------ fixtures */

const ACC_Q1 = '0001493152-26-002084'
const ACC_Q2 = '0001493152-26-016560'
const ACC_Q3 = '0001628280-26-048157'

interface RawFact {
  end: string
  val: number
  fy: number
  fp: string
  form: string
  filed: string
  accn: string
}

/** Wraps each tag's unit map in the `units` level SEC's real `companyfacts` document has. */
function facts(entries: Record<string, Record<string, Record<string, RawFact[]>>>) {
  const taxonomies: Record<string, Record<string, { units: Record<string, RawFact[]> }>> = {}
  for (const [taxonomy, tags] of Object.entries(entries)) {
    taxonomies[taxonomy] = {}
    for (const [tag, units] of Object.entries(tags)) taxonomies[taxonomy][tag] = { units }
  }
  return { facts: taxonomies }
}

/** The real `CryptoAssetNumberOfUnits` block: two unit buckets, three dates. */
const unitHazardFacts = facts({
  'us-gaap': {
    CryptoAssetNumberOfUnits: {
      Integer: [
        { end: '2025-11-30', val: 3_737_333, fy: 2026, fp: 'Q1', form: '10-Q', filed: '2026-01-13', accn: ACC_Q1 },
        { end: '2026-02-28', val: 4_473_654, fy: 2026, fp: 'Q2', form: '10-Q', filed: '2026-04-14', accn: ACC_Q2 },
      ],
      cryptoAsset: [
        { end: '2026-05-31', val: 5_700_049, fy: 2026, fp: 'Q3', form: '10-Q', filed: '2026-07-14', accn: ACC_Q3 },
      ],
    },
  },
})

/**
 * The real `CommonStockSharesOutstanding` triple at 2025-11-30, plus a synthetic 10-Q/A
 * filed the same day as the winner so the amendment field is exercised too.
 */
const amendmentFacts = facts({
  'us-gaap': {
    CommonStockSharesOutstanding: {
      shares: [
        { end: '2025-11-30', val: 408_578_823, fy: 2026, fp: 'Q1', form: '10-Q', filed: '2026-01-13', accn: ACC_Q1 },
        { end: '2025-11-30', val: 405_398_823, fy: 2026, fp: 'Q2', form: '10-Q', filed: '2026-04-14', accn: ACC_Q2 },
        { end: '2025-11-30', val: 405_398_823, fy: 2026, fp: 'Q3', form: '10-Q', filed: '2026-07-14', accn: ACC_Q3 },
      ],
    },
  },
})

const usd = (end: string, val: number, fp: string, filed: string, accn: string): RawFact => ({
  end, val, fy: 2026, fp, form: '10-Q', filed, accn,
})

/** The real FY2026 Q2 and Q3 balance sheets, tag for tag. */
const balanceSheetFacts = facts({
  'us-gaap': {
    Assets: { USD: [usd('2026-02-28', 9_894_256_000, 'Q2', '2026-04-14', ACC_Q2), usd('2026-05-31', 11_630_253_000, 'Q3', '2026-07-14', ACC_Q3)] },
    Liabilities: { USD: [usd('2026-05-31', 30_128_000, 'Q3', '2026-07-14', ACC_Q3)] },
    StockholdersEquity: { USD: [usd('2026-05-31', 11_599_577_000, 'Q3', '2026-07-14', ACC_Q3)] },
    StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: {
      USD: [usd('2026-05-31', 11_600_125_000, 'Q3', '2026-07-14', ACC_Q3)],
    },
    MinorityInterest: { USD: [usd('2026-05-31', 548_000, 'Q3', '2026-07-14', ACC_Q3)] },
    CryptoAssetFairValue: { USD: [usd('2026-02-28', 8_806_282_000, 'Q2', '2026-04-14', ACC_Q2), usd('2026-05-31', 10_871_934_000, 'Q3', '2026-07-14', ACC_Q3)] },
    // The same number at the same date. Reading one and falling back is correct; adding
    // them doubles the entire ETH book.
    CryptoAssetFairValueNoncurrent: { USD: [usd('2026-05-31', 10_871_934_000, 'Q3', '2026-07-14', ACC_Q3)] },
    CryptoAssetCost: { USD: [usd('2026-05-31', 19_074_382_000, 'Q3', '2026-07-14', ACC_Q3)] },
    CryptoAssetNumberOfUnits: {
      Integer: [{ end: '2026-02-28', val: 4_473_654, fy: 2026, fp: 'Q2', form: '10-Q', filed: '2026-04-14', accn: ACC_Q2 }],
      cryptoAsset: [{ end: '2026-05-31', val: 5_700_049, fy: 2026, fp: 'Q3', form: '10-Q', filed: '2026-07-14', accn: ACC_Q3 }],
    },
    CashAndCashEquivalentsAtCarryingValue: { USD: [usd('2026-02-28', 879_577_000, 'Q2', '2026-04-14', ACC_Q2), usd('2026-05-31', 340_289_000, 'Q3', '2026-07-14', ACC_Q3)] },
    CommonStockSharesOutstanding: {
      shares: [
        { end: '2026-02-28', val: 493_905_227, fy: 2026, fp: 'Q2', form: '10-Q', filed: '2026-04-14', accn: ACC_Q2 },
        { end: '2026-05-31', val: 579_652_432, fy: 2026, fp: 'Q3', form: '10-Q', filed: '2026-07-14', accn: ACC_Q3 },
      ],
    },
    InvestmentOwnedAtFairValue: { USD: [usd('2026-05-31', 93_207_000, 'Q3', '2026-07-14', ACC_Q3)] },
    Goodwill: { USD: [usd('2026-05-31', 15_006_000, 'Q3', '2026-07-14', ACC_Q3)] },
    IntangibleAssetsNetExcludingGoodwill: { USD: [usd('2026-05-31', 11_110_000, 'Q3', '2026-07-14', ACC_Q3)] },
    PrepaidExpenseAndOtherAssetsCurrent: { USD: [usd('2026-05-31', 4_847_000, 'Q3', '2026-07-14', ACC_Q3)] },
    OperatingLeaseRightOfUseAsset: { USD: [usd('2026-05-31', 1_294_000, 'Q3', '2026-07-14', ACC_Q3)] },
    OtherAssetsNoncurrent: { USD: [usd('2026-05-31', 680_000, 'Q3', '2026-07-14', ACC_Q3)] },
    // Tagged at February and absent at May: the no-carry-forward check.
    PropertyPlantAndEquipmentNet: { USD: [usd('2026-02-28', 33_000_000, 'Q2', '2026-04-14', ACC_Q2)] },
  },
  dei: {
    EntityCommonStockSharesOutstanding: {
      shares: [{ end: '2026-07-09', val: 603_226_394, fy: 2026, fp: 'Q3', form: '10-Q', filed: '2026-07-14', accn: ACC_Q3 }],
    },
  },
})

/** CoinGecko's real shape: BMNR reporting a 0 entry value beside a peer reporting a real one. */
const coinGeckoFixture = {
  total_holdings: 7_915_367.6767,
  total_value_usd: 19_145_918_439.65,
  market_cap_dominance: 6.56,
  companies: [
    {
      name: 'BitMine Immersion', symbol: 'BMNR.US', country: 'US',
      total_holdings: 5_901_112, total_entry_value_usd: 0,
      total_current_value_usd: 14_273_779_016.96, percentage_of_total_supply: 4.89,
    },
    {
      name: 'SharpLink', symbol: 'SBET.US', country: 'US',
      total_holdings: 868_699, total_entry_value_usd: 0,
      total_current_value_usd: 2_101_234_065.42, percentage_of_total_supply: 0.72,
    },
    {
      name: 'Bit Digital', symbol: 'BTBT.US', country: 'US',
      total_holdings: 158_461.75, total_entry_value_usd: 450_300_476,
      total_current_value_usd: 383_291_827.39, percentage_of_total_supply: 0.131,
    },
  ],
}

/**
 * BitMine's real mining-era balance sheet (crypto at 2.1% of $8.3M of assets) beside a
 * real treasury-era one. Only the second is part of the treasury history.
 */
const withMiningEra = facts({
  'us-gaap': {
    Assets: {
      USD: [
        { end: '2025-05-31', val: 8_265_816, fy: 2025, fp: 'Q3', form: '10-Q', filed: '2025-07-02', accn: '0001683168-25-004889' },
        usd('2026-05-31', 11_630_253_000, 'Q3', '2026-07-14', ACC_Q3),
      ],
    },
    CryptoAssetFairValue: {
      USD: [
        { end: '2025-05-31', val: 173_916, fy: 2025, fp: 'Q3', form: '10-Q', filed: '2025-07-02', accn: '0001683168-25-004889' },
        usd('2026-05-31', 10_871_934_000, 'Q3', '2026-07-14', ACC_Q3),
      ],
    },
    CryptoAssetNumberOfUnits: {
      cryptoAsset: [{ end: '2026-05-31', val: 5_700_049, fy: 2026, fp: 'Q3', form: '10-Q', filed: '2026-07-14', accn: ACC_Q3 }],
    },
  },
})

const secInput = (source: typeof balanceSheetFacts): BmnrSecInput => ({
  cik: '0001829311',
  facts: source as unknown as Record<string, unknown>,
  filings: [],
  freshness: 'fresh',
  cacheAgeSeconds: 0,
  warnings: [],
})

function near(actual: number | null, expected: number, tolerance: number, label: string): void {
  assert.notEqual(actual, null, `${label} was null`)
  assert.ok(
    Math.abs((actual as number) - expected) <= tolerance,
    `${label}: expected ~${expected}, got ${actual}`,
  )
}

/* ------------------------------------------------------------------ offline */

function runOffline(): void {
  const raw = balanceSheetFacts as unknown as Record<string, unknown>

  /* -- the unit-bucket hazard ------------------------------------------- */
  const units = selectInstantFacts(
    unitHazardFacts as unknown as Record<string, unknown>,
    ['CryptoAssetNumberOfUnits'],
    ['Integer', 'cryptoAsset'],
  )
  assert.equal(units.size, 3, 'reading one unit bucket loses either the history or the latest count')
  assert.deepEqual([...units.keys()].sort(), ['2025-11-30', '2026-02-28', '2026-05-31'])
  const newest = latestFact(unitHazardFacts as unknown as Record<string, unknown>, ['CryptoAssetNumberOfUnits'], ['Integer', 'cryptoAsset'])
  assert.equal(newest?.val, 5_700_049)
  assert.equal(newest?.unit, 'cryptoAsset')
  // Bucket order in the argument must not change the answer.
  assert.equal(
    selectInstantFacts(unitHazardFacts as unknown as Record<string, unknown>, ['CryptoAssetNumberOfUnits'], ['cryptoAsset', 'Integer']).size,
    3,
  )
  // Negative control: secEdgar's own helper returns the first matching bucket and stops,
  // which is why it cannot serve this page directly.
  const rawUnitFact = (unitHazardFacts.facts['us-gaap'] as Record<string, unknown>).CryptoAssetNumberOfUnits
  assert.equal(
    secTesting.unitValues(rawUnitFact as Record<string, unknown>, ['Integer', 'cryptoAsset']).length,
    2,
    'secEdgar.unitValues stops at the first bucket; selectInstantFacts must merge both',
  )

  /* -- amendment precedence --------------------------------------------- */
  const shares = selectInstantFacts(amendmentFacts as unknown as Record<string, unknown>, ['CommonStockSharesOutstanding'], ['shares'])
  assert.equal(shares.get('2025-11-30')?.val, 405_398_823, 'the later-filed restatement must win')
  assert.ok(
    factRank({ filed: '2026-04-14', form: '10-Q/A', accession: 'x' }) >
      factRank({ filed: '2026-04-14', form: '10-Q', accession: 'x' }),
    'an amendment beats the original filed the same day',
  )
  assert.ok(
    factRank({ filed: '2026-07-14', form: '10-Q', accession: 'a' }) >
      factRank({ filed: '2026-04-14', form: '10-Q/A', accession: 'z' }),
    'filing date dominates the amendment flag',
  )
  const sample = { filed: '2026-04-14', form: '10-Q/A', accession: ACC_Q2 }
  assert.equal(
    factRank(sample),
    secTesting.rank({ ...sample, value: 0, start: '', end: '', fp: '', derived: false }),
    'the shared copy of rank() must not drift from secEdgar’s',
  )

  /* -- the fair-value double-count trap --------------------------------- */
  const fairValue = factAt(raw, ['CryptoAssetFairValue', 'CryptoAssetFairValueNoncurrent'], ['USD'], '2026-05-31')
  assert.equal(fairValue?.val, 10_871_934_000)
  assert.equal(fairValue?.tag, 'CryptoAssetFairValue', 'the first tag in the ladder must win')
  // Stated out loud: summing the two tags is the wrong answer.
  assert.equal(10_871_934_000 * 2, 21_743_868_000)

  /* -- filed quarters ---------------------------------------------------- */
  const filed = buildFiledTreasury(secInput(balanceSheetFacts))
  assert.equal(filed.latest?.endDate, '2026-05-31')
  assert.equal(filed.latest?.ethUnits, 5_700_049)
  assert.equal(filed.latest?.ethUnitsUnit, 'cryptoAsset')
  assert.equal(filed.latest?.cryptoFairValue, 10_871_934_000)
  assert.equal(filed.latest?.cash, 340_289_000)
  assert.equal(filed.latest?.sharesOutstanding, 579_652_432)
  assert.equal(filed.coverShares.value, 603_226_394, 'the cover page is read from the dei taxonomy')
  assert.equal(filed.coverShares.asOf, '2026-07-09')

  /* -- quarter label is fiscal, not calendar ---------------------------- */
  const label = bmnrQuarterLabel('2026-05-31')
  assert.ok(label.includes('FY2026 Q3'), label)
  assert.notEqual(label, periodLabel('2026-05-31', 'quarterly'))
  assert.equal(periodLabel('2026-05-31', 'quarterly'), '2026-Q2', 'the calendar helper would mislabel BMNR')
  // The fiscal period comes from the date, not from the filing the fact was found in: the
  // 2025-08-31 balance sheet rides in the 10-Q filed 2026-07-14 and carries its fy/fp.
  assert.deepEqual(bmnrFiscalPeriod('2025-08-31'), { fiscalYear: 2025, fiscalPeriod: 'FY' })
  assert.deepEqual(bmnrFiscalPeriod('2025-11-30'), { fiscalYear: 2026, fiscalPeriod: 'Q1' })
  assert.deepEqual(bmnrFiscalPeriod('2026-02-28'), { fiscalYear: 2026, fiscalPeriod: 'Q2' })
  assert.deepEqual(bmnrFiscalPeriod('2026-05-31'), { fiscalYear: 2026, fiscalPeriod: 'Q3' })
  assert.notEqual(
    bmnrQuarterLabel('2025-08-31'),
    bmnrQuarterLabel('2026-05-31'),
    'two different quarters must not share a label',
  )

  // The treasury-era cut: a mining-era quarter is excluded even though it carries a crypto
  // fact, because that fact is only 2.1% of total assets.
  const miningEra = buildFiledTreasury(secInput(withMiningEra))
  assert.deepEqual(
    miningEra.quarters.map((quarter) => quarter.endDate),
    ['2026-05-31'],
    'a quarter below the materiality threshold must be cut even though it tags crypto',
  )

  /* -- composition ------------------------------------------------------- */
  const composition = buildComposition(filed.latest)
  assert.equal(composition.overAllocated, false)
  const total = composition.slices.reduce((sum, slice) => sum + slice.value, 0)
  near(total, 11_630_253_000, 1, 'composition slices must sum to total assets')
  const residual = composition.slices.find((slice) => slice.tag === 'residual')
  assert.equal(residual?.value, 291_886_000)
  assert.ok(
    !composition.otherSlices.some((slice) => slice.tag === 'PropertyPlantAndEquipmentNet'),
    'a component tagged only at an earlier quarter must not be carried forward',
  )
  const shareSum =
    (composition.slices.find((s) => s.tag === 'CryptoAssetFairValue')?.sharePct ?? 0) +
    (composition.slices.find((s) => s.tag === 'CashAndCashEquivalentsAtCarryingValue')?.sharePct ?? 0) +
    composition.otherSlices.reduce((sum, slice) => sum + (slice.sharePct ?? 0), 0)
  near(shareSum, 100, 0.001, 'the three asset shares must sum to 100')

  // A mutated fixture that double-counts the fair value must be caught, not drawn.
  const doubled = JSON.parse(JSON.stringify(balanceSheetFacts)) as typeof balanceSheetFacts
  const overQuarter = buildFiledTreasury(secInput(doubled)).latest
  assert.ok(overQuarter)
  overQuarter.components.Goodwill = 11_630_253_000
  assert.equal(buildComposition(overQuarter).overAllocated, true, 'a negative residual must raise overAllocated')

  /* -- the CoinGecko sentinel ------------------------------------------- */
  assert.equal(reportedOrNull(0), null, 'CoinGecko’s 0 entry value means undisclosed')
  assert.equal(reportedOrNull(450_300_476), 450_300_476)
  assert.equal(reportedOrNull(''), null)
  assert.equal(finiteOrNull(0), 0, 'the two guards are not interchangeable: a filed 0 is real')
  assert.equal(finiteOrNull(null), null, 'Number(null) is 0, which is the hazard')
  assert.equal(finiteOrNull(''), null, "Number('') is 0 too")

  const live = parseLiveTreasury(coinGeckoFixture, '2026-09-02T13:00:00')
  assert.ok(live)
  assert.equal(live.ethHeld.value, 5_901_112)
  assert.equal(live.supplyPct.value, 4.89)
  assert.equal(live.entryValueUsd.value, null, 'BMNR’s 0 entry value parses to null')
  const peer = pickTreasuryRow(coinGeckoFixture, 'BTBT')
  assert.equal(reportedOrNull(peer?.total_entry_value_usd), 450_300_476, 'the sentinel is row-specific')
  // BMNR is matched by symbol, not by position.
  assert.equal(String(pickTreasuryRow(coinGeckoFixture)?.symbol), 'BMNR.US')
  assert.equal(
    String(pickTreasuryRow({ ...coinGeckoFixture, companies: [...coinGeckoFixture.companies].reverse() })?.symbol),
    'BMNR.US',
    'a rank change must not put a peer’s holdings under BMNR’s name',
  )
  near(live.impliedEthPrice.value, 2_418.83, 0.01, 'implied ETH price')
  near(live.impliedEthSupply.value, 120_677_137, 1_000, 'implied ETH supply')
  near(live.cohort.bmnrShareOfCohortPct, 74.56, 0.01, 'share of the treasury cohort')

  /* -- the NAV identity -------------------------------------------------- */
  // With ETH marked at its own filed carrying value, NAV must reproduce filed equity and
  // the build-up must reproduce equity including non-controlling interest.
  const carryPrice = 10_871_934_000 / 5_901_112
  const identity = buildBmnrPayload({
    fetchedAt: '2026-09-02T13:00:00',
    treasuryBody: coinGeckoFixture,
    sec: secInput(balanceSheetFacts),
    market: { sharePrice: 40, shareChangePct: 0, marketCap: 20_000_000_000, ethPrice: carryPrice, ethChangePct: 0 },
  })
  near(identity.derived.nav.value, 11_599_577_000, 1, 'NAV must reduce to filed equity')
  near(identity.derived.navBuildUp.value, 11_600_125_000, 1, 'build-up NAV must reduce to equity including NCI')
  near(identity.derived.navReconciliationGap.value, 548_000, 1, 'the reconciliation gap is the minority interest')
  assert.equal(identity.filed?.latest?.minorityInterest, 548_000)

  /* -- every derived formula, on the real numbers ------------------------ */
  const ethPrice = 2_418.83
  const built = buildBmnrPayload({
    fetchedAt: '2026-09-02T13:00:00',
    treasuryBody: coinGeckoFixture,
    sec: secInput(balanceSheetFacts),
    market: { sharePrice: 40, shareChangePct: 1.5, marketCap: 20_000_000_000, ethPrice, ethChangePct: -2 },
  })
  const d = built.derived
  assert.equal(d.shares.value, 603_226_394, 'the cover-page count is the denominator')
  near(d.cryptoValue.value, 5_901_112 * ethPrice, 1, 'crypto value')
  const expectedNav = 11_599_577_000 + (5_901_112 * ethPrice - 10_871_934_000)
  near(d.nav.value, expectedNav, 1, 'NAV')
  near(d.navPerShare.value, expectedNav / 603_226_394, 1e-6, 'NAV per share')
  near(d.mnav.value, 20_000_000_000 / expectedNav, 1e-9, 'mNAV')
  near(d.premiumPct.value, (20_000_000_000 / expectedNav - 1) * 100, 1e-6, 'premium')
  near(d.ethPerShare.value, 5_901_112 / 603_226_394, 1e-9, 'ETH per share')
  near(d.ethPer1000Shares.value, (5_901_112 / 603_226_394) * 1000, 1e-6, 'ETH per 1,000 shares')
  near(d.impliedGrossCostPerEth.value, 19_074_382_000 / 5_700_049, 0.01, 'implied gross cost per ETH')
  near(d.filedCarryingValuePerEth.value, 10_871_934_000 / 5_700_049, 0.01, 'filed carrying value per ETH')
  near(d.costVsSpotPct.value, (ethPrice / (19_074_382_000 / 5_700_049) - 1) * 100, 0.01, 'cost vs spot')
  near(d.cryptoShareOfAssetsPct.value, (10_871_934_000 / 11_630_253_000) * 100, 1e-6, 'crypto share of assets')
  near(d.cashShareOfAssetsPct.value, (340_289_000 / 11_630_253_000) * 100, 1e-6, 'cash share of assets')
  assert.equal(d.unfiledEth.value, 5_901_112 - 5_700_049)
  near(d.unfiledEthPct.value, 3.5274, 0.001, 'unfiled ETH percent')
  near(d.filedSupplyPct.value, 4.723, 0.005, 'filed count against live implied supply')
  assert.equal(d.shareCountGap.value, 603_226_394 - 579_652_432)
  near(d.shareCountGapPct.value, 4.067, 0.005, 'share count gap percent')
  near(d.otherAssets.value, 11_630_253_000 - 10_871_934_000 - 340_289_000, 1, 'other assets')

  /* -- basis labelling: the machine check on the never-blend rule --------- */
  const crossExpected = new Set([
    'nav', 'navBuildUp', 'navReconciliationGap', 'navPerShare', 'mnav', 'premiumPct',
    'ethPerShare', 'ethPer1000Shares', 'ethValuePerShare', 'costVsSpotPct',
    'unfiledEth', 'unfiledEthPct', 'filedSupplyPct',
  ])
  for (const [key, cell] of Object.entries(d) as Array<[string, BmnrValue]>) {
    assert.ok(cell.basis, `derived.${key} carries no basis`)
    assert.ok(cell.source, `derived.${key} carries no source`)
    if (crossExpected.has(key)) {
      assert.equal(cell.basis, 'cross', `derived.${key} mixes a live and a filed input and must say so`)
    }
  }

  /* -- null propagation --------------------------------------------------- */
  const noSec = buildBmnrPayload({
    fetchedAt: '', treasuryBody: coinGeckoFixture, sec: null,
    market: { sharePrice: 40, shareChangePct: 0, marketCap: 20_000_000_000, ethPrice, ethChangePct: 0 },
  })
  for (const key of ['nav', 'navPerShare', 'mnav', 'impliedGrossCostPerEth', 'cryptoShareOfAssetsPct'] as const) {
    assert.equal(noSec.derived[key].value, null, `derived.${key} must be null without a filed balance sheet, not 0`)
  }
  const noLive = buildBmnrPayload({
    fetchedAt: '', treasuryBody: null, sec: secInput(balanceSheetFacts),
    market: { sharePrice: 40, shareChangePct: 0, marketCap: 20_000_000_000, ethPrice, ethChangePct: 0 },
  })
  assert.equal(noLive.derived.cryptoValue.value, null, 'no live ETH count means no marked crypto value')
  assert.equal(noLive.derived.nav.value, null)
  assert.notEqual(noLive.filed?.latest, null, 'the filed panel survives a dead CoinGecko lane')
  assert.equal(noLive.progress.treasury, 'unavailable')
  assert.equal(noLive.progress.filings, 'loaded')
  // The live tiles must not silently fall back to the filed count.
  assert.equal(noLive.live, null)

  // Yahoo dead, CoinGecko alive: the ETH price falls back to CoinGecko's implied price so
  // the crypto value and NAV survive, but the market lane must still report itself down
  // rather than being flattered by another lane's fallback.
  const noYahoo = buildBmnrPayload({
    fetchedAt: '', treasuryBody: coinGeckoFixture, sec: secInput(balanceSheetFacts),
    market: { sharePrice: null, shareChangePct: null, marketCap: null, ethPrice: null, ethChangePct: null },
  })
  assert.equal(noYahoo.progress.market, 'unavailable', 'a CoinGecko fallback must not mark the Yahoo lane healthy')
  assert.equal(noYahoo.market.ethPrice.source, 'CoinGecko')
  assert.ok(noYahoo.market.ethPrice.note, 'the fallback must say it was a fallback')
  assert.notEqual(noYahoo.derived.cryptoValue.value, null, 'the crypto value survives on the fallback price')
  assert.notEqual(noYahoo.derived.nav.value, null, 'NAV survives on the fallback price')
  assert.equal(noYahoo.derived.mnav.value, null, 'no market cap means no mNAV')
  assert.equal(noYahoo.derived.premiumPct.value, null)

  // Everything down: the fallback note must not claim CoinGecko answered when nothing did.
  const nothing = buildBmnrPayload({
    fetchedAt: '', treasuryBody: null, sec: null,
    market: { sharePrice: null, shareChangePct: null, marketCap: null, ethPrice: null, ethChangePct: null },
  })
  assert.equal(nothing.market.ethPrice.value, null)
  assert.equal(nothing.market.ethPrice.note, undefined, 'no source answered, so there is nothing to caveat')

  assert.equal(ratio(1, 0), null, 'a zero denominator dashes rather than yielding Infinity')
  assert.equal(growthPct(1, 0), null)
  assert.equal(growthPct(1, -5), null, 'a premium to a negative base is noise')
  assert.equal(presentSum([null, null]), null)
  assert.equal(presentSum([null, 5]), 5)

  /* -- history ------------------------------------------------------------ */
  const history = buildHistory(filed.quarters)
  assert.ok(history.length >= 2, 'at least two crypto-era quarters')
  assert.equal(history[0].qoqSharesPct, null, 'the first point has no predecessor, so null and not 0')
  assert.equal(history[0].qoqEthPct, null)
  assert.equal(history[0].accretionPct, null)
  const indexedBase = history.find((point) => point.ethPerShareIndexed !== null)
  near(indexedBase?.ethPerShareIndexed ?? null, 100, 1e-9, 'the indexed ETH series starts at 100')
  near(indexedBase?.sharesIndexed ?? null, 100, 1e-9, 'both series share one base quarter')
  // A quarter with shares but no ETH units reports the share delta and withholds the other.
  const partial = buildHistory([
    { ...filed.quarters[0], ethUnits: null, ethUnitsUnit: '' },
    { ...filed.quarters[filed.quarters.length - 1], ethUnits: null, ethUnitsUnit: '' },
  ])
  assert.notEqual(partial[1].qoqSharesPct, null)
  assert.equal(partial[1].qoqEthPct, null)

  /* -- sensitivity -------------------------------------------------------- */
  assert.equal(built.sensitivity.length, BMNR_ETH_SHOCKS.length)
  const flat = built.sensitivity.find((row) => row.shockPct === 0)
  near(flat?.navPerShare ?? null, expectedNav / 603_226_394, 1e-6, 'the 0% row equals the headline NAV per share')
  const up = built.sensitivity.find((row) => row.shockPct === 25)
  assert.ok((up?.navPerShare ?? 0) > (flat?.navPerShare ?? 0), 'a higher ETH price raises NAV per share')
  const currentMnav = built.derived.mnav.value
  const currentPremiumPct = built.derived.premiumPct.value
  assert.ok(currentMnav !== null)
  assert.ok(currentPremiumPct !== null)
  for (const row of built.sensitivity) {
    near(row.mnav, currentMnav, 1e-12, 'sensitivity holds the current mNAV constant')
    near(row.premiumPct, currentPremiumPct, 1e-12, 'sensitivity holds the current premium constant')
  }

  /* -- the empty payload -------------------------------------------------- */
  const empty = emptyBmnrPayload()
  assert.equal(empty.live, null)
  assert.equal(empty.filed, null)
  assert.deepEqual(empty.progress, { treasury: 'unavailable', filings: 'unavailable', market: 'unavailable' })
  for (const cell of Object.values(empty.derived) as BmnrValue[]) assert.equal(cell.value, null)
  assert.equal(empty.composition.slices.length, 0)
  assert.equal(empty.history.length, 0)

  /* -- the clipboard snapshot --------------------------------------------- */
  const snapshot = buildBmnrSnapshot(built)
  assert.ok(snapshot.includes('BMNR'), snapshot)
  assert.ok(snapshot.includes('5,901,112'), 'the live ETH count is in the export')
  assert.ok(snapshot.includes('cryptoAsset'), 'the filed unit tag is in the export')

  console.log('offline: all BMNR assertions passed')
}

/* --------------------------------------------------------------------- live */

function show(label: string, cell: BmnrValue, digits = 2): void {
  const printed = cell.value === null ? '--' : cell.value.toLocaleString('en-US', { maximumFractionDigits: digits })
  console.log(`  ${label.padEnd(30)} ${printed.padStart(20)}  [${cell.basis}${cell.asOf ? ` ${cell.asOf}` : ''}]`)
}

async function runLive(): Promise<void> {
  console.log('\n=== BMNR live ===')
  const { payload, errors } = await getBmnr(true)

  console.log('\nLanes')
  for (const [block, state] of Object.entries(payload.progress)) console.log(`  ${block.padEnd(10)} ${state}`)
  for (const entry of errors) console.log(`  ! ${entry.symbol}: ${entry.reason}`)

  if (payload.live) {
    console.log('\nLive treasury (CoinGecko)')
    show('ETH held', payload.live.ethHeld, 0)
    show('Percent of ETH supply', payload.live.supplyPct)
    show('ETH value USD', payload.live.ethValueUsd, 0)
    show('Implied ETH price', payload.live.impliedEthPrice)
    show('Implied ETH supply', payload.live.impliedEthSupply, 0)
    console.log(`  cohort: ${payload.live.cohort.companyCount} companies, BMNR ${payload.live.cohort.bmnrShareOfCohortPct?.toFixed(2)}% of them`)
  } else console.log('\nLive treasury: unavailable')

  if (payload.filed) {
    console.log(`\nSEC filed (CIK ${payload.filed.cik}, ${payload.filed.freshness}, age ${payload.filed.cacheAgeSeconds.toFixed(0)}s)`)
    for (const warning of payload.filed.warnings) console.log(`  ! ${warning}`)
    const quarter = payload.filed.latest
    if (quarter) {
      console.log(`  ${quarter.label} — ${quarter.form} filed ${quarter.filedDate}`)
      console.log(`    ETH units        ${quarter.ethUnits?.toLocaleString('en-US') ?? '--'}  [unit ${quarter.ethUnitsUnit}]`)
      console.log(`    Crypto carrying  ${quarter.cryptoFairValue?.toLocaleString('en-US') ?? '--'}`)
      console.log(`    Cash             ${quarter.cash?.toLocaleString('en-US') ?? '--'}`)
      console.log(`    Total assets     ${quarter.totalAssets?.toLocaleString('en-US') ?? '--'}`)
      console.log(`    Shares (sheet)   ${quarter.sharesOutstanding?.toLocaleString('en-US') ?? '--'}`)
      console.log(`    Shares (cover)   ${payload.filed.coverShares.value?.toLocaleString('en-US') ?? '--'}`)
    }
  } else console.log('\nSEC filed: unavailable')

  console.log('\nMarket')
  show('BMNR price', payload.market.sharePrice)
  show('BMNR change %', payload.market.shareChangePct)
  show('Market cap', payload.market.marketCap, 0)
  show('ETH price', payload.market.ethPrice)

  console.log('\nDerived')
  show('NAV', payload.derived.nav, 0)
  show('NAV per share', payload.derived.navPerShare)
  show('mNAV', payload.derived.mnav, 3)
  show('Premium %', payload.derived.premiumPct)
  show('ETH per 1,000 shares', payload.derived.ethPer1000Shares, 3)
  show('Gross cost / ETH', payload.derived.impliedGrossCostPerEth)
  show('Carrying value / ETH', payload.derived.filedCarryingValuePerEth)
  show('Unfiled ETH', payload.derived.unfiledEth, 0)
  show('Shares used', payload.derived.shares, 0)

  const gap = payload.derived.navReconciliationGap.value
  const minority = payload.filed?.latest?.minorityInterest ?? null
  if (gap !== null && minority !== null) {
    const ok = Math.abs(gap - minority) < 1
    console.log(`\nNAV reconciliation: gap ${gap.toLocaleString('en-US')} vs minority interest ${minority.toLocaleString('en-US')}  ${ok ? '✓' : '✗'}`)
  }

  console.log(`\nComposition (${payload.composition.asOf}), total ${payload.composition.totalAssets?.toLocaleString('en-US') ?? '--'}`)
  for (const slice of payload.composition.slices) {
    console.log(`  ${slice.label.padEnd(28)} ${slice.value.toLocaleString('en-US').padStart(18)}  ${slice.sharePct?.toFixed(2).padStart(6)}%  ${slice.tag}`)
  }
  if (payload.composition.overAllocated) console.log('  ! named components exceed total assets')

  console.log('\nHistory')
  for (const point of payload.history) {
    console.log(
      `  ${point.label.padEnd(24)} eth ${(point.ethUnits?.toLocaleString('en-US') ?? '--').padStart(12)}` +
        ` sh ${(point.shares?.toLocaleString('en-US') ?? '--').padStart(14)}` +
        ` per1k ${(point.ethPer1000Shares?.toFixed(3) ?? '--').padStart(8)}` +
        ` accretion ${(point.accretionPct?.toFixed(2) ?? '--').padStart(8)}`,
    )
  }

  console.log('\nSensitivity')
  for (const row of payload.sensitivity) {
    console.log(
      `  ${String(row.shockPct).padStart(4)}%  eth ${(row.ethPrice?.toFixed(2) ?? '--').padStart(10)}` +
        `  nav/sh ${(row.navPerShare?.toFixed(2) ?? '--').padStart(10)}` +
        `  mnav ${(row.mnav?.toFixed(3) ?? '--').padStart(8)}`,
    )
  }

  console.log(`\nFilings: ${payload.filings.length}`)
  for (const filing of payload.filings.slice(0, 5)) {
    console.log(`  ${filing.filedDate}  ${filing.form.padEnd(8)} ${filing.items || filing.description}`)
  }

  // Shape-change canaries: these would catch an upstream field rename that otherwise
  // renders as a page full of dashes.
  if (payload.live) {
    assert.ok((payload.live.ethHeld.value ?? 0) > 1_000_000, 'live ETH count looks wrong')
    near(payload.live.impliedEthSupply.value, 120_000_000, 15_000_000, 'implied ETH supply')
  }
  if (payload.filed?.latest) {
    assert.ok((payload.filed.latest.ethUnits ?? 0) > 1_000_000, 'filed ETH count looks wrong')
  }

  const started = Date.now()
  await getBmnr()
  const elapsed = Date.now() - started
  console.log(`\nSecond unforced load: ${elapsed}ms`)
  assert.ok(elapsed < 1_000, 'the second load must come out of the TTL cache')
  console.log('live: all BMNR assertions passed')
}

const args = process.argv.slice(2)
runOffline()
if (!args.includes('--offline')) await runLive()
