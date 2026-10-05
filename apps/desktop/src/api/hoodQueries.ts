import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useHood() {
  return useQuery({ queryKey: queryKeys.hood, queryFn: () => api.hood({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.hood), refetchInterval: false, placeholderData: previous => previous })
}

export function useRefreshHood() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery({ queryKey: queryKeys.hood,
    queryFn: () => api.hood({ force: true }), staleTime: 0 }), [client])
}
