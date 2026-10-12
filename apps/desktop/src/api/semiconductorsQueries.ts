import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'
import { FRESHNESS } from '@shared/freshness'

export function useSemiconductors() {
  return useQuery({ queryKey: queryKeys.semiconductors,
    queryFn: () => api.semiconductors({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.semiconductors),
    // Startup prepares the page; active polling renews prices without forcing
    // twelve-hour profiles or ten-minute news to reload on every cycle.
    refetchOnMount: false, refetchOnWindowFocus: false,
    refetchInterval: FRESHNESS.semiconductors, refetchIntervalInBackground: false })
}
export function useRefreshSemiconductors() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery({ queryKey: queryKeys.semiconductors,
    queryFn: () => api.semiconductors({ force: true }), staleTime: 0 }), [client])
}
