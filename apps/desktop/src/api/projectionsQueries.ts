import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { ChartsInterval, Envelope, ProjectionsPayload } from '@shared/contract'
import { api, queryKeys } from './client'

/**
 * The Projections page's single query.
 *
 * `refetchInterval: false`, and nothing runs until the page asks: `init_page28` fires
 * no request, and `_p28_on_show` only issues the first load once the tab is actually
 * opened. One load is a chart plus one chain request per listed expiry — 21 for AAPL —
 * so a background refetch would be among the most expensive things in the app, the same
 * rule as Trading Volumes, News, Crypto and Options.
 */
export function useProjections(
  symbol: string,
  timeframe: ChartsInterval,
  enabled: boolean,
): UseQueryResult<Envelope<ProjectionsPayload>> {
  return useQuery({
    queryKey: queryKeys.projections(symbol, timeframe),
    queryFn: () => api.projections({ symbol, timeframe }),
    enabled: enabled && Boolean(symbol),
    staleTime: Infinity,
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

/** Load and F5: a forced refetch written straight into the cache the hook reads. */
export function useRefreshProjections(): (
  symbol: string,
  timeframe: ChartsInterval,
) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async (symbol: string, timeframe: ChartsInterval) => {
      const result = await api.projections({ symbol, timeframe, force: true })
      queryClient.setQueryData(queryKeys.projections(symbol, timeframe), result)
    },
    [queryClient],
  )
}
