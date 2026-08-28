import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type {
  ChartsComparePayload,
  ChartsCompareRequest,
  ChartsHistoryPayload,
  ChartsHistoryRequest,
  ChartsRelationshipPayload,
  ChartsRelationshipRequest,
  Envelope,
} from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

export function useChartsHistory(
  request: ChartsHistoryRequest,
  pollSeconds = 0,
): UseQueryResult<Envelope<ChartsHistoryPayload>> {
  return useQuery({
    queryKey: queryKeys.chartsHistory(request.symbol, request.interval, request.range),
    queryFn: () => api.chartsHistory({ ...request, force: forcing() }),
    enabled: Boolean(request.symbol),
    staleTime: Infinity,
    refetchInterval: pollSeconds ? pollSeconds * 1000 : false,
    refetchIntervalInBackground: false,
  })
}

export function useChartsCompare(
  request: ChartsCompareRequest,
): UseQueryResult<Envelope<ChartsComparePayload>> {
  return useQuery({
    queryKey: queryKeys.chartsCompare(request.symbols, request.interval, request.range),
    queryFn: () => api.chartsCompare({ ...request, force: forcing() }),
    enabled: request.symbols.length > 0,
    staleTime: Infinity,
  })
}

export function useChartsRelationship(
  request: ChartsRelationshipRequest,
  enabled: boolean,
): UseQueryResult<Envelope<ChartsRelationshipPayload>> {
  return useQuery({
    queryKey: queryKeys.chartsRelationship(request.symbols, request.range, request.rollingWindow),
    queryFn: () => api.chartsRelationship({ ...request, force: forcing() }),
    enabled,
    staleTime: Infinity,
  })
}
