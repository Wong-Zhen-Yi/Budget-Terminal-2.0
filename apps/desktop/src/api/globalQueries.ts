import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, GlobalMarketsPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

/**
 * Seventeen world indexes in one call. Six years of daily history is the same answer all
 * six interval buttons measure against, so switching interval never refetches — only
 * Refresh and Reload go back to Yahoo.
 */
export function useGlobalMarkets(): UseQueryResult<Envelope<GlobalMarketsPayload>> {
  return useQuery({
    queryKey: queryKeys.globalMarkets,
    queryFn: () => api.globalMarkets({ force: forcing() }),
    staleTime: Infinity,
  })
}

/**
 * The toolbar's Refresh. It asks for `force` outright rather than borrowing Reload's
 * window, because the main process would otherwise answer from its own TTL cache and
 * the button would look like it did nothing.
 */
export function useRefreshGlobalMarkets(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await queryClient.fetchQuery({
      queryKey: queryKeys.globalMarkets,
      queryFn: () => api.globalMarkets({ force: true }),
      staleTime: 0,
    })
  }, [queryClient])
}
