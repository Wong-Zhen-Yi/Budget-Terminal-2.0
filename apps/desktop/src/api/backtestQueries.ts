import { useMutation, type UseMutationResult } from '@tanstack/react-query'

import type { BacktestPayload, BacktestRequest, Envelope } from '@shared/contract'
import { api } from './client'

/** Backtest is user-triggered; changing controls never fetches on its own. */
export function useBacktest(): UseMutationResult<Envelope<BacktestPayload>, Error, BacktestRequest> {
  return useMutation({ mutationFn: (request) => api.backtest(request) })
}
