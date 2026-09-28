import { useMutation, type UseMutationResult } from '@tanstack/react-query'

import type { BacktestPayload, BacktestRequest, Envelope } from '@shared/contract'
import { api } from './client'

export const backtestKey = (request: BacktestRequest) =>
  ['backtest', request.interval, request.range, request.compareSymbol,
    request.rows.map((row) => `${row.symbol}:${row.weight}`).join(',')] as const

/** Backtest is user-triggered; changing controls never fetches on its own. */
export function useBacktest(): UseMutationResult<Envelope<BacktestPayload>, Error, BacktestRequest> {
  return useMutation({ mutationFn: (request) => api.backtest(request) })
}
