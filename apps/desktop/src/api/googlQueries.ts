import { retainedQueryOptions } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useGoogl() {
  return useQuery({ queryKey: queryKeys.googl, queryFn: () => api.googl({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.googl), refetchInterval: false, placeholderData: previous => previous })
}

export function useRefreshGoogl() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery(retainedQueryOptions(client, { queryKey: queryKeys.googl,
    queryFn: () => api.googl({ force: true }), staleTime: 0 })), [client])
}
