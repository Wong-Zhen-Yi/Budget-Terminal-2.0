import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ChartsInterval, Envelope, ProjectionsTypeFilter } from '@shared/contract'
import { formatExpiration, topVolumeRecords } from '@shared/optionsPage'
import {
  buildProjectionPaths,
  buildProjectionsExport,
  buildProjectionSummaries,
  emptyProjectionModel,
  emptyProjectionPaths,
  projectionAggregate,
  projectionHeadlines,
  projectionMetaText,
  projectionPrice,
  PROJECTIONS_TIMEFRAMES,
  PROJECTIONS_TYPE_FILTERS,
  PROXY_SOURCE_NOTE,
  sectionProjectionLabel,
  type ProjectionSummary,
} from '@shared/projections'
import { api } from '@/api/client'
import { useProjections, useRefreshProjections } from '@/api/projectionsQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { OptionSummaryTable } from '@/components/options/OptionSummaryTable'
import { ProjectionsChart, SIDE_COLOR } from '@/components/projections/ProjectionsChart'
import { Button } from '@/components/ui/Button'
import { currency } from '@/lib/format'
import { useProjectionsPage } from '@/stores/projections'

/**
 * The Projections page, ported from `ChartsOptionsTopVolumeMixin` (page28).
 *
 * One load answers with a chart and every live expiration's raw chain; everything the
 * page shows on top of that — the three projected paths, the headline strip, the
 * coverage tile, the per-expiration labels and the top-volume tables — is derived here
 * from that one payload. That is why switching the tables between Calls and Puts is
 * instant: `_p28_apply_loaded_type_filter` re-renders without refetching too, and the
 * projections themselves never depended on the filter at all.
 *
 * The chart timeframe *does* reload, exactly as `_p28_set_timeframe` does — a different
 * timeframe is a different chart, and the projections anchor on its latest close. The
 * chains behind it are cached, so only the chart request actually leaves the process.
 */

type Tone = 'muted' | 'positive' | 'warning' | 'negative'
const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

function failureOf(envelope: Envelope<unknown> | undefined, block: string): string | undefined {
  const matched = envelope?.errors.find((entry) => entry.symbol === block)
  if (matched) return matched.reason
  return envelope?.meta.freshness === 'failed' ? envelope.meta.failureReason : undefined
}

export function ProjectionsPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const { symbol, timeframe, typeFilter, summarySort, setSymbol, setTimeframe, setTypeFilter, setSummarySort } =
    useProjectionsPage()
  const [draft, setDraft] = useState(symbol)
  // `_p28_on_show`: the page issues one non-forced load the first time it is shown, and
  // this component only mounts when its tab is opened — so being armed from the start is
  // that same first load, not a fetch from the app's startup.
  const [armed, setArmed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)

  const query = useProjections(symbol, timeframe, armed)
  const refresh = useRefreshProjections()
  const payload = query.data?.data

  useEffect(() => setDraft(symbol), [symbol])

  useEffect(() => {
    onStatusChange(
      [{ label: 'Projections', envelope: query.data, loading: query.isFetching }],
      '',
    )
  }, [onStatusChange, query.data, query.isFetching])

  /** `_p28_latest_chart_close`, the spot every projection anchors on. */
  const currentClose = payload?.candles.at(-1)?.close ?? null
  /** `_p28_latest_chart_date`, the weekly path's origin. */
  const asOfDate = useMemo(() => {
    const last = payload?.candles.at(-1)?.time
    return last === undefined ? '' : new Date(last * 1000).toISOString().slice(0, 10)
  }, [payload])

  const model = useMemo(
    () =>
      payload ? buildProjectionSummaries(payload.buckets, currentClose) : emptyProjectionModel(),
    [payload, currentClose],
  )
  const paths = useMemo(
    () => (asOfDate ? buildProjectionPaths(model, currentClose, asOfDate) : emptyProjectionPaths()),
    [model, currentClose, asOfDate],
  )
  const headlines = useMemo(() => projectionHeadlines(model), [model])
  const aggregate = useMemo(() => projectionAggregate(model), [model])

  /** The selected type filter's top ten per expiration, as `prepare_top_volume_records`. */
  const buckets = useMemo(
    () =>
      (payload?.buckets ?? []).map((bucket) => ({
        expiry: bucket.expiry,
        rows: topVolumeRecords(bucket.rows, typeFilter),
      })),
    [payload, typeFilter],
  )
  const rowTotal = buckets.reduce((sum, bucket) => sum + bucket.rows.length, 0)
  const populated = buckets.filter((bucket) => bucket.rows.length).length

  const load = useCallback(
    async (nextTimeframe?: ChartsInterval) => {
      const ticker = draft.trim().toUpperCase()
      if (!ticker) {
        setNotice({
          text: 'Enter a ticker before loading options top volume.',
          tone: 'warning',
        })
        return
      }
      const target = nextTimeframe ?? timeframe
      setSymbol(ticker)
      setTimeframe(target)
      setArmed(true)
      setNotice(null)
      setBusy(true)
      try {
        await refresh(ticker, target)
      } finally {
        setBusy(false)
      }
    },
    [draft, refresh, setSymbol, setTimeframe, timeframe],
  )

  /** `_p28_set_timeframe`: a new timeframe reloads, but only when something is loaded. */
  const chooseTimeframe = useCallback(
    (next: ChartsInterval) => {
      if (next === timeframe) return
      setTimeframe(next)
      if (payload?.candles.length) void load(next)
    },
    [load, payload, setTimeframe, timeframe],
  )

  const exportTopVolume = useCallback(async () => {
    if (!rowTotal) {
      setNotice({
        text: 'No options top-volume data is currently loaded to export.',
        tone: 'warning',
      })
      return
    }
    await api.writeClipboard(
      buildProjectionsExport({
        ticker: payload?.symbol ?? symbol,
        timeframe,
        typeFilter,
        currentClose,
        model,
        buckets,
        exportedAt: new Date().toLocaleString('sv-SE').slice(0, 19),
      }),
    )
    setNotice({
      text: `Top-volume options export copied for ${payload?.symbol ?? symbol}`,
      tone: 'positive',
    })
  }, [buckets, currentClose, model, payload, rowTotal, symbol, timeframe, typeFilter])

  const chartError = payload?.chartError || failureOf(query.data, 'Chart')

  /** `_p28_apply_completed_view`'s status line, in the same order of precedence. */
  const status = useMemo((): { text: string; tone: Tone } => {
    if (!armed || !payload) {
      return {
        text: 'Enter a ticker and load all-expiration top-volume options.',
        tone: 'muted',
      }
    }
    if (query.isFetching && !payload.buckets.length) {
      return { text: `Loading chart and all expirations for ${symbol}...`, tone: 'warning' }
    }
    if (query.data?.meta.freshness === 'failed') {
      return {
        text: `Error loading ${symbol}: ${query.data.meta.failureReason}`,
        tone: 'negative',
      }
    }
    if (!buckets.length) {
      return {
        text: `No listed options expirations were available for ${symbol}.`,
        tone: 'warning',
      }
    }
    if (!rowTotal) {
      return { text: `No top-volume options rows were available for ${symbol}.`, tone: 'warning' }
    }
    let text = `Updated ${symbol}: ${rowTotal} rows across ${buckets.length} expirations`
    if (chartError) text += ` | chart unavailable: ${chartError}`
    else if (populated < buckets.length) {
      text += ` | ${buckets.length - populated} expirations returned no rows`
    }
    return { text, tone: chartError || populated < buckets.length ? 'warning' : 'positive' }
  }, [armed, buckets.length, chartError, payload, populated, query.data, query.isFetching, rowTotal, symbol])

  const stats = payload?.stats

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-1">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface px-2 py-1">
        <span className="text-2xs font-semibold text-text">Projections</span>
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            void load()
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            placeholder="Ticker"
            aria-label="Projections ticker"
            className="h-8 w-32 border border-border-strong bg-surface-raised px-2 text-2xs font-semibold tracking-wide text-text outline-none focus:border-accent"
          />
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? 'Loading...' : 'Load'}
          </Button>
        </form>
        <Button variant="accent" onClick={() => void exportTopVolume()}>
          Export Top Volume
        </Button>
        <span className="ml-auto text-2xs text-text-muted">Projection range: All expirations</span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border border-border bg-surface px-2 py-1">
        <span className="mr-1 text-2xs font-semibold text-text-muted">Timeframe</span>
        {PROJECTIONS_TIMEFRAMES.map((entry) => (
          <Button
            key={entry.label}
            variant="toggle"
            active={timeframe === entry.label}
            title={entry.label}
            onClick={() => chooseTimeframe(entry.label)}
          >
            {entry.short}
          </Button>
        ))}
        <span className="mr-1 ml-4 text-2xs font-semibold text-text-muted">Table rows</span>
        {PROJECTIONS_TYPE_FILTERS.map((entry) => (
          <Button
            key={entry.key}
            variant="toggle"
            active={typeFilter === entry.key}
            onClick={() => setTypeFilter(entry.key as ProjectionsTypeFilter)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      {notice ? (
        <p className={`shrink-0 px-1 text-2xs ${toneClass[notice.tone]}`}>{notice.text}</p>
      ) : null}

      <section className="grid shrink-0 grid-cols-2 gap-3 border border-border bg-surface px-2 py-1 lg:grid-cols-5">
        <Metric
          title="Current Close"
          value={currentClose === null ? '--' : projectionPrice(currentClose)}
          meta={currentClose === null ? 'No chart close' : 'Latest chart close'}
        />
        <SummaryMetric title="Nearest Call Projection" summary={headlines.calls} side="calls" />
        <SummaryMetric title="Nearest Put Projection" summary={headlines.puts} side="puts" />
        <SummaryMetric
          title="Nearest Combined Projection"
          summary={headlines.combined}
          side="combined"
        />
        <Metric
          title="Data Confidence / Coverage"
          color={SIDE_COLOR.combined}
          value={
            aggregate
              ? `${aggregate.confidenceLabel} (${Math.round(aggregate.confidenceScore * 100)}%)`
              : '--'
          }
          meta={
            aggregate
              ? `${aggregate.expirationCount.toLocaleString('en-US')} expirations | ${aggregate.includedContractCount.toLocaleString('en-US')} valid contracts`
              : 'No projection coverage'
          }
        />
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-1 xl:grid-cols-[5fr_3fr]">
        <section className="flex min-h-0 flex-col overflow-hidden border border-border bg-surface">
          <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface-raised px-2 py-1">
            <span className="text-sm font-bold text-text">{payload?.symbol || symbol}</span>
            <span className="num text-sm font-bold text-text">
              {stats ? currency(stats.close) : '--'}
            </span>
            <span
              className={`num text-2xs font-semibold ${
                (stats?.absChange ?? 0) >= 0 ? 'text-up' : 'text-down'
              }`}
            >
              {stats
                ? `${stats.absChange >= 0 ? '+' : ''}${stats.absChange.toFixed(2)} (${
                    stats.change >= 0 ? '+' : ''
                  }${stats.change.toFixed(2)}%)`
                : '--'}
            </span>
            <span className="ml-auto flex items-center gap-3 text-2xs font-semibold">
              <span style={{ color: SIDE_COLOR.calls }}>● Calls</span>
              <span style={{ color: SIDE_COLOR.puts }}>● Puts</span>
              <span style={{ color: SIDE_COLOR.combined }}>● Combined</span>
            </span>
          </header>
          <ProjectionsChart
            candles={payload?.candles ?? []}
            paths={paths}
            empty={
              chartError ||
              (armed && query.isFetching ? 'Loading chart...' : 'No chart data loaded.')
            }
          />
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden border border-border bg-surface">
          <header className="shrink-0 border-b border-border bg-surface-raised px-2 py-1">
            <h2 className="text-2xs font-semibold text-text uppercase">Options Top Volume</h2>
            <p className="text-2xs text-text-muted">
              {buckets.length
                ? `${rowTotal} rows across ${buckets.length} expirations | ${
                    typeFilter === 'puts' ? 'Puts' : 'Calls'
                  } | All`
                : 'No options data loaded.'}
            </p>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            <div className="flex flex-col gap-2">
              {buckets.map((bucket) => (
                <article
                  key={bucket.expiry}
                  className="flex min-h-[200px] flex-col overflow-hidden border border-border bg-surface-raised"
                >
                  <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
                    <h3 className="text-2xs font-semibold text-text uppercase">
                      {formatExpiration(bucket.expiry) || bucket.expiry}
                    </h3>
                    {failureOf(query.data, bucket.expiry) ? (
                      <span
                        title={failureOf(query.data, bucket.expiry)}
                        aria-label={failureOf(query.data, bucket.expiry)}
                        className="size-1.5 shrink-0 rounded-full bg-down"
                      />
                    ) : null}
                  </header>
                  <p className="shrink-0 px-2 py-0.5 text-2xs text-text-muted">
                    {sectionProjectionLabel(model, bucket.expiry)}
                  </p>
                  <OptionSummaryTable
                    rows={bucket.rows}
                    sort={summarySort}
                    onSortChange={setSummarySort}
                    lowHighlights={false}
                    empty="No rows"
                  />
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>

      <p className="shrink-0 px-1 text-2xs text-text-dim">{PROXY_SOURCE_NOTE}</p>
      <p className={`shrink-0 px-1 text-2xs ${toneClass[status.tone]}`}>{status.text}</p>
    </div>
  )
}

function Metric({
  title,
  value,
  meta,
  color,
}: {
  title: string
  value: string
  meta: string
  color?: string
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-2xs text-text-muted">{title}</p>
      <p className="num text-sm font-bold" style={{ color: color ?? undefined }}>
        {value}
      </p>
      <p className="text-2xs text-text-muted">{meta}</p>
    </div>
  )
}

function SummaryMetric({
  title,
  summary,
  side,
}: {
  title: string
  summary: ProjectionSummary | null
  side: keyof typeof SIDE_COLOR
}) {
  return (
    <Metric
      title={title}
      color={summary ? SIDE_COLOR[side] : undefined}
      value={summary ? projectionPrice(summary.projectedPrice) : '--'}
      meta={
        summary
          ? projectionMetaText(summary)
          : `No ${side === 'combined' ? 'combined' : side.slice(0, -1)} projection available`
      }
    />
  )
}
