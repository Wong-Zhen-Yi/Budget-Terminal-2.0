import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Envelope, OptionBucket } from '@shared/contract'
import { api } from '@/api/client'
import { useMacroCharts } from '@/api/dashboardQueries'
import { MACRO_SYMBOLS } from '@shared/contract'
import { useChart, useNews, useOptions, usePortfolio, useQuotes, useTargets } from '@/api/queries'
import { ChartPanel } from '@/components/dashboard/ChartPanel'
import { ChartToolbar } from '@/components/dashboard/ChartToolbar'
import { MacroBar } from '@/components/dashboard/MacroBar'
import { NewsPanel } from '@/components/dashboard/NewsPanel'
import { OptionsPanel } from '@/components/dashboard/OptionsPanel'
import { PortfolioPanel } from '@/components/dashboard/PortfolioPanel'
import { PortfolioPiePanel } from '@/components/dashboard/PortfolioPiePanel'
import { PortfolioHeatmapPanel } from '@/components/dashboard/PortfolioHeatmapPanel'
import { TargetsPanel } from '@/components/dashboard/TargetsPanel'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Splitter } from '@/components/ui/Splitter'
import { useDashboard } from '@/stores/dashboard'
import { AgentsPage } from '@/pages/AgentsPage'

/** Show a panel's warning dot only when something actually went wrong. */
function warningOf(envelope: Envelope<unknown> | undefined): string | undefined {
  if (!envelope) return undefined
  const { freshness, failureReason } = envelope.meta
  if (freshness === 'fresh' || freshness === 'cached') return undefined
  return failureReason || freshness
}

export function DashboardPage({
  onStatusChange,
  newsFocused = false,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  /** Dashboard 2 places Agents in the center and the portfolio heatmap on the right. */
  newsFocused?: boolean
}) {
  const {
    symbol,
    timeframe,
    indicators,
    autoFollow,
    portfolioId,
    leftWidth,
    optionsWidth,
    agentsWidth: heatmapWidth,
    setSymbol,
    setTimeframe,
    toggleIndicator,
    toggleAutoFollow,
    setPortfolioId,
    setLeftWidth,
    setOptionsWidth,
    setAgentsWidth: setHeatmapWidth,
  } = useDashboard()
  const [agentPanels, setAgentPanels] = useState<PanelStatus[]>([])
  const [heatmapPanels, setHeatmapPanels] = useState<PanelStatus[]>([])

  const layoutRef = useRef<HTMLDivElement>(null)

  const portfolioQuery = usePortfolio()
  const portfolios = portfolioQuery.data?.data.portfolios ?? []
  const selected = useMemo(() => {
    const wanted = portfolioId ?? portfolioQuery.data?.data.activeId
    return portfolios.find((entry) => entry.id === wanted) ?? portfolios[0] ?? null
  }, [portfolios, portfolioId, portfolioQuery.data])

  const holdings = useMemo(() => selected?.tickers ?? [], [selected])

  const quotesQuery = useQuotes(holdings, !newsFocused)
  const chartQuery = useChart(newsFocused ? '' : symbol, timeframe)
  const optionsQuery = useOptions(newsFocused ? '' : symbol)
  const targetsQuery = useTargets(newsFocused ? [] : holdings)
  const newsQuery = useNews(newsFocused ? [] : holdings)
  const macroCharts = useMacroCharts(!newsFocused)
  const macroChartStatus = useMemo(() => macroCharts.map((query, index) => ({
    label: `${MACRO_SYMBOLS[index].label} history`,
    envelope: query.data, error: query.error, enabled: query.isEnabled,
    loading: query.isFetching,
  })), [macroCharts])

  const buckets: OptionBucket[] = optionsQuery.data?.data.buckets ?? []

  // Report panel health upward so the status bar can show the worst of it.
  useEffect(() => {
    onStatusChange(
      [
        { label: 'Holdings', envelope: portfolioQuery.data, error: portfolioQuery.error, enabled: portfolioQuery.isEnabled, loading: portfolioQuery.isFetching },
        { label: 'Quotes', envelope: quotesQuery.data, error: quotesQuery.error, enabled: quotesQuery.isEnabled, loading: quotesQuery.isFetching },
        ...(!newsFocused ? [
          { label: 'Chart', envelope: chartQuery.data, error: chartQuery.error, enabled: chartQuery.isEnabled, loading: chartQuery.isFetching },
          { label: 'Options', envelope: optionsQuery.data, error: optionsQuery.error, enabled: optionsQuery.isEnabled, loading: optionsQuery.isFetching },
        ] : [...agentPanels, ...heatmapPanels]),
        ...(!newsFocused ? [{ label: 'Targets', envelope: targetsQuery.data, error: targetsQuery.error, enabled: targetsQuery.isEnabled, loading: targetsQuery.isFetching }] : []),
        ...(!newsFocused ? [{ label: 'News', envelope: newsQuery.data, error: newsQuery.error, enabled: newsQuery.isEnabled, loading: newsQuery.isFetching }] : []),
        ...(!newsFocused ? macroChartStatus : []),
      ],
      portfolioQuery.data?.data.sourcePath ?? '',
    )
  }, [
    onStatusChange,
    newsFocused,
    agentPanels,
    heatmapPanels,
    portfolioQuery.data,
    portfolioQuery.isFetching,
    quotesQuery.data,
    quotesQuery.isFetching,
    chartQuery.data,
    chartQuery.isFetching,
    optionsQuery.data,
    optionsQuery.isFetching,
    targetsQuery.data,
    targetsQuery.isFetching,
    newsQuery.data,
    newsQuery.isFetching,
    macroChartStatus,
  ])

  const selectTicker = useCallback(
    (ticker: string) => {
      if (autoFollow) setSymbol(ticker)
    },
    [autoFollow, setSymbol],
  )

  const exportOptions = useCallback(async () => {
    if (!buckets.length) return
    const lines = [`Top options by volume - ${symbol}`, '']
    for (const bucket of buckets) {
      lines.push(`${bucket.label} (expiry ${bucket.expiration || 'n/a'})`)
      lines.push('Ticker,Type,Strike,Expiration,Price,Volume,OpenInterest')
      for (const row of bucket.rows) {
        lines.push(
          [
            row.ticker,
            row.type,
            row.strike.toFixed(1),
            row.expiration,
            row.lastPrice.toFixed(2),
            row.volume,
            row.openInterest,
          ].join(','),
        )
      }
      lines.push('')
    }
    await api.saveText(`${symbol}_top_options.csv`, lines.join('\n'))
  }, [buckets, symbol])

  const dragLeft = useCallback(
    (clientX: number) => {
      const bounds = layoutRef.current?.getBoundingClientRect()
      if (bounds) setLeftWidth(clientX - bounds.left)
    },
    [setLeftWidth],
  )

  const dragRight = useCallback(
    (clientX: number) => {
      const bounds = layoutRef.current?.getBoundingClientRect()
      if (!bounds) return
      if (newsFocused) setHeatmapWidth(bounds.right - clientX)
      else setOptionsWidth(bounds.right - clientX)
    },
    [newsFocused, setHeatmapWidth, setOptionsWidth],
  )

  return (
    <div ref={layoutRef} className={`dashboard-layout flex min-h-0 flex-1 gap-1 p-1${newsFocused ? ' dashboard-news-layout' : ''}`}>
      {/* Dashboard 2 pairs holdings with their allocation pie; Dashboard keeps targets. */}
      <div
        className="dashboard-holdings flex min-h-0 shrink-0 flex-col gap-1"
        style={{ width: leftWidth }}
      >
        <PortfolioPanel
          className="min-h-24 flex-[3]"
          portfolios={portfolios}
          selected={selected}
          quotes={quotesQuery.data?.data.holdings ?? {}}
          loading={portfolioQuery.isLoading || quotesQuery.isLoading}
          warning={warningOf(portfolioQuery.data) ?? warningOf(quotesQuery.data)}
          onSelectPortfolio={setPortfolioId}
          onSelectTicker={selectTicker}
        />
        {newsFocused ? (
          <PortfolioPiePanel
            className="min-h-24 flex-[2]"
            portfolio={selected}
            quotes={quotesQuery.data?.data.holdings ?? {}}
            loading={portfolioQuery.isLoading || quotesQuery.isLoading}
            warning={portfolioQuery.error?.message ?? quotesQuery.error?.message ?? warningOf(portfolioQuery.data) ?? warningOf(quotesQuery.data)}
          />
        ) : (
          <TargetsPanel
            className="min-h-24 flex-[2]"
            targets={targetsQuery.data?.data.targets ?? []}
            loading={targetsQuery.isLoading}
            warning={warningOf(targetsQuery.data)}
            onSelectTicker={selectTicker}
          />
        )}
        {!newsFocused ? (
          <NewsPanel
            className="min-h-24 flex-[3]"
            items={newsQuery.data?.data.items ?? []}
            loading={newsQuery.isLoading}
            warning={warningOf(newsQuery.data)}
          />
        ) : null}
      </div>

      <Splitter onDrag={dragLeft} />

      {/* Dashboard 2 keeps the heatmap and embedded Agents at full height. */}
      <div className="dashboard-market flex min-h-0 min-w-0 flex-1 flex-col gap-1">
        {!newsFocused ? <MacroBar macro={quotesQuery.data?.data.macro ?? {}} loading={quotesQuery.isLoading} charts={macroCharts} /> : null}

        <div className="dashboard-main flex min-h-0 min-w-0 flex-1 gap-1">
          <div className={`flex min-h-0 min-w-0 flex-1 flex-col gap-1 ${newsFocused ? 'dashboard-agents-column overflow-hidden border border-border' : 'dashboard-chart'}`} aria-label={newsFocused ? 'Dashboard Agents' : undefined}>
            {!newsFocused ? (
              <ChartToolbar
                symbol={symbol}
                timeframe={timeframe}
                indicators={indicators}
                autoFollow={autoFollow}
                canExport={buckets.some((bucket) => bucket.rows.length > 0)}
                onLoadSymbol={setSymbol}
                onSetTimeframe={setTimeframe}
                onToggleIndicator={toggleIndicator}
                onToggleAutoFollow={toggleAutoFollow}
                onExportOptions={() => void exportOptions()}
              />
            ) : null}
            {newsFocused ? (
              <AgentsPage embedded onStatusChange={setAgentPanels} />
            ) : (
              <ChartPanel
                payload={chartQuery.data?.data ?? null}
                indicators={indicators}
                loading={chartQuery.isFetching}
                failureReason={
                  chartQuery.data?.meta.freshness === 'failed'
                    ? chartQuery.data.meta.failureReason
                    : undefined
                }
              />
            )}
          </div>

          <Splitter onDrag={dragRight} />

          {newsFocused ? (
            <aside className="dashboard-heatmap-column flex min-h-0 min-w-0 shrink-0 flex-col" style={{ width: heatmapWidth }} aria-label="Dashboard portfolio heatmap">
              <PortfolioHeatmapPanel
                portfolio={selected}
                quotes={quotesQuery.data?.data.holdings ?? {}}
                loading={portfolioQuery.isLoading || quotesQuery.isLoading}
                warning={portfolioQuery.error?.message ?? quotesQuery.error?.message ?? warningOf(portfolioQuery.data) ?? warningOf(quotesQuery.data)}
                onStatusChange={setHeatmapPanels}
              />
            </aside>
          ) : (
            <div className="dashboard-options-column flex min-h-0 shrink-0 flex-col" style={{ width: optionsWidth }}>
              <OptionsPanel
                symbol={symbol}
                buckets={buckets}
                loading={optionsQuery.isFetching}
                warning={warningOf(optionsQuery.data)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
