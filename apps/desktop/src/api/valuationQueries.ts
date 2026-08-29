import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, ValuationPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

/**
 * The Valuation page has no refresh timer, like `init_page23`, which creates none: a load
 * is a 16-peer fan-out plus statements, and the reference only ever refetches on Load, on
 * a peer-list change and on F5.
 */
export function useValuation(
  symbol: string,
  customPeers: string[],
  enabled: boolean,
): UseQueryResult<Envelope<ValuationPayload>> {
  return useQuery({
    queryKey: queryKeys.valuation(symbol, customPeers),
    queryFn: () => api.valuation({ symbol, customPeers, force: forcing() }),
    enabled: enabled && Boolean(symbol),
    staleTime: Infinity,
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshValuation(): (symbol: string, customPeers: string[]) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async (symbol, customPeers) => {
      const result = await api.valuation({ symbol, customPeers, force: true })
      queryClient.setQueryData(queryKeys.valuation(symbol, customPeers), result)
    },
    [queryClient],
  )
}
