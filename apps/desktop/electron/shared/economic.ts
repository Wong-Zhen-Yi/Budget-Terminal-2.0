import type {
  EconomicCurveTenor,
  EconomicFrequency,
  EconomicGroup,
  EconomicPayload,
  EconomicPoint,
  EconomicProvider,
  EconomicRow,
  EconomicTransform,
  EconomicYieldCurve,
} from './contract.js'
import { ECONOMIC_GROUPS } from './contract.js'

/**
 * The Economic page's catalog, transforms and presentation maths, ported from
 * `services/economic.py` and `mixins/economic_presenters.py`.
 *
 * Everything here is pure so the probe, the main process and the page cannot disagree —
 * the same split the reference keeps by making both of those modules Qt-free. The network
 * side lives in `electron/services/economic.ts`.
 */

export const PROVIDER_LABELS: Record<EconomicProvider, string> = {
  fred: 'FRED',
  bls: 'BLS',
  treasury: 'US Treasury',
  treasury_spread: 'US Treasury',
  treasury_breakeven: 'US Treasury',
  nyfed: 'NY Fed',
  umich: 'UMich',
}

/**
 * History retained per series, and how many yearly treasury CSVs the curve provider pulls.
 * Ten years keeps the charts useful while holding the serialized payload to a few hundred
 * kilobytes.
 */
export const HISTORY_YEARS = 10

/** Nominal days between observations, used to locate the year-ago point for a YoY transform. */
const FREQUENCY_DAYS: Record<EconomicFrequency, number> = {
  daily: 1,
  weekly: 7,
  monthly: 31,
  quarterly: 92,
  annual: 366,
}

export interface EconomicSeries {
  seriesId: string
  label: string
  group: EconomicGroup
  units: string
  frequency: EconomicFrequency
  transform: EconomicTransform
  decimals: number
  higherIsBetter: boolean | null
  tenorYears?: number | null
  note?: string
  provider?: EconomicProvider
  /**
   * Provider-specific identifier: a BLS series id, a treasury CSV column, an NY Fed rate
   * name, or `'<minuend>|<subtrahend>'` for a derived treasury spread or breakeven.
   */
  providerKey?: string
}

/** Human-readable provider plus identifier, for tooltips and the Notes column. */
export function sourceLabel(series: EconomicSeries): string {
  const provider = series.provider ?? 'fred'
  return `${PROVIDER_LABELS[provider]} ${series.providerKey || series.seriesId}`.trim()
}

/** The catalog. Ordering inside a group is the display order on that group's tab. */
export const ECONOMIC_SERIES: readonly EconomicSeries[] = [
  // ------------------------------------------------------------------ inflation
  {
    seriesId: 'CPIAUCSL', label: 'CPI (YoY)', group: 'Inflation', units: 'percent',
    frequency: 'monthly', transform: 'yoy_pct', decimals: 1, higherIsBetter: false,
    provider: 'bls', providerKey: 'CUSR0000SA0',
  },
  {
    seriesId: 'CPILFESL', label: 'Core CPI (YoY)', group: 'Inflation', units: 'percent',
    frequency: 'monthly', transform: 'yoy_pct', decimals: 1, higherIsBetter: false,
    note: 'All items less food and energy, seasonally adjusted.',
    provider: 'bls', providerKey: 'CUSR0000SA0L1E',
  },
  {
    seriesId: 'PPIFID', label: 'Producer Prices (YoY)', group: 'Inflation', units: 'percent',
    frequency: 'monthly', transform: 'yoy_pct', decimals: 1, higherIsBetter: false,
    note: 'Final demand, not seasonally adjusted.',
    provider: 'bls', providerKey: 'WPUFD4',
  },
  {
    seriesId: 'T5YIE', label: '5Y Breakeven', group: 'Inflation', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    note: '5Y nominal yield less the 5Y TIPS real yield.',
    provider: 'treasury_breakeven', providerKey: '5 Yr|5 YR',
  },
  {
    seriesId: 'T10YIE', label: '10Y Breakeven', group: 'Inflation', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    note: '10Y nominal yield less the 10Y TIPS real yield.',
    provider: 'treasury_breakeven', providerKey: '10 Yr|10 YR',
  },
  {
    seriesId: 'DFII10', label: '10Y Real Yield', group: 'Inflation', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    note: '10Y TIPS yield: the market real rate.',
    provider: 'treasury', providerKey: 'real:10 YR',
  },
  {
    seriesId: 'PCEPI', label: 'PCE Prices (YoY)', group: 'Inflation', units: 'percent',
    frequency: 'monthly', transform: 'yoy_pct', decimals: 1, higherIsBetter: false,
  },
  {
    seriesId: 'PCEPILFE', label: 'Core PCE (YoY)', group: 'Inflation', units: 'percent',
    frequency: 'monthly', transform: 'yoy_pct', decimals: 1, higherIsBetter: false,
    note: 'The Fed states its 2% inflation target on this series.',
  },
  {
    seriesId: 'T5YIFR', label: '5Y5Y Forward Inflation', group: 'Inflation', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
  },
  {
    seriesId: 'MICH', label: 'UMich 1Y Expectations', group: 'Inflation', units: 'percent',
    frequency: 'monthly', transform: 'level', decimals: 1, higherIsBetter: false,
  },
  // ---------------------------------------------------------------------- labor
  {
    seriesId: 'UNRATE', label: 'Unemployment Rate', group: 'Labor', units: 'percent',
    frequency: 'monthly', transform: 'level', decimals: 1, higherIsBetter: false,
    provider: 'bls', providerKey: 'LNS14000000',
  },
  {
    seriesId: 'U6RATE', label: 'U-6 Underemployment', group: 'Labor', units: 'percent',
    frequency: 'monthly', transform: 'level', decimals: 1, higherIsBetter: false,
    note: 'Includes discouraged and involuntarily part-time workers.',
    provider: 'bls', providerKey: 'LNS13327709',
  },
  {
    seriesId: 'PAYEMS', label: 'Nonfarm Payrolls (MoM)', group: 'Labor', units: 'thousands',
    frequency: 'monthly', transform: 'mom_diff', decimals: 0, higherIsBetter: true,
    provider: 'bls', providerKey: 'CES0000000001',
  },
  {
    seriesId: 'CIVPART', label: 'Participation Rate', group: 'Labor', units: 'percent',
    frequency: 'monthly', transform: 'level', decimals: 1, higherIsBetter: true,
    provider: 'bls', providerKey: 'LNS11300000',
  },
  {
    seriesId: 'AHETPI', label: 'Avg Hourly Earnings (YoY)', group: 'Labor', units: 'percent',
    frequency: 'monthly', transform: 'yoy_pct', decimals: 1, higherIsBetter: null,
    note: 'Total private, seasonally adjusted.',
    provider: 'bls', providerKey: 'CES0500000003',
  },
  {
    seriesId: 'JTSJOL', label: 'Job Openings', group: 'Labor', units: 'thousands',
    frequency: 'monthly', transform: 'level', decimals: 0, higherIsBetter: true,
    note: 'JOLTS total nonfarm openings.',
    provider: 'bls', providerKey: 'JTS000000000000000JOL',
  },
  {
    seriesId: 'EMRATIO', label: 'Employment-Population Ratio', group: 'Labor', units: 'percent',
    frequency: 'monthly', transform: 'level', decimals: 1, higherIsBetter: true,
    provider: 'bls', providerKey: 'LNS12300000',
  },
  {
    seriesId: 'ICSA', label: 'Initial Jobless Claims', group: 'Labor', units: 'count',
    frequency: 'weekly', transform: 'level', decimals: 0, higherIsBetter: false,
  },
  {
    seriesId: 'CCSA', label: 'Continuing Claims', group: 'Labor', units: 'count',
    frequency: 'weekly', transform: 'level', decimals: 0, higherIsBetter: false,
  },
  // --------------------------------------------------------------------- growth
  {
    seriesId: 'UMCSENT', label: 'Consumer Sentiment', group: 'Growth', units: 'index',
    frequency: 'monthly', transform: 'level', decimals: 1, higherIsBetter: true,
    note: 'University of Michigan index of consumer sentiment.',
    provider: 'umich', providerKey: 'ICS_ALL',
  },
  {
    seriesId: 'GDPC1', label: 'Real GDP (QoQ SAAR)', group: 'Growth', units: 'percent',
    frequency: 'quarterly', transform: 'qoq_saar', decimals: 1, higherIsBetter: true,
  },
  {
    seriesId: 'INDPRO', label: 'Industrial Production (YoY)', group: 'Growth', units: 'percent',
    frequency: 'monthly', transform: 'yoy_pct', decimals: 1, higherIsBetter: true,
  },
  {
    seriesId: 'RSAFS', label: 'Retail Sales (YoY)', group: 'Growth', units: 'percent',
    frequency: 'monthly', transform: 'yoy_pct', decimals: 1, higherIsBetter: true,
  },
  {
    seriesId: 'TCU', label: 'Capacity Utilization', group: 'Growth', units: 'percent',
    frequency: 'monthly', transform: 'level', decimals: 1, higherIsBetter: true,
  },
  {
    seriesId: 'DGORDER', label: 'Durable Goods (MoM)', group: 'Growth', units: 'percent',
    frequency: 'monthly', transform: 'mom_pct', decimals: 1, higherIsBetter: true,
  },
  {
    seriesId: 'HOUST', label: 'Housing Starts', group: 'Growth', units: 'thousands',
    frequency: 'monthly', transform: 'level', decimals: 0, higherIsBetter: true,
  },
  {
    seriesId: 'PERMIT', label: 'Building Permits', group: 'Growth', units: 'thousands',
    frequency: 'monthly', transform: 'level', decimals: 0, higherIsBetter: true,
  },
  {
    seriesId: 'CSUSHPINSA', label: 'Case-Shiller Prices (YoY)', group: 'Growth', units: 'percent',
    frequency: 'monthly', transform: 'yoy_pct', decimals: 1, higherIsBetter: null,
  },
  {
    seriesId: 'BOPGSTB', label: 'Trade Balance', group: 'Growth', units: 'millions',
    frequency: 'monthly', transform: 'level', decimals: 0, higherIsBetter: true,
  },
  {
    seriesId: 'PSAVERT', label: 'Personal Saving Rate', group: 'Growth', units: 'percent',
    frequency: 'monthly', transform: 'level', decimals: 1, higherIsBetter: null,
  },
  // ---------------------------------------------------------------------- rates
  {
    seriesId: 'FEDFUNDS', label: 'Fed Funds Rate', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    note: 'Effective federal funds rate published by the New York Fed.',
    provider: 'nyfed', providerKey: 'unsecured/effr',
  },
  {
    seriesId: 'SOFR', label: 'SOFR', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    note: 'Secured overnight financing rate.',
    provider: 'nyfed', providerKey: 'secured/sofr',
  },
  {
    seriesId: 'DGS1MO', label: '1M Treasury', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    tenorYears: 1 / 12, provider: 'treasury', providerKey: '1 Mo',
  },
  {
    seriesId: 'DGS3MO', label: '3M Treasury', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    tenorYears: 0.25, provider: 'treasury', providerKey: '3 Mo',
  },
  {
    seriesId: 'DGS6MO', label: '6M Treasury', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    tenorYears: 0.5, provider: 'treasury', providerKey: '6 Mo',
  },
  {
    seriesId: 'DGS1', label: '1Y Treasury', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    tenorYears: 1, provider: 'treasury', providerKey: '1 Yr',
  },
  {
    seriesId: 'DGS2', label: '2Y Treasury', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    tenorYears: 2, provider: 'treasury', providerKey: '2 Yr',
  },
  {
    seriesId: 'DGS3', label: '3Y Treasury', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    tenorYears: 3, provider: 'treasury', providerKey: '3 Yr',
  },
  {
    seriesId: 'DGS5', label: '5Y Treasury', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    tenorYears: 5, provider: 'treasury', providerKey: '5 Yr',
  },
  {
    seriesId: 'DGS7', label: '7Y Treasury', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    tenorYears: 7, provider: 'treasury', providerKey: '7 Yr',
  },
  {
    seriesId: 'DGS10', label: '10Y Treasury', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    tenorYears: 10, provider: 'treasury', providerKey: '10 Yr',
  },
  {
    seriesId: 'DGS20', label: '20Y Treasury', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    tenorYears: 20, provider: 'treasury', providerKey: '20 Yr',
  },
  {
    seriesId: 'DGS30', label: '30Y Treasury', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: null,
    tenorYears: 30, provider: 'treasury', providerKey: '30 Yr',
  },
  {
    seriesId: 'T10Y2Y', label: '10Y-2Y Spread', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: true,
    note: 'Negative readings are the classic recession-warning inversion.',
    provider: 'treasury_spread', providerKey: '10 Yr|2 Yr',
  },
  {
    seriesId: 'T10Y3M', label: '10Y-3M Spread', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: true,
    provider: 'treasury_spread', providerKey: '10 Yr|3 Mo',
  },
  {
    seriesId: 'MORTGAGE30US', label: '30Y Mortgage Rate', group: 'Rates', units: 'percent',
    frequency: 'weekly', transform: 'level', decimals: 2, higherIsBetter: false,
  },
  {
    seriesId: 'BAMLH0A0HYM2', label: 'High-Yield Spread', group: 'Rates', units: 'percent',
    frequency: 'daily', transform: 'level', decimals: 2, higherIsBetter: false,
  },
  {
    seriesId: 'M2SL', label: 'M2 Money Supply (YoY)', group: 'Rates', units: 'percent',
    frequency: 'monthly', transform: 'yoy_pct', decimals: 1, higherIsBetter: null,
  },
  {
    seriesId: 'WALCL', label: 'Fed Balance Sheet', group: 'Rates', units: 'millions',
    frequency: 'weekly', transform: 'level', decimals: 0, higherIsBetter: null,
  },
]

export const SERIES_BY_ID: ReadonlyMap<string, EconomicSeries> = new Map(
  ECONOMIC_SERIES.map((series) => [series.seriesId, series]),
)

/** Tenors used to draw the treasury curve, shortest first. */
export const YIELD_CURVE_SERIES = ECONOMIC_SERIES.filter(
  (series) => typeof series.tenorYears === 'number',
)

/**
 * The headline tiles across the top of the page. Every one of these resolves from a direct
 * provider, so the strip stays populated even where FRED is unreachable.
 */
export const HEADLINE_SERIES = [
  'CPIAUCSL',
  'CPILFESL',
  'UNRATE',
  'PAYEMS',
  'FEDFUNDS',
  'DGS10',
  'T10Y2Y',
] as const

/* ------------------------------------------------------------------- helpers */

/**
 * Guard null before `Number()`, the way `finiteOrNull` does on the Valuation page.
 *
 * `Number(null)` is 0 and `Number('')` is 0, so without the guard every absent provider
 * field arrives as a real zero: a missing CPI print would render as `0.0%` and colour green
 * rather than showing the em dash that says the provider returned nothing. Python's
 * `float(None)` raises, which is why `_is_finite` has no equivalent hazard to document.
 */
function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function parseIsoDate(value: unknown): number | null {
  const parsed = Date.parse(`${String(value ?? '').slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(parsed) ? parsed : null
}

const DAY_MS = 86_400_000

/** Drop sentinel and unparseable rows, keeping ascending `(iso_date, value)` pairs. */
export function cleanPoints(points: readonly EconomicPoint[] | null | undefined): EconomicPoint[] {
  const cleaned: EconomicPoint[] = []
  for (const point of points ?? []) {
    const value = finite(point?.[1])
    if (value === null) continue
    cleaned.push([String(point[0]), value])
  }
  return cleaned
}

/**
 * Subtract two dated series on their shared dates.
 *
 * Nominal and TIPS curves are published on the same schedule but not identically — a tenor
 * can be missing on either side — so the difference is only defined where both have a value.
 */
export function alignDifference(
  minuend: readonly EconomicPoint[] | null | undefined,
  subtrahend: readonly EconomicPoint[] | null | undefined,
): EconomicPoint[] {
  const right = new Map(cleanPoints(subtrahend))
  const result: EconomicPoint[] = []
  for (const [stamp, value] of cleanPoints(minuend)) {
    const other = right.get(stamp)
    if (other === undefined) continue
    result.push([stamp, value - other])
  }
  return result
}

/**
 * Locate the observation closest to one year before `index`.
 *
 * Index arithmetic (`index - 12`) breaks the moment a series has a reporting gap or a
 * different frequency, so the lookup runs on dates with a tolerance scaled to the series'
 * own spacing.
 */
function yearAgoIndex(
  points: readonly EconomicPoint[],
  index: number,
  frequency: EconomicFrequency,
): number | null {
  const anchor = parseIsoDate(points[index][0])
  if (anchor === null) return null
  const target = anchor - 365 * DAY_MS
  // Half the nominal spacing, floored so daily series survive a holiday weekend. A tolerance
  // as wide as a whole period would happily pair a month with the month before its year-ago
  // partner whenever the series has a reporting gap.
  const spacing = Math.max(FREQUENCY_DAYS[frequency] ?? 31, 1)
  const tolerance = Math.max(Math.floor(spacing / 2), 5)
  let bestIndex: number | null = null
  let bestGap = tolerance + 1
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    const stamp = parseIsoDate(points[candidate][0])
    if (stamp === null) continue
    const gap = Math.abs(Math.round((stamp - target) / DAY_MS))
    if (gap < bestGap) {
      bestGap = gap
      bestIndex = candidate
    } else if (stamp < target) {
      // Walking further back only increases the gap once we are past the target date.
      break
    }
  }
  if (bestIndex === null || bestGap > tolerance) return null
  return bestIndex
}

function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) return null
  return (current / previous - 1) * 100
}

/** Convert raw observations into the series the page actually displays. */
export function applyTransform(
  points: readonly EconomicPoint[] | null | undefined,
  transform: EconomicTransform,
  frequency: EconomicFrequency = 'monthly',
): EconomicPoint[] {
  const items = cleanPoints(points)
  if (transform === 'level' || !items.length) return items
  const result: EconomicPoint[] = []
  if (transform === 'yoy_pct') {
    for (let index = 0; index < items.length; index += 1) {
      const prior = yearAgoIndex(items, index, frequency)
      if (prior === null) continue
      const change = percentChange(items[index][1], items[prior][1])
      if (change !== null) result.push([items[index][0], change])
    }
    return result
  }
  for (let index = 1; index < items.length; index += 1) {
    const current = items[index][1]
    const previous = items[index - 1][1]
    let change: number | null
    if (transform === 'mom_pct') change = percentChange(current, previous)
    else if (transform === 'mom_diff') change = current - previous
    else {
      const ratio = percentChange(current, previous)
      change = ratio === null ? null : ((1 + ratio / 100) ** 4 - 1) * 100
    }
    if (change !== null && Number.isFinite(change)) result.push([items[index][0], change])
  }
  return result
}

/** Percent change of the latest observation against roughly one year earlier. */
export function yoyChange(
  points: readonly EconomicPoint[] | null | undefined,
  frequency: EconomicFrequency = 'monthly',
): number | null {
  const items = cleanPoints(points)
  if (items.length < 2) return null
  const prior = yearAgoIndex(items, items.length - 1, frequency)
  if (prior === null) return null
  return percentChange(items[items.length - 1][1], items[prior][1])
}

/** Keep only the most recent `years` of observations. */
export function trimHistory(
  points: readonly EconomicPoint[] | null | undefined,
  years = HISTORY_YEARS,
): EconomicPoint[] {
  const items = cleanPoints(points)
  if (!items.length) return []
  const newest = parseIsoDate(items[items.length - 1][0])
  if (newest === null) return items
  const cutoff = newest - Math.max(Math.trunc(years), 1) * 366 * DAY_MS
  return items.filter(([stamp]) => {
    const parsed = parseIsoDate(stamp)
    return parsed !== null && parsed >= cutoff
  })
}

/** Shape one series into the row the page and its cache both consume. */
export function buildRow(
  series: EconomicSeries,
  points: readonly EconomicPoint[] | null | undefined,
): EconomicRow {
  const raw = cleanPoints(points)
  const transformed = applyTransform(raw, series.transform, series.frequency)
  const latest = transformed.at(-1) ?? null
  const prior = transformed.length > 1 ? transformed[transformed.length - 2] : null
  const rawLatest = raw.at(-1) ?? null
  return {
    seriesId: series.seriesId,
    label: series.label,
    group: series.group,
    units: series.units,
    decimals: series.decimals,
    frequency: series.frequency,
    transform: series.transform,
    higherIsBetter: series.higherIsBetter,
    tenorYears: series.tenorYears ?? null,
    note: series.note ?? '',
    provider: series.provider ?? 'fred',
    source: sourceLabel(series),
    available: latest !== null,
    latest: latest ? latest[1] : null,
    latestDate: latest ? latest[0] : null,
    prior: prior ? prior[1] : null,
    change: latest && prior ? latest[1] - prior[1] : null,
    yoy: yoyChange(raw, series.frequency),
    rawLatest: rawLatest ? rawLatest[1] : null,
    history: trimHistory(transformed),
  }
}

/** Assemble the treasury curve from whichever tenor rows came back populated. */
export function buildYieldCurve(rows: readonly EconomicRow[]): EconomicYieldCurve {
  const byId = new Map(rows.map((row) => [row.seriesId, row]))
  const tenors: EconomicCurveTenor[] = []
  for (const series of YIELD_CURVE_SERIES) {
    const row = byId.get(series.seriesId)
    const value = finite(row?.latest)
    if (!row || value === null) continue
    tenors.push({
      seriesId: series.seriesId,
      label: series.label.replace(' Treasury', ''),
      years: series.tenorYears ?? 0,
      yieldPct: value,
      date: row.latestDate,
    })
  }
  tenors.sort((left, right) => left.years - right.years)
  const lookup = new Map(tenors.map((item) => [item.seriesId, item.yieldPct]))
  const twoYear = lookup.get('DGS2')
  const tenYear = lookup.get('DGS10')
  const threeMonth = lookup.get('DGS3MO')
  const spread10y2y = twoYear === undefined || tenYear === undefined ? null : tenYear - twoYear
  const spread10y3m = threeMonth === undefined || tenYear === undefined ? null : tenYear - threeMonth
  return {
    tenors,
    spread10y2y,
    spread10y3m,
    inverted2s10s: spread10y2y !== null && spread10y2y < 0,
    inverted3m10y: spread10y3m !== null && spread10y3m < 0,
  }
}

/* ---------------------------------------------------------------- formatting */

function fixed(value: number, places: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

/** Render one observation for a table cell, with an em dash for a missing value. */
export function formatEconomicValue(
  value: number | null | undefined,
  units: string,
  decimalPlaces = 1,
): string {
  const number = finite(value)
  if (number === null) return '—'
  const places = Math.max(Math.trunc(decimalPlaces), 0)
  const kind = units.trim().toLowerCase()
  if (kind === 'percent') return `${fixed(number, places)}%`
  if (kind === 'thousands') return `${fixed(number, places)}K`
  // These are reported in millions of dollars; billions read far better at this scale.
  if (kind === 'millions') return `$${fixed(number / 1000, 1)}B`
  if (kind === 'count') return fixed(number, 0)
  if (kind === 'usd') return `$${fixed(number, places)}`
  return fixed(number, places)
}

/** Render a period-over-period change with an explicit sign. */
export function formatEconomicChange(
  value: number | null | undefined,
  units: string,
  decimalPlaces = 1,
): string {
  const number = finite(value)
  if (number === null) return '—'
  const kind = units.trim().toLowerCase()
  if (kind === 'percent') {
    const places = Math.max(Math.trunc(decimalPlaces), 0)
    return `${number < 0 ? '-' : '+'}${fixed(Math.abs(number), places)} pp`
  }
  return `${number < 0 ? '-' : '+'}${formatEconomicValue(Math.abs(number), units, decimalPlaces)}`
}

/* ---------------------------------------------------------------- presenters */

export type EconomicTone = 'positive' | 'negative' | 'neutral'

/**
 * Colour a change by whether it moved the indicator in the helpful direction.
 *
 * `higherIsBetter` is deliberately tri-state: `null` means the direction carries no
 * good/bad meaning (a participation rate reading, a breakeven), so those stay neutral
 * rather than being painted with a misleading judgement.
 */
export function changeTone(row: EconomicRow, value: number | null): EconomicTone {
  const number = finite(value)
  if (number === null || number === 0 || row.higherIsBetter === null) return 'neutral'
  const helpful = row.higherIsBetter ? number > 0 : number < 0
  return helpful ? 'positive' : 'negative'
}

/** Restrict overview rows to one group, or return them all. */
export function filterRows(rows: readonly EconomicRow[], groupKey: string): EconomicRow[] {
  const key = groupKey.trim().toLowerCase()
  if (!key || key === 'all') return [...rows]
  return rows.filter((row) => row.group.toLowerCase() === key)
}

/**
 * Keep only rows whose provider actually returned an observation.
 *
 * A provider the current network cannot reach leaves a long run of em dashes that reads as
 * a broken page, so the tables hide those by default and the status line carries the count.
 */
export function dropUnavailable(rows: readonly EconomicRow[]): EconomicRow[] {
  return rows.filter((row) => row.available)
}

/** Match the search box against both the display label and the FRED series id. */
export function searchRows(rows: readonly EconomicRow[], text: string): EconomicRow[] {
  const needle = text.trim().toUpperCase()
  if (!needle) return [...rows]
  return rows.filter(
    (row) =>
      row.label.toUpperCase().includes(needle) || row.seriesId.toUpperCase().includes(needle),
  )
}

/** Return the rows belonging to one catalog group, in catalog order. */
export function rowsForGroup(rows: readonly EconomicRow[], group: EconomicGroup): EconomicRow[] {
  return rows.filter((row) => row.group === group)
}

/** The row tooltip: provider, cadence, note, and whether anything came back at all. */
export function rowTooltip(row: EconomicRow): string {
  const parts: string[] = []
  if (row.source) parts.push(row.source)
  if (row.frequency) parts.push(row.frequency.charAt(0).toUpperCase() + row.frequency.slice(1))
  if (row.note) parts.push(row.note)
  if (!row.available) parts.push('No data returned by this provider.')
  return parts.join(' · ')
}

/** Format the headline tiles, keyed by FRED series id. */
export function summarizeHeadlines(payload: EconomicPayload | null | undefined): Record<string, string> {
  const rows = new Map((payload?.rows ?? []).map((row) => [row.seriesId, row]))
  const summary: Record<string, string> = {}
  for (const seriesId of HEADLINE_SERIES) {
    const row = rows.get(seriesId)
    summary[seriesId] = row ? formatEconomicValue(row.latest, row.units, row.decimals) : '—'
  }
  return summary
}

/** `(seriesId, caption)` for the headline strip, in display order. */
export function headlineCaptions(): Array<{ seriesId: string; caption: string }> {
  return HEADLINE_SERIES.map((seriesId) => ({
    seriesId,
    caption: SERIES_BY_ID.get(seriesId)?.label ?? seriesId,
  }))
}

/** One line summarizing the shape of the treasury curve. */
export function describeCurve(curve: EconomicYieldCurve | null | undefined): string {
  const tenors = curve?.tenors ?? []
  if (!tenors.length) return 'Treasury curve unavailable.'
  const asOf = tenors[tenors.length - 1].date ?? ''
  const spread = finite(curve?.spread10y2y)
  if (spread === null) return asOf ? `Treasury curve as of ${asOf}.` : 'Treasury curve loaded.'
  const shape = spread < 0 ? 'inverted' : Math.abs(spread) < 0.15 ? 'flat' : 'upward sloping'
  const body = `10Y-2Y at ${spread >= 0 ? '+' : '-'}${fixed(Math.abs(spread), 2)} pp — curve is ${shape}.`
  return asOf ? `${body} As of ${asOf}.` : body
}

/** Split a row's stored history into parallel date and value lists for plotting. */
export function historySeries(
  row: EconomicRow | null | undefined,
  years: number | null = null,
): { dates: string[]; values: number[] } {
  const dates: string[] = []
  const values: number[] = []
  for (const point of row?.history ?? []) {
    const value = finite(point?.[1])
    if (value === null) continue
    dates.push(String(point[0]))
    values.push(value)
  }
  if (years !== null && years > 0 && dates.length) {
    const newest = dates[dates.length - 1]
    const cutoff = `${String(Number(newest.slice(0, 4)) - Math.round(years)).padStart(4, '0')}${newest.slice(4, 10)}`
    const start = dates.findIndex((stamp) => stamp >= cutoff)
    if (start > 0) return { dates: dates.slice(start), values: values.slice(start) }
  }
  return { dates, values }
}

/** The status-bar line and severity token for a payload. */
export function describeFreshness(
  payload: EconomicPayload | null | undefined,
): { text: string; tone: 'positive' | 'warning' | 'muted' } {
  if (!payload || !payload.rows.length) {
    return {
      text: 'No economic data loaded yet. Press Refresh to pull the latest releases.',
      tone: 'muted',
    }
  }
  const loaded = payload.rows.filter((row) => row.available)
  const parts = [`${loaded.length} of ${payload.rows.length} series loaded`]
  const generated = parseIsoDate(payload.generatedAt)
  if (generated !== null) {
    const today = parseIsoDate(new Date().toISOString().slice(0, 10)) ?? generated
    const ageDays = Math.round((today - generated) / DAY_MS)
    if (ageDays <= 0) parts.push('refreshed today')
    else if (ageDays === 1) parts.push('refreshed yesterday')
    else parts.push(`refreshed ${ageDays} days ago`)
  }
  const down = [...new Set(payload.unreachable.map((name) => PROVIDER_LABELS[name] ?? name))].sort()
  if (down.length) {
    parts.push(`unreachable: ${down.join(', ')}`)
    return { text: parts.join(' · '), tone: 'warning' }
  }
  if (payload.missing.length) {
    parts.push(`${payload.missing.length} unavailable`)
    return { text: parts.join(' · '), tone: 'warning' }
  }
  return { text: parts.join(' · '), tone: 'positive' }
}

/** Describe which series came back empty and which provider owed them. */
export function missingSummary(payload: EconomicPayload | null | undefined): string {
  const names = new Set(payload?.missing ?? [])
  if (!names.size) return ''
  const owners = new Map<string, number>()
  for (const row of payload?.rows ?? []) {
    if (!names.has(row.seriesId)) continue
    const provider = PROVIDER_LABELS[row.provider] ?? row.provider
    owners.set(provider, (owners.get(provider) ?? 0) + 1)
  }
  if (!owners.size) return `${names.size} series unavailable.`
  const parts = [...owners]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name} (${count})`)
  const down = [...new Set((payload?.unreachable ?? []).map((item) => PROVIDER_LABELS[item] ?? item))].sort()
  const tail = down.length ? ` Unreachable from this network: ${down.join(', ')}.` : ''
  return `${names.size} series unavailable — ${parts.join(', ')}.${tail}`
}

/** Coerce a requested group selection to known names, defaulting to the whole catalog. */
export function normalizeGroups(groups: readonly string[] | null | undefined): EconomicGroup[] {
  if (!groups) return [...ECONOMIC_GROUPS]
  const requested = new Set(groups.map((item) => String(item).trim()))
  const wanted = ECONOMIC_GROUPS.filter((name) => requested.has(name))
  return wanted.length ? [...wanted] : [...ECONOMIC_GROUPS]
}
