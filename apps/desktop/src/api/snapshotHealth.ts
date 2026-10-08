import { useEffect, useState } from 'react'
import type { Envelope, EnvelopeError, Freshness } from '@shared/contract'

const lifetimes = new WeakMap<object, number>()

/** Query keys supply the refresh policy; source names are display text, not policy. */
export function registerSnapshot(envelope: unknown, freshnessMs: number): void {
  if (envelope && typeof envelope === 'object') lifetimes.set(envelope, freshnessMs)
}

export function snapshotLifetime(envelope: Envelope<unknown>): number | undefined {
  return lifetimes.get(envelope)
}

export function effectiveFreshness(envelope: Envelope<unknown>, now = Date.now(), freshnessMs = snapshotLifetime(envelope)): Freshness {
  const freshness = envelope.meta.freshness
  if ((freshness === 'fresh' || freshness === 'cached') && (
    (typeof envelope.meta.expiresAt === 'number' && now > envelope.meta.expiresAt) ||
    (typeof freshnessMs === 'number' && now - envelope.meta.fetchedAt > freshnessMs))) return 'stale'
  return freshness
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return error ? String(error) : ''
}

/** Generic cache failures have a source but no page-specific symbol/lane. */
export function feedErrorText(error: EnvelopeError): string {
  const label = error.symbol || error.source
  return `${label ? `${label}: ` : ''}${error.reason}`
}

/** Age badges tick without requesting data or reshuffling a reader's page. */
export function useSnapshotClock(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
