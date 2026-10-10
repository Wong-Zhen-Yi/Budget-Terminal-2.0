import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import { useEffect, useMemo, useState } from 'react'
import { STOCKS_RANGE_PRESETS } from '@shared/contract'
import type { StocksRangePreset } from '@shared/contract'
import { hoodHistory, hoodRevenueMix } from '@shared/hood'
import type { HoodBlock, HoodMetric, HoodReport } from '@shared/hood'
import { useHood, useRefreshHood } from '@/api/hoodQueries'
import { api } from '@/api/client'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { LineChart } from '@/components/charts/LineChart'
import { CandlestickChart } from '@/components/charts/CandlestickChart'
import { Donut, colorForIndex } from '@/components/charts/Donut'
import { FilingsTable } from '@/components/fundamentals/FilingsTable'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'

const amount = (value: number | null | undefined, money = false) => {
  if (value == null || !Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  const scale = magnitude >= 1e9 ? 1e9 : magnitude >= 1e6 ? 1e6 : magnitude >= 1e3 ? 1e3 : 1
  const suffix = scale === 1e9 ? 'B' : scale === 1e6 ? 'M' : scale === 1e3 ? 'K' : ''
  return `${value < 0 ? '-' : ''}${money ? '$' : ''}${(magnitude / scale).toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix}`
}
const metricValue = (metric: HoodMetric | undefined, value = metric?.value) => amount(value, metric?.unit !== 'count')
const reportPeriod = (report: HoodReport | null | undefined, quarterly = false) => report
  ? quarterly ? `${report.period.slice(0, 4)} Q${Number(report.period.slice(5)) / 3}` : new Date(`${report.period}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  : 'Unavailable'
const findMetric = (report: HoodReport | null | undefined, id: string) => report?.metrics.find(metric => metric.id === id)

function Source({ report }: { report: HoodReport | null | undefined }) {
  return <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border p-2 text-2xs text-text-muted">
    {report ? <><button className="text-accent hover:underline" onClick={() => { void api.openExternal(report.sourceUrl) }}>Robinhood report ↗</button><span>Published {report.publishedAt || 'date unavailable'}</span><span>Period {report.period}</span></> : <span>Robinhood report unavailable · use Refresh to retry.</span>}
  </div>
}

function MetricsTable({ report, quarterly = false }: { report: HoodReport | null | undefined; quarterly?: boolean }) {
  return <div className="overflow-auto"><table className="w-full text-2xs"><thead className="bg-surface-raised text-text-muted"><tr>
    <th className="p-2 text-left font-normal">Metric</th><th className="p-2 text-right font-normal">{reportPeriod(report, quarterly)}</th>
    <th className="p-2 text-right font-normal">{report?.previousPeriod ?? 'Previous'}</th><th className="p-2 text-right font-normal">{quarterly ? 'Q/Q' : 'M/M'}</th>
    <th className="p-2 text-right font-normal">{report?.yearAgoPeriod ?? 'Year ago'}</th><th className="p-2 text-right font-normal">Y/Y</th>
  </tr></thead><tbody>{report?.metrics.map(metric => <tr key={metric.id} className="border-t border-border/50 hover:bg-surface-raised">
    <td className="p-2 text-text-muted">{metric.label}{metric.unit === 'USD/share' ? ' ($/share)' : metric.unit === 'USD/user' ? ' ($/user)' : ''}</td>
    <td className="num p-2 text-right font-semibold" title={metric.value === null ? 'Unavailable' : `${metric.value.toLocaleString('en-US')} ${metric.unit}`}>{metricValue(metric)}</td><td className="num p-2 text-right">{metricValue(metric, metric.previous)}</td><td className="num p-2 text-right">{metric.change || '—'}</td>
    <td className="num p-2 text-right">{metricValue(metric, metric.yearAgo)}</td><td className="num p-2 text-right">{metric.yearChange || '—'}</td>
  </tr>)}</tbody></table>{!report ? <PanelMessage>Report metrics unavailable.</PanelMessage> : null}</div>
}

export function HoodPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const query = useHood()
  const now = useSnapshotClock()
  const freshness = query.data ? effectiveFreshness(query.data, now, FRESHNESS.hood) : 'unavailable'
  const refresh = useRefreshHood()
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [range, setRange] = useState<StocksRangePreset>('1Y')
  const data = query.data?.data
  const busy = refreshing || query.isFetching
  const warning = (block: HoodBlock) => query.data?.errors.filter(error => error.symbol === block).map(error => error.reason).join(' · ') || undefined
  const stats = data?.market?.chart.stats
  const history = useMemo(() => hoodHistory(data?.financials ?? null), [data?.financials])
  const mix = useMemo(() => hoodRevenueMix(data?.quarterly ?? null), [data?.quarterly])
  const candles = useMemo(() => {
    const all = data?.market?.chart.candles ?? []
    const end = all.at(-1)
    if (!end || range === '3Y') return all
    const start = new Date(end.time * 1000)
    start.setUTCMonth(start.getUTCMonth() - ({ '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[range || '1Y']))
    return all.filter(candle => candle.time * 1000 >= start.getTime())
  }, [data?.market?.chart.candles, range])
  const dates = useMemo(() => candles.map(candle => new Date(candle.time * 1000).toISOString().slice(0, 10)), [candles])
  useEffect(() => onStatusChange([{ label: 'HOOD', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: busy }], ''), [query.data, busy, onStatusChange])
  const onRefresh = async () => {
    setNotice('')
    setRefreshing(true)
    try { await refresh() } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) } finally { setRefreshing(false) }
  }
  const tiles = [
    ['Funded customers', metricValue(findMetric(data?.monthly, 'customers')), reportPeriod(data?.monthly)],
    ['Total platform assets', metricValue(findMetric(data?.monthly, 'assets')), reportPeriod(data?.monthly)],
    ['Net deposits · monthly', metricValue(findMetric(data?.monthly, 'deposits')), reportPeriod(data?.monthly)],
    ['Revenue · quarterly', metricValue(findMetric(data?.quarterly, 'revenue')), reportPeriod(data?.quarterly, true)],
    ['Gold subscribers', metricValue(findMetric(data?.quarterly, 'gold')), reportPeriod(data?.quarterly, true)],
    ['Diluted EPS', metricValue(findMetric(data?.quarterly, 'eps')), reportPeriod(data?.quarterly, true)],
  ]
  return <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2" data-hood-page>
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <h1 className="text-sm font-semibold">HOOD · Robinhood Markets</h1>
      <span className="num text-sm font-bold">{amount(stats?.price, true)}</span>
      <span className={`num text-xs ${stats && stats.change >= 0 ? 'text-up' : 'text-down'}`}>{stats ? `${stats.change >= 0 ? '+' : ''}${stats.change.toFixed(2)}%` : '—'}</span>
      <span className="text-2xs text-text-muted">Market cap {amount(data?.financials?.facts.marketCap, true)}</span>
      <Button className="ml-auto" variant="accent" disabled={busy} onClick={onRefresh}>{busy ? 'Loading HOOD…' : 'Refresh'}</Button>
      {['charts', 'fundamentals', 'options', 'valuation'].map(id => <Button key={id} className="capitalize" onClick={() => onNavigate(id, 'HOOD')}>{id}</Button>)}
    </div>
    <div className="shrink-0 text-2xs text-text-muted">{busy ? 'Loading Robinhood dashboard…' : `${freshness} · fetched ${data?.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : 'unavailable'}`} · USD · market price from daily bars{stats && data?.market?.chart.candles.at(-1) ? ` as of ${new Date(data.market.chart.candles.at(-1)!.time * 1000).toISOString().slice(0, 10)}` : ''}</div>
    {(notice || query.error || query.data?.errors.length) ? <div role="status" className="shrink-0 border border-warn/40 bg-surface p-2 text-xs text-warn">{notice || query.error?.message || query.data?.meta.failureReason}</div> : null}
    <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6">{tiles.map(([label, value, period]) => <div key={label} className="border border-border bg-surface p-3 text-center"><div className="text-2xs text-text-muted">{label}</div><div className="num my-1 text-lg font-bold">{value}</div><div className="text-2xs text-text-muted">{period}</div></div>)}</div>
    <div className="grid shrink-0 gap-2 xl:grid-cols-[2fr_1fr]">
      <Panel title="Stock performance · HOOD" warning={warning('market')} className="h-[430px]" actions={STOCKS_RANGE_PRESETS.map(preset => <Button key={preset} variant="toggle" active={range === preset} onClick={() => setRange(preset)}>{preset}</Button>)}>
        <div className="flex min-h-0 flex-[3] flex-col overflow-hidden p-2" data-hood-price-range={range} data-hood-candle-count={candles.length}>
          {data?.market?.chart.candles.length ? <CandlestickChart candles={candles} /> : <PanelMessage>{busy ? 'Loading price history…' : 'Price history unavailable.'}</PanelMessage>}
        </div>
        <div className="border-t border-border px-2 pt-1 text-2xs text-text-muted">Daily trading volume · shares</div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2"><LineChart labels={dates} series={[{ label: 'Volume', values: candles.map(candle => candle.volume), color: colorForIndex(1) }]} format={value => amount(value)} ticks={4} empty="Volume unavailable." /></div>
      </Panel>
      <Panel title={`Revenue composition · ${reportPeriod(data?.quarterly, true)}`} warning={warning('quarterly')} className="h-[430px]">
        <div className="flex min-h-0 flex-1 p-2"><Donut slices={mix} compact centerText={metricValue(findMetric(data?.quarterly, 'revenue'))} centerSubtext="Total net revenue" empty="Complete revenue composition unavailable." /></div>
        <p className="px-2 pb-2 text-2xs text-text-muted">Transaction breakdown appears in Quarterly results below. Categories are shown once in this allocation.</p>
        <Source report={data?.quarterly} />
      </Panel>
    </div>
    <div className="grid shrink-0 gap-2 xl:grid-cols-2">
      <Panel title={`Operating metrics · ${reportPeriod(data?.monthly)}`} warning={warning('monthly')}><MetricsTable report={data?.monthly} /><Source report={data?.monthly} /></Panel>
      <Panel title={`Quarterly results · ${reportPeriod(data?.quarterly, true)}`} warning={warning('quarterly')}><MetricsTable report={data?.quarterly} quarterly /><Source report={data?.quarterly} /></Panel>
    </div>
    {data?.monthly?.notes.length ? <p className="shrink-0 p-1 text-2xs text-text-muted">{data.monthly.notes.join(' ')}</p> : null}
    <Panel title="Financial history · latest eight available quarters" warning={warning('financials')} className="shrink-0">
      <div className="flex h-[240px] flex-col p-2"><LineChart labels={history.map(row => row.endDate)} series={[
        { label: 'Revenue', values: history.map(row => row.revenue), color: colorForIndex(0) },
        { label: 'Net income', values: history.map(row => row.netIncome), color: colorForIndex(1) },
      ]} format={value => amount(value, true)} empty={busy ? 'Loading financial history…' : 'Financial history unavailable.'} /></div>
      <div className="overflow-auto"><table className="w-full text-2xs"><thead className="bg-surface-raised text-text-muted"><tr>{['Quarter ended', 'Revenue · USD', 'Net income · USD', 'Operating cash flow · USD', 'Shares outstanding'].map(label => <th key={label} className="p-2 text-right font-normal">{label}</th>)}</tr></thead><tbody>{history.map(row => <tr key={row.endDate} className="num border-t border-border/50 text-right"><td className="p-2">{row.endDate}</td><td className="p-2">{amount(row.revenue, true)}</td><td className="p-2">{amount(row.netIncome, true)}</td><td className="p-2">{amount(row.operatingCashFlow, true)}</td><td className="p-2">{amount(row.sharesOutstanding)}</td></tr>)}</tbody></table></div>
      <p className="p-2 text-2xs text-text-muted">SEC EDGAR statements with Yahoo fallback · gaps mean unavailable data, not zero. Period-end shares only.</p>
    </Panel>
    <div className="grid shrink-0 gap-2 xl:grid-cols-2">
      <Panel title="HOOD news" warning={warning('market')} className="h-[340px]"><div className="overflow-auto">{data?.market?.news.length ? data.market.news.slice(0, 15).map(row => <button key={row.id || row.url} className="block w-full border-b border-border/50 p-3 text-left text-2xs hover:bg-surface-raised" onClick={() => { void api.openExternal(row.url) }}><div className="text-text">{row.title} ↗</div><div className="mt-1 text-text-muted">{row.source} · {row.publishedAt ? new Date(row.publishedAt).toLocaleString() : 'Date unavailable'}</div></button>) : <PanelMessage>{busy ? 'Loading headlines…' : 'No headlines available.'}</PanelMessage>}</div></Panel>
      <Panel title="SEC filings · HOOD" warning={warning('financials')} className="h-[340px]"><FilingsTable filings={data?.financials?.sec.filings ?? []} compact /></Panel>
    </div>
  </div>
}
