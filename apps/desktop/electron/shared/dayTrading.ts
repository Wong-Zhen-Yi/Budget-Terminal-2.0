import type { DayTradingResult, DayTradingSetup, DayTradingStatus, SignalsPageSettings, SignalsPayload } from './contract.js'
import { buildMarketHolidays } from './calendar.js'
import type { SignalBar } from './signals.js'

const MINUTE = 60_000
export const DAY_TRADING_REFRESH_MS = MINUTE
export const DAY_TRADING_MAX_AGE_MS = 2 * MINUTE
export const DAY_TRADING_SETUPS: Record<DayTradingSetup, string> = {
  opening_range: 'Opening range breakout',
  vwap_pullback: 'VWAP pullback',
}
export const DAY_TRADING_STATUSES: Record<DayTradingStatus, string> = {
  ready: 'Ready', watching: 'Watching', expired: 'Expired', invalidated: 'Invalidated',
  market_closed: 'Market closed', awaiting_data: 'Awaiting candles', stale: 'Delayed', error: 'Data error',
}
export const DEFAULT_DAY_TRADING_SETTINGS: SignalsPageSettings = { filter: 'all', setup: 'all', search: '' }

export function normalizeDayTradingSettings(value: unknown): SignalsPageSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    filter: input.filter === 'all' || Object.hasOwn(DAY_TRADING_STATUSES, String(input.filter))
      ? input.filter as SignalsPageSettings['filter'] : 'all',
    setup: Object.hasOwn(DAY_TRADING_SETUPS, String(input.setup)) ? input.setup as DayTradingSetup : 'all',
    search: String(input.search ?? '').slice(0, 32),
  }
}

const nyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
})
const holidayYears = new Map<number, ReturnType<typeof buildMarketHolidays>>()

export function dayTradingSession(now = Date.now()): { date: string; minute: number; open: boolean; closeMinute: number } {
  const parts = Object.fromEntries(nyFormatter.formatToParts(now).map((part) => [part.type, part.value]))
  const date = `${parts.year}-${parts.month}-${parts.day}`
  const minute = Number(parts.hour) * 60 + Number(parts.minute)
  const year = Number(parts.year)
  if (!holidayYears.has(year)) holidayYears.set(year, buildMarketHolidays(year))
  const holiday = holidayYears.get(year)!.find((entry) => entry.date === date)
  const closeMinute = holiday?.detail === '1:00 PM ET close' ? 780 : 960
  const open = parts.weekday !== 'Sat' && parts.weekday !== 'Sun' && holiday?.detail !== 'Closed all day'
    && minute >= 570 && minute < closeMinute
  return { date, minute, open, closeMinute }
}

/** Recompute time-dependent status even when no request is running or a request failed. */
export function dayTradingStatus(row: DayTradingResult, now = Date.now()): DayTradingStatus {
  const session = dayTradingSession(now)
  if (!session.open) return 'market_closed'
  if (row.error) return 'error'
  if (row.session !== session.date) return 'stale'
  if (!row.barTime) return 'awaiting_data'
  const barEnd = row.barTime ? Date.parse(row.barTime) + MINUTE : NaN
  if (!Number.isFinite(barEnd) || now - barEnd > DAY_TRADING_MAX_AGE_MS || barEnd > now) return 'stale'
  if (row.invalidatedAt) return 'invalidated'
  if (!row.confirmedAt) return 'watching'
  return now - Date.parse(row.confirmedAt) < DAY_TRADING_MAX_AGE_MS ? 'ready' : 'expired'
}

/** Explain feed health separately from the strategy's confirmation conditions. */
export function dayTradingDataMessage(row: DayTradingResult, now = Date.now()): string {
  if (row.error) return row.error
  const session = dayTradingSession(now)
  if (row.session !== session.date) return `Saved session ${row.session}. Waiting for a scan of today's session.`
  if (!row.barTime) return session.open
    ? session.minute < 571
      ? 'The first regular-session candle closes at 09:31 ET. Waiting for Yahoo to publish it.'
      : 'Yahoo has not returned a completed candle for this session. Automatic scans will retry; no setup can be confirmed yet.'
    : 'No completed regular-session candles for this date. Automatic scans resume when the market opens.'
  if (!session.open) return 'Market closed. These are saved regular-session candles, not live prices.'
  if (dayTradingStatus(row, now) === 'stale') return 'The latest completed candle is more than 2 minutes old. Signals are withheld until fresh candles arrive.'
  return 'Current completed candle received. Setup conditions are evaluated below.'
}

export function dayTradingVisible(row: DayTradingResult, settings: SignalsPageSettings): boolean {
  return (settings.filter === 'all' || row.status === settings.filter)
    && (settings.setup === 'all' || row.setup === settings.setup)
    && row.ticker.toUpperCase().includes(settings.search.trim().toUpperCase())
}

export function shouldRefreshDayTrading(now: number, visible: boolean, busy: boolean, lastStarted: number): boolean {
  return visible && !busy && dayTradingSession(now).open && now - lastStarted >= DAY_TRADING_REFRESH_MS
}

type CompleteBar = SignalBar & { open: number; high: number; low: number; volume: number }
function complete(bar: SignalBar): bar is CompleteBar {
  return [bar.open, bar.high, bar.low, bar.close, bar.volume].every((value) => value !== null && Number.isFinite(value))
    && bar.close > 0 && bar.open! > 0 && bar.low! > 0 && bar.volume! >= 0
    && bar.high! >= Math.max(bar.open!, bar.close) && bar.low! <= Math.min(bar.open!, bar.close)
}

/** Latest confirmation per ticker/setup in this session. Yahoo timestamps are bar starts. */
export function evaluateDayTrading(ticker: string, input: SignalBar[], now = Date.now(), providerError: string | null = null): DayTradingResult[] {
  const session = dayTradingSession(now)
  const byTime = new Map<number, SignalBar>()
  for (const bar of input) {
    if (!Number.isFinite(bar.timestamp) || bar.timestamp + MINUTE > now) continue
    const stamp = dayTradingSession(bar.timestamp)
    if (stamp.date === session.date && stamp.minute >= 570 && stamp.minute < session.closeMinute) byTime.set(bar.timestamp, bar)
  }
  const bars = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp)
  const last = bars.at(-1)
  const rows = (Object.keys(DAY_TRADING_SETUPS) as DayTradingSetup[]).map((setup): DayTradingResult => ({
    id: `${ticker}:${setup}:${session.date}:watching`, ticker, setup, session: session.date, status: 'watching',
    confirmedAt: null, invalidatedAt: null, barTime: last ? new Date(last.timestamp).toISOString() : null,
    latestPrice: last && Number.isFinite(last.close) ? last.close : null,
    entry: null, stop: null, target1: null, target2: null, openingHigh: null, openingLow: null, vwap: null,
    reasons: ['Waiting for the complete 09:30–09:35 ET opening range.'], error: providerError,
  }))
  const finish = () => rows.map((row) => ({ ...row, status: dayTradingStatus(row, now) }))
  if (!bars.length) return finish()
  const opening = bars.filter((bar) => dayTradingSession(bar.timestamp).minute < 575)
  const continuous = bars.every((bar, index) => complete(bar) && bar.timestamp % MINUTE === 0
    && (index === 0 ? dayTradingSession(bar.timestamp).minute === 570 : bar.timestamp - bars[index - 1].timestamp === MINUTE))
  if (!continuous || (session.minute >= 575 && opening.length !== 5)) {
    for (const row of rows) {
      row.error = providerError ?? 'Missing or incomplete regular-session bars; no setup can be confirmed.'
      row.reasons = [row.error]
    }
    return finish()
  }
  const valid = bars as CompleteBar[]
  let totalVolume = 0
  let totalValue = 0
  const vwaps = valid.map((bar) => {
    totalVolume += bar.volume
    totalValue += (bar.high + bar.low + bar.close) / 3 * bar.volume
    return totalVolume > 0 ? totalValue / totalVolume : null
  })
  for (const row of rows) row.vwap = vwaps.at(-1) ?? null
  if (opening.length !== 5) return finish()
  const high = Math.max(...opening.map((bar) => bar.high!))
  const low = Math.min(...opening.map((bar) => bar.low!))
  for (const row of rows) {
    row.openingHigh = high
    row.openingLow = low
    row.reasons = [row.setup === 'opening_range'
      ? 'Waiting for a close above the opening high and VWAP, following a close at or below the opening high.'
      : 'Waiting for a bullish VWAP touch and reclaim, following a close above VWAP.']
  }
  for (let i = 5; i < valid.length; i++) {
    const bar = valid[i]
    const previous = valid[i - 1]
    const vwap = vwaps[i]
    const previousVwap = vwaps[i - 1]
    for (const row of rows) {
      if (row.stop !== null && !row.invalidatedAt && bar.low <= row.stop) row.invalidatedAt = new Date(bar.timestamp + MINUTE).toISOString()
      if (vwap === null || previousVwap === null || bar.volume <= 0) continue
      const breakout = row.setup === 'opening_range'
      const qualifies = breakout
        ? bar.close > high && bar.close > vwap && previous.close <= high
        : previous.close > previousVwap && bar.low <= vwap && bar.close > vwap && bar.close > bar.open
      const stop = breakout ? low : bar.low
      const risk = bar.close - stop
      if (!qualifies || risk <= 0) continue
      row.confirmedAt = new Date(bar.timestamp + MINUTE).toISOString()
      row.id = `${ticker}:${row.setup}:${session.date}:${row.confirmedAt}`
      row.entry = bar.close
      row.stop = stop
      row.target1 = bar.close + risk
      row.target2 = bar.close + 2 * risk
      row.invalidatedAt = null
      row.reasons = breakout
        ? [`Confirmation close ${bar.close.toFixed(2)} exceeded opening high ${high.toFixed(2)} and VWAP ${vwap.toFixed(2)}.`, 'The preceding close was at or below the opening high. Stop: opening range low.']
        : [`The preceding close was above its VWAP. The confirmation bar touched VWAP ${vwap.toFixed(2)} and closed above it.`, 'The confirmation candle was bullish. Stop: pullback candle low.']
    }
  }
  return finish()
}

/** Reject superseded score payloads and malformed persisted trade levels. */
export function validDayTradingPayload(value: unknown, now = Date.now()): value is SignalsPayload {
  if (!value || typeof value !== 'object') return false
  const data = value as SignalsPayload
  const age = now - Date.parse(data.completedAt)
  return data.version === 5 && typeof data.session === 'string' && typeof data.marketOpen === 'boolean'
    && typeof data.source === 'string' && Array.isArray(data.candidates) && Array.isArray(data.results)
    && typeof data.errors === 'object' && data.errors !== null && age >= 0 && age <= 7 * 86_400_000
    && data.results.every((row) => row && typeof row.id === 'string' && typeof row.ticker === 'string'
      && typeof row.session === 'string' && Object.hasOwn(DAY_TRADING_SETUPS, row.setup)
      && Object.hasOwn(DAY_TRADING_STATUSES, row.status) && Array.isArray(row.reasons)
      && row.reasons.every((reason) => typeof reason === 'string')
      && [row.entry, row.stop, row.target1, row.target2, row.latestPrice, row.openingHigh, row.openingLow, row.vwap]
        .every((number) => number === null || (typeof number === 'number' && Number.isFinite(number)))
      && [row.confirmedAt, row.invalidatedAt, row.barTime].every((time) => time === null || (typeof time === 'string' && Number.isFinite(Date.parse(time))))
      && (row.error === null || typeof row.error === 'string'))
}
