import type { Envelope } from '../shared/contract.js'
import { MIB } from '../shared/cachePolicy.js'
import { POLYMARKET_ENDPOINTS, POLYMARKET_TTL, type PolymarketRequest, type PolymarketResult } from '../shared/polymarket.js'

const origins = { gamma: 'https://gamma-api.polymarket.com', clob: 'https://clob.polymarket.com', data: 'https://data-api.polymarket.com' }
const cache = new Map<string, { result: Envelope<PolymarketResult>; bytes: number }>()
const CACHE_BYTES = 16 * MIB
let cacheBytes = 0
const pending = new Map<string, Promise<Envelope<PolymarketResult>>>()
let cooldownUntil = 0

/** Only documented public GETs; callers cannot supply a URL, headers or credentials. */
export function polymarketUrl(request: PolymarketRequest): URL {
  const endpoint = POLYMARKET_ENDPOINTS.find(item => item.id === request?.endpoint)
  if (!endpoint) throw new Error('Unknown public Polymarket endpoint')
  let path = endpoint.path
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(request.params ?? {})) {
    const parameter = endpoint.params.find(item => item.name === name)
    if (!parameter || typeof value !== 'string' || value.length > 8000) throw new Error(`Invalid parameter: ${name}`)
    if (!value.trim()) continue
    if (parameter.location === 'path') {
      if (value === '.' || value === '..' || /[\\/]/.test(value)) throw new Error('Invalid path identifier')
      path = path.replace(`{${name}}`, encodeURIComponent(value))
    } else search.append(name, value)
  }
  for (const parameter of endpoint.params) {
    if (parameter.required && !request.params?.[parameter.name]?.trim()) throw new Error(`${parameter.name} is required`)
  }
  if (path.includes('{')) throw new Error('A path identifier is required')
  const url = new URL(path, origins[endpoint.group])
  url.search = search.toString()
  return url
}

export async function getPolymarket(request: PolymarketRequest): Promise<Envelope<PolymarketResult>> {
  let url: URL
  try { url = polymarketUrl(request) } catch (error) {
    return failure('', error)
  }
  const key = url.href
  const entry = cache.get(key)
  const saved = entry?.result
  if (entry) {
    cache.delete(key)
    cache.set(key, entry)
  }
  if (!request.force && saved && Date.now() < (saved.meta.expiresAt ?? 0)) return saved
  if (pending.has(key)) return pending.get(key)!
  const work = (async (): Promise<Envelope<PolymarketResult>> => {
    try {
      if (Date.now() < cooldownUntil) throw new Error('Polymarket rate limit cooldown; retry shortly')
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error', headers: { Accept: 'application/json' } })
      if (response.status === 429 || response.status === 503) {
        const wait = Number(response.headers.get('retry-after'))
        cooldownUntil = Date.now() + Math.min(300_000, Math.max(5, Number.isFinite(wait) ? wait : 30) * 1000)
      }
      if (!response.ok) throw new Error(`Polymarket returned HTTP ${response.status}`)
      const body = await response.text()
      if (body.length > 8_000_000) throw new Error('Response too large; narrow the query or reduce limit')
      const value = JSON.parse(body) as PolymarketResult['value']
      const fetchedAt = Date.now()
      const result: Envelope<PolymarketResult> = { data: { value, url: key }, meta: { source: 'Polymarket', freshness: 'fresh', fetchedAt, expiresAt: fetchedAt + POLYMARKET_TTL }, errors: [] }
      // Approximate the payload from the existing JSON text and keep it session-only.
      const bytes = (body.length + key.length) * 2
      cacheBytes -= cache.get(key)?.bytes ?? 0
      cache.delete(key)
      cache.set(key, { result, bytes })
      cacheBytes += bytes
      while (cacheBytes > CACHE_BYTES || cache.size > 160) {
        const oldest = cache.keys().next().value!
        cacheBytes -= cache.get(oldest)!.bytes
        cache.delete(oldest)
      }
      return result
    } catch (error) { return failure(key, error, saved) }
  })()
  pending.set(key, work)
  try { return await work } finally { pending.delete(key) }
}

function failure(url: string, error: unknown, saved?: Envelope<PolymarketResult>): Envelope<PolymarketResult> {
  const reason = error instanceof Error ? error.message : 'Public data request failed'
  return {
    data: saved?.data ?? { value: null, url },
    meta: { source: 'Polymarket', fetchedAt: saved?.meta.fetchedAt ?? 0, freshness: saved ? 'stale' : 'failed', failureReason: reason },
    errors: [{ source: 'Polymarket', operation: 'public read', reason }],
  }
}
