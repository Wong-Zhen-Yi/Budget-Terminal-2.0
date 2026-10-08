import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type {
  Envelope,
  FxPayload,
  PersonalFinanceMutation,
  PersonalFinancePayload,
} from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { FX_REFRESH_MS } from './refreshRates'
import { forcing } from './queries'

export function usePersonalFinance(): UseQueryResult<Envelope<PersonalFinancePayload>> {
  const queryClient = useQueryClient()

  // The finance book shares `portfolio.json`, so the existing file watcher covers it.
  useEffect(
    () =>
      api.onPortfolioChanged(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.personalFinance })
      }),
    [queryClient],
  )

  return useQuery({
    queryKey: queryKeys.personalFinance,
    queryFn: () => api.personalFinance(),
    staleTime: Infinity,
  })
}

/**
 * Writes take the same shape as the portfolio ones: the main process answers with the
 * whole re-read section and it goes straight into the cache, so a refused edit simply
 * renders unchanged and `meta.failureReason` carries the message to the page.
 */
export function useFinanceMutation(): (
  mutation: PersonalFinanceMutation,
) => Promise<Envelope<PersonalFinancePayload>> {
  const queryClient = useQueryClient()
  return useCallback(
    async (mutation: PersonalFinanceMutation) => {
      const result = await api.mutatePersonalFinance(mutation)
      queryClient.setQueryData(queryKeys.personalFinance, result)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      return result
    },
    [queryClient],
  )
}

export function useFxRate(): UseQueryResult<Envelope<FxPayload>> {
  return useQuery({
    queryKey: queryKeys.fx,
    queryFn: () => api.fx({ force: forcing() }),
    refetchInterval: FX_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: queryFreshness(queryKeys.fx),
  })
}
