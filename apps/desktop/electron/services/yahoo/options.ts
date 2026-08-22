import type { OptionBucket, OptionRow, OptionsPayload } from '../../shared/contract.js'
import { OPTION_BUCKETS } from '../../shared/contract.js'
import { cache, TTL } from '../cache.js'
import { paced, yahoo } from './client.js'

/** `YYYY-MM-DD` in UTC, the form Yahoo publishes expirations in. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Pick one expiration per bucket: the first listed expiry at or after today plus the
 * bucket's offset, falling back to the furthest available. This is
 * `_select_option_expiry_buckets` from the PySide6 app, so both apps show the same
 * three chains.
 */
export function selectBucketExpirations(expirations: Date[]): Map<string, string> {
  const selected = new Map<string, string>()
  const sorted = [...expirations].sort((a, b) => a.getTime() - b.getTime())
  if (!sorted.length) return selected

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  for (const bucket of OPTION_BUCKETS) {
    const target = startOfToday.getTime() + bucket.daysOut * 24 * 60 * 60 * 1000
    const match = sorted.find((date) => date.getTime() >= target) ?? sorted[sorted.length - 1]
    selected.set(bucket.key, isoDate(match))
  }
  return selected
}

function toRows(symbol: string, expiration: string, chain: {
  calls: Array<Record<string, unknown>>
  puts: Array<Record<string, unknown>>
}): OptionRow[] {
  const rows: OptionRow[] = []
  const push = (contract: Record<string, unknown>, type: 'Call' | 'Put') => {
    const strike = Number(contract.strike)
    if (!Number.isFinite(strike)) return
    rows.push({
      ticker: symbol,
      type,
      strike,
      expiration,
      lastPrice: Number(contract.lastPrice) || 0,
      volume: Number(contract.volume) || 0,
      openInterest: Number(contract.openInterest) || 0,
      impliedVolatility: Number(contract.impliedVolatility) || 0,
      inTheMoney: Boolean(contract.inTheMoney),
    })
  }
  chain.calls.forEach((contract) => push(contract, 'Call'))
  chain.puts.forEach((contract) => push(contract, 'Put'))
  // Calls and puts share one ranking, top 10 by volume, exactly as the PySide6 tables do.
  return rows.sort((a, b) => b.volume - a.volume).slice(0, 10)
}

async function fetchExpirations(symbol: string): Promise<Date[]> {
  const result = await paced(() => yahoo.options(symbol))
  return result.expirationDates ?? []
}

async function fetchBucket(symbol: string, expiration: string): Promise<OptionRow[]> {
  const result = await paced(() => yahoo.options(symbol, { date: expiration }))
  const chain = result.options?.[0]
  if (!chain) return []
  return toRows(symbol, expiration, {
    calls: (chain.calls ?? []) as Array<Record<string, unknown>>,
    puts: (chain.puts ?? []) as Array<Record<string, unknown>>,
  })
}

export async function getOptions(symbol: string, force = false): Promise<OptionsPayload> {
  const expirations = (
    await cache.resolve(`optexp:${symbol}`, TTL.options, () => fetchExpirations(symbol), { force })
  ).value

  const selected = selectBucketExpirations(expirations)

  // The three chains are independent requests; the rate gate paces them, so firing them
  // together costs one round trip instead of three.
  const buckets = await Promise.all(
    OPTION_BUCKETS.map(async (bucket): Promise<OptionBucket> => {
      const expiration = selected.get(bucket.key) ?? ''
      if (!expiration) {
        return { key: bucket.key, label: bucket.label, expiration: '', rows: [] }
      }
      try {
        const rows = (
          await cache.resolve(
            `optchain:${symbol}:${expiration}`,
            TTL.options,
            () => fetchBucket(symbol, expiration),
            { force },
          )
        ).value
        return { key: bucket.key, label: bucket.label, expiration, rows }
      } catch {
        // A bucket that fails renders empty with its attempted expiry still shown.
        return { key: bucket.key, label: bucket.label, expiration, rows: [] }
      }
    }),
  )

  return { symbol, buckets }
}
