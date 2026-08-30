import { useCallback } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import type {
  Envelope,
  InstitutionActivityPayload,
  InstitutionTickerActivityPayload,
  InstitutionTickerActivityRequest,
} from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

const ACTIVITY_STALE_MS = 4 * 60 * 60 * 1000

export function useInstitutionActivity(
  quarter: string,
): UseQueryResult<Envelope<InstitutionActivityPayload>> {
  const normalized = quarter.replace(/\s+/g, ' ').trim()
  return useQuery({
    queryKey: queryKeys.institutionActivity(normalized),
    queryFn: () => api.institutionActivity({ quarter: normalized, limit: 50, force: forcing() }),
    staleTime: ACTIVITY_STALE_MS,
    refetchInterval: false,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshInstitutionActivity(): (
  quarter: string,
) => Promise<Envelope<InstitutionActivityPayload>> {
  const queryClient = useQueryClient()
  return useCallback(async (quarter: string) => {
    const normalized = quarter.replace(/\s+/g, ' ').trim()
    const result = await api.institutionActivity({ quarter: normalized, limit: 50, force: true })
    queryClient.setQueryData(queryKeys.institutionActivity(normalized), result)
    return result
  }, [queryClient])
}

export function useInstitutionTickerActivity(): UseMutationResult<
  Envelope<InstitutionTickerActivityPayload>,
  Error,
  InstitutionTickerActivityRequest
> {
  return useMutation({ mutationFn: (request) => api.institutionTickerActivity(request) })
}
