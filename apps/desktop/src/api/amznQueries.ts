import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useAmzn() {
  return useQuery({ queryKey: queryKeys.amzn, queryFn: () => api.amzn({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.amzn), refetchInterval: false, placeholderData: previous => previous })
}

export function useRefreshAmzn() {
  const client = useQueryClient()
  return useCallback(() => client.fetchQuery({ queryKey: queryKeys.amzn,
    queryFn: () => api.amzn({ force: true }), staleTime: 0 }), [client])
}
