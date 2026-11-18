import { useQuery } from './progressiveQuery'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export function useNvda() {
  return useQuery({
    queryKey: queryKeys.nvda,
    queryFn: () => api.nvda({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.nvda),
    refetchInterval: false,
  })
}
