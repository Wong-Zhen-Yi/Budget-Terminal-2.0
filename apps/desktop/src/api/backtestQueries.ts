import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'

import type { BacktestPayload, BacktestRequest, Envelope } from '@shared/contract'
import { api } from './client'
import { forcing } from './queries'

// Keep Backtest isolated from periodic quote fetches and streamed portfolio marks.
export const backtestQuotesKey = (holdings: string[]) => ['backtestQuotes', [...holdings].sort().join(',')] as const

export function useBacktestQuotes(holdings: string[]) {
  return useQuery({
    queryKey: backtestQuotesKey(holdings),
    queryFn: () => api.quotes({ holdings, force: forcing() }),
    enabled: holdings.length > 0,
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const backtestKey = (request: BacktestRequest) =>
  ['backtest', request.interval, request.range, request.compareSymbol,
    request.rows.map((row) => `${row.symbol}:${row.weight}`).join(',')] as const

/** Backtest is user-triggered; changing controls never fetches on its own. */
export function useBacktest(): UseMutationResult<Envelope<BacktestPayload>, Error, BacktestRequest> {
  return useMutation({ mutationFn: (request) => api.backtest(request) })
}
