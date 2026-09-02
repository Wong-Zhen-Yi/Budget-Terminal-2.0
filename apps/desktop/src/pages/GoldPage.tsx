import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  Envelope,
  GoldMiningRow,
  GoldPayload,
  GoldQuarterPoint,
  GoldValue,
} from '@shared/contract'
import { buildGoldSnapshot } from '@shared/gold'
import { api } from '@/api/client'
import { useGold, useRefreshGold } from '@/api/goldQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Donut, colorForIndex } from '@/components/charts/Donut'
import { LineChart, type LineSeries } from '@/components/charts/LineChart'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import {
  EM_DASH,
  compactCurrency,
  currency,
  decimals,
  directionClass,
  integer,
  percent,
} from '@/lib/format'

type Tone = 'positive' | 'negative' | 'muted' | 'warning'

const toneClass: Record<Tone, string> = {
  positive: 'text-up',
  negative: 'text-down',
  muted: 'text-text-muted',
  warning: 'text-warn',
}

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

function valueTitle(metric: GoldValue | undefined): string | undefined {
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

function latestOf(payload: GoldPayload | undefined): GoldQuarterPoint | null {
  return payload?.quarterly?.periods.at(-1) ?? null
}

export function GoldPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const query = useGold()
  const refresh = useRefreshGold()
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')
  const [historyView, setHistoryView] = useState<'table' | 'chart'>('table')
  const payload = query.data?.data
  const busy = query.isFetching || refreshing
  const latest = latestOf(payload)

  useEffect(() => {
    onStatusChange([{ label: 'Gold', envelope: query.data, loading: query.isFetching }], '')
  }, [onStatusChange, query.data, query.isFetching])

  const status = useMemo(() => {
    if (notice) return notice
    if (busy && !payload) return 'Loading Gold physical fundamentals...'
    if (!payload) return 'Gold data unavailable'
    const loaded = Object.values(payload.progress).filter((state) => state === 'loaded').length
    const quarter = latest?.period ?? 'quarter unavailable'
    return `${loaded}/5 source lanes loaded · WGC ${quarter} · USGS ${payload.mining?.asOf ?? 'unavailable'}`
  }, [notice, busy, payload, latest])

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
    await api.writeClipboard(buildGoldSnapshot(payload))
    setNotice('Gold fundamentals snapshot copied to the clipboard.')
  }, [payload])

  const futuresChange = payload?.market.futuresChangePct.value
  const gldChange = payload?.market.gldChangePct.value

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1">
        <h1 className="min-w-0 truncate pr-2 text-sm font-semibold text-text">Gold — Physical Fundamentals</h1>
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
          label="COMEX Gold Proxy"
          value={currency(payload?.market.futuresPrice.value)}
          sub={futuresChange === null || futuresChange === undefined ? 'GC=F · unavailable' : `${percent(futuresChange)} · GC=F`}
          tone={futuresChange === null || futuresChange === undefined ? 'muted' : futuresChange >= 0 ? 'positive' : 'negative'}
          title={valueTitle(payload?.market.futuresPrice)}
        />
        <MetricTile
          label="GLD Proxy"
          value={currency(payload?.market.gldPrice.value)}
          sub={gldChange === null || gldChange === undefined ? 'ETF share · unavailable' : `${percent(gldChange)} · ETF share`}
          tone={gldChange === null || gldChange === undefined ? 'muted' : gldChange >= 0 ? 'positive' : 'negative'}
          title={valueTitle(payload?.market.gldPrice)}
        />
        <MetricTile
          label="Above-ground Stock"
          value={payload?.aboveGround?.total.value === null || !payload?.aboveGround ? EM_DASH : `${integer(payload.aboveGround.total.value)}t`}
          sub={payload?.aboveGround?.asOf ?? 'WGC unavailable'}
          title={valueTitle(payload?.aboveGround?.total)}
        />
        <MetricTile
          label="Quarterly Supply"
          value={payload?.derived.latestSupply.value === null || !payload ? EM_DASH : `${integer(payload.derived.latestSupply.value)}t`}
          sub={latest?.period ?? 'WGC unavailable'}
          title={valueTitle(payload?.derived.latestSupply)}
        />
        <MetricTile
          label="Quarterly Demand"
          value={payload?.derived.latestDemand.value === null || !payload ? EM_DASH : `${integer(payload.derived.latestDemand.value)}t`}
          sub={latest?.period ?? 'WGC unavailable'}
          title={valueTitle(payload?.derived.latestDemand)}
        />
        <MetricTile
          label="Stock-to-flow"
          value={payload?.derived.stockToFlow.value === null || !payload ? EM_DASH : `${decimals(payload.derived.stockToFlow.value, 1)} yrs`}
          sub="stock ÷ annual mine output"
          tone="warning"
          title={valueTitle(payload?.derived.stockToFlow)}
        />
      </div>

      <div className="grid min-h-[290px] shrink-0 grid-cols-1 gap-2 xl:h-[330px] xl:min-h-0 xl:grid-cols-12">
        <Panel
          className="min-h-[290px] xl:col-span-4 xl:h-full xl:min-h-0"
          title={`Latest Supply — ${latest?.period ?? 'Unavailable'}`}
          warning={warningOf(query.data, 'Quarterly Supply & Demand')}
        >
          <CompositionPanel
            total={latest?.totalSupply ?? null}
            empty="No quarterly supply data"
            rows={[
              ['Mine production', latest?.mineProduction ?? null],
              ['Recycled gold', latest?.recycledGold ?? null],
              ['Net producer hedging', latest?.producerHedging ?? null],
            ]}
          />
        </Panel>

        <Panel
          className="min-h-[290px] xl:col-span-4 xl:h-full xl:min-h-0"
          title={`Latest Demand — ${latest?.period ?? 'Unavailable'}`}
          warning={warningOf(query.data, 'Quarterly Supply & Demand')}
        >
          <CompositionPanel
            total={latest?.totalDemand ?? null}
            empty="No quarterly demand data"
            rows={[
              ['Jewellery', latest?.jewellery ?? null],
              ['Technology', latest?.technology ?? null],
              ['Bars & coins', latest?.barAndCoin ?? null],
              ['Gold ETFs', latest?.etfDemand ?? null],
              ['Central banks', latest?.centralBanks ?? null],
              ['OTC & other', latest?.otcAndOther ?? null],
            ]}
          />
        </Panel>

        <Panel
          className="min-h-[290px] xl:col-span-4 xl:h-full xl:min-h-0"
          title={`Above-ground Stock — ${payload?.aboveGround?.asOf ?? 'Unavailable'}`}
          warning={warningOf(query.data, 'Above-ground Stock')}
        >
          <AboveGroundPanel payload={payload} />
        </Panel>
      </div>

      <div className="grid min-h-[250px] shrink-0 grid-cols-1 gap-2 xl:h-[310px] xl:min-h-0 xl:grid-cols-12">
        <Panel
          className="min-h-[250px] xl:col-span-5 xl:h-full xl:min-h-0"
          title="Five-quarter Physical Balance"
          warning={warningOf(query.data, 'Quarterly Supply & Demand')}
          actions={
            <>
              <Button variant="toggle" active={historyView === 'table'} onClick={() => setHistoryView('table')}>Table</Button>
              <Button variant="toggle" active={historyView === 'chart'} onClick={() => setHistoryView('chart')}>Chart</Button>
            </>
          }
        >
          {historyView === 'table' ? <HistoryTable rows={payload?.quarterly?.periods ?? []} /> : <HistoryChart rows={payload?.quarterly?.periods ?? []} />}
        </Panel>

        <Panel
          className="min-h-[250px] xl:col-span-3 xl:h-full xl:min-h-0"
          title="Investment & Official Sector"
          warning={warningOf(query.data, 'Gold ETF Holdings & Flows')}
        >
          <InvestmentPanel payload={payload} />
        </Panel>

        <Panel
          className="min-h-[250px] xl:col-span-4 xl:h-full xl:min-h-0"
          title={`Mine Production & Reserves — USGS ${payload?.mining?.asOf ?? ''}`}
          warning={warningOf(query.data, 'Mine Production & Reserves')}
        >
          <MiningTable rows={payload?.mining?.rows ?? []} />
        </Panel>
      </div>

      <div className="shrink-0 px-1 pb-1 text-[10px] text-text-dim">
        Public headline extracts only · World Gold Council / Metals Focus and USGS retain ownership of their data · GC=F and GLD are proxies, not the licensed LBMA benchmark.
      </div>
    </div>
  )
}

function CompositionPanel({
  total,
  rows,
  empty,
}: {
  total: number | null
  rows: Array<[string, number | null]>
  empty: string
}) {
  const positive = rows.filter((row): row is [string, number] => typeof row[1] === 'number' && row[1] > 0)
  if (!positive.length) return <PanelMessage>{empty}</PanelMessage>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-[145px] flex-1 flex-col">
        <Donut
          slices={positive.map(([label, value], index) => ({ label, value, color: colorForIndex(index) }))}
          centerText={total === null ? EM_DASH : `${integer(total)}t`}
          centerSubtext="Total"
          compact
        />
      </div>
      <div className="grid shrink-0 grid-cols-2 border-t border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2 border-r border-b border-border px-2 py-1 text-2xs">
            <span className="truncate text-text-muted">{label}</span>
            <span className={`num ${directionClass(value)}`}>{value === null ? EM_DASH : `${decimals(value, 1)}t`}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AboveGroundPanel({ payload }: { payload: GoldPayload | undefined }) {
  const stock = payload?.aboveGround
  if (!stock?.slices.length) return <PanelMessage>No public above-ground stock data</PanelMessage>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-[170px] flex-1 flex-col">
        <Donut
          slices={stock.slices.map((entry, index) => ({ label: entry.label, value: entry.tonnes, color: colorForIndex(index) }))}
          centerText={`${integer(stock.total.value)}t`}
          centerSubtext="Above ground"
          compact
        />
      </div>
      <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">
        Below ground: reserves {integer(stock.belowGroundReserves.value)}t · resources {integer(stock.belowGroundResources.value)}t
        {stock.reconciliationGap === null ? '' : ` · rounding gap ${integer(stock.reconciliationGap)}t`}
      </div>
    </div>
  )
}

function HistoryTable({ rows }: { rows: GoldQuarterPoint[] }) {
  const columns: Array<Column<GoldQuarterPoint>> = [
    { key: 'period', header: 'Period', cell: (row) => row.period, width: '14%' },
    { key: 'supply', header: 'Supply', cell: (row) => decimals(row.totalSupply, 1), align: 'right', numeric: true, width: '14%' },
    { key: 'demand', header: 'Demand', cell: (row) => decimals(row.totalDemand, 1), align: 'right', numeric: true, width: '14%' },
    { key: 'mine', header: 'Mine', cell: (row) => decimals(row.mineProduction, 1), align: 'right', numeric: true, width: '12%' },
    { key: 'recycled', header: 'Recycle', cell: (row) => decimals(row.recycledGold, 1), align: 'right', numeric: true, width: '12%' },
    { key: 'etf', header: 'ETF', cell: (row) => <span className={directionClass(row.etfDemand)}>{decimals(row.etfDemand, 1)}</span>, align: 'right', numeric: true, width: '11%' },
    { key: 'cb', header: 'CB', cell: (row) => decimals(row.centralBanks, 1), align: 'right', numeric: true, width: '11%' },
    { key: 'price', header: 'Avg $/oz', cell: (row) => currency(row.averagePrice, 0), align: 'right', numeric: true, width: '12%' },
  ]
  return <DataTable columns={columns} rows={rows} rowKey={(row) => row.period} empty="No quarterly history" layout="fixed" minWidth="650px" />
}

function HistoryChart({ rows }: { rows: GoldQuarterPoint[] }) {
  const series: LineSeries[] = [
    { label: 'Supply', values: rows.map((row) => row.totalSupply), color: colorForIndex(0) },
    { label: 'Demand', values: rows.map((row) => row.totalDemand), color: colorForIndex(1), dashed: true },
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <LineChart labels={rows.map((row) => row.period)} series={series} format={(value) => `${Math.round(value)}t`} baseline="auto" ticks={5} />
    </div>
  )
}

function StatRow({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: number | null }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-2 border-b border-border px-2 py-1.5 text-2xs">
      <span className="text-text-muted">{label}</span>
      <span className={`num font-semibold ${tone === undefined ? 'text-text' : directionClass(tone)}`}>{value}</span>
      <span className="col-span-2 truncate text-[10px] text-text-dim">{sub}</span>
    </div>
  )
}

function InvestmentPanel({ payload }: { payload: GoldPayload | undefined }) {
  const latest = latestOf(payload)
  const etf = payload?.etf
  if (!latest && !etf) return <PanelMessage>No public investment data</PanelMessage>
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <StatRow label="Quarterly ETF demand" value={latest?.etfDemand === null || !latest ? EM_DASH : `${decimals(latest.etfDemand, 1)}t`} sub={latest?.period ?? 'WGC'} tone={latest?.etfDemand} />
      <StatRow label="Central-bank demand" value={latest?.centralBanks === null || !latest ? EM_DASH : `${decimals(latest.centralBanks, 1)}t`} sub={latest?.period ?? 'WGC'} tone={latest?.centralBanks} />
      <StatRow label="Global ETF holdings" value={etf?.holdings.value === null || !etf ? EM_DASH : `${integer(etf.holdings.value)}t`} sub={etf?.asOf ?? 'Public monthly headline unavailable'} />
      <StatRow label="Monthly ETF demand" value={etf?.monthlyDemand.value === null || !etf ? EM_DASH : `${decimals(etf.monthlyDemand.value, 1)}t`} sub={etf?.asOf ?? 'WGC'} tone={etf?.monthlyDemand.value} />
      <StatRow label="Monthly fund flow" value={compactCurrency(etf?.monthlyFlowUsd.value)} sub={etf?.asOf ?? 'WGC'} tone={etf?.monthlyFlowUsd.value} />
      <StatRow label="Global ETF AUM" value={compactCurrency(etf?.aum.value)} sub={etf?.asOf ?? 'WGC'} />
    </div>
  )
}

function MiningTable({ rows }: { rows: GoldMiningRow[] }) {
  const columns: Array<Column<GoldMiningRow>> = [
    { key: 'country', header: 'Country', cell: (row) => `${row.country}${row.estimated ? ' e' : ''}`, width: '34%', sortValue: (row) => row.country },
    { key: 'prior', header: 'Prior', cell: (row) => integer(row.priorProduction), align: 'right', numeric: true, width: '16%', sortValue: (row) => row.priorProduction },
    { key: 'production', header: 'Output', cell: (row) => integer(row.production), align: 'right', numeric: true, width: '17%', sortValue: (row) => row.production },
    { key: 'reserves', header: 'Reserves', cell: (row) => integer(row.reserves), align: 'right', numeric: true, width: '18%', sortValue: (row) => row.reserves },
    { key: 'life', header: 'Life', cell: (row) => row.reserveLifeYears === null ? EM_DASH : `${decimals(row.reserveLifeYears, 1)}y`, align: 'right', numeric: true, width: '15%', sortValue: (row) => row.reserveLifeYears },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.country}
      empty="No USGS production table"
      layout="fixed"
      minWidth="480px"
      defaultSort={{ key: 'production', direction: 'desc' }}
      rowClassName={(row) => row.country === 'World total' ? 'font-bold bg-surface-raised' : ''}
    />
  )
}
