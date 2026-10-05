import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LogicalRange } from 'lightweight-charts'
import { STOCKS_RANGE_PRESETS, type StocksRangePreset } from '@shared/contract'
import { MU_BLOCKS, buildMuSnapshot, muHistory, type MuBlock, type MuMetric } from '@shared/mu'
import { api } from '@/api/client'
import { useMu, useRefreshMu } from '@/api/muQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { LineChart } from '@/components/charts/LineChart'
import { colorForIndex } from '@/components/charts/Donut'
import { StocksChart } from '@/components/stocks/StocksChart'
import { FilingsTable } from '@/components/fundamentals/FilingsTable'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { compactCurrency, currency, percent, plainPercent } from '@/lib/format'

const unavailable = '--'
function metricText(metric: MuMetric | undefined): string {
  if (!metric) return unavailable
  if (metric.text) return metric.text
  if (metric.value === null) return metric.text || unavailable
  if (metric.unit === 'USD') return compactCurrency(metric.value)
  if (metric.unit === 'USD/share') return currency(metric.value)
  if (metric.unit === '%') return plainPercent(metric.value, 1)
  return metric.value.toLocaleString('en-US')
}
function Source({ metric }: { metric: MuMetric | undefined }) {
  if (!metric) return null
  const url = metric.page ? `${metric.sourceUrl}#page=${metric.page}` : metric.sourceUrl
  return <button className="shrink-0 text-accent hover:underline" title={url} onClick={() => void api.openExternal(url)}>{metric.page ? `p.${metric.page}` : 'Source'}</button>
}
function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="min-w-0 border border-border bg-surface px-2 py-2 text-center"><div className="truncate text-2xs text-text-muted">{label}</div><div className="num truncate text-base font-bold text-text">{value}</div><div className="truncate text-2xs text-text-muted" title={sub}>{sub}</div></div>
}

export function MuPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const query = useMu()
  const refresh = useRefreshMu()
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [range, setRange] = useState<StocksRangePreset>('1Y')
  const [logicalRange, setLogicalRange] = useState<LogicalRange | null>(null)
  const payload = query.data?.data
  const market = payload?.market
  const earnings = payload?.earnings
  const memory = payload?.memory
  const busy = query.isFetching || refreshing
  const history = useMemo(() => muHistory(payload?.financials ?? null), [payload?.financials])
  useEffect(() => onStatusChange([{ label: 'MU', envelope: query.data, loading: busy }], ''), [onStatusChange, query.data, busy])
  const warning = (block: MuBlock) => query.data?.errors.filter(error => error.symbol === block).map(error => error.reason).join(' · ') || undefined
  const empty = (block: MuBlock) => busy ? 'Loading Micron data...' : warning(block) || query.error?.message || `${block} data unavailable`
  const metric = (id: string) => earnings?.metrics.find(row => row.id === id)
  const memoryMetric = (id: string) => memory?.metrics.find(row => row.id === id)
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    setNotice('')
    try { await refresh() } catch (error) { setNotice(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`) }
    finally { setRefreshing(false) }
  }, [refresh])
  const onExport = async () => {
    if (!payload) return
    try {
      await api.writeClipboard(buildMuSnapshot(payload))
      setNotice('MU snapshot copied to clipboard.')
    }
    catch (error) { setNotice(`Export failed: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const laneStatus = (block: MuBlock) => {
    const time = payload?.laneFetchedAt[block]
    return <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">{block} · {payload?.progress[block] ?? (busy ? 'loading' : 'unavailable')}{time ? ` · fetched ${new Date(time).toLocaleString()}` : ''}</div>
  }
  const unitColumns: Array<Column<NonNullable<typeof earnings>['units'][number]>> = [
    { key: 'name', header: 'Business unit', cell: row => row.name, wrap: true, width: '46%' },
    { key: 'revenue', header: 'Revenue', cell: row => compactCurrency(row.revenue), numeric: true, align: 'right' },
    { key: 'gross', header: 'Gross margin', cell: row => plainPercent(row.grossMargin, 0), numeric: true, align: 'right' },
    { key: 'operating', header: 'Operating margin', cell: row => plainPercent(row.operatingMargin, 0), numeric: true, align: 'right' },
  ]
  const memoryRows = [['Revenue', 'Revenue'], ['Revenue share', 'Share'], ['Revenue YoY', 'Yoy'], ['Revenue QoQ', 'Qoq'], ['Bit shipments QoQ', 'Shipments'], ['Pricing QoQ', 'Pricing']]
    .map(([label, suffix]) => ({ label, dram: memoryMetric(`dram${suffix}`), nand: memoryMetric(`nand${suffix}`) }))
  const memoryColumns: Array<Column<typeof memoryRows[number]>> = [
    { key: 'label', header: 'Reported metric', cell: row => row.label, width: '25%', wrap: true },
    ...(['dram', 'nand'] as const).map(key => ({ key, header: key.toUpperCase(), wrap: true,
      cell: (row: typeof memoryRows[number]) => <div className="flex items-start gap-2"><span className="min-w-0 flex-1">{metricText(row[key])}</span><Source metric={row[key]} /></div> })),
  ]
  const status = notice || (busy ? 'Loading MU...' : query.error ? `MU load failed: ${query.error.message}` : query.data ? `${query.data.meta.freshness} · ${earnings?.period ?? 'earnings unavailable'}` : 'MU data unavailable')
  const otherMemory = memory?.metrics.filter(row => !/^(dram|nand)/.test(row.id)) ?? []

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-auto p-2" data-mu-page>
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      <h1 className="pr-2 text-sm font-semibold text-text">MU — Micron Technology</h1>
      <span className="ml-auto text-2xs text-text-muted" role="status">{status}</span>
      <Button variant="accent" disabled={busy} onClick={() => void onRefresh()}>{busy ? 'Refreshing...' : 'Refresh'}</Button>
      <Button disabled={!payload || MU_BLOCKS.every(block => payload.progress[block] === 'unavailable')} onClick={() => void onExport()}>Export snapshot</Button>
      <Button onClick={() => onNavigate('charts', 'MU')}>Charts</Button><Button onClick={() => onNavigate('fundamentals', 'MU')}>Fundamentals</Button>
      <Button onClick={() => void api.openExternal('https://investors.micron.com/overview/default.aspx')}>Investor relations</Button>
    </div>
    {query.data?.errors.length ? <div role="alert" className="shrink-0 border border-warn/40 bg-surface px-2 py-1 text-2xs text-warn">{query.data.errors.map(error => `${error.symbol}: ${error.reason}`).join(' · ')}</div> : null}
    <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
      <Tile label="Share price" value={currency(market?.chart.stats.price)} sub={`USD · ${percent(market?.chart.stats.change)} daily`} />
      <Tile label="Market cap" value={market?.metrics.marketCap ?? unavailable} sub="Yahoo Finance · market" />
      <Tile label="Forward P/E" value={market?.metrics.forwardPe ?? unavailable} sub="Yahoo Finance · estimate" />
      <Tile label="Quarterly revenue" value={metricText(metric('revenue'))} sub={`${earnings?.period ?? '--'} · GAAP`} />
      <Tile label="Gross margin" value={metricText(metric('nonGaapGrossMargin'))} sub={`${earnings?.period ?? '--'} · non-GAAP`} />
      <Tile label="Diluted EPS" value={metricText(metric('nonGaapEps'))} sub={`${earnings?.period ?? '--'} · non-GAAP`} />
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-3">
      <Panel title="MU stock performance" className="h-[340px] min-w-0 xl:col-span-2" warning={warning('market')} actions={<div className="flex gap-1">{STOCKS_RANGE_PRESETS.map(preset => <Button key={preset} variant="toggle" active={range === preset} onClick={() => { setLogicalRange(null); setRange(preset) }}>{preset}</Button>)}</div>}>
        {market ? <StocksChart payload={market.chart} mfiEnabled={false} autoFollow={false} rangePreset={range} logicalRange={logicalRange} onLogicalRangeChange={setLogicalRange} onManualRange={() => setRange('')} onHoverCandle={() => {}} /> : <PanelMessage>{empty('market')}</PanelMessage>}{laneStatus('market')}
      </Panel>
      <Panel title="Market & balance sheet" className="h-[340px] min-w-0" warning={warning('financials') || warning('market')}>
        <div className="min-h-0 flex-1 overflow-auto p-2 text-2xs">{[
          ['Next earnings · Yahoo estimate', market?.metrics.earningsDate], ['Target low', market?.targets.low], ['Target mean', market?.targets.mean], ['Target high', market?.targets.high], ['Upside to mean', market?.targets.upsideToMean], ['Analysts', market?.targets.analysts],
          ['Cash · latest Yahoo snapshot', compactCurrency(payload?.financials?.facts.totalCash)], ['Debt · latest Yahoo snapshot', compactCurrency(payload?.financials?.facts.totalDebt)],
        ].map(([label, value]) => <div key={label} className="flex gap-2 border-b border-border/60 py-1"><span className="flex-1 text-text-muted">{label}</span><span className="num text-text">{value || unavailable}</span></div>)}</div>{laneStatus('financials')}
      </Panel>
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title={`Memory cycle · ${memory?.period ?? '--'}`} className="h-[310px] min-w-0" warning={warning('memory')}>
        <DataTable columns={memoryColumns} rows={memory ? memoryRows : []} rowKey={row => row.label} layout="fixed" empty={empty('memory')} /><div className="shrink-0 px-2 py-1 text-2xs text-text-muted">Pricing and bit shipments are reported sequential changes; qualitative ranges remain as disclosed.</div>{laneStatus('memory')}
      </Panel>
      <Panel title={`HBM, inventory & investment · ${memory?.period ?? '--'}`} className="h-[310px] min-w-0" warning={warning('memory')}>
        <DataTable columns={[
          { key: 'label', header: 'Disclosure', cell: row => row.label, width: '30%', wrap: true },
          { key: 'value', header: 'Reported value', cell: row => <div className="flex gap-2"><span className="min-w-0 flex-1">{metricText(row)}{row.id === 'capex' ? ' · net, non-GAAP' : ''}</span><Source metric={row} /></div>, wrap: true },
        ]} rows={otherMemory} rowKey={row => row.id} layout="fixed" empty={empty('memory')} />
        <div className="flex shrink-0 flex-wrap gap-3 px-2 py-1 text-2xs">{memory?.sources.map(source => <button className="text-accent hover:underline" key={source.kind} onClick={() => void api.openExternal(source.url)}>{source.kind === 'remarks' ? 'Prepared remarks' : 'Earnings presentation'}</button>)}</div>
      </Panel>
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title="Quarterly financial trends · USD" className="h-[300px] min-w-0" warning={warning('financials')}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2"><LineChart labels={history.dates} series={history.series.map((series, index) => ({ values: series.values, color: colorForIndex(index), label: { revenue: 'Revenue', netIncome: 'Net income', operatingCashFlow: 'Operating cash flow', freeCashFlow: 'Free cash flow' }[series.key] }))} format={compactCurrency} empty={empty('financials')} /></div><div className="shrink-0 px-2 py-1 text-2xs text-text-muted">SEC/Yahoo statements · fiscal period end dates · free cash flow = operating cash flow − capex</div>
      </Panel>
      <Panel title={`Business units · ${earnings?.period ?? '--'}`} className="h-[300px] min-w-0" warning={warning('earnings')} actions={earnings ? <button className="text-2xs text-accent" onClick={() => void api.openExternal(earnings.sourceUrl)}>Earnings release</button> : null}>
        <DataTable columns={unitColumns} rows={earnings?.units ?? []} rowKey={row => row.name} layout="fixed" empty={empty('earnings')} /><div className="shrink-0 px-2 py-1 text-2xs text-text-muted">Reported segment basis · revenue in USD · published {earnings?.publishedAt || '--'}</div>{laneStatus('earnings')}
      </Panel>
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title={`Results & guidance · ${earnings?.guidancePeriod ?? '--'}`} className="h-[350px] min-w-0" warning={warning('earnings')}>
        <div className="shrink-0 grid grid-cols-2 gap-2 p-2 text-2xs">{earnings?.metrics.filter(row => row.id !== 'revenue').map(row => <div key={row.id} className="flex gap-2"><span className="flex-1 text-text-muted">{row.basis} {row.label} · {earnings.period}</span><span className="num text-text">{metricText(row)}</span></div>)}</div>
        <DataTable columns={[
          { key: 'label', header: 'Next-quarter outlook', cell: row => row.label, width: '34%', wrap: true }, { key: 'gaap', header: 'GAAP', cell: row => row.gaap, wrap: true }, { key: 'nonGaap', header: 'Non-GAAP', cell: row => row.nonGaap, wrap: true },
        ]} rows={earnings?.guidance ?? []} rowKey={row => row.label} layout="fixed" empty={empty('earnings')} />
      </Panel>
      <Panel title="MU news" className="h-[350px] min-w-0" warning={warning('market')}>
        <DataTable columns={[
          { key: 'title', header: 'Headline', cell: row => <button className="text-left text-accent hover:underline" onClick={() => void api.openExternal(row.url)}>{row.title}</button>, wrap: true, width: '70%' }, { key: 'source', header: 'Source / date', cell: row => `${row.source} · ${new Date(row.publishedAt).toLocaleDateString()}`, wrap: true },
        ]} rows={market?.news ?? []} rowKey={row => row.id} layout="fixed" empty={market ? 'No recent MU headlines.' : empty('market')} />
      </Panel>
    </div>
    <Panel title="Micron SEC filings" className="h-[310px] shrink-0" warning={warning('financials')}>{payload?.financials ? <FilingsTable filings={payload.financials.sec.filings} compact /> : <PanelMessage>{empty('financials')}</PanelMessage>}</Panel>
  </div>
}
