import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, PreMarketPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

/** `_P14_AUTO_REFRESH_INTERVAL_MS`. */
const REFRESH_MS = 15 * 60_000

/**
 * All six Pre-Market blocks in one call.
 *
 * The reference drives this page off a 15-minute `QTimer` that keeps running whether or
 * not the page is on screen, then defers rendering until it is. React Query gets the
 * same cadence, but `refetchIntervalInBackground: false` is the closer analogue of the
 * deferral — a hidden window stops asking rather than fetching into nothing.
 */
export function usePreMarket(): UseQueryResult<Envelope<PreMarketPayload>> {
  return useQuery({
    queryKey: queryKeys.preMarket,
    queryFn: () => api.preMarket({ force: forcing() }),
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: REFRESH_MS / 2,
  })
}

/**
 * The page's Refresh. It asks for `force` outright rather than borrowing Reload's window,
 * because the main process would otherwise answer from its own TTL cache and the button
 * would look like it did nothing.
 */
export function useRefreshPreMarket(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await queryClient.fetchQuery({
      queryKey: queryKeys.preMarket,
      queryFn: () => api.preMarket({ force: true }),
      staleTime: 0,
    })
  }, [queryClient])
}
