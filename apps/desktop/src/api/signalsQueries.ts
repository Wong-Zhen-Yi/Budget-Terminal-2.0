import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Envelope, SignalsPayload, SignalsRequest } from '@shared/contract'
import { api, queryKeys } from './client'

/** Restore cached results; the visible page owns the scan timer. */
export function useSignalsLatest() {
  return useQuery({
    queryKey: queryKeys.signals,
    queryFn: () => api.signals({ latestOnly: true }),
    staleTime: Infinity,
  })
}

export function useSignalsScan() {
  const queryClient = useQueryClient()
  return useMutation<Envelope<SignalsPayload | null>, Error, SignalsRequest>({
    mutationFn: (request) => api.signals(request),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.signals, result)
    },
  })
}
