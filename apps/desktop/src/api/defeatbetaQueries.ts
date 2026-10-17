import { useQueries } from '@tanstack/react-query'
import { DEFEATBETA_SECTIONS, TERMINAL_TTL } from '@shared/defeatbetaTerminal'
import { api, queryKeys } from './client'
import { forcing } from './queries'

export function useDefeatBetaSections(symbol: string) {
  return useQueries({ queries: DEFEATBETA_SECTIONS.map(section => ({
    queryKey: queryKeys.defeatbetaTerminal(symbol, section),
    queryFn: async () => {
      const result = await api.defeatbetaTerminal({ symbol, section, force: forcing() })
      if (result.meta.freshness === 'failed') throw new Error(result.meta.failureReason || 'Section unavailable')
      return result
    },
    staleTime: TERMINAL_TTL, retry: false, refetchOnMount: false, refetchOnWindowFocus: false,
  })) })
}
