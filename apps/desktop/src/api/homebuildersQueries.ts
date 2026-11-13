import { retainedQueryOptions } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'
import { FRESHNESS } from '@shared/freshness'

export function useHomebuilders() {
  return useQuery({ queryKey: queryKeys.homebuilders,
    queryFn: () => api.homebuilders({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.homebuilders),
    // Startup prepares the page; active polling renews prices without forcing
    // twelve-hour profiles or ten-minute news to reload on every cycle.
    refetchOnMount: false, refetchOnWindowFocus: false,
    refetchInterval: FRESHNESS.homebuilders, refetchIntervalInBackground: false })
}
export function useRefreshHomebuilders() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery(retainedQueryOptions(client, { queryKey: queryKeys.homebuilders,
    queryFn: () => api.homebuilders({ force: true }), staleTime: 0 })), [client])
}
