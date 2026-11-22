import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CloudSyncCommand } from '@shared/cloudSync'

const statusKey = ['cloudSyncStatus'] as const

/** Authentication stays live even before Settings has been visited. */
export function useCloudSyncStatus(enabled = true) {
  return useQuery({
    queryKey: statusKey,
    enabled,
    queryFn: () => window.api.cloudSyncStatus(),
    refetchOnMount: 'always',
    refetchInterval: 2000,
    retry: false,
  })
}

export function useCloudSyncCommand() {
  const client = useQueryClient()
  return useCallback(async (command: CloudSyncCommand) => {
    await client.cancelQueries({ queryKey: statusKey })
    const result = await window.api.cloudSyncCommand(command)
    await client.cancelQueries({ queryKey: statusKey })
    client.setQueryData(statusKey, result)
    return result
  }, [client])
}
