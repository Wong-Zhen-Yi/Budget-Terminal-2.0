import type { QueryClient } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'
import { api } from './client'
import { warmStartupQuery, type StartupSnapshotObserver } from './warmQueue'
import { POLYMARKET_TTL, type Json, type PolymarketRequest } from '@shared/polymarket'

export const marketRequest: PolymarketRequest = { endpoint: 'gamma:/markets', params: { closed: 'false', limit: '25', offset: '0', order: 'volume24hr', ascending: 'false' } }
export const boardRequest: PolymarketRequest = { endpoint: 'data:/v2/leaderboard', params: { limit: '25', time_period: 'day' } }
export const polyKey = (request: PolymarketRequest) => ['polymarket', request.endpoint, request.params ?? {}] as const
export function usePolymarket(request: PolymarketRequest, enabled = true, live = false) {
  return useQuery({ queryKey: polyKey(request), queryFn: () => api.polymarket({ ...request, force: true }), enabled, staleTime: POLYMARKET_TTL, refetchInterval: live ? POLYMARKET_TTL : false, retry: false })
}
export function object(value: Json | undefined): Record<string, Json> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
export function rows(value: Json | undefined): Record<string, Json>[] {
  const data = Array.isArray(value) ? value : object(value).data
  return Array.isArray(data) ? data.map(item => object(item)) : []
}
export function list(value: Json | undefined): string[] {
  if (typeof value === 'string') { try { return list(JSON.parse(value)) } catch { return [] } }
  return Array.isArray(value) ? value.map(String) : []
}
export function marketDetails(market: Record<string, Json>): PolymarketRequest[] {
  const token = list(market.clobTokenIds)[0]
  const condition = String(market.conditionId ?? '')
  return [
    ...(token ? [
      { endpoint: 'clob:/book', params: { token_id: token } },
      { endpoint: 'data:/v2/prices-history', params: { token_id: token, interval: '1w' } },
    ] : []),
    ...(condition ? [
      { endpoint: 'data:/v2/trades', params: { condition, limit: '25' } },
      { endpoint: 'data:/v2/oi', params: { condition } },
      { endpoint: 'data:/v2/holders', params: { condition, limit: '20' } },
    ] : []),
  ]
}

/** Warm the actual opening workspace, including its first market's detail panels. */
export async function warmPolymarket(client: QueryClient, onSnapshot?: StartupSnapshotObserver) {
  const load = async (request: PolymarketRequest) => {
    const key = polyKey(request)
    const result = await warmStartupQuery(client, { queryKey: key, queryFn: () => api.polymarket({ ...request, background: true }), staleTime: POLYMARKET_TTL }, onSnapshot)
    return result
  }
  const [markets] = await Promise.all([load(marketRequest), load(boardRequest)])
  const first = rows(markets.data.value)[0]
  if (first) await Promise.all(marketDetails(first).map(load))
}
