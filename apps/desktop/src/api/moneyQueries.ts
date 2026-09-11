import { useCallback, useState } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, MoneyPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

/** Seven FRED series, refreshed on demand; the service owns freshness and stale fallback. */
export function useMoney(enabled: boolean): UseQueryResult<Envelope<MoneyPayload>> {
  return useQuery({
    queryKey: queryKeys.money,
    queryFn: () => api.money({ force: forcing() }),
    enabled,
    staleTime: Infinity,
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

/** Refresh uses the service cache; force refresh downloads again and keeps eligible stale rows. */
export function useRefreshMoney(): {
  refresh: (force: boolean) => Promise<void>
  refreshing: boolean
} {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(
    async (force: boolean) => {
      setRefreshing(true)
      try {
        const result = await api.money({ force })
        queryClient.setQueryData(queryKeys.money, result)
      } finally {
        setRefreshing(false)
      }
    },
    [queryClient],
  )
  return { refresh, refreshing }
}
