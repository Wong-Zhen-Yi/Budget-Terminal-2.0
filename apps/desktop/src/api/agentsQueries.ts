import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { AgentsCommand } from '@shared/agents'
import { api, queryKeys } from './client'
import { agentChartSymbols } from '@/lib/agentChartReferences'
import { agentHistoryCandles } from '@/lib/agentChartHistory'
import { queryFreshness } from './queryPersistence'
import { assertStartupReady, StartupLoadError, warmStartupQuery, warmStartupSnapshot } from './warmQueue'

export const loadAgents = () => api.agentsStatus()

/** Warm all charts in the restored conversation, even if Agents has not been visited. */
export async function warmAgentWorkspace(client: QueryClient, backgroundOrder?: number) {
  const result = await warmStartupSnapshot(client, { queryKey: queryKeys.agents, queryFn: loadAgents, staleTime: Infinity })
  const charts = await Promise.allSettled(agentChartSymbols(result.data.messages).map(async symbol => {
    const queryKey = queryKeys.chartsHistory(symbol, '1 Day', 'Max')
    try {
      const history = await warmStartupQuery(client, {
        queryKey, staleTime: queryFreshness(queryKey),
        queryFn: () => api.chartsHistory({ symbol, interval: '1 Day', range: 'Max', background: true, backgroundOrder }),
      })
      const count = agentHistoryCandles(history.data.candles).length
      if (!count) throw new StartupLoadError('No usable OHLC history was returned.', 'failed')
      if (count < history.data.candles.length) throw new StartupLoadError('Invalid or duplicate bars were excluded.', 'degraded')
      return history
    } catch (error) {
      throw new StartupLoadError(`${symbol}: ${error instanceof Error ? error.message : String(error)}`, error instanceof StartupLoadError ? error.state : 'failed')
    }
  }))
  const failures = charts.filter((chart): chart is PromiseRejectedResult => chart.status === 'rejected')
  if (failures.length) throw new StartupLoadError(`Agent chart history: ${failures.map(chart => chart.reason instanceof Error ? chart.reason.message : String(chart.reason)).join('; ')}`,
    failures.some(chart => !(chart.reason instanceof StartupLoadError) || chart.reason.state === 'failed') ? 'failed' : 'degraded')
  assertStartupReady(result)
  return result
}

export function useAgents(poll = false) {
  return useQuery({ queryKey: queryKeys.agents, queryFn: loadAgents, staleTime: Infinity, retry: false,
    refetchInterval: !poll ? false : query => {
      const agent = query.state.data?.data
      return agent?.busy || agent?.trackers?.some(tracker => tracker.running) ? 700 : agent?.connected || agent?.autonomy || agent?.trackers?.some(tracker => tracker.enabled) ? 3000 : false
    }, refetchIntervalInBackground: true })
}
export function useAgentCommand() {
  const client = useQueryClient()
  return async (command: AgentsCommand) => {
    const result = await api.agentsCommand(command)
    await client.cancelQueries({ queryKey: queryKeys.agents })
    client.setQueryData(queryKeys.agents, result)
    if (result.errors.length) throw new Error(result.errors.map(error => error.reason).join(' · '))
    if (result.data.error) throw new Error(result.data.error)
    if (command.type === 'deleteChat') client.removeQueries({ queryKey: ['agentImages'], type: 'inactive' })
    return result
  }
}
