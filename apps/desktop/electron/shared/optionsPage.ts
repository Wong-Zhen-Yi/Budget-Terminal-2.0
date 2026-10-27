/**
 * The Options page's pure layer, shared by the main process, the renderer and the probe.
 *
 * Ported from `mixins/options_chain.py`, `mixins/options_chain_presenters.py` and
 * `services/options_analysis.py` in the PySide6 app. Everything here is deterministic:
 * the Black-Scholes Greeks and the implied-vol solve, the covered-call and
 * cash-secured-put scoring, the expiration ordering, the two summary-table record
 * builders, the highlight ranking and the two Markdown exports. No Electron, no React.
 */

/* ------------------------------------------------------------------- types */

export type OptionType = 'Call' | 'Put'

/** One contract as Yahoo quotes it, before any Greeks are added. */
export interface OptionsRawRow {
  ticker: string
  type: OptionType
  strike: number
  expiration: string
  lastPrice: number
  bid: number
  ask: number
  change: number
  volume: number
  openInterest: number
  impliedVolatility: number
  inTheMoney: boolean
  /** US options-market date of Yahoo's last trade, used only by Projections fallback pricing. */
  lastTradeDate?: string
}

/** A chain row after `_p5_enrich_chain`: IV backfilled, Greeks attached. */
export interface OptionsChainRow extends OptionsRawRow {
  ivPercent: number
  delta: number | null
  gamma: number | null
  theta: number | null
  vega: number | null
  rho: number | null
  greeksValid: boolean
}

/** One expiration the strike and top-volume grids build a panel for. */
export interface OptionsExpirationBucket {
  expiry: string
  /** Days from today (US options market date) to the expiration. */
  daysOut: number
  rows: OptionsRawRow[]
}

/** Compact research ranking computed from the complete sweep before MCP projection. */
export interface OptionsVolumeRanking {
  rows: OptionsRawRow[]
  limit: number
  totalContracts: number
  contractsWithVolume: number
  expirationsRequested: number
  expirationsLoaded: number
  failedExpirations: string[]
}

export type OptionsTypeFilter = 'both' | 'calls' | 'puts'
export type OptionsStrategy = 'None' | 'Covered Call' | 'Cash Secured Put'

/* --------------------------------------------------------------- constants */

export interface ChainColumn {
  label: string
  key: keyof OptionsChainRow
  decimals: number
  signed?: boolean
  grouped?: boolean
  suffix?: string
}

/** `_P5_CHAIN_COLUMNS`: label, payload key, and the format the cell prints in. */
export const CHAIN_COLUMNS: readonly ChainColumn[] = [
  { label: 'Strike', key: 'strike', decimals: 1 },
  { label: 'Last', key: 'lastPrice', decimals: 2 },
  { label: 'Bid', key: 'bid', decimals: 2 },
  { label: 'Ask', key: 'ask', decimals: 2 },
  { label: 'Chg', key: 'change', decimals: 2, signed: true },
  { label: 'Vol', key: 'volume', decimals: 0, grouped: true },
  { label: 'OI', key: 'openInterest', decimals: 0, grouped: true },
  { label: 'IV', key: 'ivPercent', decimals: 1, suffix: '%' },
  { label: 'Delta', key: 'delta', decimals: 3 },
  { label: 'Gamma', key: 'gamma', decimals: 3 },
  { label: 'Theta', key: 'theta', decimals: 3 },
  { label: 'Vega', key: 'vega', decimals: 3 },
  { label: 'Rho', key: 'rho', decimals: 3 },
]

export const OPTIONS_STRATEGIES: readonly OptionsStrategy[] = [
  'None',
  'Covered Call',
  'Cash Secured Put',
]

export const OPTIONS_TYPE_FILTERS: ReadonlyArray<{
  key: OptionsTypeFilter
  label: string
  type: OptionType | null
}> = [
  { key: 'both', label: 'Both', type: null },
  { key: 'calls', label: 'Calls', type: 'Call' },
  { key: 'puts', label: 'Puts', type: 'Put' },
]

/** `_P5_TOP_VOLUME_COLUMNS`, the six-column summary the other two tabs share. */
export const SUMMARY_COLUMNS = ['Ticker', 'Type', 'Strike', 'Exp', 'Price', 'Vol'] as const

/** The reference's summary tables take `head(10)` of each expiration. */
export const TOP_VOLUME_LIMIT = 10

export const STRATEGY_MIN_OI = 25
export const STRATEGY_MIN_VOLUME = 0
export const STRATEGY_MAX_SPREAD_RATIO = 0.6
export const CC_DELTA_TARGET = 0.275
export const CSP_DELTA_TARGET = 0.225
export const CC_DELTA_BAND: readonly [number, number] = [0.15, 0.4]
export const CSP_DELTA_BAND: readonly [number, number] = [0.12, 0.35]

/** `_P5_STRIKE_MATCH_TOLERANCE`: strikes are floats, so equality is a window. */
export const STRIKE_MATCH_TOLERANCE = 0.0001

/** `load_options_chain_settings`'s `default_risk_free_rate`, used when ^IRX fails. */
export const DEFAULT_RISK_FREE_RATE = 0.04

/* ------------------------------------------------------- market date rules */

const ET_ZONE = 'America/New_York'
const ET_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: ET_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** `OPTIONS_REGULAR_CLOSE_TIME`, 16:00 New York. */
const REGULAR_CLOSE_MINUTES = 16 * 60

function etNow(now: Date): { date: string; minutes: number } {
  const parts = ET_PARTS.formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '0'
  // `hour12: false` renders midnight as 24 in some ICU builds; normalise it back to 0.
  const hour = Number(get('hour')) % 24
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + Number(get('minute')),
  }
}

/** `_p5_current_options_market_date`: today's ISO date in the US options market. */
export function optionsMarketDate(now: Date = new Date()): string {
  return etNow(now).date
}

/**
 * `is_options_expiry_closed`. An expiry dies when the regular session it settles in
 * ends, not at the next local midnight — comparing against the machine's own date
 * leaves a closed expiry in the dropdown for a whole evening in Asia, and the chain
 * behind it comes back empty.
 */
export function isOptionsExpiryClosed(expiry: string, now: Date = new Date()): boolean {
  const text = String(expiry ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const market = etNow(now)
  if (text !== market.date) return text < market.date
  return market.minutes >= REGULAR_CLOSE_MINUTES
}

/** `_p5_filter_live_expiries`: unique, open or future, in source order. */
export function filterLiveExpiries(expiries: readonly string[], now: Date = new Date()): string[] {
  const seen = new Set<string>()
  const live: string[] = []
  for (const raw of expiries ?? []) {
    const text = String(raw ?? '').trim()
    if (!text || seen.has(text) || isOptionsExpiryClosed(text, now)) continue
    seen.add(text)
    live.push(text)
  }
  return live
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Whole days from the market's today to an ISO expiry, floored at zero. */
export function daysToExpiry(expiry: string, now: Date = new Date()): number {
  const target = Date.parse(`${expiry}T00:00:00Z`)
  const today = Date.parse(`${optionsMarketDate(now)}T00:00:00Z`)
  if (!Number.isFinite(target) || !Number.isFinite(today)) return 0
  return Math.max(0, Math.round((target - today) / MS_PER_DAY))
}

/**
 * `_p5_build_dynamic_top_volume_bucket_config`: every live expiration, ascending, each
 * carrying its own days-out. The grid has one panel per entry — the reference dropped
 * the fixed week-offset buckets when the tab went dynamic, so nothing here selects a
 * "nearest" expiry any more.
 */
export function buildExpirationOrder(
  expiries: readonly string[],
  now: Date = new Date(),
): Array<{ expiry: string; daysOut: number }> {
  return filterLiveExpiries(expiries, now)
    .filter((expiry) => /^\d{4}-\d{2}-\d{2}$/.test(expiry))
    .sort()
    .map((expiry) => ({ expiry, daysOut: daysToExpiry(expiry, now) }))
}

/* -------------------------------------------------------------- formatting */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** `format_top_volume_expiration`: `2025-01-17` -> `JAN 17 '25`. */
export function formatExpiration(expiry: string): string {
  const text = String(expiry ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return text
  const [, year, month, day] = match
  const monthIndex = Number(month) - 1
  if (monthIndex < 0 || monthIndex > 11) return text
  return `${MONTHS[monthIndex]} ${Number(day)} '${year.slice(2)}`
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined || !Number.isFinite(Number(value))
}

/** `format_chain_value`: a missing or non-numeric cell prints empty, never `nan`. */
export function formatChainValue(value: unknown, column: ChainColumn): string {
  if (isMissing(value)) return ''
  const numeric = Number(value)
  const body = column.grouped
    ? numeric.toLocaleString('en-US', {
        minimumFractionDigits: column.decimals,
        maximumFractionDigits: column.decimals,
      })
    : numeric.toFixed(column.decimals)
  const sign = column.signed && numeric >= 0 ? '+' : ''
  return `${sign}${body}${column.suffix ?? ''}`
}

/** `_format_strike`. */
export function formatStrike(value: unknown): string {
  return isMissing(value) ? '' : Number(value).toFixed(1)
}

/** `_format_price`. */
export function formatOptionPrice(value: unknown): string {
  return isMissing(value) ? '' : Number(value).toFixed(2)
}

/** `_format_volume`: a missing volume prints `0`, not blank. */
export function formatOptionVolume(value: unknown): string {
  const numeric = Number(value)
  if (value === null || value === undefined || !Number.isFinite(numeric)) return '0'
  return Math.trunc(numeric).toLocaleString('en-US')
}

/** The `YYYY-MM-DD (Nd)` label `_p5_populate_expiries` puts in the expiry dropdown. */
export function expiryOptionLabel(expiry: string, now: Date = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return expiry
  return `${expiry} (${daysToExpiry(expiry, now)}d)`
}

/** The strike dropdown's label: one decimal where that is exact, `%g` otherwise. */
export function formatStrikeOption(strike: number): string {
  return strike === Number(strike.toFixed(1)) ? strike.toFixed(1) : String(strike)
}

/* ------------------------------------------------- Black-Scholes machinery */

/**
 * `statistics.NormalDist().cdf`, to double precision.
 *
 * Hart's rational approximation rather than a short series: the implied-vol solve is a
 * Newton iteration on this function and the Greeks print to three decimals, so a 1e-7
 * approximation is visible in the last digit against the reference.
 */
export function normalCdf(x: number): number {
  const z = Math.abs(x)
  let upper = 0
  if (z <= 37) {
    const density = Math.exp((-z * z) / 2)
    if (z < 7.07106781186547) {
      let numerator = 3.52624965998911e-2 * z + 0.700383064443688
      numerator = numerator * z + 6.37396220353165
      numerator = numerator * z + 33.912866078383
      numerator = numerator * z + 112.079291497871
      numerator = numerator * z + 221.213596169931
      numerator = numerator * z + 220.206867912376
      let denominator = 8.83883476483184e-2 * z + 1.75566716318264
      denominator = denominator * z + 16.064177579207
      denominator = denominator * z + 86.7807322029461
      denominator = denominator * z + 296.564248779674
      denominator = denominator * z + 637.333633378831
      denominator = denominator * z + 793.826512519948
      denominator = denominator * z + 440.413735824752
      upper = (density * numerator) / denominator
    } else {
      const fraction = z + 1 / (z + 2 / (z + 3 / (z + 4 / (z + 0.65))))
      upper = density / (fraction * 2.506628274631)
    }
  }
  return x > 0 ? 1 - upper : upper
}

export function normalPdf(x: number): number {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)
}

/**
 * `_option_time`: whole days to expiry over 365, and never zero — an expiry that is
 * today prices as one day out rather than dividing by nothing.
 */
function optionTime(expiry: string, now: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiry ?? '').trim())) return null
  const days = daysToExpiry(expiry, now)
  return days / 365 || 1 / 365
}

const clampRate = (value: number) => Math.min(Math.max(Number(value) || 0, 0), 1)

/**
 * `implied_volatility`: 30 Newton steps from a 0.3 seed, sigma clamped to [0.001, 10].
 * A row that does not converge returns 0, which is what leaves its IV blank.
 */
export function impliedVolatility(
  spot: number,
  strike: number,
  expiry: string,
  riskFreeRate: number,
  dividendYield: number,
  marketPrice: number,
  optionType: 'call' | 'put',
  now: Date = new Date(),
): number {
  if (marketPrice <= 0 || spot <= 0 || strike <= 0) return 0
  if (optionType !== 'call' && optionType !== 'put') return 0
  const time = optionTime(expiry, now)
  if (time === null) return 0
  const rate = clampRate(riskFreeRate)
  const dividend = clampRate(dividendYield)
  const discountedDividend = Math.exp(-dividend * time)
  const discountedRate = Math.exp(-rate * time)
  const sqrtTime = Math.sqrt(time)
  let sigma = 0.3
  for (let step = 0; step < 30; step += 1) {
    const denominator = sigma * sqrtTime
    if (denominator <= 0) return 0
    const d1 =
      (Math.log(spot / strike) + (rate - dividend + 0.5 * sigma * sigma) * time) / denominator
    const d2 = d1 - denominator
    const price =
      optionType === 'call'
        ? spot * discountedDividend * normalCdf(d1) - strike * discountedRate * normalCdf(d2)
        : strike * discountedRate * normalCdf(-d2) - spot * discountedDividend * normalCdf(-d1)
    const vega = spot * discountedDividend * normalPdf(d1) * sqrtTime
    if (vega < 1e-12) break
    sigma = Math.max(0.001, Math.min(sigma - (price - marketPrice) / vega, 10))
    if (Math.abs(price - marketPrice) < 0.001) return sigma
  }
  return 0
}

export interface OptionGreeks {
  delta: number | null
  gamma: number | null
  theta: number | null
  vega: number | null
  rho: number | null
  greeksValid: boolean
}

export function emptyGreeks(): OptionGreeks {
  return { delta: null, gamma: null, theta: null, vega: null, rho: null, greeksValid: false }
}

/**
 * `calculate_greeks`. Theta is per day (the annual figure over 365) and vega and rho are
 * per percentage point (the raw sensitivity over 100), which is what makes a delta of
 * 0.412 sit beside a vega of 0.087 rather than 8.7 in the same row.
 */
export function calculateGreeks(
  spot: number,
  strike: number,
  expiry: string,
  volatility: number,
  optionType: 'call' | 'put',
  riskFreeRate: number,
  dividendYield: number,
  now: Date = new Date(),
): OptionGreeks {
  if (spot <= 0 || strike <= 0 || volatility <= 0) return emptyGreeks()
  if (optionType !== 'call' && optionType !== 'put') return emptyGreeks()
  const time = optionTime(expiry, now)
  if (time === null) return emptyGreeks()
  const sigma = Number(volatility)
  const sqrtTime = Math.sqrt(time)
  const denominator = sigma * sqrtTime
  if (denominator <= 0) return emptyGreeks()
  const rate = clampRate(riskFreeRate)
  const dividend = clampRate(dividendYield)
  const discountedDividend = Math.exp(-dividend * time)
  const discountedRate = Math.exp(-rate * time)
  const d1 =
    (Math.log(spot / strike) + (rate - dividend + 0.5 * sigma * sigma) * time) / denominator
  const d2 = d1 - denominator
  const density = normalPdf(d1)

  let delta: number
  let thetaYear: number
  let rho: number
  if (optionType === 'call') {
    delta = discountedDividend * normalCdf(d1)
    thetaYear =
      -(spot * discountedDividend * density * sigma) / (2 * sqrtTime) -
      rate * strike * discountedRate * normalCdf(d2) +
      dividend * spot * discountedDividend * normalCdf(d1)
    rho = (strike * time * discountedRate * normalCdf(d2)) / 100
  } else {
    delta = discountedDividend * (normalCdf(d1) - 1)
    thetaYear =
      -(spot * discountedDividend * density * sigma) / (2 * sqrtTime) +
      rate * strike * discountedRate * normalCdf(-d2) -
      dividend * spot * discountedDividend * normalCdf(-d1)
    rho = (-strike * time * discountedRate * normalCdf(-d2)) / 100
  }

  return {
    delta,
    gamma: (discountedDividend * density) / (spot * denominator),
    theta: thetaYear / 365,
    vega: (spot * discountedDividend * density * sqrtTime) / 100,
    rho,
    greeksValid: true,
  }
}

/**
 * `extract_dividend_yield`. Yahoo has published this field both as a fraction and as a
 * percentage, so anything above 1 is divided down before it reaches the Greeks.
 */
export function extractDividendYield(
  info: Record<string, unknown> | null | undefined,
): number | null {
  if (!info || typeof info !== 'object') return null
  for (const key of ['dividendYield', 'trailingAnnualDividendYield']) {
    const raw = Number(info[key])
    if (!Number.isFinite(raw) || raw < 0) continue
    const value = raw > 1 ? raw / 100 : raw
    return Math.min(Math.max(value, 0), 1)
  }
  return null
}

/**
 * `_p5_fetch_market_rate`: ^IRX quotes the 13-week bill in percent, so a reading above
 * 1 is a percentage and anything else is already a fraction.
 */
export function normalizeRiskFreeRate(raw: unknown): number | null {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.min(Math.max(value > 1 ? value / 100 : value, 0), 1)
}

/* ------------------------------------------------------------- enrichment */

/**
 * `_p5_enrich_chain`: fill an IV that Yahoo returned as zero from the row's own market
 * price, then attach the Greeks. Without the backfill every Greek column is blank
 * outside regular hours, which is when the page is most often open.
 */
export function enrichChain(
  rows: readonly OptionsRawRow[],
  expiry: string,
  spotPrice: number,
  riskFreeRate: number,
  dividendYield: number,
  now: Date = new Date(),
): OptionsChainRow[] {
  return rows.map((row) => {
    let iv = Number(row.impliedVolatility) || 0
    if (iv <= 0 && spotPrice > 0) {
      const price = row.bid > 0 && row.ask > 0 ? (row.bid + row.ask) / 2 : row.lastPrice
      const computed = impliedVolatility(
        spotPrice,
        row.strike,
        expiry,
        riskFreeRate,
        dividendYield,
        price,
        row.type === 'Call' ? 'call' : 'put',
        now,
      )
      if (computed > 0) iv = computed
    }
    const greeks = calculateGreeks(
      spotPrice,
      row.strike,
      expiry,
      iv,
      row.type === 'Call' ? 'call' : 'put',
      riskFreeRate,
      dividendYield,
      now,
    )
    return { ...row, impliedVolatility: iv, ivPercent: iv * 100, ...greeks }
  })
}

/* -------------------------------------------------------- summary records */

/** `prepare_top_volume_records`: type filter, then top ten by volume then open interest. */
export function topVolumeRecords(
  rows: readonly OptionsRawRow[],
  typeFilter: OptionsTypeFilter,
  limit = TOP_VOLUME_LIMIT,
): OptionsRawRow[] {
  const wanted = OPTIONS_TYPE_FILTERS.find((entry) => entry.key === typeFilter)?.type ?? null
  const filtered = wanted ? rows.filter((row) => row.type === wanted) : [...rows]
  return filtered
    .sort((a, b) => b.volume - a.volume || b.openInterest - a.openInterest)
    .slice(0, limit)
}

export function buildOptionsVolumeRanking(buckets: readonly OptionsExpirationBucket[], failedExpirations: readonly string[] = []): OptionsVolumeRanking {
  const failed = [...new Set(failedExpirations)]
  const contracts = buckets.filter(bucket => !failed.includes(bucket.expiry)).flatMap(bucket => bucket.rows)
  const withVolume = contracts.filter(row => Number.isFinite(row.volume) && row.volume > 0)
  const limit = 50
  return {
    rows: topVolumeRecords(withVolume, 'both', limit), limit,
    totalContracts: contracts.length, contractsWithVolume: withVolume.length,
    expirationsRequested: buckets.length,
    expirationsLoaded: buckets.filter(bucket => !failed.includes(bucket.expiry)).length,
    failedExpirations: failed,
  }
}

/**
 * `prepare_strike_records`: every contract at one strike, calls before puts, each side
 * ordered by volume then open interest.
 */
export function strikeRecords(
  rows: readonly OptionsRawRow[],
  selectedStrike: number,
  tolerance = STRIKE_MATCH_TOLERANCE,
): OptionsRawRow[] {
  return rows
    .filter((row) => Math.abs(row.strike - selectedStrike) <= tolerance)
    .sort(
      (a, b) =>
        (a.type === 'Call' ? 0 : 1) - (b.type === 'Call' ? 0 : 1) ||
        b.volume - a.volume ||
        b.openInterest - a.openInterest,
    )
}

/** The sorted union of every strike quoted across the fetched expirations. */
export function collectStrikes(buckets: readonly OptionsExpirationBucket[]): number[] {
  const strikes = new Set<number>()
  for (const bucket of buckets) {
    for (const row of bucket.rows) {
      if (Number.isFinite(row.strike)) strikes.add(row.strike)
    }
  }
  return [...strikes].sort((a, b) => a - b)
}

/**
 * `_p5_update_strike_values`' re-selection: after a reload the previously chosen strike
 * is kept only if the new list still quotes it, inside the same float tolerance.
 */
export function matchStrike(
  strikes: readonly number[],
  selected: number | null,
  tolerance = STRIKE_MATCH_TOLERANCE,
): number | null {
  if (selected === null || !Number.isFinite(selected)) return null
  return strikes.find((strike) => Math.abs(strike - selected) <= tolerance) ?? null
}

/**
 * `_summary_cell_backgrounds`: which rows carry the four highlights.
 *
 * Two ranks per highlight, strongest first. The lowest-price and lowest-volume ranks
 * explicitly exclude the rows the top ranks already claimed — in a two-row table the
 * same row is otherwise both the highest and the lowest.
 */
export interface SummaryHighlight {
  price?: { kind: 'top' | 'low'; rank: 0 | 1 }
  volume?: { kind: 'top' | 'low'; rank: 0 | 1 }
}

function rankedIndexes(
  records: readonly OptionsRawRow[],
  key: 'lastPrice' | 'volume',
  descending: boolean,
  excluded: ReadonlySet<number>,
): number[] {
  return records
    .map((record, index) => ({ index, value: Number(record[key]) }))
    .filter((entry) => !excluded.has(entry.index) && Number.isFinite(entry.value))
    .sort((a, b) => (descending ? b.value - a.value : a.value - b.value))
    .map((entry) => entry.index)
}

export function summaryHighlights(
  records: readonly OptionsRawRow[],
  depth = 2,
): SummaryHighlight[] {
  const highlights: SummaryHighlight[] = records.map(() => ({}))
  const none: ReadonlySet<number> = new Set<number>()

  const topPrice = rankedIndexes(records, 'lastPrice', true, none).slice(0, depth)
  const lowPrice = rankedIndexes(records, 'lastPrice', false, new Set(topPrice)).slice(0, depth)
  topPrice.forEach((index, rank) => {
    highlights[index].price = { kind: 'top', rank: rank as 0 | 1 }
  })
  lowPrice.forEach((index, rank) => {
    highlights[index].price = { kind: 'low', rank: rank as 0 | 1 }
  })

  const topVolume = rankedIndexes(records, 'volume', true, none).slice(0, depth)
  const lowVolume = rankedIndexes(records, 'volume', false, new Set(topVolume)).slice(0, depth)
  // Low first, then top: the reference paints the top ranks last, so they win a tie.
  lowVolume.forEach((index, rank) => {
    highlights[index].volume = { kind: 'low', rank: rank as 0 | 1 }
  })
  topVolume.forEach((index, rank) => {
    highlights[index].volume = { kind: 'top', rank: rank as 0 | 1 }
  })

  return highlights
}

/* -------------------------------------------------------- strategy scoring */

export interface StrategyDetail {
  strategy: OptionsStrategy
  rank: number
  score: number
  strike: number
  premium: number
  deltaAbs: number
  dte: number
  annualizedYield: number
  spreadRatio: number | null
  hasLiveSpread: boolean
  oi: number
  volume: number
  liquidityScore: number
  spreadScore: number
  greekStabilityScore: number
  deltaScore: number
  yieldScore: number
  upsideRoom?: number
  upsideScore?: number
  breakeven?: number
  breakevenDiscount?: number
  breakevenScore?: number
  rationale: string
}

/** `_p5_strategy_linear_score`: a value mapped into a capped 0-100 band. */
export function linearScore(value: number, low: number, high: number, inverse = false): number {
  if (!Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high)) return 0
  if (high <= low) return 0
  let normalized = (value - low) / (high - low)
  normalized = Math.max(0, Math.min(1, normalized))
  if (inverse) normalized = 1 - normalized
  return normalized * 100
}

/** `_p5_strategy_band_score`: proximity to a target, zero outside the band. */
export function bandScore(value: number, target: number, lower: number, upper: number): number {
  if (![value, target, lower, upper].every((entry) => Number.isFinite(entry))) return 0
  if (upper <= lower || value < lower || value > upper) return 0
  const radius = Math.max(target - lower, upper - target, 1e-9)
  return Math.max(0, (1 - Math.abs(value - target) / radius) * 100)
}

function describeCoveredCall(
  annualizedYield: number,
  upsideRoom: number,
  spreadRatio: number | null,
  oi: number,
  volume: number,
  hasLiveSpread: boolean,
): string {
  const spread =
    hasLiveSpread && spreadRatio !== null
      ? `${(spreadRatio * 100).toFixed(1)}% spread`
      : 'no live bid/ask spread'
  return (
    `Close to the ${CC_DELTA_TARGET.toFixed(3)} delta target, ` +
    `offers ${(annualizedYield * 100).toFixed(1)}% annualized yield, ` +
    `keeps ${(upsideRoom * 100).toFixed(1)}% upside room, ` +
    `with ${spread} and usable liquidity (OI ${oi.toFixed(0)}, Vol ${volume.toFixed(0)}).`
  )
}

function describeCashSecuredPut(
  annualizedYield: number,
  breakevenDiscount: number,
  spreadRatio: number | null,
  oi: number,
  volume: number,
  hasLiveSpread: boolean,
): string {
  const spread =
    hasLiveSpread && spreadRatio !== null
      ? `${(spreadRatio * 100).toFixed(1)}% spread`
      : 'no live bid/ask spread'
  return (
    `Close to the ${CSP_DELTA_TARGET.toFixed(3)} delta target, ` +
    `offers ${(annualizedYield * 100).toFixed(1)}% annualized yield, ` +
    `improves entry by ${(breakevenDiscount * 100).toFixed(1)}% to break-even, ` +
    `with ${spread} and usable liquidity (OI ${oi.toFixed(0)}, Vol ${volume.toFixed(0)}).`
  )
}

/**
 * `_p5_strategy_score`. Returns null for a row that is not a candidate at all: no valid
 * Greeks, no quoted price, thin open interest, a spread wider than 60% of the premium,
 * an expiry already gone, or the wrong side of spot for the strategy.
 */
export function strategyScore(
  row: OptionsChainRow,
  strategy: OptionsStrategy,
  spot: number,
  expiry: string,
  now: Date = new Date(),
): Omit<StrategyDetail, 'rank'> | null {
  const { strike, bid, ask, lastPrice: last, openInterest: oi, volume, impliedVolatility: iv } = row
  if (!row.greeksValid || strike <= 0 || spot <= 0) return null
  if (row.delta === null || row.gamma === null || row.vega === null) return null
  if (bid <= 0 && ask <= 0 && last <= 0) return null

  const premium = bid > 0 && ask > 0 ? (bid + ask) / 2 : last
  if (premium <= 0 || iv <= 0) return null

  const deltaAbs = Math.abs(row.delta)
  const gammaAbs = Math.abs(row.gamma)
  const vegaAbs = Math.abs(row.vega)
  const hasLiveSpread = bid > 0 && ask > 0 && premium > 0
  const spreadRatio = hasLiveSpread ? (ask - bid) / premium : null
  if (spreadRatio !== null && spreadRatio < 0) return null
  if (oi < STRATEGY_MIN_OI) return null
  if (volume < STRATEGY_MIN_VOLUME) return null
  if (spreadRatio !== null && spreadRatio > STRATEGY_MAX_SPREAD_RATIO) return null

  const dte = daysToExpiry(expiry, now)
  if (dte <= 0) return null

  // A chain with no live quotes still ranks; the missing spread scores a flat 35.
  const spreadScore =
    spreadRatio !== null ? linearScore(spreadRatio, 0.02, STRATEGY_MAX_SPREAD_RATIO, true) : 35
  let liquidityScore =
    (linearScore(Math.log1p(Math.max(oi, 0)), Math.log1p(STRATEGY_MIN_OI), Math.log1p(5000)) +
      linearScore(
        Math.log1p(Math.max(volume, 0)),
        Math.log1p(STRATEGY_MIN_VOLUME),
        Math.log1p(1000),
      )) /
    2
  if (volume <= 0) liquidityScore *= 0.85
  const greekStabilityScore =
    linearScore(gammaAbs, 0, 0.05, true) * 0.55 + linearScore(vegaAbs, 0, 0.35, true) * 0.45

  const base = {
    strategy,
    strike,
    premium,
    deltaAbs,
    dte,
    spreadRatio,
    hasLiveSpread,
    oi,
    volume,
    liquidityScore,
    spreadScore,
    greekStabilityScore,
  }

  if (strategy === 'Covered Call') {
    if (strike < spot) return null
    const deltaScore = bandScore(deltaAbs, CC_DELTA_TARGET, CC_DELTA_BAND[0], CC_DELTA_BAND[1])
    const annualizedYield = (premium / spot) * (365 / dte)
    const yieldScore = linearScore(annualizedYield, 0.04, 0.3)
    const upsideRoom = Math.max(0, strike / spot - 1)
    const upsideScore = linearScore(upsideRoom, 0.01, 0.12)
    let score =
      deltaScore * 0.3 +
      yieldScore * 0.25 +
      liquidityScore * 0.15 +
      spreadScore * 0.15 +
      upsideScore * 0.15 +
      greekStabilityScore * 0.1
    // A strike exactly at spot is eligible but discounted, as the reference has it.
    if (strike <= spot) score *= 0.9
    return {
      ...base,
      annualizedYield,
      deltaScore,
      yieldScore,
      upsideRoom,
      upsideScore,
      score,
      rationale: describeCoveredCall(
        annualizedYield,
        upsideRoom,
        spreadRatio,
        oi,
        volume,
        hasLiveSpread,
      ),
    }
  }

  if (strategy === 'Cash Secured Put') {
    if (strike > spot) return null
    const deltaScore = bandScore(deltaAbs, CSP_DELTA_TARGET, CSP_DELTA_BAND[0], CSP_DELTA_BAND[1])
    const annualizedYield = (premium / strike) * (365 / dte)
    const yieldScore = linearScore(annualizedYield, 0.05, 0.35)
    const breakeven = strike - premium
    const breakevenDiscount = Math.max(0, (spot - breakeven) / spot)
    const breakevenScore = linearScore(breakevenDiscount, 0.01, 0.12)
    let score =
      deltaScore * 0.3 +
      yieldScore * 0.25 +
      breakevenScore * 0.2 +
      liquidityScore * 0.15 +
      spreadScore * 0.1 +
      greekStabilityScore * 0.1
    if (strike >= spot) score *= 0.88
    return {
      ...base,
      annualizedYield,
      deltaScore,
      yieldScore,
      breakeven,
      breakevenDiscount,
      breakevenScore,
      score,
      rationale: describeCashSecuredPut(
        annualizedYield,
        breakevenDiscount,
        spreadRatio,
        oi,
        volume,
        hasLiveSpread,
      ),
    }
  }

  return null
}

/**
 * `_p5_rank_strategy_rows`: the top three candidates on one side of the chain.
 *
 * A Covered Call only ranks calls and a Cash Secured Put only ranks puts, so handing
 * this the puts table under a Covered Call returns nothing rather than scoring the
 * wrong side of the book.
 */
export function rankStrategyRows(
  rows: readonly OptionsChainRow[],
  strategy: OptionsStrategy,
  spot: number,
  expiry: string,
  now: Date = new Date(),
): Map<number, StrategyDetail> {
  const ranked = new Map<number, StrategyDetail>()
  if (!rows.length || strategy === 'None') return ranked
  if (strategy === 'Covered Call' && rows[0].type !== 'Call') return ranked
  if (strategy === 'Cash Secured Put' && rows[0].type !== 'Put') return ranked

  const candidates: Array<{ index: number; detail: Omit<StrategyDetail, 'rank'> }> = []
  rows.forEach((row, index) => {
    const detail = strategyScore(row, strategy, spot, expiry, now)
    if (detail) candidates.push({ index, detail })
  })
  candidates.sort((a, b) => b.detail.score - a.detail.score)
  candidates.slice(0, 3).forEach((candidate, position) => {
    ranked.set(candidate.index, { ...candidate.detail, rank: position + 1 })
  })
  return ranked
}

/** `_p5_format_spread_summary`. */
export function formatSpreadSummary(detail: StrategyDetail): string {
  if (!detail.hasLiveSpread || detail.spreadRatio === null) return 'Spread unavailable after hours'
  return `Spread ${(detail.spreadRatio * 100).toFixed(1)}%`
}

/** `_p5_strategy_tooltip`: the four-or-five line explanation a ranked row carries. */
export function strategyTooltip(detail: StrategyDetail | undefined): string {
  if (!detail || !detail.rank) return ''
  const lines = [
    `Rank #${detail.rank} | Score ${detail.score.toFixed(1)}`,
    detail.rationale.trim(),
    `Delta ${detail.deltaAbs.toFixed(3)} | DTE ${detail.dte} | Ann. yield ${(detail.annualizedYield * 100).toFixed(1)}%`,
    `${formatSpreadSummary(detail)} | OI ${detail.oi.toFixed(0)} | Vol ${detail.volume.toFixed(0)}`,
  ]
  if (detail.strategy === 'Covered Call') {
    lines.push(`Upside room ${((detail.upsideRoom ?? 0) * 100).toFixed(1)}%`)
  } else if (detail.strategy === 'Cash Secured Put') {
    lines.push(`Break-even discount ${((detail.breakevenDiscount ?? 0) * 100).toFixed(1)}%`)
  }
  return lines.filter(Boolean).join('\n')
}

/** `_p5_best_strategy_details`: the one-line summary the status line appends. */
export function bestStrategySummary(
  strategy: OptionsStrategy,
  callRanks: ReadonlyMap<number, StrategyDetail>,
  putRanks: ReadonlyMap<number, StrategyDetail>,
): string {
  const source =
    strategy === 'Covered Call' ? callRanks : strategy === 'Cash Secured Put' ? putRanks : null
  if (!source) return ''
  const top = [...source.values()].find((detail) => detail.rank === 1)
  if (!top) return ''
  const summary = `strike ${top.strike.toFixed(1)}, score ${top.score.toFixed(1)}`
  return top.rationale.trim() ? `${summary}, ${top.rationale.trim()}` : summary
}

/* ------------------------------------------------------------- md exports */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

function exportNumber(value: unknown, decimals = 2, integer = false): string {
  if (value === null || value === undefined) return ''
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return escapeCell(value)
  if (integer) return Math.trunc(numeric).toLocaleString('en-US')
  return numeric.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export interface ChainExportInput {
  ticker: string
  expiry: string
  spotPrice: number
  riskFreeRate: number
  rateSource: string
  dividendYield: number
  dividendSource: string
  strategy: OptionsStrategy
  rows: readonly OptionsChainRow[]
  exportedAt: string
}

function chainExportTable(rows: readonly OptionsChainRow[]): string[] {
  if (!rows.length) return ['No rows available.', '']
  const lines = [
    `| ${CHAIN_COLUMNS.map((column) => column.label).join(' | ')} |`,
    `| ${CHAIN_COLUMNS.map((column) => (column.label === 'IV' ? '---' : '---:')).join(' | ')} |`,
  ]
  for (const row of rows) {
    const cells = CHAIN_COLUMNS.map((column) =>
      escapeCell(formatChainValue(row[column.key], column)),
    )
    lines.push(`| ${cells.join(' | ')} |`)
  }
  lines.push('')
  return lines
}

/** `_p5_build_chain_export`: the Chain tab's clipboard payload. */
export function buildChainExport(input: ChainExportInput): string {
  const calls = input.rows.filter((row) => row.type === 'Call').sort((a, b) => a.strike - b.strike)
  const puts = input.rows.filter((row) => row.type === 'Put').sort((a, b) => a.strike - b.strike)
  const lines = [
    `# Options Chain Export - ${input.ticker}`,
    '',
    `- Symbol: ${input.ticker}`,
    `- Expiration: ${input.expiry || 'Unavailable'}`,
    `- Spot Price: ${exportNumber(input.spotPrice)}`,
    `- Risk-Free Rate: ${(input.riskFreeRate * 100).toFixed(2)}% (${input.rateSource})`,
    `- Dividend Yield: ${(input.dividendYield * 100).toFixed(2)}% (${input.dividendSource})`,
    `- Strategy View: ${input.strategy}`,
    `- Exported At: ${input.exportedAt}`,
    '',
    '## Context',
    '',
    'This is the currently loaded options chain for one expiry. Analyze liquidity, strike positioning, implied volatility, and call-versus-put structure from the quoted market data and calculated Greeks.',
    '',
    '## Calls',
    '',
    ...chainExportTable(calls),
    '## Puts',
    '',
    ...chainExportTable(puts),
  ]
  return `${lines.join('\n').replace(/\s+$/, '')}\n`
}

export interface TopVolumeExportInput {
  ticker: string
  typeFilter: OptionsTypeFilter
  buckets: ReadonlyArray<{ expiry: string; rows: readonly OptionsRawRow[] }>
  exportedAt: string
}

/** `_p5_build_top_options_export`, with the one dynamic all-expiry section. */
export function buildTopVolumeExport(input: TopVolumeExportInput): string {
  const typeLabel =
    OPTIONS_TYPE_FILTERS.find((entry) => entry.key === input.typeFilter)?.label ?? 'Both'
  const symbol = input.ticker || 'Unavailable'
  const lines = [
    '# Top Options by Volume Export',
    '',
    `- Current Input Symbol: ${symbol}`,
    `- Loaded Symbols: ${symbol}`,
    `- Option Type Filter: ${typeLabel}`,
    `- Exported At: ${input.exportedAt}`,
    '',
    '## Context',
    '',
    'This export captures one ranked top-volume options table for every expiration currently returned by yfinance for the loaded ticker. Analyze call-versus-put skew, strike clustering, and volume concentration by expiration while noting that the data is still a ranked snapshot rather than full order-flow context.',
    '',
    '## Options by Top Volume',
    '',
    `- Symbol: ${symbol}`,
    `- Option Type Filter: ${typeLabel}`,
    `- Expirations captured: ${input.buckets.length}`,
    '',
    'This section lists the highest-volume contracts for every expiration returned by yfinance for the loaded ticker.',
    '',
  ]
  for (const bucket of input.buckets) {
    lines.push(
      `### ${formatExpiration(bucket.expiry) || bucket.expiry}`,
      '',
      `- Selected expiration: ${bucket.expiry || 'Unavailable'}`,
      `- Rows exported: ${bucket.rows.length}`,
      '',
    )
    if (!bucket.rows.length) {
      lines.push('No top options volume records were available for this expiration.', '')
      continue
    }
    lines.push(
      '| Ticker | Type | Strike | Expiration | Last Price | Volume |',
      '| --- | --- | ---: | --- | ---: | ---: |',
    )
    for (const row of bucket.rows) {
      const cells = [
        escapeCell(row.ticker || input.ticker),
        escapeCell(row.type),
        exportNumber(row.strike, 1),
        escapeCell(row.expiration || bucket.expiry),
        exportNumber(row.lastPrice),
        exportNumber(row.volume, 0, true),
      ]
      lines.push(`| ${cells.join(' | ')} |`)
    }
    lines.push('')
  }
  return `${lines.join('\n').replace(/\s+$/, '')}\n`
}
