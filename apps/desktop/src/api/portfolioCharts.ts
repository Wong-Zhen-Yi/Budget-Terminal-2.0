import { hashKey, type QueryKey } from '@tanstack/react-query'
import type { ChartsInterval, ChartsRange, Envelope, PortfolioPayload, TimeframeLabel } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { registerSnapshot } from './snapshotHealth'
import { StartupLoadError } from './warmQueue'

export const MULTI_CHART_REQUESTS = {
  '1D': { interval: '1 Day', range: '1Y' },
  '1W': { interval: '1 Week', range: '5Y' },
  '1M': { interval: '1 Month', range: '5Y' },
} as const

export interface PortfolioChartViews {
  timeframe: TimeframeLabel
  interval: ChartsInterval
  range: ChartsRange
  multiInterval: keyof typeof MULTI_CHART_REQUESTS
}

export interface PortfolioChartTarget {
  tab: 'dashboard' | 'stocks' | 'charts'
  label: string
  queryKey: QueryKey
  load: (backgroundOrder?: number, force?: boolean) => Promise<Envelope<unknown>>
}

/** Honor earlier source expiry too, with backoff for degraded/provider failures. */
export function portfolioChartRefreshMs(target: PortfolioChartTarget, envelope?: Envelope<unknown>, failed = false, now = Date.now()): number {
  if (failed || (envelope && ['failed', 'partial', 'stale'].includes(envelope.meta.freshness))) return 30_000
  const lifetime = queryFreshness(target.queryKey)
  const expiresAt = envelope ? envelope.meta.expiresAt ?? envelope.meta.fetchedAt + lifetime : now + lifetime
  return Math.max(10_000, Math.min(lifetime, expiresAt - now + 250))
}

/** Exact page keys for every book, including inactive and read-only portfolios. */
export function portfolioChartTargets(payload: PortfolioPayload | undefined, views: PortfolioChartViews): PortfolioChartTarget[] {
  const symbols = [...new Set((payload?.portfolios ?? []).flatMap(book => book.tickers)
    .map(symbol => symbol.trim().toUpperCase()).filter(Boolean))].sort()
  const targets: PortfolioChartTarget[] = []
  for (const symbol of symbols) {
    targets.push({
      tab: 'dashboard', label: `Portfolio ${symbol} · Dashboard ${views.timeframe}`,
      queryKey: queryKeys.chart(symbol, views.timeframe),
      load: (backgroundOrder, force) => api.chart({ symbol, timeframe: views.timeframe, background: true, backgroundOrder, force }),
    }, {
      tab: 'stocks', label: `Portfolio ${symbol} · Stocks`,
      queryKey: queryKeys.stocks(symbol),
      load: (backgroundOrder, force) => api.stocks({ symbol, background: true, backgroundOrder, force }),
    })
    for (const request of [{ interval: views.interval, range: views.range }, MULTI_CHART_REQUESTS[views.multiInterval]]) {
      targets.push({
        tab: 'charts', label: `Portfolio ${symbol} · ${request.interval} ${request.range}`,
        queryKey: queryKeys.chartsHistory(symbol, request.interval, request.range),
        load: (backgroundOrder, force) => api.chartsHistory({ symbol, ...request, background: true, backgroundOrder, force }),
      })
    }
  }
  return [...new Map(targets.map(target => [hashKey(target.queryKey), target])).values()]
}

/** Keep a failed refresh from replacing a previously usable chart with an empty result. */
export async function loadPortfolioChart(target: PortfolioChartTarget, backgroundOrder?: number, force = false): Promise<Envelope<unknown>> {
  const envelope = await target.load(backgroundOrder, force)
  if (envelope.meta.freshness === 'failed') {
    throw new StartupLoadError(envelope.meta.failureReason || envelope.errors.map(error => error.reason).join(' · ') || `${target.label} failed`, 'failed')
  }
  const data = envelope.data as { candles?: unknown[]; chart?: { candles?: unknown[] } } | null
  if (!(data?.candles ?? data?.chart?.candles)?.length) throw new StartupLoadError(`${target.label}: no chart candles returned`, 'failed')
  registerSnapshot(envelope, queryFreshness(target.queryKey))
  return envelope
}
