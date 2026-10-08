import { effectiveFreshness, feedErrorText, useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import { useEffect, useMemo, useState } from 'react'
import type { LogicalRange } from 'lightweight-charts'
import { STOCKS_RANGE_PRESETS, type StocksRangePreset } from '@shared/contract'
import type { AmznBlock, AmznReport } from '@shared/amzn'
import { api } from '@/api/client'
import { useAmzn, useRefreshAmzn } from '@/api/amznQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { LineChart } from '@/components/charts/LineChart'
import { Donut, colorForIndex } from '@/components/charts/Donut'
import { StocksChart } from '@/components/stocks/StocksChart'
import { FilingsTable } from '@/components/fundamentals/FilingsTable'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { compactCurrency, currency, percent, plainPercent } from '@/lib/format'

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="min-w-0 border border-border bg-surface px-2 py-2 text-center"><div className="truncate text-2xs text-text-muted">{label}</div><div className="num my-1 truncate text-lg font-bold text-text">{value}</div><div className="truncate text-2xs text-text-muted" title={sub}>{sub}</div></div>
}
function Legend({ labels, colorIndices = labels.map((_, index) => index) }: { labels: string[]; colorIndices?: number[] }) {
  return <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 px-2 pb-2 text-2xs text-text-muted">{labels.map((label, index) => <span key={label} className="flex items-center gap-1"><span className="h-0.5 w-3" style={{ background: colorForIndex(colorIndices[index]) }} />{label}</span>)}</div>
}
const netCapex = (report: AmznReport | undefined) => report?.capex == null || report.capexProceeds == null ? null : report.capex - report.capexProceeds
const rangeText = (low: number | null | undefined, high: number | null | undefined) => low == null || high == null ? '--' : `${compactCurrency(low)} – ${compactCurrency(high)}`

export function AmznPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const query = useAmzn()
  const now = useSnapshotClock()
  const freshness = query.data ? effectiveFreshness(query.data, now, FRESHNESS.amzn) : 'unavailable'
  const refresh = useRefreshAmzn()
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [range, setRange] = useState<StocksRangePreset>('1Y')
  const [logicalRange, setLogicalRange] = useState<LogicalRange | null>(null)
  const payload = query.data?.data
  const market = payload?.market
  const latest = payload?.earnings?.reports[0]
  const reports = useMemo(() => [...(payload?.earnings?.reports ?? [])].sort((a, b) => a.period.localeCompare(b.period)), [payload?.earnings])
  const busy = query.isFetching || refreshing
  const warning = (block: AmznBlock) => query.data?.errors.filter(error => error.symbol === block).map(error => error.reason).join(' · ') || undefined
  const empty = (block: AmznBlock) => busy ? 'Loading Amazon data...' : warning(block) || query.error?.message || `${block} data unavailable`
  const reportSource = latest ? <button className="text-2xs text-accent hover:underline" onClick={() => void api.openExternal(latest.sourceUrl)}>Earnings release ↗</button> : null
  const mix = latest?.revenueCategories.every(category => category.revenue !== null)
    ? latest.revenueCategories.map(category => ({ label: category.name, value: category.revenue! })) : []
  useEffect(() => onStatusChange([{ label: 'AMZN', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: busy }], ''), [onStatusChange, query.data, busy])
  const onRefresh = async () => {
    setNotice('')
    setRefreshing(true)
    try { await refresh() } catch (error) { setNotice(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`) }
    finally { setRefreshing(false) }
  }
  const laneStatus = (block: AmznBlock) => {
    const time = payload?.laneFetchedAt[block]
    return <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">{block} · {payload?.progress[block] ?? (busy ? 'loading' : 'unavailable')}{time ? ` · fetched ${new Date(time).toLocaleString()}` : ''}</div>
  }
  const historyColumns: Array<Column<AmznReport>> = [
    { key: 'period', header: 'Quarter', cell: row => <button className="text-accent hover:underline" onClick={() => void api.openExternal(row.sourceUrl)}>{row.period} ↗</button>, width: '13%' },
    { key: 'revenue', header: 'Revenue', cell: row => compactCurrency(row.revenue), numeric: true, align: 'right' },
    { key: 'income', header: 'Operating income', cell: row => compactCurrency(row.operatingIncome), numeric: true, align: 'right', wrap: true },
    { key: 'eps', header: 'Diluted EPS', cell: row => currency(row.dilutedEps), numeric: true, align: 'right' },
    { key: 'cash', header: 'Operating cash flow', cell: row => compactCurrency(row.operatingCashFlow), numeric: true, align: 'right', wrap: true },
    { key: 'capex', header: 'Net cash capex', cell: row => compactCurrency(netCapex(row)), numeric: true, align: 'right', wrap: true },
    { key: 'fcf', header: 'Free cash flow', cell: row => compactCurrency(row.freeCashFlow), numeric: true, align: 'right', wrap: true },
  ]
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-auto p-2" data-amzn-page>
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      <h1 className="pr-2 text-sm font-semibold text-text">AMZN · Amazon.com</h1>
      <span className="ml-auto text-2xs text-text-muted" role="status">{busy ? 'Loading AMZN...' : query.error ? `AMZN load failed: ${query.error.message}` : `${freshness} · ${latest?.period ?? 'earnings unavailable'}`}</span>
      <Button variant="accent" disabled={busy} onClick={() => void onRefresh()}>{busy ? 'Refreshing...' : 'Refresh'}</Button>
      {['charts', 'fundamentals', 'options', 'valuation'].map(id => <Button key={id} className="capitalize" onClick={() => onNavigate(id, 'AMZN')}>{id}</Button>)}
      <Button onClick={() => void api.openExternal('https://ir.aboutamazon.com/overview/default.aspx')}>Investor relations</Button>
    </div>
    {(notice || query.error || query.data?.errors.length) ? <div role="alert" className="shrink-0 border border-warn/40 bg-surface px-2 py-1 text-2xs text-warn">{notice || query.error?.message || query.data?.errors.map(feedErrorText).join(' · ')}</div> : null}
    <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6">
      <Tile label="Share price" value={currency(market?.chart.stats.price)} sub={`USD · ${percent(market?.chart.stats.change)} daily · ${market?.chart.candles.at(-1) ? new Date(market.chart.candles.at(-1)!.time * 1000).toISOString().slice(0, 10) : '--'}`} />
      <Tile label="Market cap" value={market?.metrics.marketCap ?? '--'} sub="Yahoo Finance · market snapshot" />
      <Tile label="Quarterly revenue" value={compactCurrency(latest?.revenue)} sub={`${latest?.period ?? '--'} · GAAP · USD`} />
      <Tile label="Operating margin" value={plainPercent(latest?.operatingMargin, 1)} sub={`${latest?.period ?? '--'} · GAAP`} />
      <Tile label="Diluted EPS" value={currency(latest?.dilutedEps)} sub={`${latest?.period ?? '--'} · GAAP · USD/share`} />
      <Tile label="AWS revenue growth" value={percent(latest?.segments.find(segment => segment.name === 'AWS')?.revenueGrowth, 1)} sub={`${latest?.period ?? '--'} · year over year`} />
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-3">
      <Panel title="AMZN stock performance" className="h-[380px] min-w-0 xl:col-span-2" warning={warning('market')} actions={<div className="flex gap-1">{STOCKS_RANGE_PRESETS.map(preset => <Button key={preset} variant="toggle" active={range === preset} onClick={() => { setLogicalRange(null); setRange(preset) }}>{preset}</Button>)}</div>}>
        {market?.chart.candles.length ? <div className="flex min-h-0 flex-1" data-amzn-price-range={range}><StocksChart payload={market.chart} mfiEnabled={false} autoFollow={false} rangePreset={range} logicalRange={logicalRange} onLogicalRangeChange={setLogicalRange} onManualRange={() => setRange('')} onHoverCandle={() => {}} /></div> : <PanelMessage>{empty('market')}</PanelMessage>}{laneStatus('market')}
      </Panel>
      <Panel title="Valuation & balance sheet" className="h-[380px] min-w-0" warning={warning('financials') || warning('market')}>
        <div className="min-h-0 flex-1 overflow-auto p-2 text-2xs">{[
          ['Trailing P/E', market?.metrics.pe], ['Forward P/E · estimate', market?.metrics.forwardPe], ['Next earnings · Yahoo estimate', market?.metrics.earningsDate],
          ['Target mean · analyst estimate', market?.targets.mean], ['Target low / high', market ? `${market.targets.low} / ${market.targets.high}` : '--'], ['Upside to mean', market?.targets.upsideToMean],
          ['Cash · latest Yahoo snapshot', compactCurrency(payload?.financials?.facts.totalCash)], ['Debt · latest Yahoo snapshot', compactCurrency(payload?.financials?.facts.totalDebt)],
        ].map(([label, value]) => <div key={label} className="flex gap-2 border-b border-border/60 py-2"><span className="flex-1 text-text-muted">{label}</span><span className="num text-right text-text">{value || '--'}</span></div>)}</div>{laneStatus('financials')}
      </Panel>
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title={`Business segments · ${latest?.period ?? '--'}`} className="h-[360px] min-w-0" warning={warning('earnings')} actions={reportSource}>
        <DataTable columns={[
          { key: 'name', header: 'Segment', cell: row => row.name, width: '24%', wrap: true },
          { key: 'revenue', header: 'Revenue', cell: row => compactCurrency(row.revenue), numeric: true, align: 'right' },
          { key: 'growth', header: 'Revenue Y/Y', cell: row => percent(row.revenueGrowth, 1), numeric: true, align: 'right', wrap: true },
          { key: 'income', header: 'Operating income', cell: row => compactCurrency(row.operatingIncome), numeric: true, align: 'right', wrap: true },
          { key: 'margin', header: 'Operating margin', cell: row => plainPercent(row.operatingMargin, 1), numeric: true, align: 'right', wrap: true },
        ]} rows={latest?.segments ?? []} rowKey={row => row.name} layout="fixed" empty={empty('earnings')} />
        <div className="flex min-h-0 flex-1 flex-col p-2" data-amzn-chart><LineChart labels={reports.map(report => report.period)} series={['AWS', 'North America', 'International'].map((name, index) => ({ label: `${name} margin`, color: colorForIndex(index), values: reports.map(report => report.segments.find(segment => segment.name === name)?.operatingMargin ?? null) }))} format={value => plainPercent(value, 1)} ticks={3} empty={empty('earnings')} /></div>
        <Legend labels={['AWS', 'North America', 'International']} />
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">Official segment basis · revenue and income in USD · quarterly GAAP margins</div>
      </Panel>
      <Panel title={`Revenue categories · ${latest?.period ?? '--'}`} className="h-[360px] min-w-0" warning={warning('earnings')} actions={reportSource}>
        <div className="flex min-h-0 flex-1 flex-col p-2"><Donut slices={mix} compact centerText={compactCurrency(latest?.revenue)} centerSubtext="Quarterly net sales" empty={latest ? 'Complete revenue composition unavailable.' : empty('earnings')} /></div>
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">Revenue categories are a separate breakdown from geographic segments · USD</div>
      </Panel>
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title="Eight-quarter financial trends · USD" className="h-[300px] min-w-0" warning={warning('earnings')}>
        <div className="flex min-h-0 flex-1 flex-col p-2" data-amzn-chart><LineChart labels={reports.map(report => report.period)} series={(['revenue', 'operatingIncome', 'netIncome'] as const).map((key, index) => ({ label: { revenue: 'Revenue', operatingIncome: 'Operating income', netIncome: 'Net income' }[key], color: colorForIndex(index), values: reports.map(report => report[key]) }))} format={compactCurrency} empty={empty('earnings')} /></div>
        <Legend labels={['Revenue', 'Operating income', 'Net income']} />
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">Quarterly GAAP results · net income includes non-operating gains and losses</div>
      </Panel>
      <Panel title="Cash flow & capital investment · USD" className="h-[300px] min-w-0" warning={warning('earnings')}>
        <div className="flex min-h-0 flex-1 flex-col p-2" data-amzn-chart><LineChart labels={reports.map(report => report.period)} series={[
          { label: 'Operating cash flow', color: colorForIndex(0), values: reports.map(report => report.operatingCashFlow) },
          { label: 'Net cash capex', color: colorForIndex(2), values: reports.map(report => netCapex(report)) },
          { label: 'Free cash flow', color: colorForIndex(1), values: reports.map(report => report.freeCashFlow) },
        ]} format={compactCurrency} empty={empty('earnings')} /></div>
        <Legend labels={['Operating cash flow', 'Net cash capex', 'Free cash flow']} colorIndices={[0, 2, 1]} />
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">Quarterly FCF = operating cash flow − purchases of property and equipment + sales proceeds and incentives</div>
      </Panel>
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title={`Trailing cash flow · through ${latest?.period ?? '--'}`} className="h-[290px] min-w-0" warning={warning('earnings')} actions={reportSource}>
        <div className="grid shrink-0 grid-cols-3 gap-2 p-2"><Tile label="Operating cash flow" value={compactCurrency(latest?.ttmOperatingCashFlow)} sub="Trailing twelve months" /><Tile label="Net cash capex" value={compactCurrency(latest?.ttmNetCapex)} sub="Trailing twelve months" /><Tile label="Free cash flow" value={compactCurrency(latest?.ttmFreeCashFlow)} sub="Trailing twelve months" /></div>
        <DataTable columns={[
          { key: 'name', header: 'Revenue category', cell: row => row.name, width: '50%', wrap: true },
          { key: 'revenue', header: 'Quarterly revenue', cell: row => compactCurrency(row.revenue), numeric: true, align: 'right', wrap: true },
          { key: 'growth', header: 'Y/Y', cell: row => percent(row.revenueGrowth, 1), numeric: true, align: 'right' },
        ]} rows={latest?.revenueCategories ?? []} rowKey={row => row.name} layout="fixed" empty={empty('earnings')} />
      </Panel>
      <Panel title={`Management guidance · ${latest?.guidance.period || '--'}`} className="h-[290px] min-w-0" warning={warning('earnings')} actions={reportSource}>
        <div className="min-h-0 flex-1 overflow-auto p-2 text-2xs"><div className="grid grid-cols-2 gap-2"><Tile label="Net sales outlook" value={rangeText(latest?.guidance.revenueLow, latest?.guidance.revenueHigh)} sub="Management range · USD" /><Tile label="Operating income outlook" value={rangeText(latest?.guidance.operatingIncomeLow, latest?.guidance.operatingIncomeHigh)} sub="Management range · USD" /></div><p className="mt-3 leading-relaxed text-text-muted">{latest?.guidance.notes || empty('earnings')}</p></div>
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">Published {latest?.publishedAt ?? '--'} · forward-looking management guidance</div>
      </Panel>
    </div>
    <Panel title="Quarterly financial history · USD" className="h-[340px] shrink-0 min-w-0" warning={warning('earnings')}>
      <DataTable columns={historyColumns} rows={[...reports].reverse()} rowKey={row => row.period} layout="fixed" empty={empty('earnings')} />{laneStatus('earnings')}
    </Panel>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title="AMZN news" className="h-[310px] min-w-0" warning={warning('market')}>
        <DataTable columns={[
          { key: 'title', header: 'Headline', cell: row => <button className="text-left text-accent hover:underline" onClick={() => void api.openExternal(row.url)}>{row.title}</button>, wrap: true, width: '70%' },
          { key: 'source', header: 'Source / date', cell: row => `${row.source} · ${new Date(row.publishedAt).toLocaleDateString()}`, wrap: true },
        ]} rows={market?.news ?? []} rowKey={row => row.id} layout="fixed" empty={market ? 'No recent AMZN headlines.' : empty('market')} />
      </Panel>
      <Panel title="Amazon SEC filings" className="h-[310px] min-w-0" warning={warning('financials')}>
        {payload?.financials ? <FilingsTable filings={payload.financials.sec.filings} compact /> : <PanelMessage>{empty('financials')}</PanelMessage>}
      </Panel>
    </div>
  </div>
}
