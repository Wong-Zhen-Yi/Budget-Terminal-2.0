import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  BmnrHoldingSlice,
  BmnrPayload,
  BmnrQuarterPoint,
  BmnrSensitivityRow,
  BmnrValue,
  Envelope,
} from '@shared/contract'
import { buildBmnrSnapshot } from '@shared/bmnr'
import { clockTail } from '@shared/crypto'
import { api } from '@/api/client'
import { useBmnr, useRefreshBmnr } from '@/api/bmnrQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Donut, colorForIndex } from '@/components/charts/Donut'
import { LineChart, type LineSeries } from '@/components/charts/LineChart'
import { FilingsTable } from '@/components/fundamentals/FilingsTable'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import {
  EM_DASH,
  compactCurrency,
  compactNumber,
  currency,
  decimals,
  directionClass,
  integer,
  percent,
  plainPercent,
} from '@/lib/format'

/**
 * The BMNR page — BitMine Immersion Technologies, an Ethereum treasury company.
 *
 * Not a port; the PySide6 app has no equivalent. The design constraint that shapes every
 * panel is that the page has two sources which disagree by design: CoinGecko's live ETH
 * count and the last filed 10-Q's. They are shown side by side and never blended, which is
 * what the Treasury Basis panel exists to make visible rather than merely claim.
 */

const SERIES_SHARES = colorForIndex(0)
const SERIES_ETH = colorForIndex(1)

/** The dot on a panel whose lane is degraded, matching every other multi-panel page. */
function warningOf(envelope: Envelope<unknown> | undefined, block: string): string | undefined {
  if (!envelope) return undefined
  const failed = envelope.errors.find((entry) => entry.symbol === block)
  if (failed) return failed.reason
  const { freshness, failureReason } = envelope.meta
  if (freshness === 'failed') return failureReason || freshness
  return undefined
}

type Tone = 'positive' | 'negative' | 'muted' | 'warning'

const toneClass: Record<Tone, string> = {
  positive: 'text-up',
  negative: 'text-down',
  muted: 'text-text-muted',
  warning: 'text-warn',
}

/**
 * A KPI tile. The second copy of the Crypto page's `MetricTile` rather than a lift: that
 * one's `tone` is typed against `@shared/crypto`, so sharing it would weld two pages' tone
 * vocabularies together for no behaviour change. A third copy should trigger the lift.
 */
function MetricTile({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string
  value: string
  sub: string
  tone: Tone
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

/** A `BmnrValue`'s own tooltip: what it was computed from and when. */
function cellTitle(cell: BmnrValue | undefined): string | undefined {
  if (!cell) return undefined
  const parts = [`Basis: ${cell.basis}`]
  if (cell.source) parts.push(`Source: ${cell.source}`)
  if (cell.asOf) parts.push(`As of: ${cell.asOf}`)
  if (cell.note) parts.push(cell.note)
  return parts.join('\n')
}

export function BmnrPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const query = useBmnr()
  const refresh = useRefreshBmnr()
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')
  const [historyView, setHistoryView] = useState<'table' | 'chart'>('table')

  const payload = query.data?.data
  const loading = query.isFetching
  const busy = loading || refreshing

  useEffect(() => {
    // No user file behind this page, so the status bar's path slot stays empty.
    onStatusChange([{ label: 'BMNR', envelope: query.data, loading }], '')
  }, [onStatusChange, query.data, loading])

  useEffect(() => {
    if (loading) setNotice('')
  }, [loading])

  const status = useMemo(() => {
    if (notice) return notice
    if (busy) return 'Loading BMNR treasury data...'
    if (!payload) return 'Loading BMNR treasury data...'
    const meta = query.data?.meta
    if (meta?.freshness === 'failed') return `BMNR data refresh failed: ${meta.failureReason ?? 'unknown error'}`
    const parts: string[] = []
    parts.push(
      payload.progress.treasury === 'loaded'
        ? `Live ETH from CoinGecko ${clockTail(payload.fetchedAt)}`
        : 'Live ETH count unavailable; SEC filed basis shown below',
    )
    const quarter = payload.filed?.latest
    parts.push(
      quarter
        ? `SEC basis ${quarter.endDate} (${quarter.form} filed ${quarter.filedDate})`
        : 'SEC filed balance sheet unavailable',
    )
    if (payload.progress.market === 'unavailable') parts.push('market data unavailable')
    return parts.join(' · ')
  }, [notice, busy, payload, query.data])

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
    await api.writeClipboard(buildBmnrSnapshot(payload))
    setNotice('Treasury snapshot copied to the clipboard.')
  }, [payload])

  const derived = payload?.derived
  const live = payload?.live ?? null
  const quarter = payload?.filed?.latest ?? null

  const premiumTone: Tone = (() => {
    const value = derived?.premiumPct.value
    if (value === null || value === undefined) return 'muted'
    // A large premium or discount is a fact worth flagging in either direction — neither is
    // "good news", so both read amber rather than green.
    return Math.abs(value) > 25 ? 'warning' : 'muted'
  })()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1">
        <h1 className="min-w-0 truncate pr-2 text-sm font-semibold text-text">
          BMNR — {payload?.companyName ?? 'BitMine Immersion Technologies'}
        </h1>
        <span className="ml-auto min-w-0 truncate px-2 text-right text-2xs text-text-muted" title={status}>
          {status}
        </span>
        <Button variant="accent" onClick={onRefresh} disabled={busy}>
          {busy ? 'Refreshing...' : 'Refresh'}
        </Button>
        <Button onClick={onExport} disabled={!payload}>
          Export
        </Button>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
        <MetricTile
          label="ETH Held"
          value={live?.ethHeld.value === null || live === null ? EM_DASH : integer(live.ethHeld.value)}
          sub="CoinGecko · live"
          tone="muted"
          title={cellTitle(live?.ethHeld)}
        />
        <MetricTile
          label="% of ETH Supply"
          value={plainPercent(live?.supplyPct.value, 2)}
          sub={
            live?.impliedEthSupply.value
              ? `of ~${compactNumber(live.impliedEthSupply.value)} ETH · live`
              : 'live'
          }
          tone="muted"
          title={cellTitle(live?.impliedEthSupply)}
        />
        <MetricTile
          label="ETH Value"
          value={compactCurrency(derived?.cryptoValue.value)}
          sub={
            payload?.market.ethPrice.value
              ? `@ ${currency(payload.market.ethPrice.value, 0)}/ETH · live`
              : 'ETH price unavailable'
          }
          tone="muted"
          title={cellTitle(derived?.cryptoValue)}
        />
        <MetricTile
          label="NAV"
          value={compactCurrency(derived?.nav.value)}
          sub={quarter ? `equity ${quarter.endDate} marked live` : 'no filed equity'}
          tone="muted"
          title={cellTitle(derived?.nav)}
        />
        <MetricTile
          label="mNAV"
          value={derived?.mnav.value === null || !derived ? EM_DASH : `${decimals(derived.mnav.value, 2)}x`}
          sub={derived?.premiumPct.value === null || !derived ? EM_DASH : percent(derived.premiumPct.value)}
          tone={premiumTone}
          title={cellTitle(derived?.mnav)}
        />
        <MetricTile
          label="ETH / 1,000 sh"
          value={decimals(derived?.ethPer1000Shares.value, 3)}
          sub={
            derived?.shares.value
              ? `on ${compactNumber(derived.shares.value)} sh · ${derived.shares.asOf}`
              : 'no share count'
          }
          tone="muted"
          title={cellTitle(derived?.shares)}
        />
      </div>

      <div className="grid min-h-[280px] grid-cols-1 gap-2 xl:min-h-[300px] xl:flex-[31_1_0%] xl:grid-cols-12">
        <Panel
          className="min-h-[280px] xl:col-span-4 xl:h-full xl:min-h-0"
          title="Treasury Basis — Live vs SEC Filed"
          warning={warningOf(query.data, 'ETH Treasury (CoinGecko)')}
        >
          <BasisTable payload={payload} />
          <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">
            * Cross-basis: computed from one live and one filed input. The two counts are never blended.
          </div>
        </Panel>

        <Panel
          className="min-h-[280px] xl:col-span-4 xl:h-full xl:min-h-0"
          title={`Asset Composition${payload?.composition.asOf ? ` — SEC filed ${payload.composition.asOf}` : ''}`}
          warning={warningOf(query.data, 'SEC Filed Balance Sheet')}
        >
          {payload?.composition.overAllocated ? (
            <PanelMessage>
              Named components exceed total assets — a balance-sheet tag was double-counted.
            </PanelMessage>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-[140px] shrink-0 flex-col overflow-hidden xl:h-[40%] xl:max-h-[190px] xl:min-h-[140px]">
              <Donut
                slices={(payload?.composition.slices ?? []).map((slice, index) => ({
                  label: slice.label,
                  value: slice.value,
                  color: colorForIndex(index),
                }))}
                centerText={compactCurrency(payload?.composition.totalAssets)}
                centerSubtext="Total assets"
                empty="No filed balance sheet"
                compact
              />
            </div>
            <div className="flex min-h-[70px] flex-1 flex-col border-t border-border">
              <OtherHoldingsTable composition={payload?.composition} />
            </div>
          </div>
        </Panel>

        <Panel className="min-h-[280px] xl:col-span-4 xl:h-full xl:min-h-0" title="NAV Bridge" warning={warningOf(query.data, 'SEC Filed Balance Sheet')}>
          <NavBridge payload={payload} />
        </Panel>
      </div>

      <div className="grid min-h-[180px] grid-cols-1 gap-2 xl:min-h-[240px] xl:flex-[27_1_0%] xl:grid-cols-12">
        <Panel
          className="min-h-[180px] xl:col-span-5 xl:h-full xl:min-h-0"
          title="Quarterly Treasury & Dilution"
          warning={warningOf(query.data, 'SEC Filed Balance Sheet')}
          actions={
            <>
              <Button variant="toggle" active={historyView === 'table'} onClick={() => setHistoryView('table')}>
                Table
              </Button>
              <Button variant="toggle" active={historyView === 'chart'} onClick={() => setHistoryView('chart')}>
                Chart
              </Button>
            </>
          }
        >
          {historyView === 'table' ? (
            <HistoryTable rows={payload?.history ?? []} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col p-2">
              <HistoryChart rows={payload?.history ?? []} />
            </div>
          )}
        </Panel>

        <Panel className="min-h-[180px] xl:col-span-4 xl:h-full xl:min-h-0" title="ETH Price Sensitivity">
          <SensitivityTable rows={payload?.sensitivity ?? []} />
        </Panel>

        <Panel className="min-h-[180px] xl:col-span-3 xl:h-full xl:min-h-0" title="SEC Filings" warning={warningOf(query.data, 'SEC Filed Balance Sheet')}>
          <FilingsTable filings={payload?.filings ?? []} compact />
        </Panel>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- basis table */

interface BasisRow {
  metric: string
  live: string
  liveAsOf: string
  filed: string
  filedAsOf: string
  difference: string
  /** Set when the Difference column mixes bases; renders the footnote marker. */
  cross: boolean
}

function num(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? EM_DASH : decimals(value, digits)
}

function BasisTable({ payload }: { payload: BmnrPayload | undefined }) {
  const rows = useMemo<BasisRow[]>(() => {
    if (!payload) return []
    const live = payload.live
    const quarter = payload.filed?.latest ?? null
    const liveStamp = live ? live.ethHeld.asOf.slice(0, 10) : EM_DASH
    const filedStamp = quarter?.endDate ?? EM_DASH
    const derived = payload.derived

    const ethLive = live?.ethHeld.value ?? null
    const ethFiled = quarter?.ethUnits ?? null

    return [
      {
        metric: 'ETH held',
        live: ethLive === null ? EM_DASH : integer(ethLive),
        liveAsOf: liveStamp,
        filed: ethFiled === null ? EM_DASH : integer(ethFiled),
        filedAsOf: filedStamp,
        difference:
          derived.unfiledEth.value === null
            ? EM_DASH
            : `${derived.unfiledEth.value > 0 ? '+' : ''}${integer(derived.unfiledEth.value)}`,
        cross: true,
      },
      {
        metric: '% of ETH supply',
        live: plainPercent(live?.supplyPct.value, 2),
        liveAsOf: liveStamp,
        filed: plainPercent(derived.filedSupplyPct.value, 2),
        filedAsOf: filedStamp,
        difference:
          derived.unfiledEthPct.value === null
            ? EM_DASH
            : `${derived.unfiledEthPct.value > 0 ? '+' : ''}${num(derived.unfiledEthPct.value, 2)}pp`,
        cross: true,
      },
      {
        metric: 'ETH value (USD)',
        live: compactCurrency(live?.ethValueUsd.value),
        liveAsOf: liveStamp,
        filed: compactCurrency(quarter?.cryptoFairValue),
        filedAsOf: filedStamp,
        difference: EM_DASH,
        cross: true,
      },
      {
        metric: 'Shares outstanding',
        live: payload.market.impliedShares.value === null ? EM_DASH : integer(payload.market.impliedShares.value),
        liveAsOf: liveStamp,
        filed: quarter?.sharesOutstanding === null || !quarter ? EM_DASH : integer(quarter.sharesOutstanding),
        filedAsOf: filedStamp,
        difference:
          derived.shareCountGap.value === null
            ? EM_DASH
            : `${derived.shareCountGap.value > 0 ? '+' : ''}${compactNumber(derived.shareCountGap.value)} sh`,
        cross: false,
      },
      {
        metric: 'Carrying / ETH',
        live: EM_DASH,
        liveAsOf: EM_DASH,
        filed: currency(derived.filedCarryingValuePerEth.value),
        filedAsOf: filedStamp,
        difference: EM_DASH,
        cross: false,
      },
      {
        metric: 'Gross cost / ETH',
        live: currency(payload.market.ethPrice.value),
        liveAsOf: liveStamp,
        filed: currency(derived.impliedGrossCostPerEth.value),
        filedAsOf: filedStamp,
        difference: derived.costVsSpotPct.value === null ? EM_DASH : percent(derived.costVsSpotPct.value),
        cross: true,
      },
    ]
  }, [payload])

  const liveAsOf = rows[0]?.liveAsOf ?? EM_DASH
  const filedAsOf = rows[0]?.filedAsOf ?? EM_DASH
  const datedHeader = (label: string, date: string) => (
    <span className="flex flex-col">
      <span>{label}</span>
      <span className="num text-[10px] font-normal text-text-dim">{date}</span>
    </span>
  )

  const columns: Array<Column<BasisRow>> = [
    {
      key: 'metric',
      header: 'Metric',
      cell: (row) => `${row.metric}${row.cross ? ' *' : ''}`,
      width: '29%',
    },
    {
      key: 'live',
      header: datedHeader('Live', liveAsOf),
      cell: (row) => <span className="text-[11px]" title={row.live}>{row.live}</span>,
      align: 'right',
      numeric: true,
      width: '24%',
    },
    {
      key: 'filed',
      header: datedHeader('SEC filed', filedAsOf),
      cell: (row) => <span className="text-[11px]" title={row.filed}>{row.filed}</span>,
      align: 'right',
      numeric: true,
      width: '24%',
    },
    {
      key: 'difference',
      header: 'Difference',
      cell: (row) => row.difference,
      align: 'right',
      numeric: true,
      width: '23%',
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.metric}
      empty="No treasury data"
      layout="fixed"
    />
  )
}

/* --------------------------------------------------------- other holdings */

function OtherHoldingsTable({ composition }: { composition: BmnrPayload['composition'] | undefined }) {
  const columns: Array<Column<BmnrHoldingSlice>> = [
    {
      key: 'label',
      header: 'Component',
      cell: (row) => <span title={row.label}>{row.label}</span>,
      width: '30%',
    },
    {
      key: 'tag',
      header: 'us-gaap tag',
      cell: (row) => <span title={row.tag}>{row.tag}</span>,
      width: '38%',
    },
    {
      key: 'value',
      header: 'Value',
      cell: (row) => compactCurrency(row.value),
      align: 'right',
      numeric: true,
      width: '17%',
    },
    {
      key: 'share',
      header: '% assets',
      cell: (row) => plainPercent(row.sharePct, 2),
      align: 'right',
      numeric: true,
      width: '15%',
    },
  ]
  return (
    <>
      <DataTable
        columns={columns}
        rows={composition?.otherSlices ?? []}
        rowKey={(row) => `${row.label}:${row.tag}`}
        empty="No other holdings filed"
        layout="fixed"
      />
      {composition?.otherTotal !== null && composition?.otherTotal !== undefined ? (
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">
          Other total {compactCurrency(composition.otherTotal)} ·{' '}
          {/* Never fall back to a stand-in denominator: without total assets this is a dash. */}
          {plainPercent(
            composition.totalAssets ? (composition.otherTotal / composition.totalAssets) * 100 : null,
            2,
          )}{' '}
          of assets
        </div>
      ) : null}
    </>
  )
}

/* ------------------------------------------------------------- NAV bridge */

interface BridgeRow {
  label: string
  value: string
  emphasis?: boolean
  title?: string
}

function NavBridge({ payload }: { payload: BmnrPayload | undefined }) {
  const rows = useMemo<BridgeRow[]>(() => {
    if (!payload) return []
    const derived = payload.derived
    const quarter = payload.filed?.latest ?? null
    const markDelta =
      derived.cryptoValue.value === null || quarter?.cryptoFairValue === null || !quarter
        ? null
        : derived.cryptoValue.value - quarter.cryptoFairValue
    const gap = derived.navReconciliationGap.value
    const minority = quarter?.minorityInterest ?? null
    const reconciles = gap !== null && minority !== null && Math.abs(gap - minority) < 1

    return [
      {
        label: `Filed equity${quarter ? ` (${quarter.endDate})` : ''}`,
        value: compactCurrency(quarter?.stockholdersEquity),
        title: cellTitle(derived.nav),
      },
      { label: '+ crypto mark-to-market Δ', value: markDelta === null ? EM_DASH : compactCurrency(markDelta) },
      { label: '= NAV', value: compactCurrency(derived.nav.value), emphasis: true, title: cellTitle(derived.nav) },
      {
        label: `÷ shares${derived.shares.asOf ? ` (${derived.shares.asOf})` : ''}`,
        value: derived.shares.value === null ? EM_DASH : integer(derived.shares.value),
        title: cellTitle(derived.shares),
      },
      { label: '= NAV / share', value: currency(derived.navPerShare.value), emphasis: true },
      { label: 'Market cap (live)', value: compactCurrency(payload.market.marketCap.value) },
      {
        label: '= mNAV',
        value: derived.mnav.value === null ? EM_DASH : `${decimals(derived.mnav.value, 3)}x`,
        emphasis: true,
      },
      {
        label: 'Premium / (discount)',
        value: derived.premiumPct.value === null ? EM_DASH : percent(derived.premiumPct.value),
      },
      { label: 'Build-up NAV (asset side)', value: compactCurrency(derived.navBuildUp.value) },
      { label: 'Gap', value: gap === null ? EM_DASH : compactCurrency(gap) },
      {
        label: 'Minority interest (filed)',
        value: `${compactCurrency(minority)}${gap === null || minority === null ? '' : reconciles ? '  ✓' : '  ✗'}`,
      },
    ]
  }, [payload])

  const columns: Array<Column<BridgeRow>> = [
    { key: 'label', header: 'Line', cell: (row) => <span title={row.title}>{row.label}</span>, width: '70%' },
    {
      key: 'value',
      header: 'Value',
      cell: (row) => <span className={row.emphasis ? 'font-bold text-text' : ''}>{row.value}</span>,
      align: 'right',
      numeric: true,
      width: '30%',
    },
  ]

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.label}
        empty="No filed balance sheet"
        layout="fixed"
      />
      <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">
        NAV marks the crypto book to the live ETH price but takes cash, other assets and liabilities from the last
        filed balance sheet, so it does not see capital raised since that date.
      </div>
    </>
  )
}

/* ----------------------------------------------------------------- history */

function HistoryTable({ rows }: { rows: BmnrQuarterPoint[] }) {
  const columns: Array<Column<BmnrQuarterPoint>> = [
    {
      key: 'label',
      header: 'Quarter',
      cell: (row) => {
        const [quarter, period = ''] = row.label.split(' · ')
        return (
          <span className="flex min-w-0 flex-col" title={row.label}>
            <span className="truncate text-[11px] leading-tight font-medium text-text">{quarter}</span>
            <span className="truncate text-[10px] leading-none text-text-dim">{period}</span>
          </span>
        )
      },
      width: '24%',
    },
    {
      key: 'eth',
      header: 'ETH units',
      cell: (row) => (
        <span className="flex min-w-0 flex-col items-end" title={row.ethUnitsUnit || undefined}>
          <span className="text-[11px] leading-tight">{row.ethUnits === null ? EM_DASH : integer(row.ethUnits)}</span>
          <span className="max-w-full truncate font-sans text-[10px] leading-none font-normal text-text-dim">
            {row.qoqEthPct === null ? row.ethUnitsUnit || EM_DASH : `QoQ ${percent(row.qoqEthPct)}`}
          </span>
        </span>
      ),
      align: 'right',
      numeric: true,
      width: '26%',
    },
    {
      key: 'shares',
      header: 'Shares',
      cell: (row) => {
        const value = row.shares === null ? EM_DASH : integer(row.shares)
        return (
          <span className="flex min-w-0 flex-col items-end" title={value}>
            <span className="text-[11px] leading-tight">{value}</span>
            <span className="max-w-full truncate font-sans text-[10px] leading-none font-normal text-text-dim">
              {row.qoqSharesPct === null ? 'QoQ —' : `QoQ ${percent(row.qoqSharesPct)}`}
            </span>
          </span>
        )
      },
      align: 'right',
      numeric: true,
      width: '25%',
    },
    {
      key: 'perShare',
      header: 'ETH / 1,000 sh',
      cell: (row) => (
        <span className="flex min-w-0 flex-col items-end">
          <span className="text-[11px] leading-tight">{decimals(row.ethPer1000Shares, 3)}</span>
          <span className="font-sans text-[10px] leading-none font-normal text-text-dim">
            Accr.{' '}
            {row.accretionPct === null ? (
              EM_DASH
            ) : (
              <span className={directionClass(row.accretionPct)}>{percent(row.accretionPct)}</span>
            )}
          </span>
        </span>
      ),
      align: 'right',
      numeric: true,
      width: '25%',
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.endDate}
      empty="No filed quarters"
      layout="fixed"
    />
  )
}

function HistoryChart({ rows }: { rows: BmnrQuarterPoint[] }) {
  const series: LineSeries[] = [
    { values: rows.map((row) => row.sharesIndexed), color: SERIES_SHARES, label: 'Shares (indexed)' },
    {
      values: rows.map((row) => row.ethPerShareIndexed),
      color: SERIES_ETH,
      dashed: true,
      label: 'ETH / share (indexed)',
    },
  ]
  return (
    <LineChart
      labels={rows.map((row) => row.label)}
      series={series}
      format={(value) => decimals(value, 1)}
      baseline="auto"
      empty="No filed quarters"
    />
  )
}

/* ------------------------------------------------------------- sensitivity */

function SensitivityTable({ rows }: { rows: BmnrSensitivityRow[] }) {
  const columns: Array<Column<BmnrSensitivityRow>> = [
    {
      key: 'shock',
      header: 'Shock',
      cell: (row) => <span className={row.shockPct === 0 ? 'font-bold text-text' : ''}>{percent(row.shockPct, 0)}</span>,
      width: '20%',
    },
    { key: 'price', header: 'Price', cell: (row) => currency(row.ethPrice, 0), align: 'right', numeric: true, width: '26%' },
    { key: 'nav', header: 'NAV/sh', cell: (row) => currency(row.navPerShare), align: 'right', numeric: true, width: '27%' },
    {
      key: 'mnav',
      header: 'mNAV',
      cell: (row) => (row.mnav === null ? EM_DASH : `${decimals(row.mnav, 2)}x`),
      align: 'right',
      numeric: true,
      width: '27%',
    },
  ]
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => String(row.shockPct)}
        empty="No sensitivity data"
        layout="fixed"
      />
      <div className="shrink-0 border-t border-border px-2 py-1 text-[10px] text-text-dim">
        mNAV is held at its current value.
      </div>
    </>
  )
}
