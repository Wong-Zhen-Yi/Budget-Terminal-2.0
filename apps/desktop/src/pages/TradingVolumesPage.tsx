import { useCallback, useEffect, useMemo, useState } from 'react'

import { TRADING_VOLUME_INTERVALS } from '@shared/contract'
import {
  TRADING_VOLUME_METRICS,
  LOWER_OUTLIER_FACTOR,
  rankRows,
  removeLowerOutliers,
} from '@shared/tradingVolumes'
import { api } from '@/api/client'
import { useRefreshTradingVolumes, useTradingVolumes } from '@/api/tradingVolumeQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { DotPlot } from '@/components/tradingvolumes/DotPlot'
import { buildTradingVolumesLlmExport } from '@/components/tradingvolumes/llmExport'
import { useMarketCapReplay } from '@/components/tradingvolumes/useMarketCapReplay'
import { VolumeTable } from '@/components/tradingvolumes/VolumeTable'
import { Button } from '@/components/ui/Button'
import { Splitter } from '@/components/ui/Splitter'
import { useTradingVolumesPage } from '@/stores/tradingVolumes'

/**
 * The Trading Volumes page: the hundred US equities trading the most dollars, as a table
 * beside a log-log plot of market cap against that dollar volume. Ported from
 * `OverviewMixin` (`mixins/overview.py`).
 *
 * One departure from the reference: it stacks a page title over a panel title that both
 * read "Trading Volumes", where there is one header here with the controls on it.
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

export function TradingVolumesPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const query = useTradingVolumes()
  const refresh = useRefreshTradingVolumes()

  const interval = useTradingVolumesPage((state) => state.interval)
  const tableWidth = useTradingVolumesPage((state) => state.tableWidth)
  const setInterval = useTradingVolumesPage((state) => state.setInterval)
  const setTableWidth = useTradingVolumesPage((state) => state.setTableWidth)

  const [refreshing, setRefreshing] = useState(false)
  const [outliersToRemove, setOutliersToRemove] = useState(0)
  const [outliersHovered, setOutliersHovered] = useState(false)
  const [outliersFocused, setOutliersFocused] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)

  const payload = query.data?.data
  // Detect against all ranked rows so moving the slider never changes the candidates.
  const ranked = useMemo(() => rankRows(payload?.rows ?? [], interval), [payload, interval])
  const cleanedRows = useMemo(() => removeLowerOutliers(ranked, interval), [ranked, interval])
  const outlierCount = ranked.length - cleanedRows.length
  const removedCount = Math.min(outliersToRemove, outlierCount)
  const outlierTickers = useMemo(() => {
    const retained = new Set(cleanedRows)
    return new Set(ranked.filter((row) => !retained.has(row)).map((row) => row.ticker))
  }, [ranked, cleanedRows])
  const rows = useMemo(
    () => removeLowerOutliers(ranked, interval, removedCount),
    [ranked, interval, removedCount],
  )

  // Replay animates the visible rows over the active interval, so it re-plans whenever
  // either changes — and stops itself when it does.
  const replay = useMarketCapReplay(rows, interval)

  useEffect(() => {
    onStatusChange(
      [{ label: 'Trading Volumes', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching }],
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

    const base = removedCount > 0
      ? `${rows.length} rows shown, ${removedCount} lower outlier${removedCount === 1 ? '' : 's'} hidden`
      : `${rows.length} rows shown`
    const text = `${base} from ${payload.source} at ${payload.asOf}`
    return payload.missing.length
      ? { text: `${text} (${payload.missing.length} without history)`, tone: 'warning' }
      : { text, tone: 'positive' }
  }, [notice, query.data, query.isFetching, payload, ranked, rows, removedCount])

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

        <label
          className="flex flex-wrap items-center gap-2 px-1 text-2xs text-text-muted"
          title={`Remove detected outliers from lowest market cap upward. Outliers have market caps less than 1/${LOWER_OUTLIER_FACTOR} of the trend line estimate. Hover to preview remaining outliers.`}
          onMouseEnter={() => setOutliersHovered(true)}
          onMouseLeave={() => setOutliersHovered(false)}
          onFocus={() => setOutliersFocused(true)}
          onBlur={() => setOutliersFocused(false)}
        >
          <span>Remove Outliers</span>
          <input
            type="range"
            min={0}
            max={outlierCount}
            step={1}
            value={removedCount}
            disabled={outlierCount === 0}
            aria-label="Remove outliers, lowest market cap first"
            aria-valuetext={`${removedCount} of ${outlierCount} outliers removed, lowest market cap first`}
            className="w-32 accent-accent"
            onChange={(event) => {
              setNotice(null)
              setOutliersToRemove(Number(event.target.value))
            }}
          />
          <span className="num">{removedCount} / {outlierCount}</span>
          <span>Lowest market cap first</span>
        </label>
        <Button onClick={() => {
          setOutliersToRemove(0)
          setNotice(null)
        }}>Reset</Button>

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
{/* The header is a fixed h-9 on a pane that can get narrow, so the prose and
                the playback date take turns rather than competing for it. While Replay
                runs the date is the information — `_p20_apply_market_cap_animation_frame`
                writes it here — and the standing caption would only truncate to noise. */}
            {replay.frame ? (
              <span
                className="num shrink-0 pl-1 text-2xs whitespace-nowrap text-text-muted"
                title="Estimated market cap on this date, assuming shares outstanding are unchanged."
              >
                • {replay.frame.date}
              </span>
            ) : (
              <span
                className="min-w-0 truncate pl-1 text-2xs whitespace-nowrap text-text-dim"
                title="Price-based estimate that assumes shares outstanding remain unchanged."
              >
                Estimated market cap{replay.canReplay ? ' • price-based' : ''}
              </span>
            )}
            <Button
              className="ml-auto"
              variant="accent"
              disabled={!replay.canReplay}
              onClick={replay.playing ? replay.stop : replay.start}
              title={
                replay.canReplay
                  ? 'Replay the selected interval using price-based estimated market caps.'
                  : 'Refresh Trading Volumes to load daily market-cap history.'
              }
            >
              {replay.playing ? 'Stop' : 'Replay'}
            </Button>
            {TRADING_VOLUME_INTERVALS.map((key) => (
              <Button
                key={key}
                variant="toggle"
                active={key === interval}
                onClick={() => {
                  setInterval(key)
                  setOutliersToRemove(0)
                }}
              >
                {TRADING_VOLUME_METRICS[key].label}
              </Button>
            ))}
          </div>

          <DotPlot
            rows={rows}
            interval={interval}
            loaded={Boolean(ranked.length)}
            frame={replay.frame}
            plan={replay.plan}
            highlightedTickers={(outliersHovered || outliersFocused) ? outlierTickers : undefined}
          />
        </div>
      </div>
    </div>
  )
}
