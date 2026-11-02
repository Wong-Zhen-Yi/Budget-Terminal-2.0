import { fetchRetainedQuery } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'

import type { Envelope, GoldPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

/** Physical lanes are long-cached in main; this minute tick refreshes only market proxies. */
export function useGold(): UseQueryResult<Envelope<GoldPayload>> {
  return useQuery({
    queryKey: queryKeys.gold,
    queryFn: () => api.gold({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.gold),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshGold(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await fetchRetainedQuery(queryClient, queryKeys.gold, () => api.gold({ force: true }))
  }, [queryClient])
}
