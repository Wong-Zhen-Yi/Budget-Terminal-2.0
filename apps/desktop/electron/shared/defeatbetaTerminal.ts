import type { BackgroundRequest } from './contract.js'

export const DEFEATBETA_SECTIONS = ['prices', 'profile', 'officers', 'statements', 'shares', 'dividends', 'splits', 'earnings', 'news', 'transcripts', 'filings', 'breakdown'] as const
export type DefeatBetaSection = typeof DEFEATBETA_SECTIONS[number]
export type TerminalValue = string | number | boolean | null | TerminalValue[] | { [key: string]: TerminalValue }
export type TerminalRow = Record<string, TerminalValue>
export interface DefeatBetaTerminalRequest extends BackgroundRequest {
  symbol: string
  section: DefeatBetaSection
  force?: boolean
}
export interface DefeatBetaTerminalPayload {
  symbol: string
  section: DefeatBetaSection
  rows: TerminalRow[]
  publishedAt: number | null
  financialCurrency: string | null
  companyName: string | null
}

export const TERMINAL_TABS = ['Overview', 'Profile', 'Financials', 'Valuation', 'Growth', 'Profitability', 'DCF', 'News', 'SEC Filings', 'Breakdown'] as const
export const TERMINAL_TTL = 60 * 60_000
export const terminalNumber = (value: TerminalValue | undefined): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
export const terminalLabel = (value: string): string => value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())

export interface TerminalPricePoint {
  date: string
  time: number
  close: number
  ohlc: { open: number; high: number; low: number; close: number } | null
  volume: number | null
  averages: Array<number | null>
}

/** Keep real OHLC only; compute averages over the full history before selecting a view. */
export function terminalPricePoints(rows: TerminalRow[]): TerminalPricePoint[] {
  const unique = new Map<string, TerminalPricePoint>()
  for (const row of rows) {
    const date = String(row.report_date)
    const millis = Date.parse(`${date}T00:00:00Z`)
    const close = terminalNumber(row.close)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== date || close === null || close <= 0) continue
    const open = terminalNumber(row.open)
    const high = terminalNumber(row.high)
    const low = terminalNumber(row.low)
    const volume = terminalNumber(row.volume)
    const ohlc = open !== null && high !== null && low !== null && Math.min(open, low) > 0 && high >= Math.max(open, close, low) && low <= Math.min(open, close)
      ? { open, high, low, close } : null
    unique.set(date, { date, time: millis / 1000, close, ohlc, volume: volume !== null && volume >= 0 ? volume : null, averages: [] })
  }
  const points = [...unique.values()].sort((a, b) => a.time - b.time)
  const totals = [0, 0, 0]
  points.forEach((point, index) => {
    point.averages = [10, 50, 200].map((days, slot) => {
      totals[slot] += point.close
      if (index >= days) totals[slot] -= points[index - days].close
      return index + 1 >= days ? totals[slot] / days : null
    })
  })
  return points
}

export function statementPeriods(rows: TerminalRow[], period: string): string[] {
  return [...new Set(rows.filter(row => row.period_type === period && /^\d{4}-\d{2}-\d{2}$/.test(String(row.report_date))).map(row => String(row.report_date)))].sort().reverse()
}
export function statementValue(rows: TerminalRow[], item: string, date: string, period: string): number | null {
  return terminalNumber(rows.find(row => row.item_name === item && row.report_date === date && row.period_type === period)?.item_value)
}
export function terminalYoY(rows: TerminalRow[], item: string, date: string, period: string): number | null {
  const current = statementValue(rows, item, date, period)
  const year = Number(date.slice(0, 4)) - 1
  // Fiscal year ends can shift by a week in a 52/53-week calendar.
  const target = Date.parse(`${year}${date.slice(4)}`)
  const previousDate = statementPeriods(rows, period).find(candidate => Math.abs(Date.parse(candidate) - target) <= 8 * 86_400_000)
  const previous = previousDate ? statementValue(rows, item, previousDate, period) : null
  return current !== null && previous !== null && previous > 0 ? (current / previous - 1) * 100 : null
}

export function terminalDcf(fcf: number | null, shares: number | null, growth1: number, growth2: number, discount: number, terminal: number) {
  if (fcf === null || shares === null || fcf <= 0 || shares <= 0 ||
    ![growth1, growth2, discount, terminal].every(Number.isFinite) || growth1 <= -100 || growth2 <= -100 || discount <= 0 || terminal <= -100 || discount <= terminal) return null
  let cash = fcf
  let presentValue = 0
  const years = Array.from({ length: 10 }, (_, index) => {
    cash *= 1 + (index < 5 ? growth1 : growth2) / 100
    const discounted = cash / (1 + discount / 100) ** (index + 1)
    presentValue += discounted
    return { year: index + 1, cash, discounted }
  })
  const terminalValue = cash * (1 + terminal / 100) / ((discount - terminal) / 100) / (1 + discount / 100) ** 10
  const perShare = (presentValue + terminalValue) / shares
  return Number.isFinite(perShare) ? { perShare, presentValue, terminalValue, years } : null
}
