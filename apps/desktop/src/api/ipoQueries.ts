import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, IpoCompletedPayload, IpoUpcomingPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

/**
 * The IPO page's two queries.
 *
 * Both are preloaded at app startup, including when the IPO tab has not been visited.
 * The service reuses fresh disk caches and fetches on a cache miss. There is no timer;
 * Refresh and F5 force a network load even while the daily cache is fresh.
 *
 * They are separate keys on purpose: a failed upcoming scrape must not evict the completed
 * rows, which is the same isolation the two envelopes already carry.
 */

/** `_p21_restore_cached_ipo_calendar`, then `_p21_refresh_upcoming_ipo_calendar`. */
export function useUpcomingIpos(): UseQueryResult<Envelope<IpoUpcomingPayload>> {
  return useQuery({
    queryKey: queryKeys.ipoUpcoming,
    queryFn: () => api.ipoUpcoming({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.ipoUpcoming),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

/** `_p21_restore_cached_completed_ipos`, then `_p21_refresh_completed_ipos`. */
export function useCompletedIpos(year: number): UseQueryResult<Envelope<IpoCompletedPayload>> {
  return useQuery({
    queryKey: queryKeys.ipoCompleted(year),
    queryFn: () => api.ipoCompleted({ year, force: forcing() }),
    staleTime: queryFreshness(queryKeys.ipoCompleted(year)),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

/**
 * `_p21_refresh_ipo_calendar(force=True)`: the one Refresh button reloads *both* feeds,
 * and each settles on its own so a failure in one still repaints the other.
 */
export function useRefreshIpos(): (year: number) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async (year: number) => {
      await Promise.allSettled([
        queryClient
          .fetchQuery({
            queryKey: queryKeys.ipoCompleted(year),
            queryFn: () => api.ipoCompleted({ year, force: true }),
            staleTime: 0,
          })
          .catch(() => undefined),
        queryClient
          .fetchQuery({
            queryKey: queryKeys.ipoUpcoming,
            queryFn: () => api.ipoUpcoming({ force: true }),
            staleTime: 0,
          })
          .catch(() => undefined),
      ])
    },
    [queryClient],
  )
}
