import type { BackgroundRequest, EconomicPoint } from './contract.js'

export interface MoneyRequest extends BackgroundRequest {
  force?: boolean
}
export interface MoneyDefinition {
  seriesId: string
  label: string
  sourceUnits: 'millions' | 'billions'
  frequency: 'monthly' | 'weekly' | 'daily'
  seasonalAdjustment: 'SA' | 'NSA'
  definition: string
}
export interface MoneySeries extends MoneyDefinition {
  history: EconomicPoint[]
  fetchedAt: number | null
  status: 'fresh' | 'cached' | 'stale' | 'unavailable'
  error: string | null
}
export interface MoneyPayload {
  generatedAt: string
  rows: MoneySeries[]
}

export const MONEY_SERIES: readonly MoneyDefinition[] = [
  { seriesId: 'M2SL', label: 'M2 money supply', sourceUnits: 'billions', frequency: 'monthly', seasonalAdjustment: 'SA', definition: 'Broad money: M1 plus small time deposits and retail money market funds, with retirement-account adjustments.' },
  { seriesId: 'M1SL', label: 'M1 money supply', sourceUnits: 'billions', frequency: 'monthly', seasonalAdjustment: 'SA', definition: 'Currency and liquid deposits. Definition changed in May 2020 to include other liquid deposits; the historical jump reflects this change.' },
  { seriesId: 'BOGMBASE', label: 'Monetary base', sourceUnits: 'billions', frequency: 'monthly', seasonalAdjustment: 'NSA', definition: 'Currency in circulation plus reserve balances at Federal Reserve Banks.' },
  { seriesId: 'WALCL', label: 'Fed total assets', sourceUnits: 'millions', frequency: 'weekly', seasonalAdjustment: 'NSA', definition: 'Federal Reserve total assets, less consolidation eliminations. Wednesday level.' },
  { seriesId: 'WRESBAL', label: 'Bank reserve balances', sourceUnits: 'millions', frequency: 'weekly', seasonalAdjustment: 'NSA', definition: 'Reserve balances held with Federal Reserve Banks. Week average.' },
  { seriesId: 'WTREGEN', label: 'Treasury General Account', sourceUnits: 'millions', frequency: 'weekly', seasonalAdjustment: 'NSA', definition: 'US Treasury cash deposited at Federal Reserve Banks. Week average.' },
  { seriesId: 'RRPONTSYD', label: 'Overnight reverse repos', sourceUnits: 'billions', frequency: 'daily', seasonalAdjustment: 'NSA', definition: 'Treasury securities sold by the Fed through overnight reverse repurchase operations.' },
]

export function normalizeMoney(points: EconomicPoint[], units: MoneyDefinition['sourceUnits']): EconomicPoint[] {
  return [...new Map(points.filter(([date, value]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value))
    .map(([date, value]) => [date, units === 'millions' ? value / 1000 : value])).entries()].sort(([a], [b]) => a.localeCompare(b))
}

/** Missing comparisons remain null so charts break rather than implying a growth observation. */
export function moneyGrowth(points: EconomicPoint[], months: 1 | 12): Array<[string, number | null]> {
  const byMonth = new Map(points.map(([date, value]) => [date.slice(0, 7), value]))
  return points.map(([date, value]) => {
    const priorDate = new Date(`${date.slice(0, 7)}-01T00:00:00Z`)
    priorDate.setUTCMonth(priorDate.getUTCMonth() - months)
    const prior = byMonth.get(priorDate.toISOString().slice(0, 7))
    const growth = prior === undefined || prior === 0 ? null : (value / prior - 1) * 100
    return [date, growth !== null && Number.isFinite(growth) ? growth : null]
  })
}

export function moneyWindow<T extends [string, number | null]>(points: T[], years: number): T[] {
  if (!points.length) return []
  const cutoff = new Date(`${points.at(-1)![0]}T00:00:00Z`)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years)
  return points.filter(([date]) => date >= cutoff.toISOString().slice(0, 10))
}

export function moneyValue(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} B`
}
