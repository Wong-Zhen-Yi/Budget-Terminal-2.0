import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { CryptoPayload, Envelope } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

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
    const result = await api.crypto({ force: true })
    queryClient.setQueryData(queryKeys.crypto, result)
  }, [queryClient])
}
