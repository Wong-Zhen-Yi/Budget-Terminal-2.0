import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Envelope, TechnicalScanPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'

/** Disabled queries still read the persisted renderer snapshot without starting a scan. */
export function useTechnicalSnapshot() {
  return useQuery({
    queryKey: queryKeys.technicalScreen,
    queryFn: () => api.technicalScan(),
    enabled: false,
    staleTime: queryFreshness(queryKeys.technicalScreen),
  })
}

export function useTechnicalScan() {
  const queryClient = useQueryClient()
  return useMutation<Envelope<TechnicalScanPayload | null>, Error, void>({
    mutationFn: () => api.technicalScan(),
    onSuccess: (result) => {
      if (result.data) queryClient.setQueryData(queryKeys.technicalScreen, result)
    },
  })
}
