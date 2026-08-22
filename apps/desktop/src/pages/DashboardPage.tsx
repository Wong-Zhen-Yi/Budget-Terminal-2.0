import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { Envelope, OptionBucket } from '@shared/contract'
import { api } from '@/api/client'
import { useChart, useNews, useOptions, usePortfolio, useQuotes, useTargets } from '@/api/queries'
import { ChartPanel } from '@/components/dashboard/ChartPanel'
import { ChartToolbar } from '@/components/dashboard/ChartToolbar'
import { MacroBar } from '@/components/dashboard/MacroBar'
import { NewsPanel } from '@/components/dashboard/NewsPanel'
import { OptionsPanel } from '@/components/dashboard/OptionsPanel'
import { PortfolioPanel } from '@/components/dashboard/PortfolioPanel'
import { TargetsPanel } from '@/components/dashboard/TargetsPanel'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Splitter } from '@/components/ui/Splitter'
import { useDashboard } from '@/stores/dashboard'

/** Show a panel's warning dot only when something actually went wrong. */
function warningOf(envelope: Envelope<unknown> | undefined): string | undefined {
  if (!envelope) return undefined
  const { freshness, failureReason } = envelope.meta
  if (freshness === 'fresh' || freshness === 'cached') return undefined
  return failureReason || freshness
}

export function DashboardPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const {
    symbol,
    timeframe,
    indicators,
    autoFollow,
    portfolioId,
    leftWidth,
    optionsWidth,
    setSymbol,
    setTimeframe,
    toggleIndicator,
    toggleAutoFollow,
    setPortfolioId,
    setLeftWidth,
    setOptionsWidth,
  } = useDashboard()

  const layoutRef = useRef<HTMLDivElement>(null)

  const portfolioQuery = usePortfolio()
  const portfolios = portfolioQuery.data?.data.portfolios ?? []
  const selected = useMemo(() => {
    const wanted = portfolioId ?? portfolioQuery.data?.data.activeId
    return portfolios.find((entry) => entry.id === wanted) ?? portfolios[0] ?? null
  }, [portfolios, portfolioId, portfolioQuery.data])

  const holdings = useMemo(() => selected?.tickers ?? [], [selected])

  const quotesQuery = useQuotes(holdings)
  const chartQuery = useChart(symbol, timeframe)
  const optionsQuery = useOptions(symbol)
  const targetsQuery = useTargets(holdings)
  const newsQuery = useNews(holdings)

  const buckets: OptionBucket[] = optionsQuery.data?.data.buckets ?? []

  // Report panel health upward so the status bar can show the worst of it.
  useEffect(() => {
    onStatusChange(
      [
        { label: 'Holdings', envelope: portfolioQuery.data, loading: portfolioQuery.isFetching },
        { label: 'Quotes', envelope: quotesQuery.data, loading: quotesQuery.isFetching },
        { label: 'Chart', envelope: chartQuery.data, loading: chartQuery.isFetching },
        { label: 'Options', envelope: optionsQuery.data, loading: optionsQuery.isFetching },
        { label: 'Targets', envelope: targetsQuery.data, loading: targetsQuery.isFetching },
        { label: 'News', envelope: newsQuery.data, loading: newsQuery.isFetching },
      ],
      portfolioQuery.data?.data.sourcePath ?? '',
    )
  }, [
    onStatusChange,
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

  const dragOptions = useCallback(
    (clientX: number) => {
      const bounds = layoutRef.current?.getBoundingClientRect()
      if (bounds) setOptionsWidth(bounds.right - clientX)
    },
    [setOptionsWidth],
  )

  return (
    <div ref={layoutRef} className="flex min-h-0 flex-1 gap-1 p-1">
      {/* Left column: holdings, targets, news. */}
      <div
        className="flex min-h-0 shrink-0 flex-col gap-1"
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
        <TargetsPanel
          className="min-h-24 flex-[2]"
          targets={targetsQuery.data?.data.targets ?? []}
          loading={targetsQuery.isLoading}
          warning={warningOf(targetsQuery.data)}
          onSelectTicker={selectTicker}
        />
        <NewsPanel
          className="min-h-24 flex-[3]"
          items={newsQuery.data?.data.items ?? []}
          loading={newsQuery.isLoading}
          warning={warningOf(newsQuery.data)}
        />
      </div>

      <Splitter onDrag={dragLeft} />

      {/* Centre and right share the macro bar across their combined width. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
        <MacroBar macro={quotesQuery.data?.data.macro ?? {}} loading={quotesQuery.isLoading} />

        <div className="flex min-h-0 min-w-0 flex-1 gap-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
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
          </div>

          <Splitter onDrag={dragOptions} />

          <div className="flex min-h-0 shrink-0 flex-col" style={{ width: optionsWidth }}>
            <OptionsPanel
              symbol={symbol}
              buckets={buckets}
              loading={optionsQuery.isFetching}
              warning={warningOf(optionsQuery.data)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
