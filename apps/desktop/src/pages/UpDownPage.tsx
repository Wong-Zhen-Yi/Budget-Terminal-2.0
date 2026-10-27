import { useCallback, useEffect, useMemo, useState } from 'react'

import type { UpDownRow } from '@shared/contract'
import {
  UP_DOWN_INTERVALS,
  UP_DOWN_SOURCES,
  analystTargetDisplay,
  normalizeUpDownSymbols,
} from '@shared/upDown'
import { usePortfolio } from '@/api/queries'
import { useUpDownTargets } from '@/api/upDownTargetsQueries'
import { useRefreshUpDown, useUpDown } from '@/api/upDownQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { currency, percent } from '@/lib/format'
import { useUpDownPage } from '@/stores/upDown'

function metric(value: number | null, formatter: (entry: number) => string): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatter(value) : 'N/A'
}

export function UpDownPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const activeSource = useUpDownPage((state) => state.activeSource)
  const interval = useUpDownPage((state) => state.interval)
  const savedCustom = useUpDownPage((state) => state.customSymbols)
  const setActiveSource = useUpDownPage((state) => state.setActiveSource)
  const setInterval = useUpDownPage((state) => state.setInterval)
  const setSavedCustom = useUpDownPage((state) => state.setCustomSymbols)

  const portfolio = usePortfolio()
  const portfolioPayload = portfolio.data?.data
  const activePortfolio = portfolioPayload?.portfolios.find(
    (entry) => entry.id === portfolioPayload.activeId,
  ) ?? portfolioPayload?.portfolios[0]
  const portfolioSymbols = useMemo(
    () => activePortfolio?.tickers.filter((ticker) => {
      const holding = activePortfolio.holdings[ticker]
      return holding && holding.shares > 0 && holding.includeInWeight
    }) ?? [],
    [activePortfolio],
  )

  const [draft, setDraft] = useState(savedCustom.join(' '))
  const [appliedCustom, setAppliedCustom] = useState(savedCustom)
  const symbols = activeSource === 'portfolio'
    ? portfolioSymbols
    : activeSource === 'custom'
      ? appliedCustom
      : []
  const request = useMemo(
    () => ({ source: activeSource, interval, symbols }),
    [activeSource, interval, symbols],
  )
  const query = useUpDown(request)
  const refresh = useRefreshUpDown(request)
  const [refreshing, setRefreshing] = useState(false)
  const payload = query.data?.data
  const rows = payload?.source === activeSource && payload.interval === interval ? payload.rows : []
  const targetProgress = useUpDownTargets(
    rows,
    Boolean(payload?.forceTargets),
    query.data?.meta.fetchedAt ?? 0,
  )

  useEffect(() => {
    onStatusChange(
      [
        { label: 'Up/Down', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching },
        { label: 'Price Targets', envelope: query.data, enabled: rows.length > 0, loading: targetProgress.loading,
          error: targetProgress.failures ? new Error(`${targetProgress.failures} price-target batch(es) failed`) : undefined },
        { label: 'Portfolio', envelope: portfolio.data, error: portfolio.error, enabled: portfolio.isEnabled, loading: portfolio.isFetching },
      ],
      activeSource === 'portfolio' ? portfolioPayload?.sourcePath ?? '' : '',
    )
  }, [
    activeSource,
    onStatusChange,
    portfolio.data,
    portfolio.isFetching,
    portfolioPayload?.sourcePath,
    query.data,
    query.isFetching,
    rows.length,
    targetProgress.loading,
    targetProgress.failures,
  ])

  const columns = useMemo<Array<Column<UpDownRow>>>(() => [
    {
      key: 'ticker',
      header: 'Ticker',
      width: '90px',
      cell: (row) => row.ticker,
      sortValue: (row) => row.ticker,
    },
    {
      key: 'name',
      header: 'Name',
      cell: (row) => row.name,
      sortValue: (row) => row.name,
    },
    {
      key: 'lastClose',
      header: 'Last Close',
      align: 'right',
      numeric: true,
      cell: (row) => metric(row.lastClose, (value) => currency(value)),
      sortValue: (row) => row.lastClose,
    },
    {
      key: 'intervalReturn',
      header: 'Interval Return',
      align: 'right',
      numeric: true,
      cell: (row) => (
        <span className={row.intervalReturn === null ? 'text-text-dim' : row.intervalReturn >= 0 ? 'text-up' : 'text-down'}>
          {metric(row.intervalReturn, (value) => percent(value))}
        </span>
      ),
      sortValue: (row) => row.intervalReturn,
    },
    {
      key: 'tradingDays',
      header: 'Trading Days',
      align: 'right',
      numeric: true,
      cell: (row) => row.tradingDays,
      sortValue: (row) => row.tradingDays,
    },
    {
      key: 'daysUp',
      header: 'Days Up',
      align: 'right',
      numeric: true,
      cell: (row) => row.daysUp,
      sortValue: (row) => row.daysUp,
    },
    {
      key: 'daysDown',
      header: 'Days Down',
      align: 'right',
      numeric: true,
      cell: (row) => row.daysDown,
      sortValue: (row) => row.daysDown,
    },
    {
      key: 'priceTargets',
      header: 'Price Targets',
      align: 'right',
      numeric: true,
      cell: (row) => {
        const display = analystTargetDisplay(row.lastClose, targetProgress.targets[row.ticker])
        return (
          <span className={display.upside === null ? 'text-text-dim' : display.upside >= 0 ? 'text-up' : 'text-down'}>
            {display.text}
          </span>
        )
      },
      sortValue: (row) => analystTargetDisplay(row.lastClose, targetProgress.targets[row.ticker]).upside,
    },
  ], [targetProgress.targets])

  const status = useMemo(() => {
    const label = UP_DOWN_SOURCES.find((entry) => entry.key === activeSource)?.label ?? activeSource
    const intervalLabel = UP_DOWN_INTERVALS.find((entry) => entry.key === interval)?.label ?? interval.toUpperCase()
    if (query.isFetching && !rows.length) return `Loading ${label} ${intervalLabel} up/down counts...`
    if (query.data?.meta.freshness === 'failed') {
      return `Up/Down load failed for ${label}: ${query.data.meta.failureReason ?? 'unknown error'}`
    }
    if (!rows.length) {
      if ((activeSource === 'portfolio' || activeSource === 'custom') && !symbols.length) {
        return `No ${label.toLowerCase()} tickers to load.`
      }
      return payload?.missing.length
        ? `Loaded 0 ${label} ticker(s); ${payload.missing.length} missing.`
        : `Loaded 0 ${label} ticker(s).`
    }
    const missing = payload?.missing.length ? `; ${payload.missing.length} missing` : ''
    if (targetProgress.loading || targetProgress.resolved < rows.length) {
      return `Loaded ${rows.length} ${label} ticker(s)${missing}; loading price targets (${targetProgress.resolved}/${rows.length})...`
    }
    const targetWarning = targetProgress.failures ? ` ${targetProgress.failures} target batch(es) failed.` : ''
    return `Loaded ${rows.length} ${label} ticker(s)${missing}; price targets available for ${targetProgress.available}/${targetProgress.resolved}.${targetWarning}`
  }, [
    activeSource,
    interval,
    payload,
    query.data,
    query.isFetching,
    rows.length,
    symbols.length,
    targetProgress,
  ])

  const applyCustom = useCallback((save: boolean) => {
    const normalized = normalizeUpDownSymbols(draft)
    setDraft(normalized.join(' '))
    setAppliedCustom(normalized)
    if (save) setSavedCustom(normalized)
  }, [draft, setSavedCustom])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <h1 className="pr-2 text-sm font-semibold text-text">Up/Down</h1>
        <span className="mr-1 text-2xs text-text-muted">Interval</span>
        {UP_DOWN_INTERVALS.map((entry) => (
          <Button
            key={entry.key}
            variant="toggle"
            active={entry.key === interval}
            onClick={() => setInterval(entry.key)}
          >
            {entry.label}
          </Button>
        ))}
        <Button
          variant="accent"
          onClick={() => void onRefresh()}
          disabled={refreshing || query.isFetching}
        >
          Refresh
        </Button>
        <p className="ml-auto max-w-[48%] truncate text-right text-2xs text-text-muted" title={status}>
          {status}
        </p>
      </div>

      <div className="flex shrink-0 border-b border-border">
        {UP_DOWN_SOURCES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setActiveSource(entry.key)}
            className={`h-8 border border-b-0 px-3 text-2xs ${
              activeSource === entry.key
                ? 'border-accent bg-surface-raised text-text'
                : 'border-border bg-surface text-text-muted hover:text-text'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {activeSource === 'custom' ? (
        <div className="flex shrink-0 gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Enter tickers separated by commas, spaces, or new lines"
            className="no-drag h-[70px] min-w-0 flex-1 resize-none border border-border bg-surface px-2 py-1 text-2xs text-text outline-none focus:border-accent"
          />
          <div className="flex flex-col gap-1">
            <Button onClick={() => applyCustom(false)}>Apply</Button>
            <Button variant="positive" onClick={() => applyCustom(true)}>Save</Button>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 border border-border bg-surface">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.ticker}
          showIndex
          layout="fixed"
          defaultSort={{ key: 'daysUp', direction: 'desc' }}
          empty={query.isFetching ? 'Loading Up/Down rows...' : 'No Up/Down rows to display'}
        />
      </div>
    </div>
  )
}
