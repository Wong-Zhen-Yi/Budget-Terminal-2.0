import { useDataHealth } from '@/stores/dataHealth'

export function CachedPageNotice({ page }: { page: string }) {
  const status = useDataHealth(state => state.startup?.pages?.[page])
  if (!status?.cachedAt || status.state === 'ready' || status.state === 'idle') return null
  const refreshing = status.state === 'loading'
  return <p role="status" className={`shrink-0 border-b border-border bg-surface px-3 py-1 text-2xs ${refreshing ? 'text-text-muted' : 'text-warn'}`}>
    Showing saved data from {new Date(status.cachedAt).toLocaleString()}. {refreshing
      ? 'Refreshing in the background; you can use this page.'
      : `Update ${status.state === 'failed' ? 'failed' : 'is incomplete'}. ${status.reason ?? 'See Settings for details.'}`}
  </p>
}
