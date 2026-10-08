import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import { isBrowser } from './browser'

export const webAccessStatusKey = ['webAccessStatus'] as const

/** The shell loads host status immediately and keeps it current before Settings opens. */
export function useWebAccessStatus(poll = false) {
  return useQuery({
    queryKey: webAccessStatusKey,
    queryFn: () => api.webStatus(),
    enabled: !isBrowser,
    staleTime: 5_000,
    refetchOnMount: false,
    refetchInterval: poll ? 5_000 : false,
  })
}
