import { useQueries, type UseQueryResult } from '@tanstack/react-query'

import { MACRO_SYMBOLS, type ChartPayload, type Envelope } from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'

// Stable combined results keep the dashboard's health-report effect from rerunning
// simply because useQueries returned a new array during a parent render.
function combineCharts(results: UseQueryResult<Envelope<ChartPayload>>[]) {
  return results.map(({ data, isLoading, isError, isFetching }) => ({ data, isLoading, isError, isFetching }))
}

export function useMacroCharts() {
  return useQueries({
    combine: combineCharts,
    queries: MACRO_SYMBOLS.map(({ symbol }) => ({
      queryKey: queryKeys.chart(symbol, '1 Day'),
      queryFn: () => api.chart({ symbol, timeframe: '1 Day', force: forcing() }),
      staleTime: queryFreshness(queryKeys.chart(symbol, '1 Day')),
    })),
  })
}
