import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LocalSendAction } from '@shared/localSend'
import { api } from './client'

export const localSendQueryKey = ['localSendStatus'] as const

export function useLocalSend() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: localSendQueryKey, queryFn: () => api.localSendStatus(), refetchInterval: 2000 })
  const act = async (action: LocalSendAction) => {
    const result = await api.localSendAction(action)
    client.setQueryData(localSendQueryKey, result)
    return result
  }
  return { query, act }
}
