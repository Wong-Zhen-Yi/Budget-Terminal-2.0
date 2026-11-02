import { retainedQueryOptions } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useVst() {
  return useQuery({ queryKey: queryKeys.vst, queryFn: () => api.vst({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.vst), refetchInterval: false, placeholderData: previous => previous })
}

export function useRefreshVst() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery(retainedQueryOptions(client, { queryKey: queryKeys.vst,
    queryFn: () => api.vst({ force: true }), staleTime: 0 })), [client])
}
