import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, FundamentalsPagePayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useFundamentalsPage(
  symbol: string,
  snapshot: FundamentalsPagePayload | null,
): UseQueryResult<Envelope<FundamentalsPagePayload>> {
  return useQuery({
    queryKey: queryKeys.fundamentalsPage(symbol),
    queryFn: () => api.fundamentalsPage({ symbol, force: forcing() }),
    enabled: Boolean(symbol),
    staleTime: queryFreshness(queryKeys.fundamentalsPage(symbol)),
    placeholderData:
      snapshot?.symbol === symbol
        ? {
            data: snapshot,
            meta: {
              source: 'restored Fundamentals session',
              freshness: 'cached',
              fetchedAt: snapshot.generatedAt,
            },
            errors: [],
          }
        : undefined,
  })
}

export function useRefreshFundamentalsPage(): (
  symbol: string,
) => Promise<Envelope<FundamentalsPagePayload>> {
  const queryClient = useQueryClient()
  return useCallback(
    (symbol) =>
      queryClient.fetchQuery({
        queryKey: queryKeys.fundamentalsPage(symbol),
        queryFn: () => api.fundamentalsPage({ symbol, force: true }),
        staleTime: 0,
      }),
    [queryClient],
  )
}
