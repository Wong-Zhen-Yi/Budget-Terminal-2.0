import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useHims() {
  return useQuery({ queryKey: queryKeys.hims, queryFn: () => api.hims({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.hims), refetchInterval: false, placeholderData: previous => previous })
}

export function useRefreshHims() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery({ queryKey: queryKeys.hims,
    queryFn: () => api.hims({ force: true }), staleTime: 0 }), [client])
}
