import { useCallback, useState } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, EconomicPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

/**
 * The Economic page has no refresh timer, like `init_page42`, which creates none.
 *
 * A cold load is a decade of yearly treasury CSVs against a host that answers in 18-20s,
 * plus four other providers — the slowest fetch in the app. The main process caches the
 * payload on disk for six hours and serves it stale for a week, so a page revisit is free
 * and Refresh, Force refresh and F5 are the only ways it goes back to the network.
 */
export function useEconomic(enabled: boolean): UseQueryResult<Envelope<EconomicPayload>> {
  return useQuery({
    queryKey: queryKeys.economic,
    queryFn: () => api.economic({ force: forcing() }),
    enabled,
    staleTime: Infinity,
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

/**
 * The two refresh buttons.
 *
 * `Refresh` reuses the cached payload while it is still fresh; `Force refresh` skips the
 * cache entirely, which is the reference's own pair of buttons. Both write the answer
 * straight into the query cache rather than invalidating, so a failed refresh leaves the
 * payload already on screen alone.
 */
export function useRefreshEconomic(): {
  refresh: (force: boolean) => Promise<void>
  refreshing: boolean
} {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(
    async (force: boolean) => {
      setRefreshing(true)
      try {
        const result = await api.economic({ force })
        queryClient.setQueryData(queryKeys.economic, result)
      } finally {
        setRefreshing(false)
      }
    },
    [queryClient],
  )
  return { refresh, refreshing }
}
