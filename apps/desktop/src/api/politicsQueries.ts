import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, PoliticsPagePayload } from '@shared/contract'
import { POLITICS_CACHE_TTL_MS } from '@shared/politics'
import { api, queryKeys } from './client'
import { forcing } from './queries'

/** One query per Capitol Trades page, matching the reference's page-numbered disk caches. */
export function usePoliticsPage(page: number): UseQueryResult<Envelope<PoliticsPagePayload>> {
  return useQuery({
    queryKey: queryKeys.politicsPage(page),
    queryFn: () => api.politicsPage({ page, force: forcing() }),
    staleTime: POLITICS_CACHE_TTL_MS,
    placeholderData: (previous) => previous,
  })
}
