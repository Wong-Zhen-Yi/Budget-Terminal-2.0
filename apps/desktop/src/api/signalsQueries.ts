import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Envelope, SignalsPayload, SignalsRequest } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

/** Opening the page restores the latest session scan but never starts a costly scan itself. */
export function useSignalsLatest() {
  return useQuery({
    queryKey: queryKeys.signals,
    queryFn: () => api.signals(forcing() ? {} : { latestOnly: true }),
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
