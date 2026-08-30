import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, IpoCompletedPayload, IpoUpcomingPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

/**
 * The IPO page's two queries.
 *
 * Neither has a `refetchInterval`. `init_page21` fires no request at all — it restores
 * both disk caches and stops — and the reference's own TTL is 24 hours, so a background
 * refetch would re-scrape a page that changes once a day. Refresh and F5 are the only
 * things that go back to the network.
 *
 * They are separate keys on purpose: a failed upcoming scrape must not evict the completed
 * rows, which is the same isolation the two envelopes already carry.
 */

/** `IPO_CALENDAR_CACHE_TTL_SECONDS`, matching the main process's own disk TTL. */
const IPO_STALE_MS = 24 * 60 * 60 * 1000

/** `_p21_restore_cached_ipo_calendar`, then `_p21_refresh_upcoming_ipo_calendar`. */
export function useUpcomingIpos(): UseQueryResult<Envelope<IpoUpcomingPayload>> {
  return useQuery({
    queryKey: queryKeys.ipoUpcoming,
    queryFn: () => api.ipoUpcoming({ force: forcing() }),
    staleTime: IPO_STALE_MS,
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

/** `_p21_restore_cached_completed_ipos`, then `_p21_refresh_completed_ipos`. */
export function useCompletedIpos(year: number): UseQueryResult<Envelope<IpoCompletedPayload>> {
  return useQuery({
    queryKey: queryKeys.ipoCompleted(year),
    queryFn: () => api.ipoCompleted({ year, force: forcing() }),
    staleTime: IPO_STALE_MS,
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
