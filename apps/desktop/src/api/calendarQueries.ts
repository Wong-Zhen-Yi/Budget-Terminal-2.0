import { fetchRetainedQuery } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'

import type {
  CalendarMonthPayload,
  CalendarMonthRequest,
  EarningsCalendarPayload,
  EarningsCalendarRequest,
  Envelope,
} from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useCalendarMonth(
  request: Omit<CalendarMonthRequest, 'force'>,
  enabled = true,
): UseQueryResult<Envelope<CalendarMonthPayload>> {
  return useQuery({
    queryKey: queryKeys.calendarMonth(request.tickers, request.year, request.month),
    queryFn: () => api.calendarMonth({ ...request, force: forcing() }),
    enabled,
    staleTime: queryFreshness(queryKeys.calendarMonth(request.tickers, request.year, request.month)),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshCalendarMonth(
  request: Omit<CalendarMonthRequest, 'force'>,
): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await fetchRetainedQuery(queryClient, queryKeys.calendarMonth(request.tickers, request.year, request.month),
      () => api.calendarMonth({ ...request, force: true }))
  }, [queryClient, request])
}

export function useEarningsCalendar(
  request: Omit<EarningsCalendarRequest, 'force'>,
  enabled: boolean,
): UseQueryResult<Envelope<EarningsCalendarPayload>> {
  return useQuery({
    queryKey: queryKeys.earningsCalendar(request.rangeKey),
    queryFn: () => api.earningsCalendar({ ...request, force: forcing() }),
    enabled,
    staleTime: queryFreshness(queryKeys.earningsCalendar(request.rangeKey)),
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshEarningsCalendar(
  request: Omit<EarningsCalendarRequest, 'force'>,
): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await fetchRetainedQuery(queryClient, queryKeys.earningsCalendar(request.rangeKey), () => api.earningsCalendar({ ...request, force: true }))
  }, [queryClient, request])
}
