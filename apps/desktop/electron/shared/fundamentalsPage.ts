import type {
  FundamentalSeriesKey,
  FundamentalSeriesMap,
  FundamentalSeriesPoint,
  FundamentalsPagePayload,
  SecFiling,
} from './contract.js'
import { FUNDAMENTAL_SERIES_KEYS } from './contract.js'

export type FundamentalsPeriod = 'annual' | 'quarterly'
export type FundamentalsGrowthBasis = 'prior_period' | 'year_ago'

export interface FundamentalsDisplaySettings {
  period: FundamentalsPeriod
  periodCount: number
  indexed: boolean
  growthBasis: FundamentalsGrowthBasis
}

export interface FundamentalsHeadlineMetrics {
  pe: number | null
  forwardPe: number | null
  priceToSales: number | null
  peg: number | null
  fcfMarginPct: number | null
  evRevenue: number | null
  evEbitda: number | null
  netCash: number | null
  beta: number | null
  marketCap: number | null
}

export interface FundamentalsChartPoint extends FundamentalSeriesPoint {
  rawValue: number
  growth: number | null
  growthBaseline: string
  indexed: boolean
  indexedBaseLabel: string
  slot: number
}

export interface FundamentalsChartSeries {
  metric: FundamentalSeriesKey
  name: string
  legendName: string
  filled: boolean
  offset: number
  width: number
  points: FundamentalsChartPoint[]
}

export interface FundamentalsChartModel {
  title: string
  labels: string[]
  availablePeriods: number
  indexed: boolean
  growthBasis: FundamentalsGrowthBasis
  series: FundamentalsChartSeries[]
}

const CHARTS: ReadonlyArray<{
  title: string
  metrics: ReadonlyArray<[FundamentalSeriesKey, string]>
}> = [
  { title: 'Revenue', metrics: [['revenue', 'Revenue']] },
  { title: 'Net Income', metrics: [['netIncome', 'Net Income']] },
  {
    title: 'Cash Flow',
    metrics: [
      ['operatingCashFlow', 'Operating CF'],
      ['freeCashFlow', 'Free CF'],
    ],
  },
  { title: 'Shares Outstanding', metrics: [['sharesOutstanding', 'Shares Outstanding']] },
  {
    title: 'Cash and Bonds & Total Debt',
    metrics: [
      ['cashAndBonds', 'Cash and Bonds'],
      ['totalDebt', 'Total Debt'],
    ],
  },
  {
    title: 'Operating Expenses',
    metrics: [
      ['sellingGeneralAdmin', 'SG&A'],
      ['researchDevelopment', 'R&D'],
    ],
  },
]

export const FUNDAMENTALS_MIN_PERIODS = 3
export const FUNDAMENTALS_MAX_PERIODS = 16
export const FUNDAMENTALS_DEFAULT_PERIODS = 12

export function emptyFundamentalSeriesMap(): FundamentalSeriesMap {
  return Object.fromEntries(FUNDAMENTAL_SERIES_KEYS.map((key) => [key, []])) as unknown as FundamentalSeriesMap
}

export function normalizePeriodCount(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return FUNDAMENTALS_DEFAULT_PERIODS
  return Math.max(FUNDAMENTALS_MIN_PERIODS, Math.min(FUNDAMENTALS_MAX_PERIODS, Math.trunc(parsed)))
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function dateValue(value: string): number {
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

export function periodLabel(endDate: string, period: FundamentalsPeriod): string {
  const date = new Date(`${endDate.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(date.getTime())) return endDate
  const year = date.getUTCFullYear()
  return period === 'annual' ? String(year) : `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`
}

export function sortSeries(points: FundamentalSeriesPoint[]): FundamentalSeriesPoint[] {
  const byDate = new Map<string, FundamentalSeriesPoint>()
  for (const point of points) {
    if (!point.endDate || finite(point.value) === null) continue
    byDate.set(point.endDate.slice(0, 10), { ...point, endDate: point.endDate.slice(0, 10) })
  }
  return [...byDate.values()].sort((left, right) => dateValue(left.endDate) - dateValue(right.endDate))
}

/** SEC points are authoritative; Yahoo fills missing periods and cells. */
export function mergeMetricSeries(
  yahooPoints: FundamentalSeriesPoint[],
  secPoints: FundamentalSeriesPoint[],
  matchDays = 7,
): FundamentalSeriesPoint[] {
  const sec = sortSeries(secPoints)
  const merged = new Map(sec.map((point) => [point.endDate, point]))
  for (const yahoo of sortSeries(yahooPoints)) {
    let target = yahoo.endDate
    let distance = matchDays + 1
    for (const secPoint of sec) {
      const days = Math.abs(dateValue(yahoo.endDate) - dateValue(secPoint.endDate)) / 86_400_000
      if (days <= matchDays && days < distance) {
        distance = days
        target = secPoint.endDate
      }
    }
    if (!merged.has(target)) merged.set(target, { ...yahoo, endDate: target })
  }
  // A provider can report the same fiscal period with a slightly different end date.
  // Keep chart labels unique after date coalescing, with SEC still authoritative.
  const byLabel = new Map<string, FundamentalSeriesPoint>()
  for (const point of sortSeries([...merged.values()])) {
    const previous = byLabel.get(point.label)
    if (!previous || point.source === 'sec' || point.source === 'derived') byLabel.set(point.label, point)
  }
  return sortSeries([...byLabel.values()])
}

function pointMap(points: FundamentalSeriesPoint[]): Map<string, FundamentalSeriesPoint> {
  return new Map(sortSeries(points).map((point) => [point.endDate, point]))
}

/** Combine statement components only where a cash leg exists, avoiding combined-row double counts. */
export function combineCashAndBonds(
  combined: FundamentalSeriesPoint[],
  cash: FundamentalSeriesPoint[],
  shortTerm: FundamentalSeriesPoint[],
  longTerm: FundamentalSeriesPoint[],
): FundamentalSeriesPoint[] {
  const combinedByDate = pointMap(combined)
  const cashByDate = pointMap(cash)
  const shortByDate = pointMap(shortTerm)
  const longByDate = pointMap(longTerm)
  const dates = new Set([...combinedByDate.keys(), ...cashByDate.keys(), ...shortByDate.keys()])
  const output: FundamentalSeriesPoint[] = []
  for (const endDate of dates) {
    const bundled = combinedByDate.get(endDate)
    const cashPoint = cashByDate.get(endDate)
    const shortPoint = shortByDate.get(endDate)
    if (!bundled && !cashPoint && !shortPoint) continue
    const base = bundled?.value ?? (cashPoint?.value ?? 0) + (shortPoint?.value ?? 0)
    const longValue = longByDate.get(endDate)?.value ?? 0
    output.push({
      endDate,
      label: bundled?.label ?? cashPoint?.label ?? shortPoint?.label ?? endDate,
      value: base + longValue,
      source: bundled?.source ?? cashPoint?.source ?? shortPoint?.source ?? 'derived',
    })
  }
  return sortSeries(output)
}

export function combineDebt(
  total: FundamentalSeriesPoint[],
  current: FundamentalSeriesPoint[],
  nonCurrent: FundamentalSeriesPoint[],
): FundamentalSeriesPoint[] {
  const totalByDate = pointMap(total)
  const currentByDate = pointMap(current)
  const longByDate = pointMap(nonCurrent)
  const output: FundamentalSeriesPoint[] = [...totalByDate.values()]
  for (const endDate of [...currentByDate.keys()].filter((date) => longByDate.has(date))) {
    if (totalByDate.has(endDate)) continue
    const left = currentByDate.get(endDate)!
    output.push({
      endDate,
      label: left.label,
      value: left.value + longByDate.get(endDate)!.value,
      source: 'derived',
    })
  }
  return sortSeries(output)
}

export function subtractSeries(
  left: FundamentalSeriesPoint[],
  right: FundamentalSeriesPoint[],
): FundamentalSeriesPoint[] {
  const rightByDate = pointMap(right)
  return sortSeries(left.flatMap((point) => {
    const match = rightByDate.get(point.endDate)
    return match
      ? [{ ...point, value: point.value - Math.abs(match.value), source: 'derived' as const }]
      : []
  }))
}

export function growthRate(current: number, baseline: number | null): number | null {
  return baseline === null || baseline === 0 ? null : ((current - baseline) / Math.abs(baseline)) * 100
}

export function previousYearLabel(label: string): string | null {
  const match = /^(\d{4})(.*)$/.exec(label.trim())
  return match ? `${Number(match[1]) - 1}${match[2]}` : null
}

export function computeGrowth(
  points: FundamentalSeriesPoint[],
  basis: FundamentalsGrowthBasis,
): Array<{ growth: number | null; baseline: string }> {
  if (basis === 'year_ago') {
    const byLabel = new Map(points.map((point) => [point.label, point.value]))
    return points.map((point) => {
      const label = previousYearLabel(point.label)
      const growth = growthRate(point.value, label ? (byLabel.get(label) ?? null) : null)
      return { growth, baseline: growth === null ? '' : (label ?? '') }
    })
  }
  return points.map((point, index) => {
    const previous = points[index - 1]
    const growth = growthRate(point.value, previous?.value ?? null)
    return { growth, baseline: growth === null ? '' : previous.label }
  })
}

export function indexSeriesValues(values: number[]): { values: number[]; base: number | null } {
  const normalized = values.map((value) => Number.isFinite(value) ? value : 0)
  const base = normalized.find((value) => value !== 0) ?? null
  if (base === null) return { values: normalized.map(() => 0), base: null }
  return { values: normalized.map((value) => (value / Math.abs(base)) * 100), base }
}

export function seriesBarGeometry(countInput: unknown): Array<{ offset: number; width: number }> {
  const count = Math.max(1, Math.trunc(Number(countInput)) || 1)
  if (count === 1) return [{ offset: 0, width: 0.7 }]
  const pitch = 0.9 / count
  const width = pitch * 0.93
  const centre = (count - 1) / 2
  return Array.from({ length: count }, (_, index) => ({ offset: (index - centre) * pitch, width }))
}

function latestValue(points: FundamentalSeriesPoint[]): number | null {
  return sortSeries(points).at(-1)?.value ?? null
}

function reportedFlow(payload: FundamentalsPagePayload, key: FundamentalSeriesKey): number | null {
  const quarters = sortSeries(payload.quarterly[key]).slice(-4)
  if (quarters.length === 4) {
    const gaps = quarters.slice(1).map((point, index) =>
      (dateValue(point.endDate) - dateValue(quarters[index].endDate)) / 86_400_000,
    )
    if (gaps.every((gap) => gap >= 50 && gap <= 140)) {
      return quarters.reduce((sum, point) => sum + point.value, 0)
    }
  }
  return latestValue(payload.annual[key])
}

export function computeHeadlineMetrics(payload: FundamentalsPagePayload): FundamentalsHeadlineMetrics {
  const facts = payload.facts
  const revenue = reportedFlow(payload, 'revenue') ?? facts.totalRevenue
  const freeCashFlow = reportedFlow(payload, 'freeCashFlow') ?? facts.freeCashFlow
  const cash = latestValue(payload.quarterly.cashAndBonds)
    ?? latestValue(payload.annual.cashAndBonds)
    ?? facts.totalCash
  const debt = latestValue(payload.quarterly.totalDebt)
    ?? latestValue(payload.annual.totalDebt)
    ?? facts.totalDebt
  const peForPeg = facts.forwardPe ?? facts.trailingPe
  const growthPct = facts.earningsGrowth === null ? null : facts.earningsGrowth * 100
  const calculatedPeg = peForPeg !== null && growthPct !== null && growthPct > 0
    ? peForPeg / growthPct
    : facts.pegRatio
  return {
    pe: facts.trailingPe,
    forwardPe: facts.forwardPe,
    priceToSales: facts.priceToSales,
    peg: calculatedPeg,
    fcfMarginPct: freeCashFlow !== null && revenue ? (freeCashFlow / revenue) * 100 : null,
    evRevenue: facts.enterpriseValue !== null && revenue ? facts.enterpriseValue / revenue : null,
    evEbitda: facts.enterpriseValue !== null && facts.ebitda ? facts.enterpriseValue / facts.ebitda : null,
    netCash: cash !== null && debt !== null ? cash - debt : null,
    beta: facts.beta,
    marketCap: facts.marketCap,
  }
}

function preparedPoints(
  points: FundamentalSeriesPoint[],
  basis: FundamentalsGrowthBasis,
): FundamentalsChartPoint[] {
  const ordered = sortSeries(points)
  const growth = computeGrowth(ordered, basis)
  return ordered.map((point, index) => ({
    ...point,
    rawValue: point.value,
    growth: growth[index].growth,
    growthBaseline: growth[index].baseline,
    indexed: false,
    indexedBaseLabel: '',
    slot: 0,
  }))
}

export function buildFundamentalsCharts(
  primary: FundamentalsPagePayload,
  compare: FundamentalsPagePayload | null,
  settings: FundamentalsDisplaySettings,
): FundamentalsChartModel[] {
  const basis = settings.period === 'annual' ? 'prior_period' : settings.growthBasis
  const primaryMap = primary[settings.period]
  const compareMap = compare?.[settings.period] ?? null
  const comparing = Boolean(compareMap)
  return CHARTS.map((chart) => {
    const pending: Array<Omit<FundamentalsChartSeries, 'offset' | 'width'>> = []
    for (const [metric, label] of chart.metrics) {
      // Yahoo may append a price-date "Current" shares point. It is useful by itself,
      // but has no comparable fiscal label, so the reference hides it in compare mode.
      const primaryInput = comparing && metric === 'sharesOutstanding'
        ? primaryMap[metric].filter((point) => point.label !== 'Current')
        : primaryMap[metric]
      const primaryPoints = preparedPoints(primaryInput, basis)
      if (primaryPoints.length) {
        pending.push({
          metric,
          name: comparing ? `${primary.symbol} ${label}` : label,
          legendName: comparing ? primary.symbol : label,
          filled: true,
          points: primaryPoints,
        })
      }
      const compareInput = compareMap && comparing && metric === 'sharesOutstanding'
        ? compareMap[metric].filter((point) => point.label !== 'Current')
        : compareMap?.[metric] ?? []
      const comparePoints = preparedPoints(compareInput, basis)
      if (compare && comparePoints.length) {
        pending.push({
          metric,
          name: `${compare.symbol} ${label}`,
          legendName: compare.symbol,
          filled: false,
          points: comparePoints,
        })
      }
    }
    const allLabels = [...new Set(pending.flatMap((series) => series.points.map((point) => point.label)))]
      .sort((left, right) => left.localeCompare(right))
    const availablePeriods = allLabels.length
    const labels = allLabels.slice(-normalizePeriodCount(settings.periodCount))
    const visible = new Set(labels)
    const geometry = seriesBarGeometry(pending.length)
    const series = pending.map((entry, index) => {
      let points = entry.points.filter((point) => visible.has(point.label))
      if (settings.indexed) {
        const indexed = indexSeriesValues(points.map((point) => point.value))
        const baseLabel = points.find((point) => point.value !== 0)?.label ?? ''
        points = points.map((point, pointIndex) => ({
          ...point,
          value: indexed.values[pointIndex],
          indexed: true,
          indexedBaseLabel: baseLabel,
        }))
      }
      return {
        ...entry,
        ...geometry[index],
        points: points.map((point) => ({ ...point, slot: labels.indexOf(point.label) })),
      }
    })
    return {
      title: chart.title,
      labels,
      availablePeriods,
      indexed: settings.indexed,
      growthBasis: basis,
      series,
    }
  })
}

export function filterFundamentalsFilings(
  filings: SecFiling[],
  query: string,
  form: 'All' | '10-K' | '10-Q' | '8-K',
): SecFiling[] {
  const needle = query.trim().toLowerCase()
  return [...filings]
    .filter((filing) => form === 'All' || filing.form.toUpperCase().startsWith(form))
    .filter((filing) => !needle || Object.values(filing).some((value) => String(value).toLowerCase().includes(needle)))
    .sort((left, right) => right.filedDate.localeCompare(left.filedDate))
}
