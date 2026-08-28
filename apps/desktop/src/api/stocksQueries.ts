import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, StocksPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

export function useStocks(
  symbol: string,
  snapshot: StocksPayload | null,
): UseQueryResult<Envelope<StocksPayload>> {
  return useQuery({
    queryKey: queryKeys.stocks(symbol),
    queryFn: () => api.stocks({ symbol, force: forcing() }),
    enabled: Boolean(symbol),
    staleTime: Infinity,
    placeholderData:
      snapshot?.symbol === symbol
        ? {
            data: snapshot,
            meta: { source: 'restored Stocks session', freshness: 'cached', fetchedAt: snapshot.generatedAt },
            errors: [],
          }
        : undefined,
  })
}

export function useRefreshStocks(): (symbol: string) => Promise<Envelope<StocksPayload>> {
  const queryClient = useQueryClient()
  return useCallback(
    (symbol) =>
      queryClient.fetchQuery({
        queryKey: queryKeys.stocks(symbol),
        queryFn: () => api.stocks({ symbol, force: true }),
        staleTime: 0,
      }),
    [queryClient],
  )
}
