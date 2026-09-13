import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type {
  Envelope,
  EtfArbitragePayload,
  EtfAumPayload,
  EtfHoldingsPayload,
} from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

/**
 * The ETF page's three queries.
 *
 * None of them has a `refetchInterval`: `init_page13` creates no timer, and one holdings
 * load is an issuer download plus a Yahoo enrichment call while one arbitrage refresh is
 * twenty-six batched spark requests for a five-hundred-name basket. Load, Refresh
 * Arbitrage, Refresh AUM and F5 are the only things that repeat a load — the same rule
 * as Heatmap, Options, Crypto and Roll.
 */

/**
 * `_p13_load_etf`, plus `_p13_restore_startup_session`'s background refresh: the page
 * opens on the persisted ticker and re-requests it, so a restored workspace is never
 * showing yesterday's file without saying so.
 */
export function useEtfHoldings(ticker: string): UseQueryResult<Envelope<EtfHoldingsPayload>> {
  const symbol = ticker.trim().toUpperCase()
  return useQuery({
    queryKey: queryKeys.etfHoldings(symbol),
    queryFn: () => api.etfHoldings({ ticker: symbol, force: forcing() }),
    enabled: Boolean(symbol),
    staleTime: queryFreshness(queryKeys.etfHoldings(ticker)),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

/**
 * `_p13_on_subtab_changed`: arbitrage is only fetched once its subtab is visible and the
 * basket it would compare has actually loaded. `enabled` carries both conditions, which
 * is what stops a page switched straight to Holdings from spending the quote budget.
 */
export function useEtfArbitrage(
  ticker: string,
  enabled: boolean,
): UseQueryResult<Envelope<EtfArbitragePayload>> {
  const symbol = ticker.trim().toUpperCase()
  return useQuery({
    queryKey: queryKeys.etfArbitrage(symbol),
    queryFn: () => api.etfArbitrage({ ticker: symbol, force: forcing() }),
    enabled: enabled && Boolean(symbol),
    staleTime: queryFreshness(queryKeys.etfArbitrage(ticker)),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

/** `_p13_fetch_aum_universe`, which `init_page13` fires as the page is built. */
export function useEtfAum(): UseQueryResult<Envelope<EtfAumPayload>> {
  return useQuery({
    queryKey: queryKeys.etfAum,
    queryFn: () => api.etfAum({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.etfAum),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

/**
 * `Load Holdings`: force past both caches.
 *
 * `fetchQuery` rather than a bare call plus `setQueryData`, because Load also changes the
 * page's ticker — which mounts `useEtfHoldings` on the new key in the same tick. Two
 * independent requests would then race to write one key, and the unforced one can win.
 * `fetchQuery` shares React Query's own in-flight entry for the key, so there is exactly
 * one fetch and one result whichever of them started it.
 */
export function useRefreshEtfHoldings(): (ticker: string) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async (ticker: string) => {
      const symbol = ticker.trim().toUpperCase()
      if (!symbol) return
      await queryClient.fetchQuery({
        queryKey: queryKeys.etfHoldings(symbol),
        queryFn: () => api.etfHoldings({ ticker: symbol, force: true }),
        staleTime: 0,
      })
      // The basket the cached arbitrage was computed over is now the previous file's, so
      // drop it rather than leaving a gap on screen that no longer describes the holdings
      // beside it — `_p13_clear_arbitrage_payload` after every successful load.
      queryClient.removeQueries({ queryKey: queryKeys.etfArbitrage(symbol) })
    },
    [queryClient],
  )
}

/** `_p13_request_arbitrage_refresh(force=True)`. */
export function useRefreshEtfArbitrage(): (ticker: string) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async (ticker: string) => {
      const symbol = ticker.trim().toUpperCase()
      if (!symbol) return
      const result = await api.etfArbitrage({ ticker: symbol, force: true })
      queryClient.setQueryData(queryKeys.etfArbitrage(symbol), result)
    },
    [queryClient],
  )
}

/** `_p13_fetch_aum_universe(force=True)`. */
export function useRefreshEtfAum(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    const result = await api.etfAum({ force: true })
    queryClient.setQueryData(queryKeys.etfAum, result)
  }, [queryClient])
}
