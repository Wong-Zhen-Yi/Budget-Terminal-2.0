import { fetchRetainedQuery } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'

import type { BmnrPayload, Envelope } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

/**
 * The BMNR page's single query.
 *
 * The startup scheduler owns hourly snapshots, so mounting the page adds no timer.
 * Refresh and F5 can also request a new snapshot through the shared provider gates.
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
    await fetchRetainedQuery(queryClient, queryKeys.bmnr, () => api.bmnr({ force: true }))
  }, [queryClient])
}
