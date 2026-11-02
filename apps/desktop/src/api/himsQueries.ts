import { retainedQueryOptions } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useHims() {
  return useQuery({ queryKey: queryKeys.hims, queryFn: () => api.hims({ force: forcing() }),
    // Startup refreshes expired snapshots; opening the page reuses that result.
    // Retain it even while the page's query observer is suspended or unmounted.
    staleTime: queryFreshness(queryKeys.hims),
    refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    refetchInterval: false, placeholderData: previous => previous })
}

export function useRefreshHims() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery(retainedQueryOptions(client, { queryKey: queryKeys.hims,
    queryFn: () => api.hims({ force: true }), staleTime: 0 })), [client])
}
