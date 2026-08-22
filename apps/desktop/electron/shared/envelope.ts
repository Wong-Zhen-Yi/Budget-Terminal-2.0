import type { Envelope, EnvelopeError, EnvelopeMeta, Freshness } from './contract.js'

export function meta(
  source: string,
  freshness: Freshness,
  extra: Partial<EnvelopeMeta> = {},
): EnvelopeMeta {
  return { source, freshness, fetchedAt: Date.now(), ...extra }
}

export function ok<T>(data: T, source = 'yahoo', extra: Partial<EnvelopeMeta> = {}): Envelope<T> {
  return { data, meta: meta(source, 'fresh', extra), errors: [] }
}

export function partial<T>(
  data: T,
  errors: EnvelopeError[],
  source = 'yahoo',
  failureReason = '',
): Envelope<T> {
  return {
    data,
    meta: meta(source, errors.length ? 'partial' : 'fresh', failureReason ? { failureReason } : {}),
    errors,
  }
}

export function failed<T>(data: T, reason: string, source = 'yahoo'): Envelope<T> {
  return {
    data,
    meta: meta(source, 'failed', { failureReason: reason }),
    errors: [{ source, reason, operation: 'fetch' }],
  }
}

export function err(
  source: string,
  reason: string,
  operation: string,
  symbol?: string,
): EnvelopeError {
  return symbol ? { source, reason, operation, symbol } : { source, reason, operation }
}

/** Turn an unknown thrown value into a one-line message. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}
