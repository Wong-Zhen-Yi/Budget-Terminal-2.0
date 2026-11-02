import { retainedQueryOptions } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useTv() {
  return useQuery({
    queryKey: queryKeys.tv,
    queryFn: () => api.tv({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.tv),
    refetchInterval: false,
    retry: false,
  })
}

export function useRefreshTv() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery(retainedQueryOptions(client, {
    queryKey: queryKeys.tv,
    queryFn: () => api.tv({ force: true }),
    staleTime: 0,
  })), [client])
}
