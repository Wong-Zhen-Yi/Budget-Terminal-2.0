import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, OptionsChainPayload, OptionsExpirationsPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'

/**
 * The Options page's two queries.
 *
 * `refetchInterval: false` on both, and neither runs until the page asks: `init_page5`
 * fires nothing at all, and every load on the reference page comes from a button. The
 * expirations sweep is the expensive one — one chain request per listed expiry — so a
 * background refetch would spend the rate budget on a page nobody is looking at, the
 * same rule as Trading Volumes, News and Crypto.
 */

export function useOptionsChain(
  symbol: string,
  expiry: string,
  enabled: boolean,
): UseQueryResult<Envelope<OptionsChainPayload>> {
  return useQuery({
    queryKey: queryKeys.optionsChain(symbol, expiry),
    queryFn: () => api.optionsChain({ symbol, expiry }),
    enabled: enabled && Boolean(symbol),
    staleTime: queryFreshness(queryKeys.optionsChain(symbol, expiry)),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

export function useOptionsExpirations(
  symbol: string,
  enabled: boolean,
): UseQueryResult<Envelope<OptionsExpirationsPayload>> {
  return useQuery({
    queryKey: queryKeys.optionsExpirations(symbol),
    queryFn: () => api.optionsExpirations({ symbol }),
    enabled: enabled && Boolean(symbol),
    staleTime: queryFreshness(queryKeys.optionsExpirations(symbol)),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

/** Load Chain: a forced refetch written straight into the cache the hook reads. */
export function useRefreshOptionsChain(): (symbol: string, expiry: string) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async (symbol: string, expiry: string) => {
      const result = await api.optionsChain({ symbol, expiry, force: true })
      queryClient.setQueryData(queryKeys.optionsChain(symbol, expiry), result)
      // The response resolves the expiry itself when the requested one is gone, so the
      // resolved key gets the same payload and the page does not fetch it twice.
      if (result.data.expiry && result.data.expiry !== expiry) {
        queryClient.setQueryData(queryKeys.optionsChain(symbol, result.data.expiry), result)
      }
    },
    [queryClient],
  )
}

/**
 * Write a chain payload under a second key.
 *
 * A load with no expiry asks under the empty key and Yahoo resolves the nearest one, so
 * following the response with `setExpiry` changes the query key onto an entry that does
 * not exist and fetches the very same chain a second time. Seeding the resolved key
 * first is what `useRefreshOptionsChain` already does for the forced path.
 */
export function useSeedOptionsChain(): (
  symbol: string,
  expiry: string,
  envelope: Envelope<OptionsChainPayload>,
) => void {
  const queryClient = useQueryClient()
  return useCallback(
    (symbol, expiry, envelope) => {
      queryClient.setQueryData(queryKeys.optionsChain(symbol, expiry), envelope)
    },
    [queryClient],
  )
}

export function useRefreshOptionsExpirations(): (symbol: string) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async (symbol: string) => {
      const result = await api.optionsExpirations({ symbol, force: true })
      queryClient.setQueryData(queryKeys.optionsExpirations(symbol), result)
    },
    [queryClient],
  )
}
