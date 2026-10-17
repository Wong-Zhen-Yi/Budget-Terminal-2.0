import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentsCommand, AgentsState } from '@shared/agents'
import { ok } from '@shared/envelope'
import { api, queryKeys } from './client'
import { isBrowser } from './browser'

export const loadAgents = () => isBrowser
  ? Promise.resolve(ok<AgentsState>({ connected: false, busy: false, autonomy: false, objective: '', intervalMinutes: 15, runsRemaining: 0, nextRunAt: null, messages: [], error: 'Open Agents in the desktop app to connect Codex.', navigation: null }, 'Codex agent'))
  : api.agentsStatus()

export function useAgents(poll = false) {
  return useQuery({ queryKey: queryKeys.agents, queryFn: loadAgents, staleTime: Infinity, retry: false,
    refetchInterval: isBrowser || !poll ? false : query => {
      const agent = query.state.data?.data
      return agent?.busy ? 700 : agent?.connected || agent?.autonomy ? 3000 : false
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
    return result
  }
}
