import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export const browserKey = ['browser'] as const
export const loadBrowser = () => api.browserStatus()
export function useBrowser(active: boolean) {
  return useQuery({ queryKey: browserKey, queryFn: loadBrowser, staleTime: Infinity, retry: false,
    refetchInterval: active ? 600 : false, refetchIntervalInBackground: false })
}
