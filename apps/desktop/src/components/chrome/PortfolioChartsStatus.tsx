import { useEffect, useMemo } from 'react'
import { useIsRestoring, useQueries, type Query } from '@tanstack/react-query'
import type { Envelope } from '@shared/contract'
import { forcing, usePortfolio } from '@/api/queries'
import { loadPortfolioChart, portfolioChartRefreshMs, portfolioChartTargets } from '@/api/portfolioCharts'
import { queryFreshness } from '@/api/queryPersistence'
import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import { useDashboard } from '@/stores/dashboard'
import { useChartsStore } from '@/stores/charts'
import { useDataHealth } from '@/stores/dataHealth'

/** Always mounted: observing holding queries protects them from idle eviction. */
export function PortfolioChartsStatus({ enabled }: { enabled: boolean }) {
  const portfolio = usePortfolio()
  const restoring = useIsRestoring()
  const startupStarted = useDataHealth(state => state.startup !== null)
  const timeframe = useDashboard(state => state.timeframe)
  const interval = useChartsStore(state => state.interval)
  const range = useChartsStore(state => state.range)
  const multiInterval = useChartsStore(state => state.multiInterval)
  const now = useSnapshotClock()
  const targets = useMemo(() => portfolioChartTargets(portfolio.data?.data, { timeframe, interval, range, multiInterval }),
    [portfolio.data?.data, timeframe, interval, range, multiInterval])
  const results = useQueries({ queries: targets.map(target => ({
    queryKey: target.queryKey,
    queryFn: () => {
      const order = useDataHealth.getState().startup?.pageOrder?.indexOf(target.tab)
      return loadPortfolioChart(target, order !== undefined && order >= 0 ? order : undefined, forcing())
    },
    enabled: enabled && !restoring && startupStarted,
    staleTime: queryFreshness(target.queryKey),
    // Keep inactive holdings ready even while another page/window is selected.
    refetchInterval: (query: Query<Envelope<unknown>>) => portfolioChartRefreshMs(target, query.state.data, Boolean(query.state.error)),
    refetchIntervalInBackground: true,
    retry: false,
    networkMode: 'always' as const,
    // Streamed marks retain dataUpdatedAt; they must not rerender all readiness
    // bookkeeping several times a second while candle history is unchanged.
    notifyOnChangeProps: ['dataUpdatedAt', 'error', 'isFetching'] as const,
  })) })

  useEffect(() => {
    for (const tab of ['dashboard', 'stocks', 'charts']) {
      useDataHealth.getState().record(tab, targets.flatMap((target, index) => target.tab === tab ? [{
        label: target.label, envelope: results[index].data, error: results[index].error,
        loading: results[index].isFetching, freshnessMs: queryFreshness(target.queryKey),
      }] : []))
    }
  }, [targets, results])

  if (!targets.length) return null
  let ready = 0
  let failed = 0
  let stale = 0
  let loading = 0
  const issues: string[] = []
  results.forEach((result, index) => {
    if (result.isFetching) loading += 1
    const freshness = result.data && effectiveFreshness(result.data, now, queryFreshness(targets[index].queryKey))
    if (result.error || freshness === 'failed' || freshness === 'partial') {
      failed += 1
      issues.push(`${targets[index].label}: ${result.error?.message || result.data?.meta.failureReason || freshness}`)
    } else if (freshness === 'stale') stale += 1
    else if (result.data) ready += 1
  })
  const status = `Portfolio charts ${ready}/${targets.length} ready${loading ? ` · ${loading} loading` : ''}${failed ? ` · ${failed} failed` : ''}${stale ? ` · ${stale} stale` : ''}`
  return <span role="status" aria-label="Portfolio chart readiness" className={`min-w-0 truncate ${failed || stale ? 'text-warn' : 'text-text-muted'}`}
    title={`${status}. Dashboard, Stocks and selected Main/Multi chart views for all portfolios. ${issues.length ? `${issues.join('\n')} · Open Settings for details.` : 'Prepared charts stay cached and refresh in the background.'}`}>{status}</span>
}
