import { useEffect, useMemo, useState } from 'react'
import { STOCKS_RANGE_PRESETS } from '@shared/contract'
import type { StocksRangePreset } from '@shared/contract'
import { hoodHistory } from '@shared/hood'
import type { HoodMetric, HoodReport } from '@shared/hood'
import { HOOD_PRESENTATION } from '@shared/hoodPresentation'
import type { HoodPresentation, HoodPresentationPeriod } from '@shared/hoodPresentation'
import { useHood } from '@/api/hoodQueries'
import { api } from '@/api/client'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { CandlestickChart } from '@/components/charts/CandlestickChart'
import { FilingsTable } from '@/components/fundamentals/FilingsTable'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'

const amount = (value: number | null | undefined, money = false) => {
  if (value == null || !Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  const scale = magnitude >= 1e9 ? 1e9 : magnitude >= 1e6 ? 1e6 : magnitude >= 1e3 ? 1e3 : 1
  return `${value < 0 ? '-' : ''}${money ? '$' : ''}${(magnitude / scale).toLocaleString('en-US', { maximumFractionDigits: 2 })}${scale === 1e9 ? 'B' : scale === 1e6 ? 'M' : scale === 1e3 ? 'K' : ''}`
}
const revenue = (row: HoodPresentationPeriod) => row.transaction + row.interest + row.other
const findMetric = (report: HoodReport | null | undefined, id: string) => report?.metrics.find(metric => metric.id === id)
const metricValue = (metric: HoodMetric | undefined) => amount(metric?.value, metric?.unit !== 'count')
const open = (url: string) => { void api.openExternal(url) }
const pct = (part: number, total: number) => `${(part / total * 100).toFixed(1)}%`
type ChartMode = 'revenue' | 'assets' | 'profit'
const seriesFor = (mode: ChartMode) => mode === 'revenue'
  ? [{ key: 'transaction', label: 'Transactions', color: 'var(--color-accent)' }, { key: 'interest', label: 'Net interest', color: 'var(--color-text-muted)' }, { key: 'other', label: 'Other', color: 'var(--color-warn)' }]
  : mode === 'assets' ? [{ key: 'assets', label: 'Platform assets', color: 'var(--color-accent)' }, { key: 'deposits', label: 'Net deposits', color: 'var(--color-up)' }]
    : [{ key: 'revenue', label: 'Revenue', color: 'var(--color-accent)' }, { key: 'adjustedOpexAndSbc', label: 'Adj. opex + SBC', color: 'var(--color-text-muted)' }, { key: 'adjustedEbitda', label: 'Adj. EBITDA', color: 'var(--color-up)' }]
const seriesValue = (row: HoodPresentationPeriod, key: string) => key === 'revenue' ? revenue(row) : row[key as Exclude<keyof HoodPresentationPeriod, 'period' | 'basis'>]

function PresentationChart({ presentation, mode, selected, onSelect }: { presentation: HoodPresentation; mode: ChartMode; selected: number; onSelect: (index: number) => void }) {
  const series = seriesFor(mode)
  const ceiling = Math.max(...presentation.history.map(row => mode === 'revenue' ? revenue(row) : Math.max(...series.map(item => Math.abs(seriesValue(row, item.key)))))) * 1.15
  const row = presentation.history[selected]
  return <>
    <div className="hood-chart-legend">{series.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}<span className="hood-unit">USD {mode === 'assets' ? 'billions' : 'millions'}</span></div>
    <div className="hood-column-chart" aria-label={`${mode} history. Select a period to inspect its values.`}>
      {presentation.history.map((point, index) => <button key={point.period} className={`hood-column ${mode === 'revenue' ? 'hood-stacked' : ''}`} aria-pressed={index === selected} aria-label={`${point.period}: ${series.map(item => `${item.label} ${amount(seriesValue(point, item.key), true)}`).join(', ')}`} onClick={() => onSelect(index)}>
        <span className="hood-bar-space">
          {mode === 'revenue' ? <span className="hood-stack" style={{ height: `${revenue(point) / ceiling * 100}%` }}><b>{amount(revenue(point), true)}</b>{[...series].reverse().map(item => <span key={item.key} style={{ height: `${seriesValue(point, item.key) / revenue(point) * 100}%`, background: item.color }} />)}</span>
            : series.map(item => { const value = seriesValue(point, item.key); return <span key={item.key} className={`hood-bar ${value < 0 ? 'hood-bar-negative' : ''}`} style={{ height: `${Math.abs(value) / ceiling * 100}%`, background: value < 0 ? 'var(--color-down)' : item.color }} title={`${item.label}: ${amount(value, true)}`} /> })}
        </span><span className="hood-period">{point.period}</span>
      </button>)}
    </div>
    <div className="hood-chart-readout" aria-live="polite"><strong>{row.period}</strong>{series.map(item => <span key={item.key}>{item.label} <b className="num">{amount(seriesValue(row, item.key), true)}</b></span>)}</div>
  </>
}

export function HoodPage({ onStatusChange, onNavigate }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void; onNavigate: (tabId: string, symbol?: string) => void }) {
  const query = useHood()
  const data = query.data?.data
  const presentation = data?.presentation ?? HOOD_PRESENTATION
  const latest = presentation.history[presentation.history.length - 1]
  const [view, setView] = useState<'business' | 'market'>('business')
  const [mode, setMode] = useState<ChartMode>('revenue')
  const [selected, setSelected] = useState(presentation.history.length - 1)
  const [priority, setPriority] = useState('traders')
  const [range, setRange] = useState<StocksRangePreset>('1Y')
  const [showNotes, setShowNotes] = useState(false)
  const stats = data?.market?.chart.stats
  const history = useMemo(() => hoodHistory(data?.financials ?? null), [data?.financials])
  const candles = useMemo(() => {
    const all = data?.market?.chart.candles ?? []
    const end = all.at(-1)
    if (!end || range === '3Y') return all
    const start = new Date(end.time * 1000)
    start.setUTCMonth(start.getUTCMonth() - ({ '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[range || '1Y']))
    return all.filter(candle => candle.time * 1000 >= start.getTime())
  }, [data?.market?.chart.candles, range])
  useEffect(() => onStatusChange([{ label: 'HOOD', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching }], ''), [query.data, query.error, query.isFetching, query.isEnabled, onStatusChange])
  const source = (page: number) => open(`${presentation.sourceUrl}#page=${page}`)
  const activePriority = presentation.priorities.find(item => item.id === priority) ?? presentation.priorities[0]
  const monthlyIds = ['customers', 'assets', 'deposits', 'equities', 'options', 'crypto', 'events', 'margin']
  const selectedRow = presentation.history[Math.min(selected, presentation.history.length - 1)]
  return <div className="hood-focus" data-hood-page>
    <header className="hood-header">
      <div className="hood-identity"><span className="hood-symbol">HOOD</span><div><h1>Robinhood Markets</h1><p>The financial SuperApp · Investor presentation</p></div></div>
      <div className="hood-quote"><strong className="num">{amount(stats?.price, true)}</strong><span className={stats && stats.change < 0 ? 'text-down' : 'text-up'}>{stats ? `${stats.change >= 0 ? '+' : ''}${stats.change.toFixed(2)}%` : '—'}</span><small>{stats?.priceSource ?? (stats ? 'Daily stock bars' : 'Market price unavailable')}{stats ? ` · ${stats.changeBasis === '24h' ? '24h' : 'daily'}` : ''}</small></div>
      <div className="hood-shortcuts">{['charts', 'fundamentals', 'options', 'valuation'].map(id => <Button key={id} className="capitalize" onClick={() => onNavigate(id, 'HOOD')}>{id}</Button>)}</div>
    </header>
    <div className="hood-toolbar"><div className="hood-tabs" aria-label="HOOD views">{(['business', 'market'] as const).map(id => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{id === 'business' ? 'Business model' : 'Market & filings'}</button>)}</div><button className="hood-source" onClick={() => source(1)}>Investor deck · {presentation.publishedAt} ↗</button><span className="hood-asof">Snapshot: {presentation.asOf}</span></div>
    <section className="hood-engine" aria-label="Robinhood operating model, presentation snapshot">
      {[
        ['01 / CUSTOMER RELATIONSHIP', amount(presentation.fundedCustomers), 'Funded customers', `${amount(presentation.goldSubscribers)} Gold subscribers · +${presentation.goldYearGrowth}% Y/Y`],
        ['02 / ASSET GATHERING', amount(latest.assets, true), 'Platform assets · period end', `${amount(latest.deposits, true)} LTM net deposits · ${presentation.depositGrowth}% growth`],
        ['03 / MONETIZATION', amount(revenue(latest), true), 'LTM net revenue', `$${latest.arpu} LTM ARPU · 14 scaled businesses`],
        ['04 / OPERATING LEVERAGE', amount(latest.adjustedEbitda, true), 'LTM adjusted EBITDA', `${presentation.adjustedEbitdaMargin}% margin · non-GAAP`],
      ].map(([label, value, title, detail]) => <div key={label}><small>{label}</small><strong className="num">{value}</strong><h2>{title}</h2><p>{detail}</p></div>)}
    </section>
    {view === 'business' ? <div className="hood-business">
      <section className="hood-growth hood-card">
        <div className="hood-section-heading"><div><small>ASSETS → REVENUE → EARNINGS</small><h2>{mode === 'revenue' ? 'A broader revenue engine' : mode === 'assets' ? 'Compounding the asset base' : 'Scaling profitable growth'}</h2></div><button className="hood-source" onClick={() => source(mode === 'revenue' ? 14 : mode === 'assets' ? 12 : 17)}>Slide {mode === 'revenue' ? 14 : mode === 'assets' ? 12 : 17} ↗</button></div>
        <div className="hood-tabs hood-chart-tabs">{([['revenue', 'Revenue mix'], ['assets', 'Assets & deposits'], ['profit', 'Profitability']] as const).map(([id, label]) => <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}</div>
        <PresentationChart presentation={presentation} mode={mode} selected={Math.min(selected, presentation.history.length - 1)} onSelect={setSelected} />
        <p className="hood-chart-note">2021–2025: full years. Last column: LTM to Sep 2026; assets are period end.{mode === 'profit' ? ' Adjusted expenses and EBITDA are separate non-GAAP measures.' : ' Select a column for exact reported values.'}</p>
      </section>
      <section className="hood-relationship hood-card"><div className="hood-section-heading"><div><small>DEPTH OF RELATIONSHIP</small><h2>Gold & customer economics</h2></div><button className="hood-source" onClick={() => source(12)}>Slides 3, 12 ↗</button></div>
        <div className="hood-gold"><strong className="num">{amount(presentation.goldSubscribers)}</strong><div><b>Gold subscribers</b><span className="text-up">+{presentation.goldYearGrowth}% Y/Y</span></div><div className="hood-gold-share"><b>{pct(presentation.goldSubscribers, presentation.fundedCustomers)}</b><small>of funded customers*</small></div></div>
        <div className="hood-adoption"><span style={{ width: pct(presentation.goldSubscribers, presentation.fundedCustomers) }} /></div>
        <div className="hood-customer-stats"><div><b className="num">${selectedRow.arpu}</b><span>ARPU · {selectedRow.period}</span></div><div><b className="num">{selectedRow.retention}%</b><span>Retention · {selectedRow.period}</span></div><div><b className="num">{amount(latest.assets / presentation.fundedCustomers, true)}</b><span>Assets / customer*</span></div></div>
        <p className="hood-chart-note">*Calculated from rounded deck figures. Retention includes low-balance account escheatment; see definitions.</p>
      </section>
      <section className="hood-diversification hood-card"><div className="hood-section-heading"><div><small>REVENUE DIVERSIFICATION</small><h2>14 businesses above $100M annualized</h2></div><button className="hood-source" onClick={() => source(14)}>Slide 14 ↗</button></div>
        <div className="hood-business-lines">{presentation.businessLines.map((line, index) => <span key={line}><small>{String(index + 1).padStart(2, '0')}</small>{line}</span>)}</div>
        <p className="hood-chart-note">Q3 2026 revenue × 4, per management. These businesses overlap; the list is not an additive revenue breakdown.</p>
      </section>
      <section className="hood-roadmap hood-card"><div className="hood-section-heading"><div><small>MANAGEMENT'S 2026+ PRIORITIES</small><h2>Three paths to the SuperApp</h2></div><button className="hood-source" onClick={() => source(6)}>Slide 6 ↗</button></div><div className="hood-priorities">{presentation.priorities.map((item, index) => <button key={item.id} aria-pressed={priority === item.id} onClick={() => setPriority(item.id)}><span>0{index + 1}</span>{item.title}<b>→</b></button>)}</div><div className="hood-products" aria-live="polite">{activePriority.products.map(product => <span key={product}>{product}</span>)}</div><p className="hood-chart-note">Management priorities as of the deck date; execution remains forward-looking.</p></section>
      <section className="hood-monthly hood-card"><div className="hood-section-heading"><div><small>AFTER THE PRESENTATION SNAPSHOT</small><h2>Monthly operating pulse</h2></div>{data?.monthly ? <button className="hood-source" onClick={() => open(data.monthly!.sourceUrl)}>{data.monthly.period} report ↗</button> : <span className="hood-chart-note">{query.isFetching ? 'Loading Robinhood reports…' : 'Monthly report unavailable'}</span>}</div><div className="hood-pulse">{monthlyIds.map(id => { const metric = findMetric(data?.monthly, id); return <div key={id}><span>{metric?.label ?? ({ customers: 'Funded customers', assets: 'Platform assets', deposits: 'Net deposits', equities: 'Equity volume', options: 'Options contracts', crypto: 'Crypto volume', events: 'Event contracts', margin: 'Margin book' }[id])}</span><b className="num">{metricValue(metric)}</b><small>{metric?.change ? `${metric.change} M/M` : 'M/M —'}</small></div> })}</div></section>
    </div> : <div className="hood-market">
      <Panel title="Stock performance · HOOD" actions={STOCKS_RANGE_PRESETS.map(preset => <Button key={preset} onClick={() => setRange(preset)} variant="toggle" active={preset === range}>{preset}</Button>)}><div className="flex min-h-0 flex-1 flex-col" data-hood-price-range={range} data-hood-candle-count={candles.length}><CandlestickChart candles={candles} /></div></Panel>
      <Panel title="SEC filings · HOOD"><FilingsTable filings={data?.financials?.sec.filings ?? []} compact /></Panel>
      <Panel title="Financial history · quarterly" actions={data?.quarterly ? <button className="hood-source" onClick={() => open(data.quarterly!.sourceUrl)}>{data.quarterly.period} report ↗</button> : undefined}>
        <div className="hood-quarter-summary">{['revenue', 'eps', 'ebitda'].map(id => <span key={id}>{findMetric(data?.quarterly, id)?.label ?? id} <b>{metricValue(findMetric(data?.quarterly, id))}</b></span>)}</div>
        <div className="overflow-auto"><table className="hood-history"><thead><tr>{['Quarter ended', 'Revenue', 'Net income', 'Operating cash flow', 'Shares'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{history.map(row => <tr key={row.endDate}><td>{row.endDate}</td><td>{amount(row.revenue, true)}</td><td>{amount(row.netIncome, true)}</td><td>{amount(row.operatingCashFlow, true)}</td><td>{amount(row.sharesOutstanding)}</td></tr>)}</tbody></table>{!history.length && <PanelMessage>Financial history unavailable.</PanelMessage>}</div><p className="hood-chart-note">SEC statements / Yahoo fallback · USD · gaps indicate unavailable data.</p>
      </Panel>
      <Panel title="HOOD news"><div className="overflow-auto">{data?.market?.news.length ? data.market.news.map(row => <button key={row.id || row.url} className="hood-news" onClick={() => open(row.url)}>{row.title} ↗<small>{row.source}</small></button>) : <PanelMessage>No headlines available.</PanelMessage>}</div></Panel>
    </div>}
    <footer className="hood-footer"><span>Dated company disclosures · USD · financials through Sep 30, 2026</span><button onClick={() => setShowNotes(!showNotes)} aria-expanded={showNotes}>Definitions & source notes {showNotes ? '−' : '+'}</button><button onClick={() => source(20)}>Non-GAAP reconciliation ↗</button></footer>
    {showNotes && <div className="hood-notes" role="dialog" aria-label="Presentation definitions and sources"><div className="hood-section-heading"><h2>Presentation definitions & sources</h2><Button onClick={() => setShowNotes(false)}>Close</Button></div><p>{presentation.title} · published {presentation.publishedAt} · reviewed {presentation.reviewedAt}</p>{presentation.notes.map(note => <p key={note}>{note}</p>)}<button className="hood-source" onClick={() => source(1)}>Open original presentation ↗</button></div>}
  </div>
}
