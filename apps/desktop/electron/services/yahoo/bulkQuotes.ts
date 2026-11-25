import { TTL } from '../cache.js'
import { paced, yahoo } from './client.js'
import { isRateLimitError } from './rateGate.js'

/**
 * One `yahoo.quote` request for a whole page catalog instead of one per row.
 *
 * The Semiconductors and Homebuilders pages walk a fixed catalog with a few workers, and
 * each row's market lane asked Yahoo for its own quote. Yahoo's quote endpoint accepts a
 * symbol list, so the first lane to need a quote loads the whole catalog in a few chunked
 * requests and every other row reads from that snapshot. A symbol the snapshot omits
 * falls back to its own request, except when its chunk was rate-limited: sending dozens
 * of single requests into a 429 cooldown would only lengthen it.
 */

export const BULK_QUOTE_CHUNK_SIZE = 50
/** A forced refresh still shares a snapshot this young, so one refresh costs one bulk load. */
const FORCE_REUSE_MS = 10_000

type RawQuote = Record<string, unknown>

interface Snapshot {
  loadedAt: number
  quotes: Promise<{ quotes: Map<string, RawQuote>; failures: Map<string, unknown> }>
}

export interface BulkQuoteLoaderOptions {
  ttlMs?: number
  chunkSize?: number
  now?: () => number
  bulk?: (symbols: string[]) => Promise<unknown>
  single?: (symbol: string) => Promise<unknown>
}

export function createBulkQuoteLoader(catalog: readonly string[], options: BulkQuoteLoaderOptions = {}): (symbol: string, force?: boolean) => Promise<RawQuote> {
  const symbols = [...new Set(catalog.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))]
  const ttlMs = options.ttlMs ?? TTL.quotes
  const chunkSize = options.chunkSize ?? BULK_QUOTE_CHUNK_SIZE
  const now = options.now ?? Date.now
  const bulk = options.bulk ?? (chunk => paced(() => yahoo.quote(chunk)))
  const single = options.single ?? (symbol => paced(() => yahoo.quote(symbol)))
  let snapshot: Snapshot | null = null

  const load = (): Snapshot['quotes'] => (async () => {
    const quotes = new Map<string, RawQuote>()
    const failures = new Map<string, unknown>()
    const chunks: string[][] = []
    for (let index = 0; index < symbols.length; index += chunkSize) chunks.push(symbols.slice(index, index + chunkSize))
    await Promise.all(chunks.map(async chunk => {
      try {
        const result = await bulk(chunk)
        for (const row of Array.isArray(result) ? result : [result]) {
          const symbol = row && typeof row === 'object' ? String((row as RawQuote).symbol ?? '').toUpperCase() : ''
          if (symbol) quotes.set(symbol, row as RawQuote)
        }
      } catch (error) {
        for (const symbol of chunk) failures.set(symbol, error)
      }
    }))
    return { quotes, failures }
  })()

  return async (symbol, force = false) => {
    symbol = symbol.trim().toUpperCase()
    if (!symbols.includes(symbol)) return single(symbol) as Promise<RawQuote>
    const age = snapshot ? now() - snapshot.loadedAt : Infinity
    if (!snapshot || age >= (force ? Math.min(FORCE_REUSE_MS, ttlMs) : ttlMs)) {
      snapshot = { loadedAt: now(), quotes: load() }
    }
    const { quotes, failures } = await snapshot.quotes
    const hit = quotes.get(symbol)
    if (hit) return hit
    const failure = failures.get(symbol)
    if (failure !== undefined && isRateLimitError(failure)) throw failure
    return single(symbol) as Promise<RawQuote>
  }
}
