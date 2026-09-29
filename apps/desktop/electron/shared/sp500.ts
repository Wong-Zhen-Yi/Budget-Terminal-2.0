import type { BackgroundRequest } from './contract.js'

export const SP500_PARTS = ['constituents', 'market', 'history', 'holdings', 'valuation'] as const
export type Sp500Part = typeof SP500_PARTS[number]
export type Sp500Window = '1M' | '3M' | 'YTD' | '1Y' | '5Y'
export interface Sp500Request extends BackgroundRequest { part: Sp500Part; force?: boolean }
export interface Sp500Constituent {
  symbol: string
  security: string
  sector: string
  industry: string
  headquarters: string
  dateAdded: string | null
  cik: string
  founded: string
}
export interface Sp500Point { date: string; close: number }
export interface Sp500Holding { symbol: string; name: string; weight: number | null; sector: string }
export interface Sp500Value { label: string; value: number | null; unit: 'ratio' | 'percent'; asOf: string; basis: string; definition: string }
export interface Sp500Data {
  asOf: string
  source: string
  constituents?: Sp500Constituent[]
  market?: { symbol: string; price: number | null; change: number | null; asOf: string }[]
  history?: Record<string, Sp500Point[]>
  holdings?: { rows: Sp500Holding[]; partial: boolean }
  valuation?: Sp500Value[]
  warnings: string[]
}
export interface BreadthResult {
  session: string
  total: number
  valid: number
  advancing: number
  declining: number
  unchanged: number
  above50: number
  eligible50: number
  above200: number
  eligible200: number
  highs: number
  lows: number
  eligible252: number
}
export interface Sp500Breadth {
  id: string
  state: 'idle' | 'running' | 'complete' | 'cancelled' | 'failed'
  completed: number
  total: number
  failed: number
  startedAt: string
  completedAt: string
  result: BreadthResult | null
  error: string
}
export interface Sp500BreadthRequest { action: 'status' | 'start' | 'cancel'; id?: string; force?: boolean }
export const SP500_SECTORS = [
  ['XLK', 'Information Technology'], ['XLF', 'Financials'], ['XLV', 'Health Care'],
  ['XLY', 'Consumer Discretionary'], ['XLP', 'Consumer Staples'], ['XLC', 'Communication Services'],
  ['XLI', 'Industrials'], ['XLE', 'Energy'], ['XLU', 'Utilities'], ['XLB', 'Materials'], ['XLRE', 'Real Estate'],
] as const
export const symbolKey = (symbol: string): string => symbol.trim().toUpperCase().replace(/\./g, '-')
export function newestFirst(rows: Sp500Constituent[]): Sp500Constituent[] {
  return [...rows].sort((a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? '') || a.symbol.localeCompare(b.symbol))
}
export function movingAverage(rows: Sp500Point[], length: number): Array<number | null> {
  let sum = 0
  return rows.map((row, i) => {
    sum += row.close
    if (i >= length) sum -= rows[i - length].close
    return i >= length - 1 ? sum / length : null
  })
}
export function windowPoints(rows: Sp500Point[], window: Sp500Window): Sp500Point[] {
  if (!rows.length) return []
  const end = new Date(`${rows.at(-1)!.date}T00:00:00Z`)
  if (window === 'YTD') end.setUTCFullYear(end.getUTCFullYear(), 0, 1)
  else if (window === '1M' || window === '3M') end.setUTCMonth(end.getUTCMonth() - (window === '1M' ? 1 : 3))
  else end.setUTCFullYear(end.getUTCFullYear() - (window === '1Y' ? 1 : 5))
  const start = end.toISOString().slice(0, 10)
  // Use the last available close on/before the boundary; YTD starts at the prior year close.
  const first = rows.findLastIndex((row) => window === 'YTD' ? row.date < start : row.date <= start)
  return rows.slice(Math.max(0, first))
}
export function riskStats(rows: Sp500Point[]): { returnPct: number | null; drawdown: number | null; volatility: number | null } {
  if (rows.length < 2) return { returnPct: null, drawdown: null, volatility: null }
  let high = rows[0].close
  let drawdown = 0
  const returns: number[] = []
  rows.forEach((row, i) => {
    high = Math.max(high, row.close)
    drawdown = Math.min(drawdown, row.close / high - 1)
    if (i) returns.push(row.close / rows[i - 1].close - 1)
  })
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
  return { returnPct: (rows.at(-1)!.close / rows[0].close - 1) * 100, drawdown: drawdown * 100,
    volatility: returns.length > 1 ? Math.sqrt(variance * 252) * 100 : null }
}
export function alignedComparison(a: Sp500Point[], b: Sp500Point[], window: Sp500Window) {
  const lookup = new Map(b.map((row) => [row.date, row.close]))
  const common = windowPoints(a.filter((row) => lookup.has(row.date)), window)
  const first = common[0]
  return { dates: common.map((row) => row.date),
    a: common.map((row) => row.close / first.close * 100),
    b: common.map((row) => lookup.get(row.date)! / lookup.get(first.date)! * 100) }
}
export function diversification(rows: Sp500Constituent[], holdings: Sp500Holding[], partial: boolean) {
  const weights = new Map(holdings.map((row) => [symbolKey(row.symbol), row.weight]))
  const groups = (field: 'sector' | 'industry') => {
    const result = new Map<string, { label: string; count: number; countPct: number; weight: number; matched: number }>()
    for (const row of rows) {
      const label = row[field] || 'Unclassified'
      const group = result.get(label) ?? { label, count: 0, countPct: 0, weight: 0, matched: 0 }
      group.count++
      const weight = weights.get(symbolKey(row.symbol))
      if (weight != null && Number.isFinite(weight) && weight >= 0) { group.weight += weight * 100; group.matched++ }
      group.countPct = group.count / rows.length * 100
      result.set(label, group)
    }
    return [...result.values()].sort((a, b) => b.weight - a.weight || b.count - a.count || a.label.localeCompare(b.label))
  }
  const members = new Set(rows.map((row) => symbolKey(row.symbol)))
  const ranked = holdings.filter((row) => members.has(symbolKey(row.symbol)) && row.weight != null && row.weight >= 0)
    .sort((a, b) => b.weight! - a.weight!)
  const complete = !partial && rows.length > 0 && ranked.length === rows.length
  return { sectors: groups('sector'), industries: groups('industry'), ranked, matched: ranked.length,
    companies: new Set(rows.map((row) => row.cik || row.symbol)).size,
    concentration: [5, 10, 20].map((n) => complete ? ranked.slice(0, n).reduce((sum, row) => sum + row.weight! * 100, 0) : null),
    coveredWeight: ranked.reduce((sum, row) => sum + row.weight! * 100, 0) }
}
export function emptyBreadth(session: string, total: number): BreadthResult {
  return { session, total, valid: 0, advancing: 0, declining: 0, unchanged: 0, above50: 0, eligible50: 0,
    above200: 0, eligible200: 0, highs: 0, lows: 0, eligible252: 0 }
}
export function addBreadth(result: BreadthResult, points: Sp500Point[], sessions: string[]): void {
  const rows = points.filter((row) => row.date <= result.session)
  if (rows.at(-1)?.date !== result.session) return
  const dates = new Set(rows.map((row) => row.date))
  const eligible = (n: number) => rows.length >= n && sessions.length >= n && sessions.slice(-n).every((date) => dates.has(date))
  const close = rows.at(-1)!.close
  if (eligible(2)) {
    result.valid++
    const previous = rows.at(-2)!.close
    if (close > previous) result.advancing++
    else if (close < previous) result.declining++
    else result.unchanged++
  }
  if (eligible(50)) { result.eligible50++; if (close > rows.slice(-50).reduce((sum, row) => sum + row.close, 0) / 50) result.above50++ }
  if (eligible(200)) { result.eligible200++; if (close > rows.slice(-200).reduce((sum, row) => sum + row.close, 0) / 200) result.above200++ }
  if (eligible(252)) {
    result.eligible252++
    const prices = rows.slice(-252).map((row) => row.close)
    if (close >= Math.max(...prices)) result.highs++
    if (close <= Math.min(...prices)) result.lows++
  }
}
