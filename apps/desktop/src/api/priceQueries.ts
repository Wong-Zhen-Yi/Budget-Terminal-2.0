import { useMutation, type UseMutationResult } from '@tanstack/react-query'

import type { Envelope, PriceScreenPayload, PriceScreenRequest } from '@shared/contract'
import { api } from './client'

/** Price only loads when Fetch is selected; the PySide6 page has no on-show refresh. */
export function usePriceScreen(): UseMutationResult<
  Envelope<PriceScreenPayload>,
  Error,
  PriceScreenRequest
> {
  return useMutation({ mutationFn: (request) => api.priceScreen(request) })
}

