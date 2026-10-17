import { useCallback, useEffect, useMemo, useState } from 'react'

import type { HeatmapEtfKey, HeatmapInterval } from '@shared/contract'
import { HEATMAP_INTERVALS } from '@shared/contract'
import {
  HEATMAP_ETFS,
  buildHeatmapDetail,
  buildHeatmapRows,
  buildHeatmapSummary,
  etfLabel,
  etfTicker,
  formatHeatmapPct,
  formatHoldingSummary,
  intervalLabel,
  selectHeatmapRow,
  type HeatmapRow,
} from '@shared/heatmap'
import { useHeatmap, useRefreshHeatmap } from '@/api/heatmapQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { IndexHeatmap } from '@/components/heatmap/IndexHeatmap'
import { Button } from '@/components/ui/Button'

/**
 * The Heatmap page, ported from `SpyHeatmapMixin.init_page17`.
 *
 * The same four bands the reference stacks: the title row with the three index buttons
 * and the seven interval buttons, the six-cell summary strip, the map itself at flex 1,
 * and the selected-holding detail strip. Double-clicking a tile opens the holding in
 * Charts, as `_p17_open_symbol_in_charts` does.
 *
 * The interval buttons never go back to the network. The payload carries all seven
 * windows per holding, so switching between Live and 1Y is a re-render — the reference
 * does the same thing through `_p17_render_interval_result`.
 */

const changeClass = (value: number | null | undefined) =>
  typeof value !== 'number' || !Number.isFinite(value)
    ? 'text-text-muted'
    : value >= 0
      ? 'text-up'
      : 'text-down'

export function HeatmapPage({
  onStatusChange,
  onNavigate,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate?: (tabId: string, symbol?: string) => void
}) {
  const [etf, setEtf] = useState<HeatmapEtfKey>('SPY')
  const [interval, setIntervalKey] = useState<HeatmapInterval>('live')
  const [selected, setSelected] = useState<HeatmapRow | null>(null)

  const query = useHeatmap(etf)
  const refresh = useRefreshHeatmap()
  const [refreshing, setRefreshing] = useState(false)

  const payload = query.data?.data.etf === etf ? query.data.data : undefined
  const loading = query.isFetching

  useEffect(() => {
    // No file behind this page, so the status bar's path slot stays empty.
    onStatusChange([{ label: 'Heatmap', envelope: query.data, error: query.error, enabled: query.isEnabled, loading }], '')
  }, [onStatusChange, query.data, loading])

  const rows = useMemo(
    () => (payload && payload.etf === etf ? buildHeatmapRows(payload, etf, interval) : []),
    [payload, etf, interval],
  )

  // `select_heatmap_row`: keep the chosen symbol across an interval change, drop it when
  // the index changes, and otherwise fall back to the largest holding.
  const active = useMemo(() => selectHeatmapRow(rows, selected, etf), [rows, selected, etf])

  const summary = useMemo(() => buildHeatmapSummary(payload, interval), [payload, interval])
  const detail = useMemo(() => buildHeatmapDetail(active, interval), [active, interval])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refresh(etf)
    } finally {
      setRefreshing(false)
    }
  }, [refresh, etf])

  /** `_p17_render_interval_result`'s status line, including its loaded-count rescue. */
  const status = useMemo(() => {
    if (loading) {
      return `Loading ${etfLabel(etf)} holdings heatmap - ${intervalLabel(interval)}...`
    }
    const meta = query.data?.meta
    if (!payload || meta?.freshness === 'failed') {
      return `${etfLabel(etf)} heatmap refresh failed: ${meta?.failureReason ?? query.error?.message ?? 'unknown error'}`
    }
    const loaded = `Loaded ${rows.length} ${etfLabel(etf)} holdings (${etfTicker(etf)}) from ${
      payload.issuer || 'ETF holdings source'
    }${payload.asOfDate ? `, holdings as of ${payload.asOfDate}` : ''}. ${payload.priceSource || 'Yahoo Finance'} · prices as of ${payload.priceAsOfDate || '--'} · ${intervalLabel(interval)}.`
    // `describe_market_data_status` returns only the failure reason for a degraded
    // payload; keeping the loaded count too is what stops "356 quotes unavailable" from
    // hiding how much of the map did work.
    if ((meta?.freshness === 'partial' || meta?.freshness === 'stale') && meta.failureReason) return `${loaded} ${meta.failureReason}`
    return loaded
  }, [loading, query.data, query.error, payload, rows.length, etf, interval])

  const missing = Math.max(0, summary.holdingsLoaded - summary.quoteCoverage)

  const cells: Array<{ key: string; label: string; value: string; className: string; title?: string }> = [
    {
      key: 'updated',
      label: 'Prices as of',
      value: payload?.priceAsOfDate || '--',
      className: 'text-text',
      title: payload ? `Yahoo Finance · fetched ${new Date(payload.fetchedAt).toLocaleString()}` : undefined,
    },
    {
      key: 'holdings',
      label: 'Holdings',
      value: summary.holdingsLoaded ? String(summary.holdingsLoaded) : '--',
      className: 'text-text',
    },
    {
      key: 'coverage',
      label: 'Quote Coverage',
      value: summary.holdingsLoaded ? `${summary.quoteCoverage}/${summary.holdingsLoaded}` : '--',
      // `_p17_set_coverage_label`: a bare "147/503" is easy to read past, so colour the
      // shortfall — red once more than half the book is unquoted, amber below that.
      className: !summary.holdingsLoaded
        ? 'text-text-muted'
        : !missing
          ? 'text-text'
          : summary.quoteCoverage * 2 < summary.holdingsLoaded
            ? 'text-down'
            : 'text-warn',
      title: summary.holdingsLoaded
        ? missing
          ? `${missing} of ${summary.holdingsLoaded} holdings have no quote and render as no-data tiles.`
          : `All ${summary.holdingsLoaded} holdings are quoted.`
        : undefined,
    },
    {
      key: 'weighted',
      label: 'Weighted Move',
      value: formatHeatmapPct(summary.weightedMove, true),
      className: changeClass(summary.weightedMove),
    },
    {
      key: 'strongest',
      label: 'Strongest',
      value: formatHoldingSummary(summary.strongest),
      className: changeClass(summary.strongest?.changePct),
    },
    {
      key: 'weakest',
      label: 'Weakest',
      value: formatHoldingSummary(summary.weakest),
      className: changeClass(summary.weakest?.changePct),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <h1 className="pr-2 text-sm font-semibold text-text">Heatmap</h1>
        {HEATMAP_ETFS.map((entry) => (
          <Button
            key={entry.key}
            variant="toggle"
            active={entry.key === etf}
            title={`${entry.label} holdings, via ${entry.ticker}`}
            onClick={() => {
              setEtf(entry.key)
              setSelected(null)
            }}
          >
            {entry.label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {HEATMAP_INTERVALS.map((entry) => (
            <Button
              key={entry.key}
              variant="toggle"
              active={entry.key === interval}
              onClick={() => setIntervalKey(entry.key)}
            >
              {intervalLabel(entry.key)}
            </Button>
          ))}
          <Button variant="accent" onClick={() => void onRefresh()} disabled={refreshing || loading}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-6 divide-x divide-border border border-border bg-surface">
        {cells.map((cell) => (
          <div key={cell.key} title={cell.title} className="flex flex-col items-center px-2 py-1">
            <span className="text-2xs text-text-muted">{cell.label}</span>
            <span className={`num text-2xs font-semibold ${cell.className}`}>{cell.value}</span>
          </div>
        ))}
      </div>

      <p className="shrink-0 text-right text-2xs text-text-muted" title={status}>
        {status}
      </p>

      <IndexHeatmap
        rows={rows}
        selectedSymbol={active?.symbol ?? ''}
        onSelect={setSelected}
        onActivate={(symbol) => onNavigate?.('charts', symbol)}
        empty={
          loading
            ? 'Loading index holdings...'
            : query.error || query.data?.meta.freshness === 'failed'
              ? 'Heatmap unavailable. Press Refresh to retry.'
              : 'No index holdings available. Press Refresh to retry.'
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-3 border border-border bg-surface px-3 py-1.5 text-2xs text-text">
        <span className="font-semibold">{detail.symbol}</span>
        <span className="truncate text-text-muted">{detail.name}</span>
        <span>{detail.sector}</span>
        <span className="num">{detail.weight}</span>
        <span className="num">{detail.price}</span>
        <span className={`num font-semibold ${changeClass(detail.changePct)}`}>
          {detail.changeText}
        </span>
        <span className="ml-auto text-text-dim">
          Scroll to zoom, drag to pan, double-click a tile to open it in Charts.
        </span>
      </div>
    </div>
  )
}
