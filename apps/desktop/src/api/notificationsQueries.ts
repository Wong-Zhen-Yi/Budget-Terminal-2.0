import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotificationCommand } from '@shared/notifications'
import { api } from './client'

export const notificationsKey = ['notifications'] as const
export const loadNotifications = () => api.notificationsStatus()
export function useNotifications() {
  return useQuery({ queryKey: notificationsKey, queryFn: loadNotifications, staleTime: Infinity,
    refetchInterval: 3000, refetchIntervalInBackground: true, retry: false })
}
export function useNotificationCommand() {
  const client = useQueryClient()
  return async (command: NotificationCommand) => {
    const result = await api.notificationsCommand(command)
    await client.cancelQueries({ queryKey: notificationsKey })
    client.setQueryData(notificationsKey, result)
    if (result.errors.length) throw new Error(result.errors.map(error => error.reason).join(' · '))
    return result.data
  }
}
