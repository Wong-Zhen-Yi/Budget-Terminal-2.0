import type { Envelope, SignalsPayload } from '@shared/contract'
import { dayTradingSession, dayTradingStatus } from '@shared/dayTrading'

/** Market closure pauses scans; it does not repair incomplete saved observations. */
export function signalsHealth(envelope: Envelope<SignalsPayload | null> | undefined, now: number): Envelope<SignalsPayload | null> | undefined {
  const payload = envelope?.data
  if (!envelope || !payload || envelope.meta.freshness === 'failed') return envelope
  const incomplete = new Set([...Object.keys(payload.errors), ...payload.results.filter(row => row.error).map(row => row.ticker)])
  const delayed = dayTradingSession(now).open && payload.results.some(row => ['stale', 'error', 'awaiting_data'].includes(dayTradingStatus(row, now)))
  if (!incomplete.size && !delayed) return envelope
  return { ...envelope, meta: { ...envelope.meta, freshness: 'partial',
    failureReason: envelope.meta.failureReason || (incomplete.size
      ? `${incomplete.size} ticker(s) have incomplete data. Inspect their details.`
      : 'Missing or delayed candles; signals are withheld until complete data arrives.') } }
}
