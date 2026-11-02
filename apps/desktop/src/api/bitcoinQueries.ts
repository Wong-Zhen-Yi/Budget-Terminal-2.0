import { fetchRetainedQuery } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'

import type { Envelope } from '@shared/contract'
import type { BitcoinPayload } from '@shared/bitcoin'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useBitcoin(): UseQueryResult<Envelope<BitcoinPayload>> {
  return useQuery({
    queryKey: queryKeys.bitcoin,
    queryFn: () => api.bitcoin({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.bitcoin),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshBitcoin(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await fetchRetainedQuery(queryClient, queryKeys.bitcoin, () => api.bitcoin({ force: true }))
  }, [queryClient])
}
