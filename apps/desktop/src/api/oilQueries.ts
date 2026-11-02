import { fetchRetainedQuery } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'

import type { Envelope, OilPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

/**
 * The EIA weekly and OPEC daily lanes are long-cached in main, so this minute tick only
 * really refreshes the four crude and product quotes; the dated strip has its own TTL and
 * answers from cache on most ticks.
 */
export function useOil(): UseQueryResult<Envelope<OilPayload>> {
  return useQuery({
    queryKey: queryKeys.oil,
    queryFn: () => api.oil({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.oil),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshOil(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await fetchRetainedQuery(queryClient, queryKeys.oil, () => api.oil({ force: true }))
  }, [queryClient])
}
