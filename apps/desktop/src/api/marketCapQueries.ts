import type { MarketCapTier } from '@shared/contract'
import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MARKET_CAP_TTL, marketCapInTier } from '@shared/marketCap'
import { api, queryKeys } from './client'
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
    staleTime: MARKET_CAP_TTL,
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
  const query = useQuery({
    queryKey: ['marketCapSales', [...symbols].sort().join(',')],
    queryFn: () => api.marketCapSales({ symbols, force: force.current || forcing() }),
    enabled: symbols.length > 0,
    staleTime: MARKET_CAP_TTL,
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
