import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, PriceScreenPayload, PriceScreenRequest } from '@shared/contract'
import { api } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

export const priceScreenKey = (request: PriceScreenRequest) =>
  ['priceScreen', request.minimumPrice, request.maximumPrice] as const

export function usePriceScreen(request: PriceScreenRequest): UseQueryResult<Envelope<PriceScreenPayload>> {
  return useQuery({
    queryKey: priceScreenKey(request),
    queryFn: () => api.priceScreen({ ...request, force: request.force || forcing() }),
    staleTime: queryFreshness(priceScreenKey(request)),
    refetchInterval: false,
  })
}

