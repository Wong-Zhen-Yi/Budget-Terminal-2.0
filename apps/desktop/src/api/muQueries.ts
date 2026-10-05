import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useMu() {
  return useQuery({ queryKey: queryKeys.mu, queryFn: () => api.mu({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.mu), refetchInterval: false, placeholderData: previous => previous })
}

export function useRefreshMu() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery({ queryKey: queryKeys.mu,
    queryFn: () => api.mu({ force: true }), staleTime: 0 }), [client])
}
