import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CloudSyncCommand, CloudSyncStatus } from '@shared/cloudSync'
import type { Envelope } from '@shared/contract'

const statusKey = ['cloudSyncStatus'] as const
export const CLOUD_SYNC_ACTIVE_POLL_MS = 2_000
export const CLOUD_SYNC_IDLE_POLL_MS = 30_000

/** Sign-in, restore and sync transitions resolve in seconds; a settled account does not. */
export function cloudSyncPollInterval(status: CloudSyncStatus | undefined, watching: boolean): number {
  if (watching || !status) return CLOUD_SYNC_ACTIVE_POLL_MS
  const transitioning = status.signInPending || status.pending || status.state === 'syncing'
    || status.authState === 'restoring' || status.authState === 'signingIn'
  return transitioning ? CLOUD_SYNC_ACTIVE_POLL_MS : CLOUD_SYNC_IDLE_POLL_MS
}

/**
 * Authentication stays live even before Settings has been visited. The shell polls a
 * settled account slowly; `watching` (the visible Settings panel) keeps the fast cadence.
 */
export function useCloudSyncStatus(enabled = true, watching = false) {
  return useQuery({
    queryKey: statusKey,
    enabled,
    queryFn: () => window.api.cloudSyncStatus(),
    refetchOnMount: 'always',
    refetchInterval: query => cloudSyncPollInterval((query.state.data as Envelope<CloudSyncStatus> | undefined)?.data, watching),
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
