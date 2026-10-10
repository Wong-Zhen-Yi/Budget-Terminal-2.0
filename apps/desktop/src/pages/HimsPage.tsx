import { effectiveFreshness, feedErrorText, useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import { useEffect, useMemo, useState } from 'react'
import { STOCKS_RANGE_PRESETS } from '@shared/contract'
import type { StocksRangePreset } from '@shared/contract'
import { HIMS_METRICS, himsGrowth, himsMargin, himsRevenueMix } from '@shared/hims'
import type { HimsBlock, HimsMetricId, HimsReport } from '@shared/hims'
import { useHims, useRefreshHims } from '@/api/himsQueries'
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
  return `${value < 0 ? '-' : ''}${money ? '$' : ''}${(magnitude / scale).toLocaleString('en-US', { maximumFractionDigits: 2 })}${scale === 1e9 ? 'B' : scale === 1e6 ? 'M' : scale === 1e3 ? 'K' : ''}`
}
const percent = (value: number | null | undefined, signed = false) => value == null || !Number.isFinite(value) ? '—' : `${signed && value > 0 ? '+' : ''}${value.toFixed(1)}%`
const valueOf = (report: HimsReport | null | undefined, id: HimsMetricId) => report?.metrics[id].value ?? null
const metricAmount = (id: HimsMetricId, value: number | null | undefined) => amount(value, HIMS_METRICS.find(spec => spec.id === id)?.unit !== 'count')

function Legend({ labels }: { labels: string[] }) {
  return <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 px-2 pb-2 text-2xs text-text-muted">{labels.map((label, index) => <span key={label} className="flex items-center gap-1"><span className="h-0.5 w-3" style={{ background: colorForIndex(index) }} />{label}</span>)}</div>
}

function Source({ report }: { report: HimsReport | null | undefined }) {
  return <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border p-2 text-2xs text-text-muted">
    {report ? <><button className="text-accent hover:underline" onClick={() => { void api.openExternal(report.sourceUrl) }}>Hims & Hers earnings release ↗</button>{report.supplementalSourceUrl ? <button className="text-accent hover:underline" onClick={() => { void api.openExternal(report.supplementalSourceUrl!) }}>Supplemental SEC metrics ↗</button> : null}<span>{report.period} · published {report.publishedAt || 'date unavailable'}</span></> : <span>Earnings release unavailable · Refresh to retry.</span>}
  </div>
}

function MetricsTable({ report, ids }: { report: HimsReport | undefined; ids: HimsMetricId[] }) {
  return <div className="overflow-auto"><table className="w-full text-2xs"><thead className="bg-surface-raised text-text-muted"><tr>
    <th className="p-2 text-left font-normal">Metric</th><th className="p-2 text-right font-normal">{report?.period ?? 'Current quarter'}</th><th className="p-2 text-right font-normal">Year-ago quarter</th><th className="p-2 text-right font-normal">Y/Y</th>
  </tr></thead><tbody>{ids.map(id => {
    const spec = HIMS_METRICS.find(entry => entry.id === id)!
    const metric = report?.metrics[id]
    const growth = himsGrowth(metric?.value, metric?.yearAgo)
    return <tr key={id} className="border-t border-border/50 hover:bg-surface-raised">
      <td className="p-2 text-text-muted">{spec.label}</td><td className="num p-2 text-right font-semibold" title={metric?.value == null ? 'Unavailable' : `${metric.value.toLocaleString('en-US')} ${spec.unit}`}>{metricAmount(id, metric?.value)}</td>
      <td className="num p-2 text-right">{metricAmount(id, metric?.yearAgo)}</td><td className={`num p-2 text-right ${growth == null ? '' : growth >= 0 ? 'text-up' : 'text-down'}`}>{percent(growth, true)}</td>
    </tr>
  })}</tbody></table></div>
}

export function HimsPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const query = useHims()
  const now = useSnapshotClock()
  const freshness = query.data ? effectiveFreshness(query.data, now, FRESHNESS.hims) : 'unavailable'
  const refresh = useRefreshHims()
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [range, setRange] = useState<StocksRangePreset>('1Y')
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const data = query.data?.data
  const busy = refreshing || query.isFetching
  const hasContent = Boolean(data?.market || data?.financials || data?.earnings)
  const loading = busy && !hasContent
  const reports = data?.earnings?.reports ?? []
  const report = reports.find(entry => entry.period === selectedPeriod) ?? reports[0]
  const warning = (block: HimsBlock) => query.data?.errors.filter(error => error.symbol === block).map(error => error.reason).join(' · ') || undefined
  const history = useMemo(() => [...(data?.earnings?.reports ?? [])].reverse(), [data?.earnings])
  const mix = useMemo(() => himsRevenueMix(report), [report])
  const stats = data?.market?.chart.stats
  const facts = data?.financials?.facts
  const market = data?.market
  const arpuId: HimsMetricId = report && (report.metrics.arpu.value !== null || report.period >= '2026') ? 'arpu' : 'onlineArpu'
  const revenue = valueOf(report, 'revenue')
  const candles = useMemo(() => {
    const all = data?.market?.chart.candles ?? []
    const end = all.at(-1)
    if (!end || range === '3Y') return all
    const start = new Date(end.time * 1000)
    start.setUTCMonth(start.getUTCMonth() - ({ '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[range || '1Y']))
    return all.filter(candle => candle.time * 1000 >= start.getTime())
  }, [data?.market?.chart.candles, range])
  const dates = useMemo(() => candles.map(candle => new Date(candle.time * 1000).toISOString().slice(0, 10)), [candles])
  useEffect(() => onStatusChange([{ label: 'HIMS', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: busy }], ''), [query.data, busy, onStatusChange])
  const onRefresh = async () => {
    setNotice('')
    setRefreshing(true)
    try { await refresh() } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) } finally { setRefreshing(false) }
  }
  const tileIds: HimsMetricId[] = ['revenue', 'subscribers', arpuId, 'ebitda', 'netIncome', 'eps']
  const valuation: Array<[string, string]> = [
    ['Market cap', amount(facts?.marketCap, true)], ['Enterprise value', amount(facts?.enterpriseValue, true)],
    ['Trailing P/E', amount(facts?.trailingPe)], ['Forward P/E', amount(facts?.forwardPe)], ['Price / sales · trailing', amount(facts?.priceToSales)],
    ['Cash · latest balance sheet', amount(facts?.totalCash, true)], ['Debt · latest balance sheet', amount(facts?.totalDebt, true)],
    ['Shares outstanding', amount(facts?.sharesOutstanding)], ['Beta', amount(facts?.beta)],
    ['Analyst target · low', market?.targets.low || '—'], ['Analyst target · mean', market?.targets.mean || '—'], ['Analyst target · high', market?.targets.high || '—'],
    ['Upside to mean', market?.targets.upsideToMean || '—'], ['Analysts', market?.targets.analysts || '—'], ['Next earnings · estimated', market?.metrics.earningsDate || '—'],
  ]
  return <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2" data-hims-page>
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <h1 className="text-sm font-semibold">HIMS · Hims & Hers Health</h1>
      <span className="num text-sm font-bold">{amount(stats?.price, true)}</span>
      <span className={`num text-xs ${stats && stats.change >= 0 ? 'text-up' : 'text-down'}`}>{percent(stats?.change, true)}</span>
      <span className="text-2xs text-text-muted">NYSE · USD · Consumer health platform</span>
      <Button className="ml-auto" variant="accent" disabled={busy} onClick={onRefresh}>{busy ? loading ? 'Loading HIMS…' : 'Updating HIMS…' : 'Refresh'}</Button>
      {['charts', 'fundamentals', 'options', 'valuation'].map(id => <Button key={id} className="capitalize" onClick={() => onNavigate(id, 'HIMS')}>{id}</Button>)}
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-2 text-2xs text-text-muted">
      <span>{loading ? 'Loading Hims & Hers dashboard…' : `${busy ? 'Updating cached dashboard · ' : ''}${freshness} · fetched ${data?.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : 'unavailable'}`} · price from daily bars{data?.market?.chart.candles.at(-1) ? ` as of ${new Date(data.market.chart.candles.at(-1)!.time * 1000).toISOString().slice(0, 10)}` : ''}</span>
      <label className="ml-auto flex items-center gap-2">Reporting quarter<select aria-label="Reporting quarter" className="no-drag border border-border-strong bg-surface-raised p-1 text-text" value={report?.period ?? ''} onChange={event => setSelectedPeriod(event.target.value)} disabled={!reports.length}>
        {!reports.length ? <option value="">Unavailable</option> : reports.map(entry => <option key={entry.period}>{entry.period}</option>)}
      </select></label>
    </div>
    {(notice || query.error || query.data?.errors.length) ? <div role="status" className="shrink-0 border border-warn/40 bg-surface p-2 text-xs text-warn">{notice || query.error?.message || query.data?.meta.failureReason || query.data?.errors.map(feedErrorText).join(' · ')}</div> : null}
    <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6">{tileIds.map(id => {
      const spec = HIMS_METRICS.find(entry => entry.id === id)!
      const metric = report?.metrics[id]
      const growth = himsGrowth(metric?.value, metric?.yearAgo)
      return <div key={id} className="border border-border bg-surface p-3 text-center"><div className="text-2xs text-text-muted">{spec.label}</div><div className="num my-1 text-lg font-bold">{metricAmount(id, metric?.value)}</div><div className="text-2xs text-text-muted">{report?.period ?? 'Unavailable'} · Y/Y <span className={growth == null ? '' : growth >= 0 ? 'text-up' : 'text-down'}>{percent(growth, true)}</span></div></div>
    })}</div>
    <div className="grid shrink-0 gap-2 xl:grid-cols-[2fr_1fr]">
      <Panel title="Stock performance · HIMS" warning={warning('market')} className="h-[430px]" actions={STOCKS_RANGE_PRESETS.map(preset => <Button key={preset} variant="toggle" active={range === preset} onClick={() => setRange(preset)}>{preset}</Button>)}>
        <div className="flex min-h-0 flex-[3] flex-col overflow-hidden p-2" data-hims-price-range={range} data-hims-candle-count={candles.length}>
          {market?.chart.candles.length ? <CandlestickChart candles={candles} /> : <PanelMessage>{busy ? 'Loading price history…' : 'Price history unavailable.'}</PanelMessage>}
        </div>
        <div className="border-t border-border px-2 pt-1 text-2xs text-text-muted">Daily trading volume · shares · Yahoo Finance</div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2"><LineChart labels={dates} series={[{ label: 'Volume', values: candles.map(candle => candle.volume), color: colorForIndex(1) }]} format={value => amount(value)} ticks={4} empty="Volume unavailable." /></div>
      </Panel>
      <Panel title={`Revenue composition · ${report?.period ?? 'Unavailable'}`} warning={warning('earnings')} className="h-[430px]">
        <div className="flex min-h-0 flex-1 p-2"><Donut slices={mix} compact centerText={amount(revenue, true)} centerSubtext="Quarterly revenue" empty="Complete revenue composition unavailable." /></div>
        <p className="px-2 pb-2 text-2xs text-text-muted">Geography where reported; online / wholesale for earlier quarters. Each allocation reconciles to total revenue.</p><Source report={report} />
      </Panel>
    </div>
    <div className="grid shrink-0 gap-2 xl:grid-cols-2">
      <Panel title="Subscribers & unit economics" warning={warning('earnings')}>
        <div className="flex h-[240px] flex-col p-2"><LineChart labels={history.map(row => row.period)} series={[{ label: 'Subscribers · period end', values: history.map(row => valueOf(row, 'subscribers')), color: colorForIndex(0) }]} format={value => amount(value)} baseline="auto" empty={busy ? 'Loading subscriber history…' : 'Subscriber history unavailable.'} /></div>
        <MetricsTable report={report} ids={['subscribers', arpuId]} />
        <p className="p-2 text-2xs text-text-muted">Subscriber count is measured at quarter end. Monthly revenue per average subscriber uses the period average. Online-only revenue per subscriber is a separate historical metric; it is not spliced into the newer metric.</p><Source report={report} />
      </Panel>
      <Panel title="Profitability & marketing efficiency" warning={warning('earnings')}>
        <div className="flex h-[240px] flex-col p-2"><LineChart labels={history.map(row => row.period)} series={[
          { label: 'Gross margin', values: history.map(row => himsMargin(valueOf(row, 'grossProfit'), valueOf(row, 'revenue'))), color: colorForIndex(0) },
          { label: 'Marketing / revenue', values: history.map(row => himsMargin(valueOf(row, 'marketing'), valueOf(row, 'revenue'))), color: colorForIndex(1) },
          { label: 'Adjusted EBITDA margin · non-GAAP', values: history.map(row => himsMargin(valueOf(row, 'ebitda'), valueOf(row, 'revenue'))), color: colorForIndex(2) },
        ]} format={value => percent(value)} empty="Margin history unavailable." /></div>
        <Legend labels={['Gross margin', 'Marketing / revenue', 'Adjusted EBITDA margin · non-GAAP']} />
        <div className="grid grid-cols-2 gap-2 border-t border-border p-2 text-2xs">{[
          ['Gross margin', himsMargin(valueOf(report, 'grossProfit'), revenue)], ['Marketing / revenue', himsMargin(valueOf(report, 'marketing'), revenue)],
          ['Adjusted EBITDA margin', himsMargin(valueOf(report, 'ebitda'), revenue)], ['Net margin · GAAP', himsMargin(valueOf(report, 'netIncome'), revenue)],
        ].map(([label, value]) => <div key={String(label)} className="flex justify-between gap-2"><span className="text-text-muted">{label}</span><span className="num">{percent(value as number | null)}</span></div>)}</div><Source report={report} />
      </Panel>
    </div>
    <Panel title="Financial history · latest eight available quarters" warning={warning('earnings')} className="shrink-0">
      <div className="flex h-[250px] flex-col p-2"><LineChart labels={history.map(row => row.period)} series={[
        { label: 'Revenue', values: history.map(row => valueOf(row, 'revenue')), color: colorForIndex(0) },
        { label: 'Adjusted EBITDA · non-GAAP', values: history.map(row => valueOf(row, 'ebitda')), color: colorForIndex(1) },
        { label: 'Net income · GAAP', values: history.map(row => valueOf(row, 'netIncome')), color: colorForIndex(2) },
      ]} format={value => amount(value, true)} empty={busy ? 'Loading earnings history…' : 'Financial history unavailable.'} /></div>
      <Legend labels={['Revenue', 'Adjusted EBITDA · non-GAAP', 'Net income · GAAP']} />
      <div className="overflow-auto"><table className="w-full text-2xs"><thead className="bg-surface-raised text-text-muted"><tr>{['Quarter', 'Revenue', 'Subscribers', 'Adjusted EBITDA', 'Net income', 'Diluted EPS', 'Free cash flow', 'Source'].map(label => <th key={label} className="p-2 text-right font-normal">{label}</th>)}</tr></thead><tbody>{history.map(row => <tr key={row.period} className="num border-t border-border/50 text-right hover:bg-surface-raised"><td className="p-2">{row.period}</td>{(['revenue', 'subscribers', 'ebitda', 'netIncome', 'eps', 'freeCashFlow'] as const).map(id => <td key={id} className="p-2">{metricAmount(id, valueOf(row, id))}</td>)}<td className="p-2"><button className="text-accent hover:underline" onClick={() => { void api.openExternal(row.sourceUrl) }}>Release ↗</button></td></tr>)}</tbody></table></div>
      <p className="p-2 text-2xs text-text-muted">Quarterly release values in USD · adjusted EBITDA and free cash flow are company-defined non-GAAP measures. Gaps indicate unavailable data. Growth comparisons are omitted when the prior value is zero or negative.</p>
    </Panel>
    <div className="grid shrink-0 gap-2 xl:grid-cols-2">
      <Panel title={`Quarterly results · ${report?.period ?? 'Unavailable'}`} warning={warning('earnings')}><MetricsTable report={report} ids={['revenue', 'grossProfit', 'marketing', 'operatingIncome', 'netIncome', 'eps', 'ebitda']} /><Source report={report} /></Panel>
      <Panel title="Cash generation" warning={warning('earnings')}>
        <div className="flex h-[230px] flex-col p-2"><LineChart labels={history.map(row => row.period)} series={[
          { label: 'Operating cash flow', values: history.map(row => valueOf(row, 'operatingCashFlow')), color: colorForIndex(0) },
          { label: 'Free cash flow · non-GAAP', values: history.map(row => valueOf(row, 'freeCashFlow')), color: colorForIndex(1) },
        ]} format={value => amount(value, true)} empty="Cash flow history unavailable." /></div>
        <Legend labels={['Operating cash flow', 'Free cash flow · non-GAAP']} />
        <MetricsTable report={report} ids={['operatingCashFlow', 'freeCashFlow']} /><Source report={report} />
      </Panel>
    </div>
    <div className="grid shrink-0 gap-2 xl:grid-cols-2">
      <Panel title={`Management guidance · issued ${report?.publishedAt ?? 'Unavailable'}`} warning={warning('earnings')}>
        {report?.guidance.length ? <div className="overflow-auto"><table className="w-full text-2xs"><thead className="bg-surface-raised text-text-muted"><tr>{['Period', 'Revenue range · USD', 'Adjusted EBITDA range · USD'].map(label => <th key={label} className="p-2 text-left font-normal">{label}</th>)}</tr></thead><tbody>{report.guidance.map(row => <tr key={row.period} className="border-t border-border/50"><td className="p-3">{row.period}</td><td className="num p-3">{amount(row.revenueLow, true)} – {amount(row.revenueHigh, true)}</td><td className="num p-3">{amount(row.ebitdaLow, true)} – {amount(row.ebitdaHigh, true)}</td></tr>)}</tbody></table></div> : <PanelMessage>Guidance unavailable in this release.</PanelMessage>}
        <p className="p-2 text-2xs text-text-muted">Company outlook as of the selected release. Forward-looking estimates may change; adjusted EBITDA is non-GAAP.</p><Source report={report} />
      </Panel>
      <Panel title="Valuation & balance sheet" warning={[warning('financials'), warning('market')].filter(Boolean).join(' · ') || undefined}>
        <div className="grid grid-cols-1 gap-x-5 gap-y-2 p-3 text-2xs sm:grid-cols-2">{valuation.map(([label, value]) => <div key={label} className="flex justify-between gap-2"><span className="text-text-muted">{label}</span><span className="num">{value}</span></div>)}</div>
        <p className="border-t border-border p-2 text-2xs text-text-muted">Yahoo Finance snapshot / SEC statements · balance sheet dates and trailing valuation windows differ from the selected earnings quarter. Analyst targets are estimates.</p>
      </Panel>
    </div>
    <div className="grid shrink-0 gap-2 xl:grid-cols-2">
      <Panel title="HIMS news" warning={warning('market')} className="h-[340px]"><div className="overflow-auto">{market?.news.length ? market.news.slice(0, 15).map(row => <button key={row.id || row.url} className="block w-full border-b border-border/50 p-3 text-left text-2xs hover:bg-surface-raised" onClick={() => { void api.openExternal(row.url) }}><div className="text-text">{row.title} ↗</div><div className="mt-1 text-text-muted">{row.source} · {row.publishedAt ? new Date(row.publishedAt).toLocaleString() : 'Date unavailable'}</div></button>) : <PanelMessage>{busy ? 'Loading headlines…' : 'No headlines available.'}</PanelMessage>}</div></Panel>
      <Panel title="SEC filings · HIMS" warning={warning('financials')} className="h-[340px]"><FilingsTable filings={data?.financials?.sec.filings ?? []} compact /></Panel>
    </div>
    <Panel title="Company overview & research" warning={warning('market')} className="shrink-0">
      <p className="p-3 text-2xs text-text-muted">{market?.company.description || 'Company profile unavailable.'}</p>
      <div className="flex flex-wrap gap-2 border-t border-border p-2"><Button onClick={() => { void api.openExternal('https://investors.hims.com/') }}>Investor relations ↗</Button><Button onClick={() => { void api.openExternal('https://www.sec.gov/edgar/browse/?CIK=1773751&owner=exclude') }}>SEC EDGAR ↗</Button><span className="self-center text-2xs text-text-muted">Profile: Yahoo Finance · data freshness: {freshness}</span></div>
    </Panel>
  </div>
}
