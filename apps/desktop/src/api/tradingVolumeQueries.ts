import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, TradingVolumesPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

/**
 * The whole page in one call: a twelve-page screen plus one hundred daily charts.
 *
 * `refetchInterval` is deliberately off, which is the one place this page diverges from
 * the Pre-Market pattern. The reference has no timer either — `_p20_on_show` loads once
 * and everything after that is the Refresh button — and a background refetch here would
 * quietly spend a hundred Yahoo requests every few minutes on a page nobody is reading.
 * Refresh and F5 are the only ways this refetches.
 */
export function useTradingVolumes(): UseQueryResult<Envelope<TradingVolumesPayload>> {
  return useQuery({
    queryKey: queryKeys.tradingVolumes,
    queryFn: () => api.tradingVolumes({ force: forcing() }),
    refetchInterval: false,
    staleTime: queryFreshness(queryKeys.tradingVolumes),
  })
}

/**
 * The page's Refresh. Asks for `force` outright rather than borrowing Reload's window,
 * because the main process would otherwise answer from its own TTL cache and the button
 * would look like it did nothing.
 */
export function useRefreshTradingVolumes(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await queryClient.fetchQuery({
      queryKey: queryKeys.tradingVolumes,
      queryFn: () => api.tradingVolumes({ force: true }),
      staleTime: 0,
    })
  }, [queryClient])
}
