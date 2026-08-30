import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  Envelope,
  QuantPairDetail,
  QuantPairRequest,
  QuantScanPayload,
  QuantScanRequest,
} from '@shared/contract'
import { api, queryKeys } from './client'

/** Opening Quant restores its latest 12-hour result but never starts the expensive scan. */
export function useQuantLatest() {
  return useQuery({
    queryKey: queryKeys.quant,
    queryFn: () => api.quantScan({ latestOnly: true }),
    staleTime: Infinity,
  })
}

export function useQuantScan() {
  const queryClient = useQueryClient()
  return useMutation<Envelope<QuantScanPayload | null>, Error, QuantScanRequest>({
    mutationFn: (request) => api.quantScan(request),
    onSuccess: (result) => queryClient.setQueryData(queryKeys.quant, result),
  })
}

export function useQuantPair() {
  return useMutation<Envelope<QuantPairDetail | null>, Error, QuantPairRequest>({
    mutationFn: (request) => api.quantPair(request),
  })
}
