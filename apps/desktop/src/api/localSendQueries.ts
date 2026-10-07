import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LocalSendAction } from '@shared/localSend'
import { api } from './client'

export const localSendQueryKey = ['localSendStatus'] as const

async function localSendRequest<T>(request: () => Promise<T>): Promise<T> {
  try { return await request() }
  catch (error) {
    if (/No handler registered for ['"]sync:localsend:(status|action)['"]/.test(String(error))) {
      throw new Error('The running Budget Terminal needs an update. Close Budget Terminal completely, then open it with the launcher to load LocalSend sync.')
    }
    throw error
  }
}

export function useLocalSend() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: localSendQueryKey, queryFn: () => localSendRequest(() => api.localSendStatus()), refetchInterval: 2000 })
  const act = async (action: LocalSendAction) => {
    const result = await localSendRequest(() => api.localSendAction(action))
    client.setQueryData(localSendQueryKey, result)
    return result
  }
  return { query, act }
}
