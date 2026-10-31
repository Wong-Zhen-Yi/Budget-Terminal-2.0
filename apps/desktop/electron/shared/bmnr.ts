import type {
  BmnrBasis,
  BmnrBlock,
  BmnrBlockStatus,
  BmnrComposition,
  BmnrDerived,
  BmnrFiledQuarter,
  BmnrFiledTreasury,
  BmnrHoldingSlice,
  BmnrLiveTreasury,
  BmnrMarket,
  BmnrPayload,
  BmnrQuarterPoint,
  BmnrSensitivityRow,
  BmnrValue,
  SecFiling,
  SecFreshness,
  Quote,
} from './contract.js'
import { BMNR_SYMBOL } from './contract.js'

/**
 * Every number the BMNR page shows, as pure functions over raw source documents.
 *
 * No Electron, no React, no `services/` imports: the main process builds the payload with
 * these, the page reads it, and `scripts/probe-bmnr.ts` asserts them against fixtures, so
 * the three cannot disagree.
 *
 * The page exists because BMNR is an Ethereum treasury company — the equity is a wrapper
 * around a pile of ETH — and its two sources disagree by design. CoinGecko publishes a
 * *live* ETH count; the last filed 10-Q publishes an authoritative one that can be a
 * quarter old. **They are never blended.** Every figure below is wrapped in a `BmnrValue`
 * carrying its `basis`, `asOf` and `source`, and the handful that genuinely mix a live and
 * a filed input are marked `basis: 'cross'` rather than being passed off as either.
 */

/* -------------------------------------------------------------------- guards */

/**
 * `Number(null)` and `Number('')` are both `0`, which is the hazard this whole file is
 * written around. Without the guard a quarter that never tagged `MinorityInterest` would
 * subtract a real zero from NAV, and a missing cash line would render as a genuine $0
 * balance instead of a dash. Same rule as `finiteOrNull` in `shared/valuation.ts` and
 * `finite()` in the Economic service; `shared/` modules do not import each other's
 * helpers, so it is redeclared here.
 */
export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * The zero-as-sentinel case, and **only** that case.
 *
 * CoinGecko reports `total_entry_value_usd: 0` for BMNR while reporting a real
 * `450300476` for Bit Digital in the same response, so a zero there means "not disclosed",
 * not "acquired for nothing". This does not generalise: `MinorityInterest: 0` in a filing
 * is a real zero and goes through `finiteOrNull` instead.
 */
export function reportedOrNull(value: unknown): number | null {
  const numeric = finiteOrNull(value)
  return numeric === null || numeric === 0 ? null : numeric
}

/* ------------------------------------------------------------- combinators */

/*
 * Any null in, null out. Stated once here and relied on everywhere below: a derived figure
 * built on a missing input must dash, never quietly report a number computed against zero.
 */

export function add(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b
}

export function diff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b
}

export function times(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a * b
}

/** Also null when `b === 0`, so a zero NAV yields a dash rather than `Infinity`. */
export function ratio(a: number | null, b: number | null): number | null {
  return a === null || b === null || b === 0 ? null : a / b
}

export function pctOf(a: number | null, b: number | null): number | null {
  const value = ratio(a, b)
  return value === null ? null : value * 100
}

/** `(a / b - 1) * 100`, and null when `b <= 0` — a premium to a negative NAV is noise. */
export function growthPct(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b <= 0) return null
  return (a / b - 1) * 100
}

/**
 * Sum of whatever is present; null only when everything is absent.
 *
 * Used **exclusively** by `buildComposition`, where a component the filing did not tag is
 * absorbed by the residual slice rather than voiding the whole chart. Anywhere else it
 * would silently turn a missing input into a zero, which is precisely what the strict
 * combinators above exist to prevent.
 */
export function presentSum(values: Array<number | null>): number | null {
  let total = 0
  let seen = false
  for (const value of values) {
    if (value === null) continue
    total += value
    seen = true
  }
  return seen ? total : null
}

/* -------------------------------------------------------------- value cells */

export function bmnrValue(
  value: number | null,
  asOf: string,
  source: string,
  basis: BmnrBasis,
  note?: string,
): BmnrValue {
  return note ? { value, asOf, source, basis, note } : { value, asOf, source, basis }
}

function emptyValue(basis: BmnrBasis = 'filed'): BmnrValue {
  return { value: null, asOf: '', source: '', basis }
}

/* ----------------------------------------------------------- fact selection */

export interface SelectedBmnrFact {
  end: string
  val: number
  form: string
  fp: string
  fy: number | null
  filed: string
  accession: string
  /** The `units` key the value came from — `USD`, `shares`, `Integer`, `cryptoAsset`. */
  unit: string
  tag: string
}

/**
 * Mirrors `rank()` in `services/secEdgar.ts`; `shared/` may not import from `services/`,
 * so the probe asserts the two produce identical strings and cannot drift.
 *
 * Later filing date wins, then an amendment over the original it restates, then accession.
 * The filing date has to dominate: BMNR's 2025-11-30 share count was restated from
 * 408,578,823 to 405,398,823 in a plain later 10-Q with no `/A` anywhere in sight.
 */
export function factRank(fact: { filed: string; form: string; accession: string }): string {
  return `${fact.filed}:${fact.form.endsWith('/A') ? 1 : 0}:${fact.accession}`
}

const INSTANT_FORMS = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A'])

function normalizeUnitKey(value: string): string {
  return value.replaceAll(' ', '').toLowerCase()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function isoDate(value: unknown): string {
  const text = String(value ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

/**
 * Every instant fact for a tag ladder, keyed by balance-sheet date.
 *
 * Two behaviours are load-bearing.
 *
 * **Units are merged across every matching bucket.** BMNR reports
 * `CryptoAssetNumberOfUnits` under the unit `Integer` in the FY2026 Q1 and Q2 10-Qs and
 * under `cryptoAsset` in Q3, so reading a single bucket makes either the history or the
 * latest count invisible. `secEdgar`'s own `unitValues` returns the *first* matching
 * bucket and stops — correct for its single-unit specs, wrong here, which is why that
 * helper is exported and asserted as a negative control in the probe.
 *
 * **Tags are a ladder, never a sum.** The first tag with a fact at a given date wins and
 * later tags cannot overwrite it. `CryptoAssetFairValue` and `CryptoAssetFairValueNoncurrent`
 * are the same number at every date BMNR reports both, so adding them would double the
 * entire ETH book.
 */
export function selectInstantFacts(
  facts: Record<string, unknown>,
  tags: string[],
  units: string[],
): Map<string, SelectedBmnrFact> {
  const wanted = units.map(normalizeUnitKey)
  const root = asRecord(asRecord(facts).facts)
  const result = new Map<string, SelectedBmnrFact>()

  for (const tag of tags) {
    const perTag = new Map<string, SelectedBmnrFact>()
    for (const taxonomy of ['us-gaap', 'dei']) {
      const fact = asRecord(asRecord(root[taxonomy])[tag])
      const unitMap = asRecord(fact.units)
      for (const unitKey of Object.keys(unitMap)) {
        if (!wanted.includes(normalizeUnitKey(unitKey))) continue
        const items = unitMap[unitKey]
        if (!Array.isArray(items)) continue
        for (const rawItem of items) {
          const raw = asRecord(rawItem)
          const form = String(raw.form ?? '')
          if (!INSTANT_FORMS.has(form)) continue
          const end = isoDate(raw.end)
          const val = finiteOrNull(raw.val)
          if (!end || val === null) continue
          const selected: SelectedBmnrFact = {
            end,
            val,
            form,
            fp: String(raw.fp ?? '').toUpperCase(),
            fy: finiteOrNull(raw.fy),
            filed: isoDate(raw.filed),
            accession: String(raw.accn ?? ''),
            unit: unitKey,
            tag,
          }
          const previous = perTag.get(end)
          if (!previous || factRank(selected) > factRank(previous)) perTag.set(end, selected)
        }
      }
    }
    // Ladder precedence: an earlier tag already answering this date is not overwritten.
    for (const [end, fact] of perTag) if (!result.has(end)) result.set(end, fact)
  }
  return result
}

/** The single most recent balance-sheet date from a ladder, or null. */
export function latestFact(
  facts: Record<string, unknown>,
  tags: string[],
  units: string[],
): SelectedBmnrFact | null {
  const selected = [...selectInstantFacts(facts, tags, units).values()]
  selected.sort((left, right) => left.end.localeCompare(right.end))
  return selected.length ? selected[selected.length - 1] : null
}

/**
 * The ladder's value at exactly `endDate`, or null.
 *
 * There is deliberately no carry-forward. `PropertyPlantAndEquipmentNet` is tagged at
 * 2026-02-28 and absent at 2026-05-31, and reporting February's balance as May's would
 * quietly invent an asset the company no longer discloses.
 */
export function factAt(
  facts: Record<string, unknown>,
  tags: string[],
  units: string[],
  endDate: string,
): SelectedBmnrFact | null {
  return selectInstantFacts(facts, tags, units).get(endDate) ?? null
}

/* -------------------------------------------------------------- tag ladders */

const USD = ['USD']
const SHARES = ['shares']

/** First tag present wins; never summed. Kept as a table so the next reader can find it. */
export const BMNR_FACT_LADDERS = {
  ethUnits: { tags: ['CryptoAssetNumberOfUnits'], units: ['Integer', 'cryptoAsset', 'unit', 'pure'] },
  cryptoFairValue: { tags: ['CryptoAssetFairValue', 'CryptoAssetFairValueNoncurrent'], units: USD },
  cryptoCost: { tags: ['CryptoAssetCost'], units: USD },
  cash: {
    tags: [
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
      'Cash',
    ],
    units: USD,
  },
  totalAssets: { tags: ['Assets'], units: USD },
  liabilities: { tags: ['Liabilities'], units: USD },
  stockholdersEquity: { tags: ['StockholdersEquity'], units: USD },
  stockholdersEquityInclNci: {
    tags: ['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    units: USD,
  },
  minorityInterest: { tags: ['MinorityInterest'], units: USD },
  sharesOutstanding: { tags: ['CommonStockSharesOutstanding'], units: SHARES },
  coverShares: { tags: ['EntityCommonStockSharesOutstanding'], units: SHARES },
} as const

/** Asset lines beyond crypto and cash, read only at the latest balance-sheet date. */
export const BMNR_COMPONENT_LADDER: ReadonlyArray<{ label: string; tags: string[] }> = [
  { label: 'Investments at fair value', tags: ['InvestmentOwnedAtFairValue', 'Investments', 'InvestmentsFairValueDisclosure'] },
  { label: 'Receivables', tags: ['AccountsAndOtherReceivablesNetCurrent', 'OtherReceivablesNetCurrent', 'AccountsNotesAndLoansReceivableNetCurrent'] },
  { label: 'Goodwill', tags: ['Goodwill'] },
  { label: 'Intangibles', tags: ['IntangibleAssetsNetExcludingGoodwill'] },
  { label: 'Property & equipment', tags: ['PropertyPlantAndEquipmentNet'] },
  { label: 'Right-of-use asset', tags: ['OperatingLeaseRightOfUseAsset'] },
  { label: 'Prepaid & other current', tags: ['PrepaidExpenseAndOtherAssetsCurrent'] },
  { label: 'Other non-current', tags: ['OtherAssetsNoncurrent'] },
]

export const BMNR_CRYPTO_SLICE_LABEL = 'Crypto assets (ETH)'
export const BMNR_CASH_SLICE_LABEL = 'Cash & equivalents'
export const BMNR_RESIDUAL_SLICE_LABEL = 'Other / unclassified'

/** ETH shocks the sensitivity ladder re-prices NAV at. */
export const BMNR_ETH_SHOCKS: readonly number[] = [-25, -10, 0, 10, 25]

/** How many treasury-era quarters the history table and chart carry at most. */
export const BMNR_MAX_QUARTERS = 12

/**
 * The crypto share of total assets at which a quarter counts as part of the treasury era.
 * BitMine's mining years top out at 3.3% and its treasury quarters bottom out at 89%, so
 * anything between separates them.
 */
export const BMNR_TREASURY_ERA_MIN_SHARE = 0.1

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** BMNR's fiscal year ends 31 August, so FY2026 runs September 2025 to August 2026. */
export const BMNR_FISCAL_YEAR_END_MONTH = 8

export interface BmnrFiscalPeriod {
  fiscalYear: number | null
  /** `Q1`-`Q3`, or `FY` for the quarter ending on the fiscal year end. */
  fiscalPeriod: string
}

/**
 * The fiscal period a balance-sheet date falls in, derived from the date alone.
 *
 * Deliberately not read from the fact's own `fy`/`fp`. Those describe the **filing**, not
 * the period it measures: the 2025-08-31 balance sheet rides along as a comparative in the
 * 10-Q filed 2026-07-14 and carries that filing's `fy: 2026, fp: 'Q3'`, so trusting it
 * labelled two different quarters `FY2026 Q3`.
 */
export function bmnrFiscalPeriod(endDate: string): BmnrFiscalPeriod {
  const year = Number(endDate.slice(0, 4))
  const month = Number(endDate.slice(5, 7))
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { fiscalYear: null, fiscalPeriod: '' }
  }
  const firstMonth = (BMNR_FISCAL_YEAR_END_MONTH % 12) + 1
  const offset = (month - firstMonth + 12) % 12
  const quarter = Math.floor(offset / 3) + 1
  return {
    fiscalYear: month >= firstMonth ? year + 1 : year,
    fiscalPeriod: quarter === 4 ? 'FY' : `Q${quarter}`,
  }
}

/**
 * `FY2026 Q3 · May 2026`.
 *
 * Fiscal, not calendar. BMNR's year ends 31 August, so `periodLabel()` in
 * `shared/fundamentalsPage.ts` would label the May 2026 quarter `2026-Q2` — a quarter that
 * does not exist in BMNR's own filings.
 */
export function bmnrQuarterLabel(endDate: string): string {
  const month = Number(endDate.slice(5, 7))
  const stamp = Number.isFinite(month) && month >= 1 && month <= 12
    ? `${MONTHS[month - 1]} ${endDate.slice(0, 4)}`
    : endDate
  const { fiscalYear, fiscalPeriod } = bmnrFiscalPeriod(endDate)
  if (fiscalYear === null || !fiscalPeriod) return stamp
  return `FY${fiscalYear} ${fiscalPeriod} · ${stamp}`
}

/* ------------------------------------------------------------- live parsing */

export interface BmnrCoinGeckoRow {
  name?: unknown
  symbol?: unknown
  country?: unknown
  total_holdings?: unknown
  total_entry_value_usd?: unknown
  total_current_value_usd?: unknown
  percentage_of_total_supply?: unknown
}

/**
 * BMNR's row out of the treasury list.
 *
 * Deliberately not `companies[0]`. BMNR is the first row only because it is the largest
 * holder today; a rank change would render SharpLink's holdings under BMNR's name with no
 * error raised anywhere.
 */
export function pickTreasuryRow(body: unknown, symbol = BMNR_SYMBOL): BmnrCoinGeckoRow | null {
  const rows = asRecord(body).companies
  if (!Array.isArray(rows)) return null
  const wanted = symbol.toUpperCase()
  const bySymbol = rows.find((row) => {
    const ticker = String(asRecord(row).symbol ?? '').split('.')[0]?.trim().toUpperCase()
    return ticker === wanted
  })
  if (bySymbol) return bySymbol as BmnrCoinGeckoRow
  const byName = rows.find((row) => String(asRecord(row).name ?? '').trim().toUpperCase().startsWith('BITMINE'))
  return (byName as BmnrCoinGeckoRow) ?? null
}

export function parseLiveTreasury(body: unknown, fetchedAt: string, symbol = BMNR_SYMBOL): BmnrLiveTreasury | null {
  const row = pickTreasuryRow(body, symbol)
  if (!row) return null
  const root = asRecord(body)
  const source = 'CoinGecko'
  const live = (value: number | null, note?: string): BmnrValue =>
    bmnrValue(value, fetchedAt, source, 'live', note)

  const ethHeld = finiteOrNull(row.total_holdings)
  const supplyPct = finiteOrNull(row.percentage_of_total_supply)
  const currentValue = finiteOrNull(row.total_current_value_usd)
  const cohortHoldings = finiteOrNull(root.total_holdings)

  return {
    ethHeld: live(ethHeld),
    supplyPct: live(supplyPct),
    ethValueUsd: live(currentValue),
    entryValueUsd: live(
      reportedOrNull(row.total_entry_value_usd),
      'CoinGecko reports 0 here for BitMine, which means undisclosed rather than zero.',
    ),
    impliedEthPrice: live(ratio(currentValue, ethHeld)),
    impliedEthSupply: live(
      ratio(ethHeld, ratio(supplyPct, 100)),
      'Derived from a percentage rounded to two decimals; good to about three significant figures.',
    ),
    cohort: {
      companyCount: Array.isArray(root.companies) ? root.companies.length : 0,
      totalHoldings: cohortHoldings,
      totalValueUsd: finiteOrNull(root.total_value_usd),
      marketCapDominancePct: finiteOrNull(root.market_cap_dominance),
      bmnrShareOfCohortPct: pctOf(ethHeld, cohortHoldings),
    },
  }
}

/* ------------------------------------------------------------ filed parsing */

export interface BmnrSecInput {
  cik: string
  facts: Record<string, unknown>
  filings: SecFiling[]
  freshness: SecFreshness
  cacheAgeSeconds: number
  warnings: string[]
}

function filedSource(quarter: { form: string; filedDate: string } | null): string {
  if (!quarter) return 'SEC EDGAR'
  return quarter.filedDate ? `SEC ${quarter.form} filed ${quarter.filedDate}` : `SEC ${quarter.form}`
}

/**
 * Which balance-sheet dates become quarters.
 *
 * Anchored on `Assets`, then cut to the **treasury** era: the first quarter where crypto is
 * at least `BMNR_TREASURY_ERA_MIN_SHARE` of total assets.
 *
 * Cutting at the first quarter carrying any crypto fact is not enough. BitMine tagged small
 * bitcoin-mining balances from 2022 — 0.2% to 3.3% of assets — while it was a shell with a
 * few million dollars of assets and a share count on the far side of a reverse split that
 * XBRL does not restate. Those quarters put a 2,495-share row and a 113x step into the
 * dilution table, reporting a corporate transformation as accretion arithmetic. The
 * materiality cut separates the two eras cleanly: the mining years never exceed 3.3% and
 * the treasury quarters never drop below 89%.
 */
function quarterDates(facts: Record<string, unknown>): string[] {
  const assets = selectInstantFacts(facts, [...BMNR_FACT_LADDERS.totalAssets.tags], [...BMNR_FACT_LADDERS.totalAssets.units])
  const crypto = selectInstantFacts(facts, [...BMNR_FACT_LADDERS.cryptoFairValue.tags], [...BMNR_FACT_LADDERS.cryptoFairValue.units])
  const units = selectInstantFacts(facts, [...BMNR_FACT_LADDERS.ethUnits.tags], [...BMNR_FACT_LADDERS.ethUnits.units])

  const all = [...new Set([...assets.keys(), ...crypto.keys(), ...units.keys()])].sort()
  const firstMaterial = all.find((date) => {
    const share = ratio(crypto.get(date)?.val ?? null, assets.get(date)?.val ?? null)
    return share !== null && share >= BMNR_TREASURY_ERA_MIN_SHARE
  })
  // No material crypto quarter at all: fall back to the most recent quarters rather than
  // returning nothing, so a filer without the tags still renders a balance-sheet history.
  const dates = firstMaterial ? all.filter((date) => date >= firstMaterial) : all
  return dates.slice(-BMNR_MAX_QUARTERS)
}

export function buildFiledTreasury(input: BmnrSecInput): BmnrFiledTreasury {
  const { facts } = input
  const read = (key: keyof typeof BMNR_FACT_LADDERS, endDate: string): SelectedBmnrFact | null => {
    const ladder = BMNR_FACT_LADDERS[key]
    return factAt(facts, [...ladder.tags], [...ladder.units], endDate)
  }

  const quarters: BmnrFiledQuarter[] = quarterDates(facts).map((endDate) => {
    const anchor = read('totalAssets', endDate) ?? read('ethUnits', endDate) ?? read('cryptoFairValue', endDate)
    const ethUnits = read('ethUnits', endDate)
    const components: Record<string, number> = {}
    for (const entry of BMNR_COMPONENT_LADDER) {
      const fact = factAt(facts, entry.tags, USD, endDate)
      if (fact) components[fact.tag] = fact.val
    }
    // The fiscal period is derived from the date, never from the winning fact's own
    // `fy`/`fp` — those describe the filing it was found in, not the period it measures.
    const fiscal = bmnrFiscalPeriod(endDate)
    return {
      endDate,
      label: bmnrQuarterLabel(endDate),
      form: anchor?.form ?? '',
      fiscalYear: fiscal.fiscalYear,
      fiscalPeriod: fiscal.fiscalPeriod,
      filedDate: anchor?.filed ?? '',
      accession: anchor?.accession ?? '',
      ethUnits: ethUnits?.val ?? null,
      ethUnitsUnit: ethUnits?.unit ?? '',
      cryptoFairValue: read('cryptoFairValue', endDate)?.val ?? null,
      cryptoCost: read('cryptoCost', endDate)?.val ?? null,
      cash: read('cash', endDate)?.val ?? null,
      totalAssets: read('totalAssets', endDate)?.val ?? null,
      liabilities: read('liabilities', endDate)?.val ?? null,
      stockholdersEquity: read('stockholdersEquity', endDate)?.val ?? null,
      stockholdersEquityInclNci: read('stockholdersEquityInclNci', endDate)?.val ?? null,
      minorityInterest: read('minorityInterest', endDate)?.val ?? null,
      sharesOutstanding: read('sharesOutstanding', endDate)?.val ?? null,
      components,
    }
  })

  const latest = quarters.length ? quarters[quarters.length - 1] : null
  const cover = latestFact(facts, [...BMNR_FACT_LADDERS.coverShares.tags], [...BMNR_FACT_LADDERS.coverShares.units])

  return {
    cik: input.cik,
    quarters,
    latest,
    coverShares: cover
      ? bmnrValue(
          cover.val,
          cover.end,
          filedSource({ form: cover.form, filedDate: cover.filed }),
          'filed',
          'Cover-page count, dated after the balance sheet it ships with.',
        )
      : emptyValue('filed'),
    freshness: input.freshness,
    cacheAgeSeconds: input.cacheAgeSeconds,
    warnings: input.warnings,
  }
}

/* ------------------------------------------------------------- composition */

/**
 * The asset composition at the latest filed date, anchored on the residual.
 *
 * A tag list alone does not work: at 2026-05-31 BMNR tags six of the eight components in
 * `BMNR_COMPONENT_LADDER` and the named lines fall $291.9M short of `Assets`. Taking total
 * assets as the truth and letting the unnamed remainder be its own slice is what makes the
 * donut add up to the balance sheet rather than to whatever happened to be tagged.
 *
 * A *negative* residual means a tag was double-counted — the
 * `CryptoAssetFairValue`/`CryptoAssetFairValueNoncurrent` trap — so it raises
 * `overAllocated` instead of drawing a nonsense slice.
 */
export function buildComposition(quarter: BmnrFiledQuarter | null): BmnrComposition {
  if (!quarter) {
    return { asOf: '', totalAssets: null, slices: [], otherSlices: [], otherTotal: null, overAllocated: false }
  }
  const totalAssets = quarter.totalAssets
  const named: BmnrHoldingSlice[] = []
  const push = (label: string, tag: string, value: number | null): void => {
    if (value === null) return
    named.push({ label, tag, value, sharePct: pctOf(value, totalAssets) })
  }

  push(BMNR_CRYPTO_SLICE_LABEL, 'CryptoAssetFairValue', quarter.cryptoFairValue)
  push(BMNR_CASH_SLICE_LABEL, 'CashAndCashEquivalentsAtCarryingValue', quarter.cash)
  for (const entry of BMNR_COMPONENT_LADDER) {
    const tag = entry.tags.find((candidate) => candidate in quarter.components)
    if (tag) push(entry.label, tag, quarter.components[tag])
  }

  const namedTotal = presentSum(named.map((slice) => slice.value))
  const residual = diff(totalAssets, namedTotal)
  const overAllocated = residual !== null && residual < 0

  const slices = [...named]
  if (residual !== null && residual > 0) {
    slices.push({
      label: BMNR_RESIDUAL_SLICE_LABEL,
      tag: 'residual',
      value: residual,
      sharePct: pctOf(residual, totalAssets),
    })
  }

  const otherSlices = slices.filter(
    (slice) => slice.label !== BMNR_CRYPTO_SLICE_LABEL && slice.label !== BMNR_CASH_SLICE_LABEL,
  )
  return {
    asOf: quarter.endDate,
    totalAssets,
    slices,
    otherSlices,
    otherTotal: presentSum(otherSlices.map((slice) => slice.value)),
    overAllocated,
  }
}

/* ----------------------------------------------------------------- history */

/**
 * Quarter-over-quarter ETH accumulation against share issuance.
 *
 * Both series are rebased to 100 at the **same** quarter — the first one carrying an ETH
 * per-share figure — rather than each at its own first non-null point. Rebasing them
 * separately would put the two curves on incomparable bases and make the comparison the
 * chart exists for meaningless.
 */
export function buildHistory(quarters: BmnrFiledQuarter[]): BmnrQuarterPoint[] {
  const perShare = quarters.map((quarter) => times(ratio(quarter.ethUnits, quarter.sharesOutstanding), 1000))
  const baseIndex = perShare.findIndex((value) => value !== null)
  const shareBase = baseIndex >= 0 ? quarters[baseIndex].sharesOutstanding : null
  const ethBase = baseIndex >= 0 ? perShare[baseIndex] : null

  return quarters.map((quarter, index) => {
    const previous = index > 0 ? quarters[index - 1] : null
    const qoqSharesPct = previous ? growthPct(quarter.sharesOutstanding, previous.sharesOutstanding) : null
    const qoqEthPct = previous ? growthPct(quarter.ethUnits, previous.ethUnits) : null
    const usable = baseIndex >= 0 && index >= baseIndex
    return {
      endDate: quarter.endDate,
      label: quarter.label,
      shares: quarter.sharesOutstanding,
      ethUnits: quarter.ethUnits,
      ethUnitsUnit: quarter.ethUnitsUnit,
      ethPer1000Shares: perShare[index],
      qoqSharesPct,
      qoqEthPct,
      accretionPct: diff(qoqEthPct, qoqSharesPct),
      sharesIndexed: usable ? times(ratio(quarter.sharesOutstanding, shareBase), 100) : null,
      ethPerShareIndexed: usable ? times(ratio(perShare[index], ethBase), 100) : null,
    }
  })
}

/* ------------------------------------------------------------- derived set */

export interface BmnrMarketInput {
  sharePrice: number | null
  shareChangePct: number | null
  marketCap: number | null
  ethPrice: number | null
  ethChangePct: number | null
}

export function buildMarket(input: BmnrMarketInput, fetchedAt: string, ethFallback: BmnrValue | null): BmnrMarket {
  const source = 'Yahoo Finance'
  const live = (value: number | null, note?: string): BmnrValue => bmnrValue(value, fetchedAt, source, 'live', note)
  // Yahoo's ETH-USD quote, or CoinGecko's own implied price when that call failed. The
  // note is attached only when a fallback actually supplied a number — claiming CoinGecko
  // answered when nothing did would be its own small lie.
  const fallback = ethFallback?.value ?? null
  const ethPrice = input.ethPrice !== null
    ? live(input.ethPrice)
    : fallback !== null
      ? bmnrValue(fallback, fetchedAt, 'CoinGecko', 'live',
          'Yahoo ETH-USD was unavailable; CoinGecko implied price used.')
      : live(null)
  return {
    sharePrice: live(input.sharePrice),
    shareChangePct: live(input.shareChangePct),
    marketCap: live(input.marketCap),
    ethPrice,
    ethChangePct: live(input.ethChangePct),
    impliedShares: bmnrValue(
      ratio(input.marketCap, input.sharePrice),
      fetchedAt,
      'derived',
      'live',
      'Market cap over share price. Shown for comparison only; never used as a denominator when a filed count exists.',
    ),
  }
}

export function buildDerived(
  live: BmnrLiveTreasury | null,
  filed: BmnrFiledTreasury | null,
  market: BmnrMarket,
): BmnrDerived {
  const quarter = filed?.latest ?? null
  const filedStamp = quarter?.endDate ?? ''
  const filedFrom = filedSource(quarter)
  const liveStamp = live?.ethHeld.asOf ?? ''

  const asFiled = (value: number | null, note?: string): BmnrValue =>
    bmnrValue(value, filedStamp, filedFrom, 'filed', note)
  const asCross = (value: number | null, note?: string): BmnrValue =>
    bmnrValue(value, filedStamp, `live × ${filedFrom}`, 'cross', note)

  // The cover-page count wins: BMNR issued roughly 24M shares (4.1%) between the
  // 2026-05-31 balance sheet and its 2026-07-09 cover date, and every per-share figure
  // would overstate by that much on the older count. The balance-sheet count and Yahoo's
  // implied count both stay on the payload beside it; none of the three is averaged.
  const coverShares = filed?.coverShares.value ?? null
  const sheetShares = quarter?.sharesOutstanding ?? null
  const sharesValue = coverShares ?? sheetShares ?? market.impliedShares.value
  const shares = coverShares !== null
    ? bmnrValue(coverShares, filed?.coverShares.asOf ?? '', filed?.coverShares.source ?? filedFrom, 'filed',
        'Cover-page count, the most recent share figure BMNR has filed.')
    : sheetShares !== null
      ? asFiled(sheetShares, 'Balance-sheet count; no later cover-page figure was filed.')
      : bmnrValue(market.impliedShares.value, market.impliedShares.asOf, 'derived', 'live',
          'Implied from Yahoo market cap; no filed share count was available.')

  const ethHeld = live?.ethHeld.value ?? null
  const ethPrice = market.ethPrice.value
  const cryptoValue = times(ethHeld, ethPrice)
  const otherAssets = diff(diff(quarter?.totalAssets ?? null, quarter?.cryptoFairValue ?? null), quarter?.cash ?? null)

  // NAV takes the last filed parent-only equity and marks the crypto book to the live
  // price. Three inputs rather than five, non-controlling interest excluded by
  // construction rather than by a MinorityInterest subtraction most quarters never tag,
  // and it is what "mark-to-market NAV" actually means. `navBuildUp` reconstructs the same
  // figure from the asset side; on real data the gap between them is exactly the minority
  // interest, which the page shows as a live correctness check.
  const nav = add(quarter?.stockholdersEquity ?? null, diff(cryptoValue, quarter?.cryptoFairValue ?? null))
  const navBuildUp = diff(add(add(cryptoValue, quarter?.cash ?? null), otherAssets), quarter?.liabilities ?? null)
  const mnav = ratio(market.marketCap.value, nav)
  const ethPerShare = ratio(ethHeld, sharesValue)
  const impliedGrossCostPerEth = ratio(quarter?.cryptoCost ?? null, quarter?.ethUnits ?? null)

  return {
    shares,
    cryptoValue: bmnrValue(cryptoValue, liveStamp, 'derived', 'live'),
    otherAssets: asFiled(otherAssets),
    nav: asCross(nav, 'Crypto marked to the live price; cash, other assets and liabilities are as last filed.'),
    navBuildUp: asCross(navBuildUp),
    navReconciliationGap: asCross(diff(navBuildUp, nav)),
    navPerShare: asCross(ratio(nav, sharesValue)),
    mnav: asCross(mnav),
    premiumPct: asCross(mnav === null ? null : (mnav - 1) * 100),
    ethPerShare: asCross(ethPerShare),
    ethPer1000Shares: asCross(times(ethPerShare, 1000)),
    ethValuePerShare: asCross(times(ethPerShare, ethPrice)),
    impliedGrossCostPerEth: asFiled(
      impliedGrossCostPerEth,
      'Cumulative gross purchases per unit, including ETH since sold. Not the cost basis of the ETH still held.',
    ),
    filedCarryingValuePerEth: asFiled(ratio(quarter?.cryptoFairValue ?? null, quarter?.ethUnits ?? null)),
    costVsSpotPct: asCross(growthPct(ethPrice, impliedGrossCostPerEth)),
    cryptoShareOfAssetsPct: asFiled(pctOf(quarter?.cryptoFairValue ?? null, quarter?.totalAssets ?? null)),
    cashShareOfAssetsPct: asFiled(pctOf(quarter?.cash ?? null, quarter?.totalAssets ?? null)),
    otherShareOfAssetsPct: asFiled(pctOf(otherAssets, quarter?.totalAssets ?? null)),
    unfiledEth: asCross(diff(ethHeld, quarter?.ethUnits ?? null)),
    unfiledEthPct: asCross(pctOf(diff(ethHeld, quarter?.ethUnits ?? null), quarter?.ethUnits ?? null)),
    filedSupplyPct: asCross(pctOf(quarter?.ethUnits ?? null, live?.impliedEthSupply.value ?? null)),
    shareCountGap: asFiled(diff(coverShares, sheetShares)),
    shareCountGapPct: asFiled(pctOf(diff(coverShares, sheetShares), sheetShares)),
  }
}

export function buildSensitivity(
  live: BmnrLiveTreasury | null,
  filed: BmnrFiledTreasury | null,
  market: BmnrMarket,
  shares: number | null,
): BmnrSensitivityRow[] {
  const quarter = filed?.latest ?? null
  const ethHeld = live?.ethHeld.value ?? null
  // Sensitivity assumes the market continues to value BMNR at today's mNAV multiple.
  // Previously this ladder held market cap fixed, which mechanically made mNAV fall as
  // ETH rose and obscured the assumption the page is meant to communicate.
  const currentNav = add(
    quarter?.stockholdersEquity ?? null,
    diff(times(ethHeld, market.ethPrice.value), quarter?.cryptoFairValue ?? null),
  )
  const currentMnav = ratio(market.marketCap.value, currentNav)
  const currentPremiumPct = currentMnav === null ? null : (currentMnav - 1) * 100
  return BMNR_ETH_SHOCKS.map((shockPct) => {
    const ethPrice = times(market.ethPrice.value, 1 + shockPct / 100)
    const nav = add(quarter?.stockholdersEquity ?? null, diff(times(ethHeld, ethPrice), quarter?.cryptoFairValue ?? null))
    return {
      shockPct,
      ethPrice,
      navPerShare: ratio(nav, shares),
      mnav: currentMnav,
      premiumPct: currentPremiumPct,
    }
  })
}

/* ----------------------------------------------------------- page assembly */

export interface BmnrBuildInput {
  fetchedAt: string
  /** Raw CoinGecko treasury body, or null when that lane failed. */
  treasuryBody: unknown
  /** Raw SEC document, or null when that lane failed. */
  sec: BmnrSecInput | null
  market: BmnrMarketInput
}

export function buildBmnrPayload(input: BmnrBuildInput): BmnrPayload {
  const live = input.treasuryBody === null ? null : parseLiveTreasury(input.treasuryBody, input.fetchedAt)
  const filed = input.sec ? buildFiledTreasury(input.sec) : null
  const market = buildMarket(input.market, input.fetchedAt, live?.impliedEthPrice ?? null)
  const derived = buildDerived(live, filed, market)
  // Read off the raw Yahoo inputs, not off `market`: an ETH price that fell back to
  // CoinGecko would otherwise report the Yahoo lane as healthy when it is not.
  const hasMarket = input.market.sharePrice !== null || input.market.ethPrice !== null

  const progress: Record<BmnrBlock, BmnrBlockStatus> = {
    treasury: live ? 'loaded' : 'unavailable',
    filings: filed?.latest ? 'loaded' : 'unavailable',
    market: hasMarket ? 'loaded' : 'unavailable',
  }

  return {
    fetchedAt: input.fetchedAt,
    symbol: BMNR_SYMBOL,
    companyName: 'BitMine Immersion Technologies, Inc.',
    live,
    filed,
    market,
    derived,
    composition: buildComposition(filed?.latest ?? null),
    history: buildHistory(filed?.quarters ?? []),
    sensitivity: buildSensitivity(live, filed, market, derived.shares.value),
    filings: input.sec?.filings ?? [],
    progress,
  }
}

/** Refresh the selected equity mark while retaining the filed/treasury observations. */
export function markBmnrPayload(payload: BmnrPayload, quote: Quote): BmnrPayload {
  const asOf = new Date(quote.asOf ?? Date.now()).toISOString()
  const source = quote.source ?? 'Yahoo Finance'
  const market = { ...payload.market,
    sharePrice: bmnrValue(quote.price, asOf, source, 'live', quote.priceBasis === 'equity-perp-mark' ? 'Equity-perpetual mark, not a stock-exchange trade.' : undefined),
    shareChangePct: bmnrValue(quote.change, asOf, source, 'live', quote.changeBasis === '24h' ? '24-hour perpetual mark change.' : 'Change against previous stock close.'),
    impliedShares: bmnrValue(ratio(payload.market.marketCap.value, quote.price), asOf, 'derived', 'cross',
      'Yahoo stock market cap divided by the selected price. Comparison only; filed share counts remain the preferred denominator.'),
  }
  const derived = buildDerived(payload.live, payload.filed, market)
  return { ...payload, market, derived,
    sensitivity: buildSensitivity(payload.live, payload.filed, market, derived.shares.value) }
}

export function emptyBmnrPayload(fetchedAt = ''): BmnrPayload {
  return buildBmnrPayload({
    fetchedAt,
    treasuryBody: null,
    sec: null,
    market: { sharePrice: null, shareChangePct: null, marketCap: null, ethPrice: null, ethChangePct: null },
  })
}

/* -------------------------------------------------------------- clipboard */

function line(label: string, cell: BmnrValue, digits = 2): string {
  const printed = cell.value === null ? '--' : cell.value.toLocaleString('en-US', { maximumFractionDigits: digits })
  const stamp = cell.asOf ? ` (${cell.basis}, ${cell.asOf})` : ` (${cell.basis})`
  return `${label}: ${printed}${stamp}`
}

/** The Export button's text, on the `buildCryptoSnapshot` precedent. */
export function buildBmnrSnapshot(payload: BmnrPayload): string {
  const rows: string[] = [
    `${payload.symbol} - ${payload.companyName}`,
    `Generated ${payload.fetchedAt}`,
    '',
  ]
  if (payload.live) {
    rows.push(
      line('ETH held (live)', payload.live.ethHeld, 0),
      line('Percent of ETH supply', payload.live.supplyPct, 2),
      line('ETH value USD', payload.live.ethValueUsd, 0),
    )
  } else rows.push('ETH held (live): unavailable')
  if (payload.filed?.latest) {
    const quarter = payload.filed.latest
    rows.push(
      '',
      `Filed basis: ${quarter.label} (${quarter.form} filed ${quarter.filedDate})`,
      `  ETH units: ${quarter.ethUnits?.toLocaleString('en-US') ?? '--'} [unit ${quarter.ethUnitsUnit || 'n/a'}]`,
      `  Crypto carrying value: ${quarter.cryptoFairValue?.toLocaleString('en-US') ?? '--'}`,
      `  Cash: ${quarter.cash?.toLocaleString('en-US') ?? '--'}`,
      `  Total assets: ${quarter.totalAssets?.toLocaleString('en-US') ?? '--'}`,
      `  Shares outstanding: ${quarter.sharesOutstanding?.toLocaleString('en-US') ?? '--'}`,
    )
  } else rows.push('', 'Filed basis: unavailable')
  rows.push(
    '',
    line('NAV', payload.derived.nav, 0),
    line('NAV per share', payload.derived.navPerShare, 2),
    line('mNAV', payload.derived.mnav, 3),
    line('Premium / (discount) %', payload.derived.premiumPct, 2),
    line('ETH per 1,000 shares', payload.derived.ethPer1000Shares, 3),
    line('Shares used', payload.derived.shares, 0),
  )
  if (payload.composition.otherSlices.length) {
    rows.push('', `Other holdings (${payload.composition.asOf})`)
    for (const slice of payload.composition.otherSlices) {
      rows.push(`  ${slice.label}: ${slice.value.toLocaleString('en-US')} (${slice.sharePct?.toFixed(2) ?? '--'}%)`)
    }
  }
  return rows.join('\n')
}
