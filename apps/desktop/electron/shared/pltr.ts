import type { FundamentalsPagePayload, FundamentalSeriesKey } from './contract.js'

const HISTORY_KEYS = ['revenue', 'netIncome', 'operatingCashFlow', 'freeCashFlow', 'sharesOutstanding', 'researchDevelopment'] as const

export interface PltrQuarter {
  endDate: string
  revenue: number | null
  netIncome: number | null
  operatingCashFlow: number | null
  freeCashFlow: number | null
  sharesOutstanding: number | null
  researchDevelopment: number | null
  revenueGrowth: number | null
  shareGrowth: number | null
  netMargin: number | null
  fcfMargin: number | null
}

const finite = (value: number | undefined): number | null => value != null && Number.isFinite(value) ? value : null
const ratio = (value: number | null, base: number | null) => value !== null && base !== null && base > 0 ? value / base * 100 : null

/** Align by fiscal date, including the year-ago quarter outside the displayed window. */
export function pltrHistory(financials: FundamentalsPagePayload | null): PltrQuarter[] {
  if (!financials) return []
  const series = financials.quarterly
  // Yahoo can append a price-date shares point; it is not a fiscal quarter.
  const valueAt = (key: FundamentalSeriesKey, date: string) => finite(series[key].find(point => point.endDate === date && point.label !== 'Current')?.value)
  const dates = [...new Set(HISTORY_KEYS.flatMap(key => series[key].filter(point => point.label !== 'Current').map(point => point.endDate)))].sort()
  return dates.slice(-8).map(endDate => {
    const previousYear = `${Number(endDate.slice(0, 4)) - 1}${endDate.slice(4)}`
    const revenue = valueAt('revenue', endDate)
    const netIncome = valueAt('netIncome', endDate)
    const freeCashFlow = valueAt('freeCashFlow', endDate)
    const sharesOutstanding = valueAt('sharesOutstanding', endDate)
    const growth = (value: number | null, key: FundamentalSeriesKey) => {
      const base = valueAt(key, previousYear)
      return value !== null && base !== null && base > 0 ? (value / base - 1) * 100 : null
    }
    return { endDate, revenue, netIncome, freeCashFlow, sharesOutstanding,
      operatingCashFlow: valueAt('operatingCashFlow', endDate), researchDevelopment: valueAt('researchDevelopment', endDate),
      revenueGrowth: growth(revenue, 'revenue'), shareGrowth: growth(sharesOutstanding, 'sharesOutstanding'),
      netMargin: ratio(netIncome, revenue), fcfMargin: ratio(freeCashFlow, revenue) }
  })
}
