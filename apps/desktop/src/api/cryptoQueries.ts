import { fetchRetainedQuery } from './snapshotResult'
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient, type UseQueryResult, type QueryClient } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'

import type { CryptoPayload, Envelope, ChartsHistoryRequest } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'
import { warmStartupQuery, type StartupSnapshotObserver } from './warmQueue'

// Match the main-process crypto cache lifetime without forcing provider requests.
const CRYPTO_REFRESH_MS = 60_000

/** Poll while mounted; switching pages unmounts Crypto and stops its timer. */
export function useCrypto(): UseQueryResult<Envelope<CryptoPayload>> {
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  return useQuery({
    enabled: visible,
    queryKey: queryKeys.crypto,
    queryFn: () => api.crypto({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.crypto),
    refetchInterval: visible ? CRYPTO_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  })
}

export function useRefreshCrypto(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await fetchRetainedQuery(queryClient, queryKeys.crypto, () => api.crypto({ force: true }))
  }, [queryClient])
}

/** Diagnostic polling is local IPC and never sends a provider request. */
export function useCryptoProviderUsage() {
  return useQuery({
    queryKey: ['apiUsage'], queryFn: () => api.apiUsage(), staleTime: 500,
    refetchInterval: 1_000, refetchIntervalInBackground: false, retry: false,
  })
}

export async function warmCryptoChart(
  client: QueryClient,
  request: ChartsHistoryRequest,
  backgroundOrder?: number,
  onSnapshot?: StartupSnapshotObserver,
) {
  return warmStartupQuery(client, {
    queryKey: queryKeys.chartsHistory(request.symbol, request.interval, request.range),
    queryFn: () => api.chartsHistory({ ...request, background: true, backgroundOrder }),
    staleTime: queryFreshness(queryKeys.chartsHistory(request.symbol, request.interval, request.range)),
  }, onSnapshot)
}
