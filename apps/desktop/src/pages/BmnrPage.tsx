import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  BmnrHoldingSlice,
  BmnrPayload,
  BmnrQuarterPoint,
  BmnrSensitivityRow,
  BmnrValue,
} from '@shared/contract'
import { BMNR_CASH_SLICE_LABEL, buildBmnrSnapshot } from '@shared/bmnr'
import { api } from '@/api/client'
import { useBmnr } from '@/api/bmnrQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { colorForIndex } from '@/components/charts/Donut'
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

import './BmnrPage.css'

const SERIES_SHARES = colorForIndex(0)
const SERIES_ETH = colorForIndex(1)

function TreasuryMetric({
  label,
  value,
  detail,
  warning = false,
  title,
}: {
  label: string
  value: string
  detail: string
  warning?: boolean
  title?: string
}) {
  return (
    <div className="bmnr-metric" title={title}>
      <dt>{label}</dt>
      <dd>
        <span className="num bmnr-metric-value">{value}</span>
        <span className={warning ? 'text-warn' : 'text-text-muted'}>{detail}</span>
      </dd>
    </div>
  )
}

/** A `BmnrValue`'s own tooltip: what it was computed from and when. */
function cellTitle(cell: BmnrValue | undefined): string | undefined {
  if (!cell) return undefined
  const parts = [`Basis: ${cell.basis === 'live' ? 'market snapshot' : cell.basis === 'cross' ? 'market snapshot + SEC filed' : 'SEC filed'}`]
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
  const [notice, setNotice] = useState('')
  const [historyView, setHistoryView] = useState<'table' | 'chart'>('table')

  const payload = query.data?.data
  const loading = query.isFetching

  useEffect(() => {
    onStatusChange([{ label: 'BMNR', envelope: query.data, error: query.error, enabled: query.isEnabled, loading }], '')
  }, [onStatusChange, query.data, query.error, query.isEnabled, loading])

  useEffect(() => {
    if (loading) setNotice('')
  }, [loading])

  const onExport = useCallback(async () => {
    if (!payload) return
    try {
      await api.writeClipboard(buildBmnrSnapshot(payload))
      setNotice('Copied to clipboard')
    } catch {
      setNotice('Copy failed · Retry')
    }
  }, [payload])

  const derived = payload?.derived
  const live = payload?.live
  const quarter = payload?.filed?.latest ?? null
  const cash = quarter?.cash ?? null
  const cashShare = derived?.cashShareOfAssetsPct.value ?? null
  const premium = derived?.premiumPct.value ?? null
  const mnav = derived?.mnav.value ?? null
  const ethSpot = payload?.market.ethPrice.value ?? null

  return (
    <div className="bmnr-page">
      <header className="bmnr-header">
        <h1>
          <span>BMNR</span>
          <span>{payload?.companyName ?? 'BitMine Immersion Technologies'}</span>
        </h1>
        <Button className="bmnr-copy" onClick={onExport} disabled={!payload}>
          {notice || 'Copy treasury snapshot'}
        </Button>
        <span className="sr-only" role="status">{notice}</span>
      </header>

      <div className="bmnr-summary">
        <section className="bmnr-cash" aria-labelledby="bmnr-cash-heading">
          <h2 id="bmnr-cash-heading">Cash &amp; equivalents</h2>
          <strong className="num bmnr-cash-value" title={cash === null ? undefined : `${currency(cash, 0)} USD`}>
            {compactCurrency(cash)}
          </strong>
          <div className="bmnr-cash-detail">
            <span>SEC filed{quarter ? ` · ${quarter.endDate}` : ''}</span>
            {cashShare !== null ? (
              <span><strong className="num">{plainPercent(cashShare, 2)}</strong> of assets</span>
            ) : null}
          </div>
        </section>

        <dl className="bmnr-metrics" aria-label="Treasury and valuation metrics">
          <TreasuryMetric label="ETH held" value={integer(live?.ethHeld.value)} detail="CoinGecko snapshot" title={cellTitle(live?.ethHeld)} />
          <TreasuryMetric
            label="ETH supply share"
            value={plainPercent(live?.supplyPct.value, 2)}
            detail={live?.impliedEthSupply.value ? `of ~${compactNumber(live.impliedEthSupply.value)} ETH` : 'Market snapshot'}
            title={cellTitle(live?.impliedEthSupply)}
          />
          <TreasuryMetric
            label="ETH value"
            value={compactCurrency(derived?.cryptoValue.value)}
            detail={ethSpot === null ? 'Snapshot mark' : `${currency(ethSpot, 0)} per ETH`}
            title={cellTitle(derived?.cryptoValue)}
          />
          <TreasuryMetric label="NAV" value={compactCurrency(derived?.nav.value)} detail="Filed equity + ETH mark" title={cellTitle(derived?.nav)} />
          <TreasuryMetric
            label="mNAV"
            value={mnav === null ? EM_DASH : `${decimals(mnav, 2)}x`}
            detail={premium === null ? 'Market cap / NAV' : `${percent(premium)} vs. NAV`}
            warning={premium !== null && Math.abs(premium) > 25}
            title={cellTitle(derived?.mnav)}
          />
          <TreasuryMetric
            label="ETH / 1,000 shares"
            value={decimals(derived?.ethPer1000Shares.value, 3)}
            detail={derived?.shares.value ? `on ${compactNumber(derived.shares.value)} shares` : 'Filed share count'}
            title={cellTitle(derived?.ethPer1000Shares)}
          />
        </dl>
      </div>

      <div className="bmnr-panels">
        <Panel className="bmnr-assets" title="Filed Asset Composition">
          <AssetComposition composition={payload?.composition} />
        </Panel>

        <Panel className="bmnr-basis" title="Treasury Basis">
          <BasisTable payload={payload} />
          <p className="bmnr-panel-note">* Cross-basis metrics use both market and SEC data.</p>
        </Panel>

        <Panel className="bmnr-nav" title="NAV Bridge">
          <NavBridge payload={payload} />
        </Panel>

        <Panel
          className="bmnr-history"
          title="Quarterly Treasury & Dilution"
          actions={
            <div className="bmnr-history-views" role="group" aria-label="Quarterly treasury view">
              <Button variant="toggle" active={historyView === 'table'} onClick={() => setHistoryView('table')}>
                Table
              </Button>
              <Button variant="toggle" active={historyView === 'chart'} onClick={() => setHistoryView('chart')}>
                Chart
              </Button>
            </div>
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

        <Panel className="bmnr-sensitivity" title="ETH Price Sensitivity">
          <SensitivityTable rows={payload?.sensitivity ?? []} />
        </Panel>

        <Panel className="bmnr-filings" title="SEC Filings">
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
  liveTitle?: string
  filed: string
  filedTitle?: string
  difference: string
  /** Set when the Difference column mixes bases; renders the footnote marker. */
  cross: boolean
}

function num(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? EM_DASH : decimals(value, digits)
}

function BasisTable({ payload }: { payload: BmnrPayload | undefined }) {
  const liveAsOf = payload?.live?.ethHeld.asOf.slice(0, 10) || EM_DASH
  const filedAsOf = payload?.filed?.latest?.endDate ?? EM_DASH
  const rows = useMemo<BasisRow[]>(() => {
    if (!payload) return []
    const live = payload.live
    const quarter = payload.filed?.latest ?? null
    const derived = payload.derived

    const ethLive = live?.ethHeld.value ?? null
    const ethFiled = quarter?.ethUnits ?? null

    return [
      {
        metric: 'ETH held',
        live: ethLive === null ? EM_DASH : integer(ethLive),
        filed: ethFiled === null ? EM_DASH : integer(ethFiled),
        difference:
          derived.unfiledEth.value === null
            ? EM_DASH
            : `${derived.unfiledEth.value > 0 ? '+' : ''}${integer(derived.unfiledEth.value)}`,
        cross: true,
      },
      {
        metric: 'ETH supply share',
        live: plainPercent(live?.supplyPct.value, 2),
        filed: plainPercent(derived.filedSupplyPct.value, 2),
        difference:
          derived.unfiledEthPct.value === null
            ? EM_DASH
            : `${derived.unfiledEthPct.value > 0 ? '+' : ''}${num(derived.unfiledEthPct.value, 2)}pp`,
        cross: true,
      },
      {
        metric: 'ETH value (USD)',
        live: compactCurrency(live?.ethValueUsd.value),
        filed: compactCurrency(quarter?.cryptoFairValue),
        difference: EM_DASH,
        cross: true,
      },
      {
        metric: 'Shares outstanding',
        live: compactNumber(payload.market.impliedShares.value),
        liveTitle: integer(payload.market.impliedShares.value),
        filed: compactNumber(quarter?.sharesOutstanding),
        filedTitle: integer(quarter?.sharesOutstanding),
        difference:
          derived.shareCountGap.value === null
            ? EM_DASH
            : `${derived.shareCountGap.value > 0 ? '+' : ''}${compactNumber(derived.shareCountGap.value)} sh`,
        cross: false,
      },
      {
        metric: 'Carrying / ETH',
        live: EM_DASH,
        filed: currency(derived.filedCarryingValuePerEth.value),
        difference: EM_DASH,
        cross: false,
      },
      {
        metric: 'Gross cost / ETH',
        live: currency(payload.market.ethPrice.value),
        filed: currency(derived.impliedGrossCostPerEth.value),
        difference: derived.costVsSpotPct.value === null ? EM_DASH : percent(derived.costVsSpotPct.value),
        cross: true,
      },
    ]
  }, [payload])

  const datedHeader = (label: string, date: string) => (
    <span className="flex flex-col">
      <span>{label}</span>
      <span className="num text-[10px] font-normal text-text-muted">{date}</span>
    </span>
  )

  const columns: Array<Column<BasisRow>> = [
    {
      key: 'metric',
      header: 'Metric',
      cell: (row) => <span title={row.metric}>{row.metric}{row.cross ? ' *' : ''}</span>,
      width: '35%',
    },
    {
      key: 'live',
      header: datedHeader('Market', liveAsOf),
      cell: (row) => <span title={row.liveTitle ?? row.live}>{row.live}</span>,
      align: 'right',
      numeric: true,
      width: '22.5%',
    },
    {
      key: 'filed',
      header: datedHeader('SEC filed', filedAsOf),
      cell: (row) => <span title={row.filedTitle ?? row.filed}>{row.filed}</span>,
      align: 'right',
      numeric: true,
      width: '22.5%',
    },
    {
      key: 'difference',
      header: 'Difference',
      cell: (row) => row.difference,
      align: 'right',
      numeric: true,
      width: '20%',
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

/* -------------------------------------------------------- asset composition */

function AssetComposition({ composition }: { composition: BmnrPayload['composition'] | undefined }) {
  const slices = composition?.slices ?? []
  const columns: Array<Column<BmnrHoldingSlice>> = [
    {
      key: 'label',
      header: 'Component',
      cell: (row, index) => (
        <span className="bmnr-asset-label" title={`${row.label} · ${row.tag}`}>
          <span aria-hidden="true" style={{ backgroundColor: colorForIndex(index) }} />
          <span className="truncate">{row.label}</span>
        </span>
      ),
      width: '54%',
    },
    {
      key: 'value',
      header: 'Value',
      cell: (row) => compactCurrency(row.value),
      align: 'right',
      numeric: true,
      width: '25%',
    },
    {
      key: 'share',
      header: '% assets',
      cell: (row) => plainPercent(row.sharePct, 2),
      align: 'right',
      numeric: true,
      width: '21%',
    },
  ]
  return (
    <>
      <div className="bmnr-allocation">
        <div className="bmnr-allocation-total">
          <span>Total assets <strong className="num">{compactCurrency(composition?.totalAssets)}</strong></span>
          <span className="num">{composition?.asOf}</span>
        </div>
        {composition?.overAllocated ? (
          <p className="bmnr-allocation-warning">Components exceed total assets</p>
        ) : (
          <div className="bmnr-allocation-bar" aria-hidden="true">
            {slices.map((slice, index) => slice.sharePct !== null && slice.sharePct > 0 ? (
              <span key={slice.label} style={{ width: `${slice.sharePct}%`, backgroundColor: colorForIndex(index) }} />
            ) : null)}
          </div>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={slices}
        rowKey={(row) => row.label}
        rowClassName={(row) => row.label === BMNR_CASH_SLICE_LABEL ? 'bmnr-asset-cash' : ''}
        empty="No filed balance sheet"
        layout="fixed"
      />
      <p className="bmnr-panel-note">Other assets <span className="num">{compactCurrency(composition?.otherTotal)}</span></p>
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
        label: 'Filed equity',
        value: compactCurrency(quarter?.stockholdersEquity),
        title: cellTitle(derived.nav),
      },
      { label: '+ ETH mark adjustment', value: compactCurrency(markDelta) },
      { label: '= NAV', value: compactCurrency(derived.nav.value), emphasis: true, title: cellTitle(derived.nav) },
      {
        label: '÷ Shares outstanding',
        value: derived.shares.value === null ? EM_DASH : integer(derived.shares.value),
        title: cellTitle(derived.shares),
      },
      { label: '= NAV / share', value: currency(derived.navPerShare.value), emphasis: true },
      { label: 'Market cap (snapshot)', value: compactCurrency(payload.market.marketCap.value) },
      {
        label: '= mNAV',
        value: derived.mnav.value === null ? EM_DASH : `${decimals(derived.mnav.value, 3)}x`,
        emphasis: true,
      },
      {
        label: 'Premium / (discount)',
        value: derived.premiumPct.value === null ? EM_DASH : percent(derived.premiumPct.value),
      },
      { label: 'Asset-side NAV', value: compactCurrency(derived.navBuildUp.value) },
      { label: 'Reconciliation gap', value: compactCurrency(gap) },
      {
        label: 'Minority interest (filed)',
        value: `${compactCurrency(minority)}${gap === null || minority === null ? '' : reconciles ? '  ✓' : '  ✗'}`,
      },
    ]
  }, [payload])

  return (
    <>
      {rows.length ? (
        <dl className="bmnr-nav-ledger">
          {rows.map((row) => (
            <div className={row.emphasis ? 'bmnr-nav-result' : undefined} key={row.label} title={row.title}>
              <dt>{row.label}</dt>
              <dd className="num">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : <PanelMessage>No NAV data</PanelMessage>}
      <p className="bmnr-panel-note">Cash, other assets and liabilities are SEC filed.</p>
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
      cell: (row) => row.shockPct === 0 ? 'Base case' : percent(row.shockPct, 0),
      width: '25%',
    },
    { key: 'price', header: 'Price', cell: (row) => currency(row.ethPrice, 0), align: 'right', numeric: true, width: '25%' },
    { key: 'nav', header: 'NAV/sh', cell: (row) => currency(row.navPerShare), align: 'right', numeric: true, width: '25%' },
    {
      key: 'mnav',
      header: 'mNAV',
      cell: (row) => (row.mnav === null ? EM_DASH : `${decimals(row.mnav, 2)}x`),
      align: 'right',
      numeric: true,
      width: '25%',
    },
  ]
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => String(row.shockPct)}
        rowClassName={(row) => row.shockPct === 0 ? 'bmnr-sensitivity-base' : ''}
        empty="No sensitivity data"
        layout="fixed"
      />
      <p className="bmnr-panel-note">Scenarios hold mNAV at the snapshot multiple.</p>
    </>
  )
}
