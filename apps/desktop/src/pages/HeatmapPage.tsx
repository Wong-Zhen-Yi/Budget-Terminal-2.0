import { useEffect, useMemo, useState } from 'react'

import type { HeatmapEtfKey, HeatmapInterval, HeatmapPayload } from '@shared/contract'
import { HEATMAP_INTERVALS } from '@shared/contract'
import {
  HEATMAP_ETFS,
  HEATMAP_REPLAY_STEP_MS,
  heatmapAtDate,
  heatmapReplayDates,
  buildHeatmapDetail,
  buildHeatmapRows,
  buildHeatmapSummary,
  formatHeatmapPct,
  formatHoldingSummary,
  intervalLabel,
  selectHeatmapRow,
  type HeatmapRow,
} from '@shared/heatmap'
import { useHeatmap, useHeatmapProgress } from '@/api/heatmapQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { IndexHeatmap } from '@/components/heatmap/IndexHeatmap'
import { Button } from '@/components/ui/Button'
import { pointerText } from '@/mobile/touch'

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

  const [replay, setReplay] = useState<{
    payload: HeatmapPayload; dates: string[]; index: number; playing: boolean
  } | null>(null)
  const replayStepMs = HEATMAP_REPLAY_STEP_MS[interval]

  useEffect(() => {
    if (!replay?.playing) return
    const timer = window.setInterval(() => setReplay(current => {
      if (!current?.playing) return current
      const index = Math.min(current.index + 1, current.dates.length - 1)
      return { ...current, index, playing: index < current.dates.length - 1 }
    }), replayStepMs)
    return () => window.clearInterval(timer)
  }, [replay?.playing, replayStepMs])

  const query = useHeatmap(etf)
  const loading = query.isFetching
  const preview = useHeatmapProgress(etf, loading)
  const completed = query.data?.data.etf === etf ? query.data.data : undefined
  // Keep the previous map during refresh until new prices begin arriving.
  const latestPayload = preview && (preview.quoteCoverage > 0 || !completed?.holdings.length) ? preview : completed

  const replayDates = useMemo(() => heatmapReplayDates(completed), [completed])
  const payload = useMemo(() => replay
    ? heatmapAtDate(replay.payload, replay.dates[replay.index])
    : latestPayload, [replay, latestPayload])

  useEffect(() => {
    // No file behind this page, so the status bar's path slot stays empty.
    onStatusChange([{ label: 'Heatmap', envelope: query.data, error: query.error, enabled: query.isEnabled, loading }], '')
  }, [onStatusChange, query.data, query.error, query.isEnabled, loading])

  const rows = useMemo(
    () => (payload && payload.etf === etf ? buildHeatmapRows(payload, etf, interval) : []),
    [payload, etf, interval],
  )

  // `select_heatmap_row`: keep the chosen symbol across an interval change, drop it when
  // the index changes, and otherwise fall back to the largest holding.
  const active = useMemo(() => selectHeatmapRow(rows, selected, etf), [rows, selected, etf])

  const summary = useMemo(() => buildHeatmapSummary(payload, interval), [payload, interval])
  const detail = useMemo(() => buildHeatmapDetail(active, interval), [active, interval])


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
          ? `${missing} of ${summary.holdingsLoaded} holdings ${loading ? 'are waiting for quotes' : 'have no quote'} and render as no-data tiles.`
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
      <div className="mobile-tab-strip flex shrink-0 flex-wrap items-center gap-1" role="group" aria-label="Heatmap index and timeframe">
        <h1 className="mobile-hide pr-2 text-sm font-semibold text-text">Heatmap</h1>
        {HEATMAP_ETFS.map((entry) => (
          <Button
            key={entry.key}
            variant="toggle"
            active={entry.key === etf}
            title={`${entry.label} holdings, via ${entry.ticker}`}
            onClick={() => {
              setReplay(null)
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

        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface px-2 py-1 text-2xs">
        <span className="font-semibold text-text">Historical replay</span>
        <span className="text-text-muted">{replayStepMs / 1000}s per trading day</span>
        {replay ? <>
          <Button onClick={() => setReplay(current => current ? { ...current,
            index: current.index === current.dates.length - 1 ? 0 : current.index,
            playing: !current.playing } : null)}>{replay.playing ? 'Pause' : 'Play'}</Button>
          <Button onClick={() => setReplay(current => current ? { ...current, index: 0, playing: false } : null)}>Restart</Button>
          <span className="num text-text" aria-live="off">{replay.dates[replay.index]}</span>
          <input type="range" aria-label="Replay date" min={0} max={replay.dates.length - 1}
            value={replay.index} aria-valuetext={replay.dates[replay.index]}
            className="min-w-24 flex-1 accent-accent"
            onChange={event => { const index = Number(event.target.value)
              setReplay(current => current ? { ...current, index, playing: false } : null) }} />
          <span className="num text-text-muted">{replay.index + 1}/{replay.dates.length}</span>
          <Button onClick={() => setReplay(null)}>Back to latest</Button>
        </> : <>
          <Button disabled={replayDates.length < 2} onClick={() => {
            if (!completed || replayDates.length < 2) return
            if (interval === 'live') setIntervalKey('1d')
            setReplay({ payload: completed, dates: replayDates, index: 0, playing: true })
          }}>Play history</Button>
          <span role="status" className="min-w-0 flex-1 truncate text-text-muted">{replayDates.length >= 2
            ? `${replayDates[0]} to ${replayDates.at(-1)} · current holdings and weights`
            : loading || query.isPending ? 'Replay building…' : 'Replay unavailable. Retrying automatically…'}</span>
        </>}
      </div>

      <div className="grid shrink-0 grid-cols-6 divide-x divide-border border border-border bg-surface">
        {cells.map((cell) => (
          <div key={cell.key} title={cell.title} className="flex flex-col items-center px-2 py-1">
            <span className="text-2xs text-text-muted">{cell.label}</span>
            <span className={`num text-2xs font-semibold ${cell.className}`}>{cell.value}</span>
          </div>
        ))}
      </div>

      <IndexHeatmap
        rows={rows}
        selectedSymbol={active?.symbol ?? ''}
        onSelect={setSelected}
        onActivate={(symbol) => onNavigate?.('charts', symbol)}
        empty={
          loading
            ? 'Loading index holdings...'
            : query.error || query.data?.meta.freshness === 'failed'
              ? 'Heatmap unavailable.'
              : 'No index holdings available.'
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
          {pointerText('Scroll to zoom, drag to pan, double-click a tile to open it in Charts.', 'Pinch to zoom, drag to pan, double-tap a tile to open it in Charts.')}
        </span>
      </div>
    </div>
  )
}
