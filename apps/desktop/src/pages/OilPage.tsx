import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  Envelope,
  OilCurvePoint,
  OilPayload,
  OilSeries,
  OilSeriesKey,
  OilValue,
} from '@shared/contract'
import { buildOilSnapshot } from '@shared/oil'
import { api } from '@/api/client'
import { useOil, useRefreshOil } from '@/api/oilQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { colorForIndex } from '@/components/charts/Donut'
import { LineChart, type LineSeries } from '@/components/charts/LineChart'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { EM_DASH, currency, decimals, directionClass, integer, percent } from '@/lib/format'

type Tone = 'positive' | 'negative' | 'muted' | 'warning'

const toneClass: Record<Tone, string> = {
  positive: 'text-up',
  negative: 'text-down',
  muted: 'text-text-muted',
  warning: 'text-warn',
}

/** Weeks of weekly history the inventory chart plots — roughly two years of prints. */
const HISTORY_WEEKS = 104

function MetricTile({
  label,
  value,
  sub,
  tone = 'muted',
  title,
}: {
  label: string
  value: string
  sub: string
  tone?: Tone
  title?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center border border-border bg-surface px-2 py-1" title={title}>
      <span className="truncate text-2xs text-text-muted">{label}</span>
      <span className="num truncate text-sm font-bold text-text">{value}</span>
      <span className={`truncate text-2xs font-bold ${toneClass[tone]}`}>{sub}</span>
    </div>
  )
}

function valueTitle(metric: OilValue | undefined): string | undefined {
  if (!metric) return undefined
  return [
    `Frequency: ${metric.frequency}`,
    metric.source ? `Source: ${metric.source}` : '',
    metric.asOf ? `As of: ${metric.asOf}` : '',
    metric.note ?? '',
  ].filter(Boolean).join('\n')
}

function warningOf(envelope: Envelope<unknown> | undefined, label: string): string | undefined {
  return envelope?.errors.find((entry) => entry.symbol === label)?.reason
}

function changeTone(value: number | null | undefined): Tone {
  if (value === null || value === undefined) return 'muted'
  return value >= 0 ? 'positive' : 'negative'
}

function seriesOf(payload: OilPayload | undefined, key: OilSeriesKey): OilSeries | null {
  return (
    payload?.inventories?.series.find((entry) => entry.key === key) ??
    payload?.flows?.series.find((entry) => entry.key === key) ??
    payload?.benchmarks?.prices.series.find((entry) => entry.key === key) ??
    null
  )
}

/** Thousand barrels read as millions on screen; every other EIA unit prints as reported. */
function seriesText(series: OilSeries | null, value: number | null | undefined, places = 1): string {
  if (value === null || value === undefined || !series) return EM_DASH
  if (series.unit === 'kb') return `${decimals(value / 1_000, places)}M bbl`
  if (series.unit === 'kbd') return `${decimals(value / 1_000, places + 1)}M b/d`
  if (series.unit === 'percent') return `${decimals(value, 1)}%`
  if (series.unit === 'usdPerBbl' || series.unit === 'usdPerGal') return currency(value, places + 1)
  return decimals(value, places)
}

export function OilPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const query = useOil()
  const refresh = useRefreshOil()
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')
  const [curveView, setCurveView] = useState<'chart' | 'table'>('chart')
  const [historyKey, setHistoryKey] = useState<OilSeriesKey>('crude')
  const payload = query.data?.data
  const busy = query.isFetching || refreshing

  useEffect(() => {
    onStatusChange([{ label: 'Oil', envelope: query.data, loading: query.isFetching }], '')
  }, [onStatusChange, query.data, query.isFetching])

  const status = useMemo(() => {
    if (notice) return notice
    if (busy && !payload) return 'Loading Oil physical fundamentals...'
    if (!payload) return 'Oil data unavailable'
    const loaded = Object.values(payload.progress).filter((state) => state === 'loaded').length
    const week = payload.inventories?.asOf ?? 'week unavailable'
    const next = payload.inventories?.nextReleaseDate
    return `${loaded}/5 source lanes loaded · EIA week ending ${week}${next ? ` · next release ${next}` : ''}`
  }, [notice, busy, payload])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    setNotice('')
    try {
      await refresh()
    } catch (error) {
      setNotice(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  const onExport = useCallback(async () => {
    if (!payload) return
    await api.writeClipboard(buildOilSnapshot(payload))
    setNotice('Oil fundamentals snapshot copied to the clipboard.')
  }, [payload])

  const wtiChange = payload?.market.wtiChangePct.value
  const brentChange = payload?.market.brentChangePct.value
  const crack = payload?.derived.crackSpread321.value
  const deviation = payload?.derived.crudeVsFiveYear.value
  const curve = payload?.curve ?? null
  const selected = seriesOf(payload, historyKey)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1">
        <h1 className="min-w-0 truncate pr-2 text-sm font-semibold text-text">Oil — Physical Fundamentals</h1>
        <span className="ml-auto min-w-0 truncate px-2 text-right text-2xs text-text-muted" title={status}>
          {status}
        </span>
        <Button variant="accent" onClick={onRefresh} disabled={busy}>
          {busy ? 'Refreshing...' : 'Refresh'}
        </Button>
        <Button onClick={onExport} disabled={!payload}>Export</Button>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
        <MetricTile
          label="WTI Front Month"
          value={currency(payload?.market.wtiPrice.value)}
          sub={wtiChange === null || wtiChange === undefined ? 'CL=F · unavailable' : `${percent(wtiChange)} · CL=F`}
          tone={changeTone(wtiChange)}
          title={valueTitle(payload?.market.wtiPrice)}
        />
        <MetricTile
          label="Brent Front Month"
          value={currency(payload?.market.brentPrice.value)}
          sub={brentChange === null || brentChange === undefined ? 'BZ=F · unavailable' : `${percent(brentChange)} · BZ=F`}
          tone={changeTone(brentChange)}
          title={valueTitle(payload?.market.brentPrice)}
        />
        <MetricTile
          label="Brent−WTI Spread"
          value={payload?.derived.brentWtiSpread.value === null || !payload ? EM_DASH : `${decimals(payload.derived.brentWtiSpread.value, 2)}`}
          sub="$/bbl · light sweet basis"
          tone={changeTone(payload?.derived.brentWtiSpread.value)}
          title={valueTitle(payload?.derived.brentWtiSpread)}
        />
        <MetricTile
          label="3-2-1 Crack Spread"
          value={crack === null || crack === undefined ? EM_DASH : `${decimals(crack, 2)}`}
          sub="$/bbl · gross refining margin"
          tone={crack === null || crack === undefined ? 'muted' : crack >= 0 ? 'positive' : 'negative'}
          title={valueTitle(payload?.derived.crackSpread321)}
        />
        <MetricTile
          label="Curve Shape"
          value={curve ? curve.shape.charAt(0).toUpperCase() + curve.shape.slice(1) : EM_DASH}
          sub={
            curve?.frontToBackSpread.value === null || !curve
              ? 'strip unavailable'
              : `${decimals(curve.frontToBackSpread.value, 2)} $/bbl front-to-back`
          }
          tone={curve?.shape === 'backwardation' ? 'positive' : curve?.shape === 'contango' ? 'negative' : 'muted'}
          title={valueTitle(curve?.frontToBackSpread)}
        />
        <MetricTile
          label="Crude vs 5Y Average"
          value={deviation === null || deviation === undefined ? EM_DASH : percent(deviation, 1)}
          sub={payload?.inventories?.asOf ?? 'EIA unavailable'}
          tone={deviation === null || deviation === undefined ? 'muted' : deviation >= 0 ? 'negative' : 'positive'}
          title={valueTitle(payload?.derived.crudeVsFiveYear)}
        />
      </div>

      <div className="grid min-h-[300px] shrink-0 grid-cols-1 gap-2 xl:h-[340px] xl:min-h-0 xl:grid-cols-12">
        <Panel
          className="min-h-[300px] xl:col-span-5 xl:h-full xl:min-h-0"
          title={`WTI Term Structure — ${curve ? curve.shape : 'Unavailable'}`}
          warning={warningOf(query.data, 'WTI Term Structure')}
          actions={
            <>
              <Button variant="toggle" active={curveView === 'chart'} onClick={() => setCurveView('chart')}>Chart</Button>
              <Button variant="toggle" active={curveView === 'table'} onClick={() => setCurveView('table')}>Table</Button>
            </>
          }
        >
          {curveView === 'chart' ? <CurveChart points={curve?.points ?? []} /> : <CurveTable points={curve?.points ?? []} />}
        </Panel>

        <Panel
          className="min-h-[300px] xl:col-span-7 xl:h-full xl:min-h-0"
          title={`Weekly Inventories — EIA ${payload?.inventories?.asOf ?? 'Unavailable'}`}
          warning={warningOf(query.data, 'EIA Weekly Inventories')}
        >
          <SeriesTable
            rows={payload?.inventories?.series ?? []}
            empty="No EIA weekly stock data"
            selected={historyKey}
            onSelect={setHistoryKey}
            deviationTone="inverted"
          />
        </Panel>
      </div>

      <div className="grid min-h-[300px] shrink-0 grid-cols-1 gap-2 xl:h-[340px] xl:min-h-0 xl:grid-cols-12">
        <Panel
          className="min-h-[300px] xl:col-span-7 xl:h-full xl:min-h-0"
          title={`Weekly Supply & Demand — EIA ${payload?.flows?.asOf ?? 'Unavailable'}`}
          warning={warningOf(query.data, 'EIA Weekly Supply & Demand')}
        >
          <SeriesTable
            rows={payload?.flows?.series ?? []}
            empty="No EIA weekly flow data"
            selected={historyKey}
            onSelect={setHistoryKey}
            deviationTone="neutral"
          />
        </Panel>

        <Panel
          className="min-h-[300px] xl:col-span-5 xl:h-full xl:min-h-0"
          title={selected ? `${selected.label} — Two-year History` : 'Weekly History'}
          warning={warningOf(query.data, 'EIA Weekly Inventories')}
        >
          <HistoryChart series={selected} />
        </Panel>
      </div>

      <div className="grid min-h-[230px] shrink-0 grid-cols-1 gap-2 xl:h-[250px] xl:min-h-0 xl:grid-cols-12">
        <Panel
          className="min-h-[230px] xl:col-span-5 xl:h-full xl:min-h-0"
          title={`Physical Benchmarks — ${payload?.benchmarks?.prices.asOf ?? 'Unavailable'}`}
          warning={warningOf(query.data, 'EIA Price Assessments')}
        >
          <BenchmarkPanel payload={payload} />
        </Panel>

        <Panel
          className="min-h-[230px] xl:col-span-7 xl:h-full xl:min-h-0"
          title="Balance & Refining"
          warning={warningOf(query.data, 'EIA Weekly Supply & Demand')}
        >
          <BalancePanel payload={payload} />
        </Panel>
      </div>

      <div className="shrink-0 px-1 pb-1 text-[10px] text-text-dim">
        EIA weekly figures are survey estimates and are revised in the monthly series · OPEC publishes the Reference
        Basket as a settlement average, not a traded contract · CL=F, BZ=F, RB=F and HO=F are futures quotes, not
        physical price assessments.
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- term structure */

function CurveChart({ points }: { points: OilCurvePoint[] }) {
  if (points.length < 2) return <PanelMessage>No WTI contract strip</PanelMessage>
  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <LineChart
        labels={points.map((point) => point.label)}
        series={[{ label: 'WTI strip', values: points.map((point) => point.price), color: colorForIndex(0) }]}
        format={(value) => `$${value.toFixed(0)}`}
        baseline="auto"
        ticks={5}
      />
    </div>
  )
}

function CurveTable({ points }: { points: OilCurvePoint[] }) {
  const columns: Array<Column<OilCurvePoint>> = [
    { key: 'label', header: 'Contract', cell: (row) => row.label, width: '26%' },
    { key: 'symbol', header: 'Symbol', cell: (row) => row.symbol, width: '28%' },
    { key: 'price', header: 'Settle', cell: (row) => currency(row.price), align: 'right', numeric: true, width: '23%' },
    {
      key: 'premium',
      header: 'vs Front',
      cell: (row) => (
        <span className={directionClass(row.premiumPct)}>{row.premiumPct === null ? EM_DASH : percent(row.premiumPct, 1)}</span>
      ),
      align: 'right',
      numeric: true,
      width: '23%',
    },
  ]
  return <DataTable columns={columns} rows={points} rowKey={(row) => row.symbol} empty="No WTI contract strip" layout="fixed" minWidth="380px" />
}

/* ---------------------------------------------------------------- EIA series */

/**
 * `deviationTone` is tri-state, for the reason the Economic page's `higherIsBetter` is.
 *
 * On a stock series the sign has an unambiguous reading — a build above the five-year band
 * is bearish for crude and a draw is bullish — so the column is coloured against the usual
 * green-is-up convention. On a flow series it does not: production above its band is
 * bearish while refinery utilization above its band is bullish, and painting both the same
 * way would state a judgement the number does not support. Those stay neutral.
 */
function SeriesTable({
  rows,
  empty,
  selected,
  onSelect,
  deviationTone,
}: {
  rows: OilSeries[]
  empty: string
  selected: OilSeriesKey
  onSelect: (key: OilSeriesKey) => void
  deviationTone: 'inverted' | 'neutral'
}) {
  const columns: Array<Column<OilSeries>> = [
    { key: 'label', header: 'Series', cell: (row) => row.label, width: '30%', sortValue: (row) => row.label },
    {
      key: 'latest',
      header: 'Latest',
      cell: (row) => seriesText(row, row.latest),
      align: 'right',
      numeric: true,
      width: '17%',
      sortValue: (row) => row.latest,
    },
    {
      key: 'weekChange',
      header: 'w/w',
      cell: (row) => <span className={directionClass(row.weekChange)}>{seriesText(row, row.weekChange, 2)}</span>,
      align: 'right',
      numeric: true,
      width: '17%',
      sortValue: (row) => row.weekChange,
    },
    {
      key: 'yearAgo',
      header: 'Year ago',
      cell: (row) => seriesText(row, row.yearAgo),
      align: 'right',
      numeric: true,
      width: '17%',
      sortValue: (row) => row.yearAgo,
    },
    {
      key: 'deviation',
      header: 'vs 5Y',
      cell: (row) => (
        <span
          className={
            deviationTone === 'neutral' || row.deviationPct === null
              ? 'text-text'
              : directionClass(-row.deviationPct)
          }
        >
          {row.deviationPct === null ? EM_DASH : percent(row.deviationPct, 1)}
        </span>
      ),
      align: 'right',
      numeric: true,
      width: '19%',
      sortValue: (row) => row.deviationPct,
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      empty={empty}
      layout="fixed"
      minWidth="520px"
      onRowClick={(row) => onSelect(row.key)}
      rowClassName={(row) => (row.key === selected ? 'bg-surface-raised font-bold' : '')}
    />
  )
}

function HistoryChart({ series }: { series: OilSeries | null }) {
  if (!series?.history.length) return <PanelMessage>No weekly history</PanelMessage>
  const window = series.history.slice(-HISTORY_WEEKS)
  const lines: LineSeries[] = [
    { label: series.label, values: window.map((point) => point.value), color: colorForIndex(0) },
  ]
  if (series.fiveYearAverage !== null) {
    lines.push({
      label: '5Y average (latest week)',
      values: window.map(() => series.fiveYearAverage),
      color: colorForIndex(3),
      dashed: true,
    })
  }
  const scale = series.unit === 'kb' ? 1_000 : series.unit === 'kbd' ? 1_000 : 1
  const suffix = series.unit === 'kb' ? 'M' : series.unit === 'kbd' ? 'M b/d' : series.unit === 'percent' ? '%' : ''
  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <LineChart
        labels={window.map((point) => point.date)}
        series={lines}
        format={(value) => `${(value / scale).toFixed(1)}${suffix}`}
        baseline="auto"
        ticks={5}
      />
    </div>
  )
}

/* --------------------------------------------------------------- side panels */

function StatRow({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: number | null }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-2 border-b border-border px-2 py-1.5 text-2xs">
      <span className="text-text-muted">{label}</span>
      <span className={`num font-semibold ${tone === undefined ? 'text-text' : directionClass(tone)}`}>{value}</span>
      <span className="col-span-2 truncate text-[10px] text-text-dim">{sub}</span>
    </div>
  )
}

/**
 * EIA's survey-based price assessments, with the OPEC basket alongside when it answers.
 *
 * The basket row prints its own absence rather than disappearing: a reader who expects it
 * should be told the source refused the request, not left to wonder where the row went.
 */
function BenchmarkPanel({ payload }: { payload: OilPayload | undefined }) {
  const benchmarks = payload?.benchmarks
  if (!benchmarks) return <PanelMessage>No public benchmark assessments</PanelMessage>
  const opec = benchmarks.opec
  const basketSpread = payload?.derived.basketToBrent.value
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {benchmarks.prices.series.map((series) => (
        <StatRow
          key={series.key}
          label={series.label}
          value={seriesText(series, series.latest, 2)}
          sub={`w/w ${seriesText(series, series.weekChange, 3)} · year ago ${seriesText(series, series.yearAgo, 2)} · ${series.asOf}`}
          tone={series.weekChange}
        />
      ))}
      <StatRow
        label="OPEC reference basket"
        value={opec ? currency(opec.basketPrice.value) : EM_DASH}
        sub={
          opec
            ? `Settlement average · ${opec.asOf} · vs Brent ${decimals(basketSpread, 2)} · ${integer(opec.history.length)} sessions`
            : 'opec.org refuses this client at its edge; the EIA assessments above are unaffected'
        }
        tone={opec ? opec.dayChange.value : undefined}
      />
      <StatRow
        label="EIA spot less front future"
        value={
          payload?.derived.spotVsFutures.value === null || !payload
            ? EM_DASH
            : decimals(payload.derived.spotVsFutures.value, 2)
        }
        sub="A survey week against a live tick — a staleness check, not a tradeable basis"
        tone={payload?.derived.spotVsFutures.value}
      />
    </div>
  )
}

function BalancePanel({ payload }: { payload: OilPayload | undefined }) {
  const production = seriesOf(payload, 'production')
  const refinerInput = seriesOf(payload, 'refinerInput')
  const utilization = seriesOf(payload, 'utilization')
  const supplied = seriesOf(payload, 'productSupplied')
  const exports = seriesOf(payload, 'exports')
  const netImports = seriesOf(payload, 'netImports')
  if (!production && !refinerInput && !supplied) return <PanelMessage>No EIA weekly balance data</PanelMessage>
  const cover = payload?.derived.daysOfSupply
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-2">
      <div>
        <StatRow
          label="Days of supply"
          value={cover?.value === null || !cover ? EM_DASH : `${decimals(cover.value, 1)} days`}
          sub="Commercial crude over refiner runs · SPR excluded"
        />
        <StatRow
          label="US field production"
          value={seriesText(production, production?.latest)}
          sub={production ? `w/w ${seriesText(production, production.weekChange, 2)} · ${production.asOf}` : 'unavailable'}
          tone={production?.weekChange}
        />
        <StatRow
          label="Refiner crude runs"
          value={seriesText(refinerInput, refinerInput?.latest)}
          sub={refinerInput ? `w/w ${seriesText(refinerInput, refinerInput.weekChange, 2)} · ${refinerInput.asOf}` : 'unavailable'}
          tone={refinerInput?.weekChange}
        />
      </div>
      <div>
        <StatRow
          label="Refinery utilization"
          value={utilization?.latest === null || !utilization ? EM_DASH : `${decimals(utilization.latest, 1)}%`}
          sub={utilization ? `5Y average ${decimals(utilization.fiveYearAverage, 1)}% · ${utilization.asOf}` : 'unavailable'}
          tone={utilization?.weekChange}
        />
        <StatRow
          label="Products supplied"
          value={seriesText(supplied, supplied?.latest)}
          sub={supplied ? `The EIA demand proxy · ${supplied.asOf}` : 'unavailable'}
          tone={supplied?.weekChange}
        />
        <StatRow
          label="Crude exports / net imports"
          value={`${seriesText(exports, exports?.latest)} / ${seriesText(netImports, netImports?.latest)}`}
          sub="Net imports run negative when the US is a net crude exporter"
        />
      </div>
    </div>
  )
}
