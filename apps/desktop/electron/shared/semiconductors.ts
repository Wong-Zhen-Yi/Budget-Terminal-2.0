import type { BackgroundRequest, NewsArticle } from './contract.js'
import { FRESHNESS } from './freshness.js'

export const SEMICONDUCTOR_GROUPS = [
  { id: 'design', label: 'Chip design', description: 'Fabless compute, connectivity, analog and specialty chip designers.' },
  { id: 'integrated', label: 'Integrated manufacturers', description: 'Companies designing and manufacturing their own semiconductors.' },
  { id: 'foundry', label: 'Foundries', description: 'Contract wafer fabrication and process development.' },
  { id: 'memory', label: 'Memory', description: 'DRAM, NAND and specialty nonvolatile memory.' },
  { id: 'equipment', label: 'Equipment', description: 'Wafer fabrication, deposition, etch and process control equipment.' },
  { id: 'test-packaging', label: 'Test & packaging', description: 'Chip assembly, advanced packaging, test and inspection.' },
  { id: 'eda-ip', label: 'Design software & IP', description: 'Electronic design automation, semiconductor IP and yield software.' },
  { id: 'materials', label: 'Materials & suppliers', description: 'Wafers, masks, chemicals and specialist components for chip manufacturing.' },
] as const
export type SemiconductorGroup = (typeof SEMICONDUCTOR_GROUPS)[number]['id']
export interface SemiconductorCompany {
  symbol: string
  name: string
  group: SemiconductorGroup
  headquarters: string
  country: 'United States'
  exchange: 'Nasdaq' | 'NYSE' | 'NYSE American'
  rationale: string
  diversified: boolean
  cik: string
  sourceUrls: string[]
  reviewedAt: string
}
export interface SemiconductorsRequest extends BackgroundRequest { force?: boolean }
export type SemiconductorStatus = 'loaded' | 'partial' | 'stale' | 'unavailable'
export interface SemiconductorPoint { date: string; close: number }
export interface SemiconductorMarket {
  priceSource?: string
  changeBasis?: '24h' | 'previous-close'
  price: number | null
  dailyChange: number | null
  marketCap: number | null
  quoteTime: number | null
  history: SemiconductorPoint[]
}
export interface SemiconductorProfile {
  description: string
  trailingPe: number | null
  forwardPe: number | null
  revenue: number | null
  revenueGrowth: number | null
  grossMargin: number | null
  earningsDate: number | null
}
export interface SemiconductorRow {
  company: SemiconductorCompany
  market: SemiconductorMarket | null
  profile: SemiconductorProfile | null
  news: NewsArticle[]
  progress: Record<'market' | 'profile' | 'news', SemiconductorStatus>
  fetchedAt: Record<'market' | 'profile' | 'news', number | null>
}
export interface SemiconductorsPayload { rows: SemiconductorRow[]; fetchedAt: number; catalogReviewedAt: string }

export function semiconductorLaneStatus(row: SemiconductorRow, lane: keyof SemiconductorRow['progress'], now: number): SemiconductorStatus {
  const status = row.progress[lane]
  const time = row.fetchedAt[lane]
  const ttl = { market: FRESHNESS.semiconductors, profile: FRESHNESS.profile, news: FRESHNESS.news }[lane]
  return status !== 'unavailable' && time !== null && now - time > ttl ? 'stale' : status
}

export function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
export function priceReturn(history: SemiconductorPoint[], targetDate: string): number | null {
  const last = history.at(-1)
  const base = history.findLast(point => point.date <= targetDate)
  return last && base && finite(last.close) !== null && finite(base.close) !== null && last.close > 0 && base.close > 0 && base !== last ? (last.close / base.close - 1) * 100 : null
}
export function rowReturns(row: SemiconductorRow, now = Date.now()) {
  const today = new Date(now)
  const month = new Date(now)
  // Subtract a calendar month, clamping to its last day rather than overflowing.
  const day = month.getUTCDate()
  month.setUTCDate(1)
  month.setUTCMonth(month.getUTCMonth() - 1)
  const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate()
  month.setUTCDate(Math.min(day, end))
  return {
    month: priceReturn(row.market?.history ?? [], month.toISOString().slice(0, 10)),
    ytd: priceReturn(row.market?.history ?? [], `${today.getUTCFullYear() - 1}-12-31`),
  }
}
export function semiconductorOverview(rows: SemiconductorRow[]) {
  const caps = rows.flatMap(row => {
    const cap = finite(row.market?.marketCap)
    return cap !== null && cap > 0 ? [cap] : []
  })
  const changes = rows.flatMap(row => finite(row.market?.dailyChange) === null ? [] : [row.market!.dailyChange!])
  return { count: rows.length, marketCap: caps.reduce((sum, cap) => sum + cap, 0), capCount: caps.length,
    daily: changes.length ? changes.reduce((sum, change) => sum + change, 0) / changes.length : null,
    quoteCount: changes.length, advancing: changes.filter(change => change > 0).length,
    declining: changes.filter(change => change < 0).length, unchanged: changes.filter(change => change === 0).length }
}
/** Same starting session for every comparison; gaps remain gaps, never zero returns. */
export function semiconductorComparison(rows: SemiconductorRow[], startDate: string) {
  const usable = rows.filter(row => row.market?.history.length)
  const maps = usable.map(row => new Map(row.market!.history.filter(point => point.date >= startDate).map(point => [point.date, point.close])))
  const dates = [...new Set(maps.flatMap(map => [...map.keys()]))].sort()
  const base = dates.find(date => maps.every(map => (map.get(date) ?? 0) > 0))
  if (!base) return { dates: [], series: [] }
  const labels = dates.filter(date => date >= base)
  return { dates: labels, series: usable.map((row, index) => ({ symbol: row.company.symbol,
    values: labels.map(date => maps[index].has(date) ? (maps[index].get(date)! / maps[index].get(base)! - 1) * 100 : null) })) }
}
export function semiconductorNews(rows: SemiconductorRow[]): NewsArticle[] {
  const seen = new Set<string>()
  return rows.flatMap(row => row.news).sort((a, b) => b.publishedAt - a.publishedAt).filter(article => {
    const key = article.url || article.id
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
