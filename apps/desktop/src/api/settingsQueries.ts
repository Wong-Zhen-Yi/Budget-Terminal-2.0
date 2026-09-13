import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type {
  AppSettings,
  AppSettingsMutation,
  Envelope,
  MaintenanceAction,
  MaintenanceResult,
} from '@shared/contract'
import { api, queryKeys } from './client'
import { isRemoteQueryKey, removeRendererCache } from './queryPersistence'

export function useSettings(): UseQueryResult<Envelope<AppSettings>> {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.settings(),
    staleTime: Infinity,
  })
}

/**
 * Writes take the same shape as the portfolio and finance ones: the main process
 * answers with the whole re-read document and it goes straight into the cache, so a
 * refused edit — hiding Settings, moving the top tab up — simply renders unchanged.
 */
export function useSettingsMutation(): (
  mutation: AppSettingsMutation,
) => Promise<Envelope<AppSettings>> {
  const queryClient = useQueryClient()
  return useCallback(
    async (mutation: AppSettingsMutation) => {
      const result = await api.mutateSettings(mutation)
      queryClient.setQueryData(queryKeys.settings, result)
      return result
    },
    [queryClient],
  )
}

/**
 * Run one User Data action. Import and Clear replace the store underneath every open
 * page, so the whole cache is dropped afterwards rather than trusting the file watcher
 * to cover queries it does not know about.
 */
export function useMaintenance(): (
  action: MaintenanceAction,
) => Promise<Envelope<MaintenanceResult>> {
  const queryClient = useQueryClient()
  return useCallback(
    async (action: MaintenanceAction) => {
      const result = await api.maintenance(action)
      if (result.data.performed && action !== 'exportUserData') {
        await removeRendererCache()
        queryClient.removeQueries({
          type: 'inactive',
          predicate: (query) => isRemoteQueryKey(query.queryKey),
        })
        await queryClient.resetQueries({
          type: 'active',
          predicate: (query) => isRemoteQueryKey(query.queryKey),
        })
        await queryClient.invalidateQueries({
          predicate: (query) => !isRemoteQueryKey(query.queryKey),
        })
      }
      return result
    },
    [queryClient],
  )
}
