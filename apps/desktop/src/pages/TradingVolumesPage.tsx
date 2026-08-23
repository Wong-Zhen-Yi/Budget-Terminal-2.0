import { useCallback, useEffect, useMemo, useState } from 'react'

import { TRADING_VOLUME_INTERVALS } from '@shared/contract'
import {
  TRADING_VOLUME_METRICS,
  filterStatusText,
  rankRows,
  visibleRows,
  type TradingVolumeFilter,
} from '@shared/tradingVolumes'
import { api } from '@/api/client'
import { useRefreshTradingVolumes, useTradingVolumes } from '@/api/tradingVolumeQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { DotPlot } from '@/components/tradingvolumes/DotPlot'
import { buildTradingVolumesLlmExport } from '@/components/tradingvolumes/llmExport'
import { VolumeTable } from '@/components/tradingvolumes/VolumeTable'
import { Button } from '@/components/ui/Button'
import { NumberInput } from '@/components/ui/NumberInput'
import { Splitter } from '@/components/ui/Splitter'
import { useTradingVolumesPage } from '@/stores/tradingVolumes'

/**
 * The Trading Volumes page: the hundred US equities trading the most dollars, as a table
 * beside a log-log plot of market cap against that dollar volume. Ported from
 * `OverviewMixin` (`mixins/overview.py`).
 *
 * Two departures from the reference, both deliberate. It stacks a page title over a panel
 * title that both read "Trading Volumes"; there is one header here, with the controls on
 * it. And Replay — the five-second market-cap animation — is not built yet, so its button
 * is present but disabled; the payload already carries the history it will need.
 */

type Tone = 'muted' | 'positive' | 'warning' | 'negative'

const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

/** Keeps either pane usable however far the divider is dragged. */
const MIN_PANE = 320

/**
 * `NumberInput` is built for table cells, where it stays invisible until hover. On a
 * toolbar it needs the frame the reference's `QSpinBox` has, so the wrapper supplies one.
 */
const SPIN_BOX = 'h-8 w-14 border border-border-strong bg-surface-raised px-1'

export function TradingVolumesPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const query = useTradingVolumes()
  const refresh = useRefreshTradingVolumes()

  const interval = useTradingVolumesPage((state) => state.interval)
  const mode = useTradingVolumesPage((state) => state.mode)
  const excludeTop = useTradingVolumesPage((state) => state.excludeTop)
  const rowRangeStart = useTradingVolumesPage((state) => state.rowRangeStart)
  const rowRangeEnd = useTradingVolumesPage((state) => state.rowRangeEnd)
  const tableWidth = useTradingVolumesPage((state) => state.tableWidth)
  const setInterval = useTradingVolumesPage((state) => state.setInterval)
  const setExcludeTop = useTradingVolumesPage((state) => state.setExcludeTop)
  const setRowRangeStart = useTradingVolumesPage((state) => state.setRowRangeStart)
  const setRowRangeEnd = useTradingVolumesPage((state) => state.setRowRangeEnd)
  const applyRowRange = useTradingVolumesPage((state) => state.applyRowRange)
  const reset = useTradingVolumesPage((state) => state.reset)
  const setTableWidth = useTradingVolumesPage((state) => state.setTableWidth)

  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)

  const payload = query.data?.data
  const filter = useMemo<TradingVolumeFilter>(
    () => ({ mode, excludeTop, rowRangeStart, rowRangeEnd }),
    [mode, excludeTop, rowRangeStart, rowRangeEnd],
  )

  // Rank every row by the active metric, then slice. The rank is stamped before the
  // slice, which is what lets the `#` column keep reading 6..100 under an exclude.
  const ranked = useMemo(() => rankRows(payload?.rows ?? [], interval), [payload, interval])
  const rows = useMemo(() => visibleRows(ranked, filter), [ranked, filter])

  useEffect(() => {
    onStatusChange(
      [{ label: 'Trading Volumes', envelope: query.data, loading: query.isFetching }],
      '',
    )
  }, [onStatusChange, query.data, query.isFetching])

  /** `_p20_trading_volume_status_text` plus the source and timestamp suffix. */
  const status = useMemo<{ text: string; tone: Tone }>(() => {
    if (notice) return notice
    if (query.isFetching) {
      return {
        text: payload ? 'Refreshing trading volume...' : 'Loading trading volume...',
        tone: 'muted',
      }
    }
    const meta = query.data?.meta
    if (meta?.freshness === 'failed') {
      return {
        text: `Trading Volumes failed: ${meta.failureReason ?? 'unknown error'}`,
        tone: 'negative',
      }
    }
    if (!payload || !ranked.length) return { text: 'Ready', tone: 'muted' }

    const base = filterStatusText(filter, rows.length, ranked.length)
    const text = `${base} from ${payload.source} at ${payload.asOf}`
    return payload.missing.length
      ? { text: `${text} (${payload.missing.length} without history)`, tone: 'warning' }
      : { text, tone: 'positive' }
  }, [notice, query.data, query.isFetching, payload, ranked, rows, filter])

  const onRefresh = useCallback(async () => {
    setNotice(null)
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  const onExport = useCallback(async () => {
    if (!payload?.rows.length) {
      setNotice({ text: 'Load trading volume before exporting data.', tone: 'warning' })
      return
    }
    const path = await api.saveText(
      'trading_volumes.md',
      buildTradingVolumesLlmExport(payload),
    )
    setNotice(
      path
        ? {
            text: `Exported ${payload.rows.length} stocks across ${TRADING_VOLUME_INTERVALS.length} intervals to ${path}`,
            tone: 'positive',
          }
        : null,
    )
  }, [payload])

  const onDrag = useCallback(
    (clientX: number) => {
      const available = window.innerWidth
      setTableWidth(Math.min(Math.max(clientX, MIN_PANE), available - MIN_PANE))
    },
    [setTableWidth],
  )

  const busy = refreshing || query.isFetching

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <h1 className="pr-2 text-sm font-semibold text-text">Trading Volumes</h1>

        <span className="px-1 text-2xs text-text-muted">Exclude top</span>
        <NumberInput
          value={excludeTop}
          onCommit={setExcludeTop}
          min={0}
          className={SPIN_BOX}
          aria-label="Exclude the highest-ranked rows"
        />
        <span className="pl-2 text-2xs text-text-muted">From row</span>
        <NumberInput
          value={rowRangeStart}
          onCommit={setRowRangeStart}
          min={1}
          className={SPIN_BOX}
          aria-label="First row to show"
        />
        <span className="text-2xs text-text-muted">To row</span>
        <NumberInput
          value={rowRangeEnd}
          onCommit={setRowRangeEnd}
          min={1}
          className={SPIN_BOX}
          aria-label="Last row to show"
        />
        <Button onClick={applyRowRange}>Search Rows</Button>
        <Button onClick={reset}>Reset</Button>

        <Button className="ml-2" onClick={() => void onRefresh()} disabled={busy}>
          {busy ? 'Refreshing...' : 'Refresh'}
        </Button>
        <Button variant="positive" onClick={() => void onExport()}>
          Export for LLM
        </Button>

        <span className={`ml-auto pl-2 text-2xs ${toneClass[status.tone]}`}>{status.text}</span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className="flex min-h-0 flex-col overflow-hidden border border-border bg-surface"
          style={{ width: tableWidth }}
        >
          <VolumeTable rows={rows} interval={interval} loading={query.isLoading} />
        </div>

        <Splitter onDrag={onDrag} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-border bg-surface">
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
            <span className="shrink-0 text-2xs font-semibold whitespace-nowrap text-text">
              Trading Volumes Dot Plot
            </span>
            {/* The header is a fixed h-9, so this has to give way on a narrow pane
                rather than wrap a second line into it. */}
            <span
              className="min-w-0 truncate pl-1 text-2xs whitespace-nowrap text-text-dim"
              title="Price-based estimate that assumes shares outstanding remain unchanged."
            >
              Estimated market cap • price-based
            </span>
            <Button
              className="ml-auto"
              variant="accent"
              disabled
              title="Market-cap replay is not built yet; the history it needs is already loaded."
            >
              Replay
            </Button>
            {TRADING_VOLUME_INTERVALS.map((key) => (
              <Button
                key={key}
                variant="toggle"
                active={key === interval}
                onClick={() => setInterval(key)}
              >
                {TRADING_VOLUME_METRICS[key].label}
              </Button>
            ))}
          </div>

          <DotPlot rows={rows} interval={interval} loaded={Boolean(ranked.length)} />
        </div>
      </div>
    </div>
  )
}
