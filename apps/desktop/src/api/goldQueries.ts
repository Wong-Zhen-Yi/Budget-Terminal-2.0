import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, GoldPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

/** Physical lanes are long-cached in main; this minute tick refreshes only market proxies. */
export function useGold(): UseQueryResult<Envelope<GoldPayload>> {
  return useQuery({
    queryKey: queryKeys.gold,
    queryFn: () => api.gold({ force: forcing() }),
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshGold(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    const result = await api.gold({ force: true })
    queryClient.setQueryData(queryKeys.gold, result)
  }, [queryClient])
}
