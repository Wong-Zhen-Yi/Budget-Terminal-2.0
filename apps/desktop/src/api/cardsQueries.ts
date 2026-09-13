import { useCallback } from 'react'
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type {
  CardsMutation,
  CardsPayload,
  CardsPerformanceRequest,
  CardsPerformancePayload,
  Envelope,
} from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useCards(): UseQueryResult<Envelope<CardsPayload>> {
  return useQuery({
    queryKey: queryKeys.cards,
    queryFn: () => api.cards(),
    staleTime: Infinity,
  })
}

function requestSignature(request: CardsPerformanceRequest): string {
  return JSON.stringify({
    interval: request.interval,
    cards: request.cards.map((card) => ({
      ...card,
      symbols: [...card.symbols].sort(),
      weights: Object.entries(card.weights).sort(([left], [right]) => left.localeCompare(right)),
      shares: Object.entries(card.shares).sort(([left], [right]) => left.localeCompare(right)),
    })),
  })
}

export function cardsPerformanceKey(request: CardsPerformanceRequest) {
  return queryKeys.cardsPerformance(requestSignature(request))
}

export function useCardsPerformance(
  requests: CardsPerformanceRequest[],
): Array<UseQueryResult<Envelope<CardsPerformancePayload>>> {
  return useQueries({
    queries: requests.map((request) => ({
      queryKey: cardsPerformanceKey(request),
      queryFn: () => api.cardsPerformance({ ...request, force: forcing() }),
      enabled: request.cards.length > 0,
      staleTime: queryFreshness(cardsPerformanceKey(request)),
    })),
  })
}

export function useCardsMutation(): (
  mutation: CardsMutation,
) => Promise<Envelope<CardsPayload>> {
  const queryClient = useQueryClient()
  return useCallback(async (mutation) => {
    const result = await api.mutateCards(mutation)
    queryClient.setQueryData(queryKeys.cards, result)
    return result
  }, [queryClient])
}

export function useRefreshCards(): (
  requests: CardsPerformanceRequest[],
) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async (requests) => {
    await Promise.all(requests.map(async (request) => {
      const result = await api.cardsPerformance({ ...request, force: true })
      queryClient.setQueryData(cardsPerformanceKey(request), result)
    }))
  }, [queryClient])
}
