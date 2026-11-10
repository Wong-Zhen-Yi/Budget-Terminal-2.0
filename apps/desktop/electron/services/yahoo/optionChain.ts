import { cache, TTL } from '../cache.js'
import { paced, yahoo } from './client.js'

// Raw Yahoo payloads have their own namespace: existing optchain/optpage entries
// contain incompatible, derived rows. The shared cache retains source provenance.
export function rawOptionListing(ticker: string, force = false) {
  const symbol = ticker.trim().toUpperCase()
  return cache.resolve(`options:raw:v1:${symbol}:listing`, TTL.options,
    () => paced(() => yahoo.options(symbol)), { force }).then(result => result.value)
}

export function rawOptionChain(ticker: string, expiration: string, force = false) {
  const symbol = ticker.trim().toUpperCase()
  return cache.resolve(`options:raw:v1:${symbol}:${expiration}`, TTL.options,
    async () => {
      const result = await paced(() => yahoo.options(symbol, { date: expiration }))
      if (!result.options?.[0]) throw new Error(`No options chain returned for ${symbol} ${expiration}.`)
      return result
    }, { force }).then(result => result.value)
}

/** Preserve the Date[] contract shared with older consumers and persisted caches. */
export function optionExpiries(ticker: string, force = false): Promise<Date[]> {
  const symbol = ticker.trim().toUpperCase()
  return cache.resolve(`optexp:${symbol}`, TTL.options,
    async () => (await rawOptionListing(symbol, force)).expirationDates ?? [], { force })
    .then(result => result.value)
}
