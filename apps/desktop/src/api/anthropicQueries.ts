import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from './progressiveQuery'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'
import { retainedQueryOptions } from './snapshotResult'

export function useAnthropic() {
  return useQuery({ queryKey: queryKeys.anthropic, queryFn: () => api.anthropic({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.anthropic), refetchInterval: false, placeholderData: previous => previous })
}

export function useRefreshAnthropic() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery(retainedQueryOptions(client, { queryKey: queryKeys.anthropic,
    queryFn: () => api.anthropic({ force: true }), staleTime: 0 })), [client])
}
