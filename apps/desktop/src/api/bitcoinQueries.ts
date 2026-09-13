import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

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
    const result = await api.bitcoin({ force: true })
    queryClient.setQueryData(queryKeys.bitcoin, result)
  }, [queryClient])
}
