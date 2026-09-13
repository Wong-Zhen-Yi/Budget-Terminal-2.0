import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, PoliticsPagePayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

/** One query per Capitol Trades page, matching the reference's page-numbered disk caches. */
export function usePoliticsPage(page: number): UseQueryResult<Envelope<PoliticsPagePayload>> {
  return useQuery({
    queryKey: queryKeys.politicsPage(page),
    queryFn: () => api.politicsPage({ page, force: forcing() }),
    staleTime: queryFreshness(queryKeys.politicsPage(page)),
    placeholderData: (previous) => previous,
  })
}
