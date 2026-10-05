import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useAvgo() {
  return useQuery({ queryKey: queryKeys.avgo, queryFn: () => api.avgo({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.avgo), refetchInterval: false, placeholderData: previous => previous })
}

export function useRefreshAvgo() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery({ queryKey: queryKeys.avgo,
    queryFn: () => api.avgo({ force: true }), staleTime: 0 }), [client])
}
