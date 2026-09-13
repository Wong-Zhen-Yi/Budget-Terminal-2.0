import type { MarketCapTier } from '@shared/contract'
import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { marketCapInTier } from '@shared/marketCap'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

export function useMarketCap(tier: MarketCapTier) {
  const force = useRef(false)
  const query = useQuery({
    queryKey: queryKeys.marketCap(tier),
    queryFn: async () => {
      const result = await api.marketCap({ tier, force: force.current || forcing() })
      if (result.data.rows.some((row) => !marketCapInTier(row.marketCap, tier))) {
        throw new Error('The data service returned a different market-cap range. Restart Budget Terminal to load the updated service.')
      }
      return result
    },
    staleTime: queryFreshness(queryKeys.marketCap(tier)),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  })
  const refresh = async () => {
    force.current = true
    try { await query.refetch() } finally { force.current = false }
  }
  return { ...query, refresh }
}

export function useMarketCapSales(symbols: string[]) {
  const force = useRef(false)
  const key = ['marketCapSales', [...symbols].sort().join(',')] as const
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.marketCapSales({ symbols, force: force.current || forcing() }),
    enabled: symbols.length > 0,
    staleTime: queryFreshness(key),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  })
  const refresh = async () => {
    if (!symbols.length) return
    force.current = true
    try { await query.refetch() } finally { force.current = false }
  }
  return { ...query, refresh }
}
