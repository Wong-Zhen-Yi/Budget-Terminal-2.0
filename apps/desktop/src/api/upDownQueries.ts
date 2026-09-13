import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, UpDownPayload, UpDownRequest } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

function keyOf(request: Omit<UpDownRequest, 'force'>) {
  return queryKeys.upDown(request.source, request.interval, request.symbols ?? [])
}

export function useUpDown(
  request: Omit<UpDownRequest, 'force'>,
): UseQueryResult<Envelope<UpDownPayload>> {
  return useQuery({
    queryKey: keyOf(request),
    queryFn: () => api.upDown({ ...request, force: forcing() }),
    staleTime: queryFreshness(keyOf(request)),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshUpDown(
  request: Omit<UpDownRequest, 'force'>,
): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    const result = await api.upDown({ ...request, force: true })
    queryClient.setQueryData(keyOf(request), result)
  }, [queryClient, request])
}
