import { fetchRetainedQuery } from './snapshotResult'
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'

import type { Envelope, HeatmapEtfKey, HeatmapPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

/**
 * One query per index, so the three buttons hold three independent payloads the way
 * `_p17_results` does and switching back to one already loaded is instant.
 *
 * `refetchInterval: false` on purpose: `init_page17` creates no timer, and one load is an
 * issuer file plus batched Yahoo daily-history reads. Refresh and F5 are the only ways it
 * refetches — the same rule as Trading Volumes, News and Crypto.
 *
 * Startup warms the default SPY map. Other index buttons load their own query on first
 * selection and reuse it on subsequent visits.
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

/** Read local previews while the normal query (including startup warm-up) completes. */
export function useHeatmapProgress(etf: HeatmapEtfKey, loading: boolean): HeatmapPayload | null {
  const [preview, setPreview] = useState<HeatmapPayload | null>(null)
  useEffect(() => {
    setPreview(null)
    if (!loading) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const payload = await api.heatmapProgress(etf)
        if (!cancelled && payload?.etf === etf) setPreview(payload)
      } catch {
        // The completed query owns provider errors and retry status.
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), 500)
      }
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [etf, loading])
  return loading && preview?.etf === etf ? preview : null
}

export function useRefreshHeatmap(): (etf: HeatmapEtfKey) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async (etf: HeatmapEtfKey) => {
      await fetchRetainedQuery(queryClient, queryKeys.heatmap(etf), () => api.heatmap({ etf, force: true }))
    },
    [queryClient],
  )
}
