import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, HeatmapEtfKey, HeatmapPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

/**
 * One query per index, so the three buttons hold three independent payloads the way
 * `_p17_results` does and switching back to one already loaded is instant.
 *
 * `refetchInterval: false` on purpose: `init_page17` creates no timer, and one load is an
 * issuer file plus twenty-odd Yahoo spark requests. Refresh and F5 are the only ways it
 * refetches — the same rule as Trading Volumes, News and Crypto.
 *
 * One documented departure from `_p17_on_show`, which warms all three indexes every time
 * the tab is shown: only the selected index is fetched here. Three warm loads is three
 * times the request budget for two maps nobody has asked to see, and the per-index cache
 * already makes the second visit to a given button free.
 */
export function useHeatmap(etf: HeatmapEtfKey): UseQueryResult<Envelope<HeatmapPayload>> {
  return useQuery({
    queryKey: queryKeys.heatmap(etf),
    queryFn: () => api.heatmap({ etf, force: forcing() }),
    staleTime: queryFreshness(queryKeys.heatmap(etf)),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshHeatmap(): (etf: HeatmapEtfKey) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async (etf: HeatmapEtfKey) => {
      const result = await api.heatmap({ etf, force: true })
      queryClient.setQueryData(queryKeys.heatmap(etf), result)
    },
    [queryClient],
  )
}
