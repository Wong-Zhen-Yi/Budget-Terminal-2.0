import { useCallback } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { SP500_PARTS, type Sp500BreadthRequest } from '@shared/sp500'
import { api } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

export function useSp500() {
  const client = useQueryClient()
  const queries = useQueries({ queries: SP500_PARTS.map((part) => ({
    queryKey: ['sp500', part], queryFn: () => api.sp500({ part, force: forcing() }),
    staleTime: queryFreshness(['sp500', part]),
    refetchOnWindowFocus: false,
  })) })
  const breadth = useQuery({ queryKey: ['sp500Breadth'], queryFn: () => api.sp500Breadth({ action: 'status' }),
    refetchInterval: (query) => query.state.data?.data.state === 'running' ? 1000 : false,
    refetchOnMount: false, staleTime: 30_000 })
  const refresh = useCallback(() => Promise.allSettled(SP500_PARTS.map((part) => client.fetchQuery({
    queryKey: ['sp500', part], queryFn: () => api.sp500({ part, force: true }), staleTime: 0,
  }))), [client])
  const scan = useCallback(async (request: Sp500BreadthRequest) => {
    client.setQueryData(['sp500Breadth'], await api.sp500Breadth(request))
  }, [client])
  return { queries, breadth, refresh, scan }
}
