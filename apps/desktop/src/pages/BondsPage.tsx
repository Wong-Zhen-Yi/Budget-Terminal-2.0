import { useEffect, useMemo, useState } from 'react'

import type { EconomicPayload, EconomicRow } from '@shared/contract'
import {
  describeCurve,
  describeFreshness,
  historySeries,
  missingSummary,
  rowTooltip,
} from '@shared/economic'
import { useEconomic, useRefreshEconomic } from '@/api/economicQueries'
import { BondCalculator } from '@/components/bonds/BondCalculator'
import { LineChart } from '@/components/charts/LineChart'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { YieldCurvePanel } from '@/components/economic/YieldCurvePanel'
import { Button } from '@/components/ui/Button'
import { Chip, type ChipTone } from '@/components/ui/Chip'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { Select } from '@/components/ui/Select'
import { EM_DASH } from '@/lib/format'

const HEADLINE_IDS = ['FEDFUNDS', 'DGS3MO', 'DGS2', 'DGS10', 'DGS30', 'BAMLH0A0HYM2'] as const

const HISTORY_IDS = [
  'DGS3MO',
  'DGS2',
  'DGS5',
  'DGS10',
  'DGS30',
  'DFII10',
  'T10YIE',
  'T10Y2Y',
  'BAMLH0A0HYM2',
] as const

const LOOKBACK_OPTIONS = [
  { value: '1', label: '1 year' },
  { value: '3', label: '3 years' },
  { value: '5', label: '5 years' },
  { value: '10', label: '10 years' },
] as const

interface MaturityRow {
  series: EconomicRow
  low52: number | null
  high52: number | null
  rangePosition: number | null
}

function fixedPercent(value: number | null, places = 2): string {
  return value === null ? EM_DASH : `${value.toFixed(places)}%`
}

function signedBps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${value > 0 ? '+' : ''}${rounded} bp`
}

/** Yield rises imply price falls, so rate moves use the inverse of the equity palette. */
function rateMoveClass(value: number | null): string {
  if (value === null || value === 0) return 'text-text-muted'
  return value > 0 ? 'text-down' : 'text-up'
}

function lastYearRange(row: EconomicRow): { low: number | null; high: number | null } {
  const newest = row.history.at(-1)?.[0]
  if (!newest) return { low: null, high: null }
  const cutoff = `${String(Number(newest.slice(0, 4)) - 1).padStart(4, '0')}${newest.slice(4)}`
  const values = row.history
    .filter(([date]) => date >= cutoff)
    .map(([, value]) => value)
    .filter(Number.isFinite)
  return values.length ? { low: Math.min(...values), high: Math.max(...values) } : { low: null, high: null }
}

function HeadlineMetric({ row }: { row: EconomicRow | undefined }) {
  const moveBps = row?.change === null || row?.change === undefined ? null : row.change * 100
  return (
    <div
      className="relative flex min-w-0 flex-col overflow-hidden border border-border bg-surface px-3 py-2"
      title={row ? rowTooltip(row) : 'Waiting for this rate series.'}
    >
      <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
      <span className="truncate text-2xs text-text-muted">{row?.label ?? 'Rate unavailable'}</span>
      <div className="flex items-baseline gap-2">
        <span className="num text-lg leading-7 font-semibold text-text">
          {fixedPercent(row?.latest ?? null)}
        </span>
        <span className={`num text-2xs ${rateMoveClass(moveBps)}`}>
          {signedBps(moveBps)}
        </span>
      </div>
      <span className="truncate text-[10px] text-text-dim">
        {row?.latestDate ? `As of ${row.latestDate}` : 'No observation returned'}
      </span>
    </div>
  )
}

function SignalRow({
  label,
  value,
  sub,
  tone = 'muted',
}: {
  label: string
  value: string
  sub: string
  tone?: ChipTone
}) {
  const valueClass = tone === 'down'
    ? 'text-down'
    : tone === 'up'
      ? 'text-up'
      : tone === 'warn'
        ? 'text-warn'
        : 'text-text'
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-border/60 px-2 py-2">
      <span className="text-2xs text-text-muted">{label}</span>
      <span className={`num text-2xs font-semibold ${valueClass}`}>{value}</span>
      <span className="col-span-2 truncate text-[10px] text-text-dim" title={sub}>{sub}</span>
    </div>
  )
}

function spreadTone(value: number | null): ChipTone {
  if (value === null) return 'muted'
  if (value < 0) return 'down'
  if (value < 0.15) return 'warn'
  return 'up'
}

function creditTone(value: number | null): ChipTone {
  if (value === null) return 'muted'
  if (value >= 5) return 'down'
  if (value >= 3.5) return 'warn'
  return 'up'
}

function CurveSignals({
  payload,
  rows,
}: {
  payload: EconomicPayload | undefined
  rows: Map<string, EconomicRow>
}) {
  const curve = payload?.yieldCurve
  const spread2s10s = curve?.spread10y2y ?? null
  const spread3m10y = curve?.spread10y3m ?? null
  const realYield = rows.get('DFII10')?.latest ?? null
  const breakeven = rows.get('T10YIE')?.latest ?? null
  const highYield = rows.get('BAMLH0A0HYM2')?.latest ?? null
  const curveTone = spreadTone(spread2s10s)
  const curveLabel = spread2s10s === null
    ? 'Unavailable'
    : spread2s10s < 0
      ? 'Inverted'
      : spread2s10s < 0.15
        ? 'Flat'
        : 'Upward'

  return (
    <Panel
      title="Rate signals"
      className="h-full"
      actions={<Chip tone={curveTone}>{curveLabel}</Chip>}
    >
      <div className="border-b border-border bg-surface-raised px-2 py-2">
        <p className="text-2xs leading-5 text-text-muted">{describeCurve(curve)}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <SignalRow
          label="2Y → 10Y slope"
          value={signedBps(spread2s10s === null ? null : spread2s10s * 100)}
          sub={spread2s10s !== null && spread2s10s < 0 ? 'Classic curve inversion signal' : 'Long yield less 2Y yield'}
          tone={spreadTone(spread2s10s)}
        />
        <SignalRow
          label="3M → 10Y slope"
          value={signedBps(spread3m10y === null ? null : spread3m10y * 100)}
          sub={spread3m10y !== null && spread3m10y < 0 ? 'Front end sits above the long end' : 'Long yield less 3M bill yield'}
          tone={spreadTone(spread3m10y)}
        />
        <SignalRow
          label="10Y real yield"
          value={fixedPercent(realYield)}
          sub="Nominal 10Y less market inflation compensation"
          tone={realYield === null ? 'muted' : realYield >= 2 ? 'warn' : 'accent'}
        />
        <SignalRow
          label="10Y breakeven"
          value={fixedPercent(breakeven)}
          sub="Treasury-implied average inflation rate"
          tone={breakeven === null ? 'muted' : breakeven >= 3 ? 'down' : breakeven >= 2.5 ? 'warn' : 'accent'}
        />
        <SignalRow
          label="US high-yield spread"
          value={highYield === null ? EM_DASH : `${Math.round(highYield * 100)} bp`}
          sub="Option-adjusted spread over Treasuries"
          tone={creditTone(highYield)}
        />
      </div>
    </Panel>
  )
}

function RangePosition({ value }: { value: number | null }) {
  if (value === null) return <span className="text-text-dim">{EM_DASH}</span>
  return (
    <div className="flex items-center gap-2" title={`${Math.round(value)}% through its 52-week range`}>
      <div className="relative h-1 w-16 bg-border-strong">
        <span
          className="absolute top-[-3px] size-2 bg-accent"
          style={{ left: `calc(${Math.min(Math.max(value, 0), 100)}% - 4px)` }}
        />
      </div>
      <span className="num text-[10px] text-text-dim">{Math.round(value)}%</span>
    </div>
  )
}

function MaturityTable({ rows, loading }: { rows: EconomicRow[]; loading: boolean }) {
  const maturities = useMemo<MaturityRow[]>(() => rows.map((series) => {
    const { low, high } = lastYearRange(series)
    const rangePosition = series.latest === null || low === null || high === null || high === low
      ? null
      : (series.latest - low) / (high - low) * 100
    return { series, low52: low, high52: high, rangePosition }
  }), [rows])

  const columns = useMemo<Array<Column<MaturityRow>>>(() => [
    {
      key: 'tenor',
      header: 'Tenor',
      width: '74px',
      cell: ({ series }) => <span title={rowTooltip(series)}>{series.label.replace(' Treasury', '')}</span>,
    },
    {
      key: 'yield',
      header: 'Yield',
      align: 'right',
      numeric: true,
      width: '70px',
      cell: ({ series }) => fixedPercent(series.latest),
    },
    {
      key: 'move',
      header: 'Move',
      align: 'right',
      numeric: true,
      width: '74px',
      cell: ({ series }) => {
        const move = series.change === null ? null : series.change * 100
        return <span className={rateMoveClass(move)}>{signedBps(move)}</span>
      },
    },
    {
      key: 'range',
      header: '52W low–high',
      align: 'right',
      numeric: true,
      width: '130px',
      cell: (row) => row.low52 === null || row.high52 === null
        ? EM_DASH
        : `${row.low52.toFixed(2)}–${row.high52.toFixed(2)}%`,
    },
    {
      key: 'position',
      header: 'Position',
      width: '104px',
      cell: (row) => <RangePosition value={row.rangePosition} />,
    },
  ], [])

  return (
    <DataTable
      columns={columns}
      rows={maturities}
      rowKey={(row) => row.series.seriesId}
      layout="fixed"
      minWidth="470px"
      empty={loading ? 'Loading Treasury maturities...' : 'Treasury maturities unavailable'}
    />
  )
}

function HistoryPanel({
  rows,
  selectedId,
  onSelect,
  lookback,
  onLookback,
}: {
  rows: EconomicRow[]
  selectedId: string
  onSelect: (value: string) => void
  lookback: string
  onLookback: (value: string) => void
}) {
  const options = rows.map((row) => ({ value: row.seriesId, label: row.label }))
  const selected = rows.find((row) => row.seriesId === selectedId) ?? rows[0] ?? null
  const { dates, values } = historySeries(selected, Number(lookback))
  const moveBps = selected?.change === null || selected?.change === undefined
    ? null
    : selected.change * 100

  return (
    <Panel
      title="Rate history"
      className="h-full"
      actions={
        <>
          <Select
            aria-label="Rate series"
            value={selected?.seriesId ?? ''}
            options={options}
            onChange={onSelect}
            className="w-[190px]"
          />
          <Select
            aria-label="History span"
            value={lookback}
            options={LOOKBACK_OPTIONS}
            onChange={onLookback}
            className="w-[88px]"
          />
        </>
      }
    >
      {selected && values.length ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
          <div className="flex shrink-0 items-center gap-3 text-2xs">
            <span className="num font-semibold text-text">{fixedPercent(selected.latest)}</span>
            <span className={`num ${rateMoveClass(moveBps)}`}>{signedBps(moveBps)}</span>
            <span className="truncate text-text-dim">{selected.source} · {selected.latestDate ?? 'date unavailable'}</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <LineChart
              labels={dates}
              series={[{ label: selected.label, values, color: 'var(--color-accent)' }]}
              format={(value) => `${value.toFixed(2)}%`}
              baseline="auto"
            />
          </div>
        </div>
      ) : (
        <PanelMessage>No history returned for this series.</PanelMessage>
      )}
    </Panel>
  )
}

export function BondsPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const query = useEconomic(true)
  const { refresh, refreshing } = useRefreshEconomic()
  const [selectedId, setSelectedId] = useState<string>('DGS10')
  const [lookback, setLookback] = useState('5')
  const payload = query.data?.data
  const busy = query.isFetching || refreshing
  const rowsById = useMemo(
    () => new Map((payload?.rows ?? []).map((row) => [row.seriesId, row])),
    [payload],
  )
  const treasuryRows = useMemo(
    () => (payload?.rows ?? []).filter((row) => row.tenorYears !== null),
    [payload],
  )
  const historyRows = useMemo(
    () => HISTORY_IDS.flatMap((id) => {
      const row = rowsById.get(id)
      return row ? [row] : []
    }),
    [rowsById],
  )

  useEffect(() => {
    onStatusChange([{ label: 'Bonds', envelope: query.data, loading: query.isFetching }], '')
  }, [onStatusChange, query.data, query.isFetching])

  const status = useMemo(() => {
    if (busy && !payload?.rows.length) return 'Loading Treasury curve and fixed-income signals...'
    if (query.data?.meta.freshness === 'failed') {
      return `Bond market refresh failed: ${query.data.meta.failureReason ?? 'unknown error'}`
    }
    return describeFreshness(payload).text
  }, [busy, payload, query.data])

  const footer = missingSummary(payload)
  const tenYearYield = rowsById.get('DGS10')?.latest ?? null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-auto p-2">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        <h1 className="text-sm font-semibold text-text">Bonds</h1>
        <p className="min-w-0 flex-1 truncate text-2xs text-text-muted">
          US Treasury term structure, rate and credit signals, historical yields and bond math.
        </p>
        <Button variant="accent" onClick={() => void refresh(false)} disabled={busy}>
          {busy ? 'Fetching...' : 'Refresh'}
        </Button>
        <Button
          onClick={() => void refresh(true)}
          disabled={busy}
          title="Re-download every rates provider, ignoring the shared economic cache."
        >
          Force refresh
        </Button>
      </div>

      <p className="shrink-0 truncate text-2xs text-text-muted" title={status}>{status}</p>

      <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
        {HEADLINE_IDS.map((id) => <HeadlineMetric key={id} row={rowsById.get(id)} />)}
      </div>

      <div className="grid min-h-[320px] shrink-0 grid-cols-1 gap-2 xl:h-[360px] xl:min-h-0 xl:grid-cols-12">
        <div className="min-h-[320px] xl:col-span-8 xl:h-full xl:min-h-0">
          <YieldCurvePanel curve={payload?.yieldCurve} className="h-full" />
        </div>
        <div className="min-h-[320px] xl:col-span-4 xl:h-full xl:min-h-0">
          <CurveSignals payload={payload} rows={rowsById} />
        </div>
      </div>

      <div className="grid min-h-[310px] shrink-0 grid-cols-1 gap-2 xl:h-[350px] xl:min-h-0 xl:grid-cols-12">
        <div className="min-h-[310px] xl:col-span-7 xl:h-full xl:min-h-0">
          <HistoryPanel
            rows={historyRows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            lookback={lookback}
            onLookback={setLookback}
          />
        </div>
        <Panel title="Treasury maturity monitor" className="min-h-[310px] xl:col-span-5 xl:h-full xl:min-h-0">
          <MaturityTable rows={treasuryRows} loading={busy} />
        </Panel>
      </div>

      <BondCalculator marketYield={tenYearYield} />

      <div className="flex shrink-0 items-center justify-between gap-3 px-1 pb-1 text-[10px] text-text-dim">
        <span>{footer || 'US Treasury, New York Fed and FRED public series.'}</span>
        <span className="shrink-0">Decision support only · prices exclude accrued interest and transaction costs</span>
      </div>
    </div>
  )
}
