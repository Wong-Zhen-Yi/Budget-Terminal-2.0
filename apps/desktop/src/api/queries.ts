import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type {
  ChartPayload,
  Envelope,
  FundamentalsPayload,
  NewsPayload,
  PortfolioMutation,
  OptionsPayload,
  PortfolioPayload,
  QuotesPayload,
  TargetsPayload,
  TimeframeLabel,
} from '@shared/contract'
import { api, queryKeys } from './client'

/** Quotes and the macro bar tick on their own; everything else refetches on demand. */
const QUOTE_REFRESH_MS = 60_000

/**
 * Invalidating a query re-runs its fetcher, but the main process answers that from its
 * own TTL cache — so a Reload would return the same numbers. This window marks the
 * refetches that a Reload triggered so they carry `force` through to Yahoo.
 *
 * Exported because the pages that keep their queries in their own module — the Global
 * page — still have to answer a Reload the same way.
 */
const FORCE_WINDOW_MS = 5_000
let forceUntil = 0

export function forcing(): boolean {
  return Date.now() < forceUntil
}

export function usePortfolio(): UseQueryResult<Envelope<PortfolioPayload>> {
  const queryClient = useQueryClient()

  // The PySide6 app still owns edits, so pick up its writes instead of polling the file.
  useEffect(
    () =>
      api.onPortfolioChanged(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.portfolio })
      }),
    [queryClient],
  )

  return useQuery({
    queryKey: queryKeys.portfolio,
    queryFn: () => api.portfolio(),
    staleTime: Infinity,
  })
}

export function useQuotes(holdings: string[]): UseQueryResult<Envelope<QuotesPayload>> {
  return useQuery({
    queryKey: queryKeys.quotes(holdings),
    queryFn: () => api.quotes({ holdings }),
    refetchInterval: QUOTE_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: QUOTE_REFRESH_MS / 2,
  })
}

export function useChart(
  symbol: string,
  timeframe: TimeframeLabel,
): UseQueryResult<Envelope<ChartPayload>> {
  return useQuery({
    queryKey: queryKeys.chart(symbol, timeframe),
    queryFn: () => api.chart({ symbol, timeframe, force: forcing() }),
    enabled: Boolean(symbol),
    staleTime: Infinity,
  })
}

export function useOptions(symbol: string): UseQueryResult<Envelope<OptionsPayload>> {
  return useQuery({
    queryKey: queryKeys.options(symbol),
    queryFn: () => api.options({ symbol, force: forcing() }),
    enabled: Boolean(symbol),
    staleTime: Infinity,
  })
}

export function useTargets(tickers: string[]): UseQueryResult<Envelope<TargetsPayload>> {
  return useQuery({
    queryKey: queryKeys.targets(tickers),
    queryFn: () => api.targets({ tickers, force: forcing() }),
    enabled: tickers.length > 0,
    staleTime: Infinity,
  })
}

export function useNews(tickers: string[]): UseQueryResult<Envelope<NewsPayload>> {
  return useQuery({
    queryKey: queryKeys.news(tickers),
    queryFn: () => api.news({ tickers, force: forcing() }),
    enabled: tickers.length > 0,
    staleTime: Infinity,
  })
}

/**
 * Reload (F5): drop every cached answer and refetch what is on screen. `force` on the
 * main-process side bypasses its TTL cache too, so this really does go back to Yahoo.
 */
export function useFundamentals(tickers: string[]): UseQueryResult<Envelope<FundamentalsPayload>> {
  return useQuery({
    queryKey: queryKeys.fundamentals(tickers),
    queryFn: () => api.fundamentals({ tickers, force: forcing() }),
    enabled: tickers.length > 0,
    staleTime: Infinity,
  })
}

/**
 * Apply one portfolio edit. The main process answers with the whole re-read document,
 * which is written straight into the cache so the table reflects the stored state
 * rather than an optimistic guess — a rejected edit then simply renders unchanged.
 */
export function usePortfolioMutation(): (
  mutation: PortfolioMutation,
) => Promise<Envelope<PortfolioPayload>> {
  const queryClient = useQueryClient()
  return useCallback(
    async (mutation) => {
      const result = await api.mutatePortfolio(mutation)
      queryClient.setQueryData(queryKeys.portfolio, result)
      return result
    },
    [queryClient],
  )
}

export function useReloadAll(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    forceUntil = Date.now() + FORCE_WINDOW_MS
    try {
      await queryClient.refetchQueries()
    } finally {
      forceUntil = 0
    }
  }
}
