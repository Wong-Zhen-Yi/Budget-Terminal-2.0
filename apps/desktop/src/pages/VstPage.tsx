import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LogicalRange } from 'lightweight-charts'
import { STOCKS_RANGE_PRESETS } from '@shared/contract'
import type { StocksRangePreset } from '@shared/contract'
import { periodLabel, seriesBarGeometry } from '@shared/fundamentalsPage'
import type { FundamentalsChartModel } from '@shared/fundamentalsPage'
import { VST_BLOCKS, vstHistory, buildVstSnapshot } from '@shared/vst'
import type { VstBlock } from '@shared/vst'
import { api } from '@/api/client'
import { useVst, useRefreshVst } from '@/api/vstQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Donut, colorForIndex } from '@/components/charts/Donut'
import { StocksChart } from '@/components/stocks/StocksChart'
import { FilingsTable } from '@/components/fundamentals/FilingsTable'
import { FundamentalsBarChart, FundamentalsChartLegend } from '@/components/fundamentals/FundamentalsBarChart'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { compactCurrency, currency, integer, percent, plainPercent } from '@/lib/format'

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="min-w-0 border border-border bg-surface px-2 py-2 text-center"><div className="truncate text-2xs text-text-muted" title={label}>{label}</div><div className="num truncate text-base font-bold text-text" title={value}>{value}</div><div className="truncate text-2xs text-text-muted" title={sub}>{sub}</div></div>
}

export function VstPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const query = useVst()
  const refresh = useRefreshVst()
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [range, setRange] = useState<StocksRangePreset>('1Y')
  const [logicalRange, setLogicalRange] = useState<LogicalRange | null>(null)
  const payload = query.data?.data
  const market = payload?.market
  const earnings = payload?.earnings
  const operations = payload?.operations
  const busy = query.isFetching || refreshing
  const financialChart = useMemo<FundamentalsChartModel | null>(() => {
    const financials = payload?.financials
    if (!financials) return null
    const history = vstHistory(financials)
    const labels = history.dates.map(date => periodLabel(date, 'quarterly'))
    const geometry = seriesBarGeometry(history.series.length)
    const names = { revenue: 'Revenue', netIncome: 'Net income', operatingCashFlow: 'Operating cash flow', freeCashFlow: 'Free cash flow' }
    return {
      title: 'Quarterly financial trends · USD',
      labels,
      availablePeriods: labels.length,
      indexed: false,
      growthBasis: 'year_ago',
      series: history.series.map((series, index) => ({
        metric: series.key,
        name: names[series.key],
        legendName: names[series.key],
        filled: true,
        ...geometry[index],
        points: history.dates.flatMap((date, slot) => {
          const point = financials.quarterly[series.key].find(point => point.endDate === date)
          return point && Number.isFinite(point.value) ? [{
            ...point,
            label: labels[slot],
            rawValue: point.value,
            growth: null,
            growthBaseline: '',
            indexed: false,
            indexedBaseLabel: '',
            slot,
          }] : []
        }),
      })),
    }
  }, [payload?.financials])
  useEffect(() => onStatusChange([{ label: 'VST', envelope: query.data, loading: busy }], ''), [onStatusChange, query.data, busy])
  const warning = (block: VstBlock) => query.data?.errors.filter(error => error.symbol === block).map(error => error.reason).join(' · ') || undefined
  const empty = (block: VstBlock) => busy ? 'Loading Vistra data...' : warning(block) || query.error?.message || `${block} data unavailable`
  const metric = (id: string) => earnings?.metrics.find(row => row.id === id)?.value
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    setNotice('')
    try { await refresh() } catch (error) { setNotice(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`) }
    finally { setRefreshing(false) }
  }, [refresh])
  const onExport = async () => {
    if (!payload) return
    try {
      await api.writeClipboard(buildVstSnapshot(payload))
      setNotice('VST snapshot copied to clipboard.')
    }
    catch (error) { setNotice(`Export failed: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const laneStatus = (block: VstBlock) => <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">
    {block} · {payload?.progress[block] ?? (busy ? 'loading' : 'unavailable')}{payload?.laneFetchedAt[block] ? ` · fetched ${new Date(payload.laneFetchedAt[block]).toLocaleString()}` : ''}
  </div>
  const source = earnings ? <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t border-border px-2 py-1 text-2xs text-text-muted">
    <button className="text-accent hover:underline" onClick={() => void api.openExternal(earnings.sourceUrl)}>Earnings release</button>
    <span>{earnings.period} · ended {earnings.periodEnd} · published {earnings.publishedAt || '--'}</span>
  </div> : null
  const operationsSource = operations ? <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t border-border px-2 py-1 text-2xs text-text-muted">
    <button className="text-accent hover:underline" onClick={() => void api.openExternal(operations.sourceUrl)}>Quarterly filing</button>
    <span>{operations.period} · ended {operations.periodEnd} · filed {operations.publishedAt}</span>
  </div> : null
  const status = notice || (busy ? 'Loading VST...' : query.error ? `VST load failed: ${query.error.message}` : query.data ? `${query.data.meta.freshness} · ${earnings?.period ?? 'earnings unavailable'}` : 'VST data unavailable')

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-auto p-2" data-vst-page>
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      <h1 className="pr-2 text-sm font-semibold text-text">VST — Vistra Energy</h1>
      <span className="ml-auto text-2xs text-text-muted" role="status">{status}</span>
      <Button variant="accent" disabled={busy} onClick={() => void onRefresh()}>{busy ? 'Refreshing...' : 'Refresh'}</Button>
      <Button disabled={!payload || VST_BLOCKS.every(block => payload.progress[block] === 'unavailable')} onClick={() => void onExport()}>Export snapshot</Button>
      <Button onClick={() => onNavigate('charts', 'VST')}>Charts</Button><Button onClick={() => onNavigate('fundamentals', 'VST')}>Fundamentals</Button>
      <Button onClick={() => void api.openExternal('https://investor.vistracorp.com/')}>Investor relations</Button>
    </div>
    {query.data?.errors.length ? <div role="alert" className="shrink-0 border border-warn/40 bg-surface px-2 py-1 text-2xs text-warn">{query.data.errors.map(error => `${error.symbol}: ${error.reason}`).join(' · ')}</div> : null}
    <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
      <Tile label="Share price" value={currency(market?.chart.stats.price)} sub={`USD · ${percent(market?.chart.stats.change)} daily`} />
      <Tile label="Market cap" value={market?.metrics.marketCap ?? '--'} sub="Yahoo Finance · market" />
      <Tile label="Forward P/E" value={market?.metrics.forwardPe ?? '--'} sub="Yahoo Finance · estimate" />
      <Tile label="Ongoing ops. adjusted EBITDA" value={compactCurrency(metric('ebitda'))} sub={`${earnings?.period ?? '--'} · non-GAAP`} />
      <Tile label="Adjusted EBITDA growth" value={plainPercent(metric('ebitdaGrowth'), 1)} sub={`${earnings?.period ?? '--'} · YoY`} />
      <Tile label="Quarterly net income" value={compactCurrency(metric('netIncome'))} sub={`${earnings?.period ?? '--'} · GAAP`} />
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-3">
      <Panel title="VST stock performance" className="h-[340px] min-w-0 xl:col-span-2" warning={warning('market')} actions={<div className="flex gap-1">{STOCKS_RANGE_PRESETS.map(preset => <Button key={preset} variant="toggle" active={range === preset} onClick={() => { setLogicalRange(null); setRange(preset) }}>{preset}</Button>)}</div>}>
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
      <Panel title={`Retail & generation EBITDA · ${earnings?.period ?? '--'}`} className="h-[310px] min-w-0" warning={warning('earnings')}>
        <DataTable columns={[
          { key: 'name', header: 'Segment', cell: row => row.name, width: '35%', wrap: true },
          { key: 'ebitda', header: 'Adj. EBITDA', cell: row => compactCurrency(row.ebitda), align: 'right', numeric: true },
          { key: 'prior', header: 'Year ago', cell: row => compactCurrency(row.yearAgo), align: 'right', numeric: true },
          { key: 'growth', header: 'YoY', cell: row => plainPercent(row.growth, 1), align: 'right', numeric: true },
        ]} rows={earnings?.segments ?? []} rowKey={row => row.name} layout="fixed" empty={empty('earnings')} />
        <div className="shrink-0 px-2 py-1 text-2xs text-text-muted">Non-GAAP · USD · ongoing operations excludes Asset Closure. YoY shown where prior EBITDA is positive.</div>{source}
      </Panel>
      <Panel title="Annual management guidance" className="h-[310px] min-w-0" warning={warning('earnings')}>
        <DataTable columns={[
          { key: 'label', header: 'Metric', cell: row => row.label, width: '46%', wrap: true },
          { key: 'year', header: 'Year', cell: row => row.year },
          { key: 'range', header: 'Range · USD millions', align: 'right', cell: row => `${currency(row.low / 1e6, 0)} – ${currency(row.high / 1e6, 0)}`, wrap: true },
        ]} rows={earnings?.guidance ?? []} rowKey={row => row.label} layout="fixed" empty={empty('earnings')} />
        <div className="shrink-0 px-2 py-1 text-2xs text-text-muted">Non-GAAP · FCFbG = adjusted free cash flow before growth. Outlook as of the release date; see the release for assumptions and exclusions.</div>{source}
      </Panel>
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title={`Energy revenue breakdown · ${operations?.period ?? '--'}`} className="h-[440px] min-w-0" warning={warning('operations')}>
        <DataTable columns={[
          { key: 'label', header: 'Revenue category', cell: row => row.label, width: '70%', wrap: true },
          { key: 'value', header: 'USD millions', align: 'right', numeric: true, cell: row => currency(row.value / 1e6, 0) },
        ]} rows={operations?.revenues ?? []} rowKey={row => row.id} layout="fixed" empty={empty('operations')} />
        <div className="flex shrink-0 justify-between border-t border-border px-2 py-1 text-2xs"><span>Consolidated revenue</span><span className="num font-semibold">{currency(operations ? operations.totalRevenue / 1e6 : null, 0)} million</span></div>
        <div className="shrink-0 px-2 py-1 text-2xs text-text-muted">Consolidated amounts after intersegment eliminations · hedging includes gains and losses.</div>{operationsSource}
      </Panel>
      <Panel title={`Energy types · generation mix · ${operations?.period ?? '--'}`} className="h-[440px] min-w-0" warning={warning('operations')}>
        <div className="shrink-0 px-2 pt-2 text-2xs text-text-muted">Vistra does not disclose revenue by fuel type. The mix below shows reported production volumes.</div>
        {operations ? <div className="flex h-36 shrink-0 overflow-hidden" data-vst-generation-chart><Donut compact
          slices={operations.generation.flatMap((row, index) => row.gwh === null ? [] : [{ label: row.name, value: row.gwh, color: colorForIndex(index) }])}
          centerText={integer(operations.totalGenerationGwh)} centerSubtext="GWh" /></div> : null}
        <DataTable columns={[
          { key: 'name', header: 'Energy type', cell: row => row.name, width: '29%', wrap: true },
          { key: 'gwh', header: 'GWh', cell: row => integer(row.gwh), align: 'right', numeric: true },
          { key: 'share', header: 'Mix', cell: row => plainPercent(row.share, 1), align: 'right', numeric: true },
          { key: 'revenue', header: 'Fuel revenue', cell: () => 'Not disclosed', wrap: true, width: '29%' },
        ]} rows={operations?.generation ?? []} rowKey={row => row.name} layout="fixed" empty={empty('operations')} />
        <div className="shrink-0 px-2 py-1 text-2xs text-text-muted">Production summed across Texas, East and West. Mix uses disclosed GWh; battery output is not separately reported.</div>{operationsSource}
      </Panel>
    </div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title="Quarterly financial trends · USD" className="h-[320px] min-w-0" warning={warning('financials')}>
        {financialChart ? <div className="shrink-0" data-vst-financial-legend><FundamentalsChartLegend model={financialChart} /></div> : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2" data-vst-financial-chart>{financialChart ? <FundamentalsBarChart model={financialChart} /> : <PanelMessage>{empty('financials')}</PanelMessage>}</div>
        <div className="shrink-0 px-2 py-1 text-2xs text-text-muted">SEC/Yahoo statements · fiscal quarters · free cash flow = operating cash flow − capex</div>{laneStatus('financials')}
      </Panel>
      <Panel title="Expected generation hedged" className="h-[320px] min-w-0" warning={warning('earnings')}>
        <div className="min-h-0 flex-1 overflow-auto p-3">{earnings?.hedges.length ? earnings.hedges.map(hedge => <div key={hedge.year} className="mb-4">
          <div className="mb-1 flex justify-between text-2xs"><span>{hedge.year}</span><span className="num">Approximately {plainPercent(hedge.percent, 0)}</span></div>
          <div className="h-3 bg-surface-raised"><div className="h-full bg-accent" style={{ width: `${hedge.percent}%` }} /></div>
        </div>) : <div className="text-2xs text-text-muted">{empty('earnings')}</div>}</div>
        <div className="shrink-0 px-2 py-1 text-2xs text-text-muted">Hedges as of {earnings?.hedgeAsOf || '--'} · reported expected generation volumes</div>{source}
      </Panel>
    </div>
    <Panel title="VST news" className="h-[300px] shrink-0" warning={warning('market')}>
      <DataTable columns={[
        { key: 'title', header: 'Headline', cell: row => <button className="text-left text-accent hover:underline" onClick={() => void api.openExternal(row.url)}>{row.title}</button>, wrap: true, width: '70%' },
        { key: 'source', header: 'Source / date', cell: row => `${row.source} · ${new Date(row.publishedAt).toLocaleDateString()}`, wrap: true },
      ]} rows={market?.news ?? []} rowKey={row => row.id} layout="fixed" empty={market ? 'No recent VST headlines.' : empty('market')} />{laneStatus('market')}
    </Panel>
    <Panel title="Vistra SEC filings" className="h-[310px] shrink-0" warning={warning('financials')}>{payload?.financials ? <FilingsTable filings={payload.financials.sec.filings} compact /> : <PanelMessage>{empty('financials')}</PanelMessage>}</Panel>
  </div>
}
