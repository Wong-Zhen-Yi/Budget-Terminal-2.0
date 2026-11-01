import { dayTradingSession } from './dayTrading.js'
import { nextMarketOpen } from './marketOpenReminder.js'

const MINUTE = 60_000
const FINALIZE_MS = 20 * MINUTE

function timestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  // Yahoo's decoded metadata uses Dates; tolerate raw epoch seconds as well.
  return typeof value === 'number' && Number.isFinite(value) ? value * 1000 : NaN
}

/** Regular-session stock prices stay useful overnight. Unknown markets keep their normal cadence. */
export function regularMarketRefreshAt(meta: unknown, intervalMs: number, now = Date.now()): number {
  const normal = now + intervalMs
  if (!meta || typeof meta !== 'object') return normal
  const market = meta as {
    instrumentType?: string
    exchangeTimezoneName?: string
    currentTradingPeriod?: { regular?: { start?: unknown; end?: unknown } }
  }
  // This calendar belongs to US cash equities, never futures, FX or 24/7 perpetuals.
  if (!['EQUITY', 'ETF'].includes(market.instrumentType ?? '')
    || market.exchangeTimezoneName !== 'America/New_York') return normal
  const start = timestamp(market.currentTradingPeriod?.regular?.start)
  const end = timestamp(market.currentTradingPeriod?.regular?.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return normal
  const session = dayTradingSession(now)
  // Keep checking through the close so delayed final bars can settle. The calendar
  // also prevents yesterday's metadata from suppressing today's live session.
  if (session.open || dayTradingSession(now - FINALIZE_MS).open
    || (now >= start && now < end + FINALIZE_MS)) return normal
  const next = Math.min(nextMarketOpen(now), start > now ? start : Infinity)
  return next
}
