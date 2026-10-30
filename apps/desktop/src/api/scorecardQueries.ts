import { useQueries } from '@tanstack/react-query'
import type { BackgroundRequest } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

export async function loadScorecardCompany(symbol: string, options: BackgroundRequest & { force?: boolean } = {}) {
  const result = await api.fundamentalsPage({ symbol, ...options })
  if (result.meta.freshness === 'failed') throw new Error(result.meta.failureReason || `${symbol} financials could not load.`)
  return result
}

export function useScorecardCompanies(symbols: string[]) {
  return useQueries({ queries: symbols.map(symbol => ({
    queryKey: queryKeys.fundamentalsPage(symbol),
    queryFn: () => loadScorecardCompany(symbol, { force: forcing() }),
    staleTime: queryFreshness(queryKeys.fundamentalsPage(symbol)),
    refetchOnMount: false,
    refetchInterval: false as const,
  })) })
}
