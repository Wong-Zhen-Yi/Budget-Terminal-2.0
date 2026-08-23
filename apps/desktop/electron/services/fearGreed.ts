import type { FearGreedPayload, FearGreedRow } from '../shared/contract.js'
import { fearGreedTimestamp, fgRating } from '../shared/preMarket.js'
import { cache, TTL } from './cache.js'

/**
 * CNN's Fear & Greed Index, ported from `_fetch_fear_greed`.
 *
 * This is the one network call in the app that is not Yahoo, so it deliberately does not
 * go through `paced()`: the rate gate models Yahoo's 429 behaviour and halves its budget
 * on one, and putting an unrelated host behind it would let a CNN hiccup throttle the
 * dashboard. It is a single request per refresh either way.
 *
 * The endpoint is unauthenticated but the edge rejects a default agent, so the browser
 * `User-Agent` *and* the `Referer` are both required. Only `fear_and_greed` is read; the
 * response also carries the component series (`market_momentum_sp500`,
 * `stock_price_strength`, ...) and the full history, which the page has no use for.
 */

const URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata'
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://edition.cnn.com/markets/fear-and-greed',
}

export const FEAR_GREED_SOURCE = 'cnn fear & greed'

/** The four history rows, in the order the panel prints them. */
const HISTORY_KEYS: ReadonlyArray<{ key: string; period: string }> = [
  { key: 'previous_close', period: 'Previous close' },
  { key: 'previous_1_week', period: '1 week ago' },
  { key: 'previous_1_month', period: '1 month ago' },
  { key: 'previous_1_year', period: '1 year ago' },
]

/** `round(float(score), 1)`, or null for anything unusable. */
function score(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return null
  return Math.round(parsed * 10) / 10
}

/** `rating.title()`: CNN sends `extreme fear`, the panel shows `Extreme Fear`. */
function titleCase(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '--'
  return value.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
}

async function fetchFearGreed(): Promise<FearGreedPayload> {
  const response = await fetch(URL, { headers: HEADERS, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`CNN returned HTTP ${response.status}.`)
  const body = (await response.json()) as { fear_and_greed?: Record<string, unknown> }
  const fg = body.fear_and_greed
  if (!fg) throw new Error('CNN response carried no fear_and_greed block.')

  const history: FearGreedRow[] = HISTORY_KEYS.map(({ key, period }) => {
    const value = score(fg[key])
    return { period, score: value, rating: fgRating(value) }
  })

  return {
    score: score(fg.score),
    rating: titleCase(fg.rating),
    timestamp: fearGreedTimestamp(fg.timestamp),
    history,
  }
}

export function getFearGreed(force = false): Promise<FearGreedPayload> {
  return cache
    .resolve('pre-market:fear-greed', TTL.fearGreed, fetchFearGreed, { force })
    .then((result) => result.value)
}
