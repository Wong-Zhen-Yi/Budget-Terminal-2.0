import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useHims() {
  return useQuery({ queryKey: queryKeys.hims, queryFn: () => api.hims({ force: forcing() }),
    // Startup refreshes expired snapshots; opening the page reuses that result.
    // Retain it even while the page's query observer is suspended or unmounted.
    staleTime: queryFreshness(queryKeys.hims), gcTime: Infinity,
    refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    refetchInterval: false, placeholderData: previous => previous })
}

export function useRefreshHims() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery({ queryKey: queryKeys.hims,
    queryFn: () => api.hims({ force: true }), staleTime: 0 }), [client])
}
