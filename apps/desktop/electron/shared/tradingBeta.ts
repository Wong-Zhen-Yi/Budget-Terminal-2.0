import type { MarketCapPoint } from './contract.js'

export const BETA_WINDOW = 60

/** Exact matching return endpoints; gaps never become mismatched multi-day returns. */
export function rollingBeta(
  stock: { dates: string[]; values: number[] },
  market: { dates: string[]; values: number[] },
): MarketCapPoint[] {
  const prices = new Map(stock.dates.map((date, i) => [date, stock.values[i]]))
  const window: Array<{ x: number; y: number } | null> = []
  const result: MarketCapPoint[] = []
  for (let i = 1; i < market.dates.length; i++) {
    const a = prices.get(market.dates[i - 1])
    const b = prices.get(market.dates[i])
    const m = market.values[i - 1]
    const n = market.values[i]
    const valid = [a, b, m, n].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
    window.push(valid ? { x: n / m - 1, y: b! / a! - 1 } : null)
    if (window.length > BETA_WINDOW) window.shift()
    if (window.length < BETA_WINDOW || window.some((p) => p === null)) continue
    const pairs = window as Array<{ x: number; y: number }>
    const mx = pairs.reduce((sum, p) => sum + p.x, 0) / BETA_WINDOW
    const my = pairs.reduce((sum, p) => sum + p.y, 0) / BETA_WINDOW
    const variance = pairs.reduce((sum, p) => sum + (p.x - mx) ** 2, 0)
    if (variance < 1e-20) continue
    const value = pairs.reduce((sum, p) => sum + (p.x - mx) * (p.y - my), 0) / variance
    if (Number.isFinite(value)) result.push({ date: market.dates[i], value })
  }
  return result
}
