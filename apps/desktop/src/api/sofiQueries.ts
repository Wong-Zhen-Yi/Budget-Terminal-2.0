import { retainedQueryOptions } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useSofi() {
  return useQuery({ queryKey: queryKeys.sofi, queryFn: () => api.sofi({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.sofi), refetchInterval: false, placeholderData: previous => previous })
}

export function useRefreshSofi() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery(retainedQueryOptions(client, { queryKey: queryKeys.sofi,
    queryFn: () => api.sofi({ force: true }), staleTime: 0 })), [client])
}
