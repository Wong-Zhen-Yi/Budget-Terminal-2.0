import { useDataHealth } from '@/stores/dataHealth'

export function PageReadiness({ page }: { page: string }) {
  const status = useDataHealth(state => state.startup?.pages?.[page])
  const label = !status ? 'Waiting' : status.refreshing ? 'Refreshing' : ({
    loading: 'Loading', ready: 'Ready', degraded: 'Incomplete', failed: 'Failed', idle: 'Needs input',
  })[status.state]
  return <span data-page-readiness={page} className={`ml-2 text-[10px] ${status?.state === 'failed' || status?.state === 'degraded' ? 'text-warn' : 'text-text-dim'}`}
    title={status?.reason}>{label}</span>
}
