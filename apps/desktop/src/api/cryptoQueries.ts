import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { CryptoPayload, Envelope } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

/**
 * The Crypto page's single query.
 *
 * `refetchInterval: false` on purpose: `init_page19` fires one load and Refresh is the
 * only thing that repeats it, so a background refetch would spend CoinGecko's free-tier
 * budget on a page nobody is looking at. Refresh and F5 are the only ways it refetches —
 * the same rule as Trading Volumes and News.
 */
export function useCrypto(): UseQueryResult<Envelope<CryptoPayload>> {
  return useQuery({
    queryKey: queryKeys.crypto,
    queryFn: () => api.crypto({ force: forcing() }),
    staleTime: Infinity,
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshCrypto(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    const result = await api.crypto({ force: true })
    queryClient.setQueryData(queryKeys.crypto, result)
  }, [queryClient])
}
