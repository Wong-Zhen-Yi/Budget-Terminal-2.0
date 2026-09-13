import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { BmnrPayload, Envelope } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

/**
 * The BMNR page's single query.
 *
 * `refetchInterval: false` for the same reason the Crypto page sets it: one load is a
 * CoinGecko call, two SEC calls and three Yahoo quotes, and CoinGecko's free tier
 * rate-limits by the minute. Refresh and F5 are the only ways it refetches.
 */
export function useBmnr(): UseQueryResult<Envelope<BmnrPayload>> {
  return useQuery({
    queryKey: queryKeys.bmnr,
    queryFn: () => api.bmnr({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.bmnr),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshBmnr(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    const result = await api.bmnr({ force: true })
    queryClient.setQueryData(queryKeys.bmnr, result)
  }, [queryClient])
}
