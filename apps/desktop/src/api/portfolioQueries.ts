import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type {
  AnalyticsPayload,
  Envelope,
  HeatmapInterval,
  MetricsLookback,
  MomentumPayload,
  OptionQuotesPayload,
  OptionQuotesRequest,
  PositionInput,
  ReturnsPayload,
  ReturnTimeframe,
} from '@shared/contract'
import { api, queryKeys } from './client'
import { computeExposure } from '@shared/analytics'

/**
 * The Portfolio page's analytics queries.
 *
 * All of these are expensive — each one pulls daily history for every holding — so they
 * only run when their sub-tab is on screen. `enabled` is how that is enforced; the
 * caller passes whether its tab is visible.
 */

/** A stable key for a set of positions, so a re-render does not refetch. */
export function positionsSignature(positions: PositionInput[], cashAmount: number): string {
  return `${[...positions]
    .map((position) => `${position.ticker}:${position.shares}`)
    .sort()
    .join('|')}#${cashAmount}`
}

export function useReturns(
  tickers: string[],
  window: ReturnTimeframe | HeatmapInterval,
  enabled: boolean,
): UseQueryResult<Envelope<ReturnsPayload>> {
  return useQuery({
    queryKey: queryKeys.returns(tickers, window),
    queryFn: () => api.returns({ tickers, window }),
    enabled: enabled && tickers.length > 0,
    staleTime: Infinity,
  })
}

export function useMomentum(
  positions: PositionInput[],
  cashAmount: number,
  timeframe: ReturnTimeframe,
  enabled: boolean,
): UseQueryResult<Envelope<MomentumPayload>> {
  return useQuery({
    queryKey: queryKeys.momentum(positionsSignature(positions, cashAmount), timeframe),
    queryFn: () => api.momentum({ positions, cashAmount, timeframe }),
    enabled: enabled && (positions.length > 0 || cashAmount > 0),
    staleTime: Infinity,
  })
}

export function useAnalytics(
  positions: PositionInput[],
  cashAmount: number,
  currentValues: Record<string, number>,
  benchmarkSymbol: string,
  lookback: MetricsLookback,
  enabled: boolean,
): UseQueryResult<Envelope<AnalyticsPayload>> {
  return useQuery({
    queryKey: queryKeys.analytics(
      positionsSignature(positions, cashAmount),
      benchmarkSymbol,
      lookback,
    ),
    queryFn: () =>
      api.analytics({ positions, cashAmount, currentValues, benchmarkSymbol, lookback }),
    // Exposure uses live quotes. Recompute it when inputs change while retaining
    // cached historical metrics, avoiding history requests on every quote tick.
    select: (envelope) => ({
      ...envelope,
      data: {
        ...envelope.data,
        exposure: computeExposure(
          positions.filter((position) => position.shares > 0).length + (cashAmount > 0 ? 1 : 0),
          currentValues,
        ),
      },
    }),
    enabled: enabled && (positions.length > 0 || cashAmount > 0),
    staleTime: Infinity,
  })
}

export function useOptionQuotes(
  positions: OptionQuotesRequest['positions'],
  enabled: boolean,
): UseQueryResult<Envelope<OptionQuotesPayload>> {
  const signature = positions
    .map((p) => `${p.rowId}:${p.ticker}:${p.expiry}:${p.strike}:${p.strategy}`)
    .join('|')
  return useQuery({
    queryKey: queryKeys.optionQuotes(signature),
    queryFn: () => api.optionQuotes({ positions }),
    enabled: enabled && positions.length > 0,
    staleTime: 60_000,
  })
}
