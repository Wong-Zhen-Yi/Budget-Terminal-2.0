import type { UpDownInterval, UpDownRow, UpDownSource } from './contract.js'

export const UP_DOWN_SOURCES: ReadonlyArray<{ key: UpDownSource; label: string }> = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'spy', label: 'SPY Holdings' },
  { key: 'qqq', label: 'QQQ Holdings' },
  { key: 'custom', label: 'Custom' },
]

export const UP_DOWN_INTERVALS: ReadonlyArray<{ key: UpDownInterval; label: string }> = [
  { key: '1d', label: '1D' },
  { key: '5d', label: '5D' },
  { key: '30d', label: '30D' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
]

export interface UpDownCloseSeries {
  dates: string[]
  values: number[]
}

export function normalizeUpDownSymbols(value: unknown): string[] {
  const raw = typeof value === 'string'
    ? value.replace(/[,;]/g, ' ').split(/\s+/)
    : Array.isArray(value)
      ? value
      : []
  const seen = new Set<string>()
  const symbols: string[] = []
  for (const entry of raw) {
    const symbol = String(entry ?? '').trim().toUpperCase()
    // Issuer baskets include cash and temporary numeric security IDs, which are
    // not Yahoo equity tickers. Preserve valid classes and international suffixes.
    if (!symbol || symbol === 'CASH' || seen.has(symbol) || !/^(?:[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*|\d+\.[A-Z]+)$/.test(symbol)) continue
    seen.add(symbol)
    symbols.push(symbol)
  }
  return symbols
}

function subtractYear(date: string): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCFullYear(value.getUTCFullYear() - 1)
  return value.toISOString().slice(0, 10)
}

function selectedChangeIndexes(dates: string[], interval: UpDownInterval): number[] {
  const indexes = Array.from({ length: Math.max(0, dates.length - 1) }, (_, index) => index + 1)
  if (interval === '1d') return indexes.slice(-1)
  if (interval === '5d') return indexes.slice(-5)
  if (interval === '30d') return indexes.slice(-30)
  const latest = dates.at(-1) ?? ''
  const start = interval === 'ytd' ? `${latest.slice(0, 4)}-01-01` : subtractYear(latest)
  return indexes.filter((index) => dates[index] >= start)
}

export function calculateUpDownRow(
  ticker: string,
  series: UpDownCloseSeries,
  interval: UpDownInterval,
  name = '',
): UpDownRow | null {
  const length = Math.min(series.dates.length, series.values.length)
  const points = Array.from({ length }, (_, index) => ({
    date: series.dates[index],
    value: Number(series.values[index]),
  }))
    .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.value) && point.value > 0)
    .sort((left, right) => left.date.localeCompare(right.date))
  const deduped = [...new Map(points.map((point) => [point.date, point])).values()]
  if (deduped.length < 2) return null

  const dates = deduped.map((point) => point.date)
  const values = deduped.map((point) => point.value)
  const selected = selectedChangeIndexes(dates, interval)
  if (!selected.length) return null
  const changes = selected.map((index) => values[index] - values[index - 1])
  const base = values[selected[0] - 1]
  const lastClose = values.at(-1) as number
  return {
    ticker: ticker.trim().toUpperCase(),
    name: name.trim(),
    lastClose,
    intervalReturn: base ? ((lastClose - base) / base) * 100 : null,
    tradingDays: selected.length,
    daysUp: changes.filter((value) => value > 0).length,
    daysDown: changes.filter((value) => value < 0).length,
    flatDays: changes.filter((value) => value === 0).length,
  }
}

export function sortUpDownRows(rows: UpDownRow[]): UpDownRow[] {
  return [...rows].sort(
    (left, right) =>
      right.daysUp - left.daysUp ||
      left.daysDown - right.daysDown ||
      left.ticker.localeCompare(right.ticker),
  )
}

export function analystTargetDisplay(
  currentPrice: number | null,
  target: number | null | undefined,
): { text: string; upside: number | null } {
  if (
    typeof currentPrice !== 'number' ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0 ||
    typeof target !== 'number' ||
    !Number.isFinite(target) ||
    target <= 0
  ) {
    return { text: 'N/A', upside: null }
  }
  const upside = ((target - currentPrice) / currentPrice) * 100
  const targetText = Math.abs(target - Math.round(target)) < 0.005
    ? Math.round(target).toLocaleString('en-US')
    : target.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const upsideText = Math.abs(upside - Math.round(upside)) < 0.05
    ? upside.toFixed(0)
    : upside.toFixed(1)
  return {
    text: `$${targetText} (${upside >= 0 ? '+' : ''}${upsideText}%)`,
    upside,
  }
}
