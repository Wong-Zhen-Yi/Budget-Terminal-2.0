import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LogicalRange } from 'lightweight-charts'
import { STOCKS_RANGE_PRESETS } from '@shared/contract'
import type { StocksRangePreset } from '@shared/contract'
import { AVGO_BLOCKS, avgoHistory, buildAvgoSnapshot } from '@shared/avgo'
import type { AvgoBlock, AvgoMetric } from '@shared/avgo'
import { api } from '@/api/client'
import { useAvgo, useRefreshAvgo } from '@/api/avgoQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { LineChart } from '@/components/charts/LineChart'
import { Donut, colorForIndex } from '@/components/charts/Donut'
import { StocksChart } from '@/components/stocks/StocksChart'
import { FilingsTable } from '@/components/fundamentals/FilingsTable'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { compactCurrency, currency, percent, plainPercent } from '@/lib/format'

function metricText(metric: AvgoMetric | undefined): string {
  if (!metric || metric.value === null) return 'Not disclosed'
  const value = metric.unit === 'USD' ? compactCurrency(metric.value) : metric.unit === 'USD/share' ? currency(metric.value)
    : metric.unit === '%' ? plainPercent(metric.value, 1) : metric.value.toLocaleString('en-US')
  return metric.text && (metric.basis === 'outlook' || /^(over|approximately|about)$/i.test(metric.text)) ? `${metric.text} ${value}` : value
}
function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="min-w-0 border border-border bg-surface px-2 py-2 text-center"><div className="truncate text-2xs text-text-muted">{label}</div><div className="num truncate text-base font-bold text-text" title={value}>{value}</div><div className="truncate text-2xs text-text-muted" title={sub}>{sub}</div></div>
}
function Metrics({ rows, empty }: { rows: AvgoMetric[]; empty: string }) {
  return <DataTable columns={[
    { key: 'label', header: 'Metric', cell: row => row.label, width: '45%', wrap: true },
    { key: 'basis', header: 'Basis', cell: row => row.basis, width: '20%', wrap: true },
    { key: 'value', header: 'Value', align: 'right', numeric: true, cell: row => <div className="flex justify-end gap-2"><span title={row.text}>{metricText(row)}</span><button className="shrink-0 text-accent hover:underline" title={row.sourceUrl} onClick={() => void api.openExternal(row.sourceUrl)}>Source</button></div>, wrap: true },
  ]} rows={rows} rowKey={row => row.id} layout="fixed" empty={empty} />
}

export function AvgoPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const query = useAvgo()
  const refresh = useRefreshAvgo()
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [range, setRange] = useState<StocksRangePreset>('1Y')
  const [logicalRange, setLogicalRange] = useState<LogicalRange | null>(null)
  const payload = query.data?.data
  const market = payload?.market
  const earnings = payload?.earnings
  const busy = query.isFetching || refreshing
  const history = useMemo(() => avgoHistory(payload?.financials ?? null), [payload?.financials])
  useEffect(() => onStatusChange([{ label: 'AVGO', envelope: query.data, loading: busy }], ''), [onStatusChange, query.data, busy])
  const warning = (block: AvgoBlock) => query.data?.errors.filter(error => error.symbol === block).map(error => error.reason).join(' · ') || undefined
  const empty = (block: AvgoBlock) => busy ? 'Loading Broadcom data...' : warning(block) || query.error?.message || `${block} data unavailable`
  const metric = (id: string) => earnings?.metrics.find(row => row.id === id)
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    setNotice('')
    try { await refresh() } catch (error) { setNotice(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`) }
    finally { setRefreshing(false) }
  }, [refresh])
  const onExport = async () => {
    if (!payload) return
    try {
      await api.writeClipboard(buildAvgoSnapshot(payload))
      setNotice('AVGO snapshot copied to clipboard.')
    }
    catch (error) { setNotice(`Export failed: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const laneStatus = (block: AvgoBlock) => <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">
    {block} · {payload?.progress[block] ?? (busy ? 'loading' : 'unavailable')}{payload?.laneFetchedAt[block] ? ` · fetched ${new Date(payload.laneFetchedAt[block]).toLocaleString()}` : ''}
  </div>
  const source = earnings ? <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t border-border px-2 py-1 text-2xs text-text-muted">
    <button className="text-accent hover:underline" onClick={() => void api.openExternal(earnings.sourceUrl)}>Earnings release</button>
    <span>{earnings.period} · ended {earnings.periodEnd || '--'} · published {earnings.publishedAt || '--'}</span>
  </div> : null
  const status = notice || (busy ? 'Loading AVGO...' : query.error ? `AVGO load failed: ${query.error.message}` : query.data ? `${query.data.meta.freshness} · ${earnings?.period ?? 'earnings unavailable'}` : 'AVGO data unavailable')
  const mix = earnings?.segments.map((segment, index) => ({ label: segment.name, value: segment.revenue, color: colorForIndex(index) })) ?? []

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-auto p-2" data-avgo-page>
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      <h1 className="pr-2 text-sm font-semibold text-text">AVGO — Broadcom</h1>
      <span className="ml-auto text-2xs text-text-muted" role="status">{status}</span>
      <Button variant="accent" disabled={busy} onClick={() => void onRefresh()}>{busy ? 'Refreshing...' : 'Refresh'}</Button>
      <Button disabled={!payload || AVGO_BLOCKS.every(block => payload.progress[block] === 'unavailable')} onClick={() => void onExport()}>Export snapshot</Button>
      <Button onClick={() => onNavigate('charts', 'AVGO')}>Charts</Button><Button onClick={() => onNavigate('fundamentals', 'AVGO')}>Fundamentals</Button>
      <Button onClick={() => void api.openExternal('https://investors.broadcom.com/')}>Investor relations</Button>
    </div>
    {query.data?.errors.length ? <div role="alert" className="shrink-0 border border-warn/40 bg-surface px-2 py-1 text-2xs text-warn">{query.data.errors.map(error => `${error.symbol}: ${error.reason}`).join(' · ')}</div> : null}
    <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
      <Tile label="Share price" value={currency(market?.chart.stats.price)} sub={`USD · ${percent(market?.chart.stats.change)} daily`} />
      <Tile label="Market cap" value={market?.metrics.marketCap ?? '--'} sub="Yahoo Finance · market" />
      <Tile label="Forward P/E" value={market?.metrics.forwardPe ?? '--'} sub="Yahoo Finance · estimate" />
      <Tile label="Quarterly revenue" value={earnings ? metricText(metric('revenue')) : '--'} sub={`${earnings?.period ?? '--'} · GAAP`} />
      <Tile label="AI semiconductor revenue" value={earnings ? metricText(metric('aiRevenue')) : '--'} sub={`${earnings?.period ?? '--'} · reported`} />
      <Tile label="Diluted EPS" value={earnings ? metricText(metric('nonGaapEps')) : '--'} sub={`${earnings?.period ?? '--'} · non-GAAP`} />
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-3">
      <Panel title="AVGO stock performance" className="h-[340px] min-w-0 xl:col-span-2" warning={warning('market')} actions={<div className="flex gap-1">{STOCKS_RANGE_PRESETS.map(preset => <Button key={preset} variant="toggle" active={range === preset} onClick={() => { setLogicalRange(null); setRange(preset) }}>{preset}</Button>)}</div>}>
        {market ? <StocksChart payload={market.chart} mfiEnabled={false} autoFollow={false} rangePreset={range} logicalRange={logicalRange} onLogicalRangeChange={setLogicalRange} onManualRange={() => setRange('')} onHoverCandle={() => {}} /> : <PanelMessage>{empty('market')}</PanelMessage>}{laneStatus('market')}
      </Panel>
      <Panel title="Market & balance sheet" className="h-[340px] min-w-0" warning={warning('financials') || warning('market')}>
        <div className="min-h-0 flex-1 overflow-auto p-2 text-2xs">{[
          ['Next earnings · Yahoo estimate', market?.metrics.earningsDate], ['Target low', market?.targets.low], ['Target mean', market?.targets.mean], ['Target high', market?.targets.high], ['Upside to mean', market?.targets.upsideToMean], ['Analysts', market?.targets.analysts],
          ['Cash · latest Yahoo snapshot', compactCurrency(payload?.financials?.facts.totalCash)], ['Debt · latest Yahoo snapshot', compactCurrency(payload?.financials?.facts.totalDebt)],
        ].map(([label, value]) => <div key={label} className="flex gap-2 border-b border-border/60 py-1"><span className="flex-1 text-text-muted">{label}</span><span className="num text-text">{value || '--'}</span></div>)}</div>{laneStatus('financials')}
      </Panel>
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title={`AI semiconductor business · ${earnings?.period ?? '--'}`} className="h-[340px] min-w-0" warning={warning('earnings')}>
        <Metrics rows={earnings?.metrics.filter(row => /^ai/.test(row.id)) ?? []} empty={empty('earnings')} />
        <div className="min-h-0 flex-1 overflow-auto px-2 py-1 text-2xs text-text-muted">{earnings?.commentary.length ? earnings.commentary.map(paragraph => <p key={paragraph} className="pb-2">{paragraph}</p>) : 'Custom accelerator and networking commentary not disclosed.'}</div>{source}
      </Panel>
      <Panel title={`Revenue mix · ${earnings?.period ?? '--'}`} className="h-[340px] min-w-0" warning={warning('earnings')}>
        <div className="flex h-40 shrink-0 overflow-hidden" data-avgo-mix-chart><Donut compact slices={mix} centerSubtext="Revenue" centerText={earnings ? compactCurrency(metric('revenue')?.value) : '--'} /></div>
        <DataTable columns={[
          { key: 'name', header: 'Segment', cell: row => row.name, width: '40%', wrap: true }, { key: 'revenue', header: 'Revenue', cell: row => compactCurrency(row.revenue), align: 'right', numeric: true },
          { key: 'share', header: 'Mix', cell: row => plainPercent(row.share, 0), align: 'right', numeric: true }, { key: 'growth', header: 'YoY', cell: row => plainPercent(row.growth, 0), align: 'right', numeric: true },
        ]} rows={earnings?.segments ?? []} rowKey={row => row.name} layout="fixed" empty={empty('earnings')} />{source}
      </Panel>
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title="Quarterly financial trends · USD" className="h-[320px] min-w-0" warning={warning('financials')}>
        <div className="min-h-0 flex-1 p-2"><LineChart labels={history.dates} series={history.series.map((series, index) => ({ values: series.values, color: colorForIndex(index), label: { revenue: 'Revenue', netIncome: 'Net income', operatingCashFlow: 'Operating cash flow', freeCashFlow: 'Free cash flow' }[series.key] }))} format={compactCurrency} empty={empty('financials')} /></div>
        <div className="shrink-0 px-2 py-1 text-2xs text-text-muted">SEC/Yahoo statements · fiscal period end dates · free cash flow = operating cash flow − capex</div>{laneStatus('financials')}
      </Panel>
      <Panel title={`Results, cash flow & dividend · ${earnings?.period ?? '--'}`} className="h-[320px] min-w-0" warning={warning('earnings')}>
        <Metrics rows={earnings?.metrics.filter(row => !/^ai/.test(row.id)) ?? []} empty={empty('earnings')} />{source}{laneStatus('earnings')}
      </Panel>
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title={`Next-quarter guidance · ${earnings?.guidancePeriod ?? '--'}`} className="h-[300px] min-w-0" warning={warning('earnings')}>
        <Metrics rows={earnings?.guidance ?? []} empty={empty('earnings')} /><div className="shrink-0 px-2 py-1 text-2xs text-text-muted">Management outlook as of the release date; approximate and lower-bound disclosures retain their wording.</div>{source}
      </Panel>
      <Panel title="AVGO news" className="h-[300px] min-w-0" warning={warning('market')}>
        <DataTable columns={[
          { key: 'title', header: 'Headline', cell: row => <button className="text-left text-accent hover:underline" onClick={() => void api.openExternal(row.url)}>{row.title}</button>, wrap: true, width: '70%' }, { key: 'source', header: 'Source / date', cell: row => `${row.source} · ${new Date(row.publishedAt).toLocaleDateString()}`, wrap: true },
        ]} rows={market?.news ?? []} rowKey={row => row.id} layout="fixed" empty={market ? 'No recent AVGO headlines.' : empty('market')} />{laneStatus('market')}
      </Panel>
    </div>
    <Panel title="Broadcom SEC filings" className="h-[310px] shrink-0" warning={warning('financials')}>{payload?.financials ? <FilingsTable filings={payload.financials.sec.filings} compact /> : <PanelMessage>{empty('financials')}</PanelMessage>}</Panel>
  </div>
}
