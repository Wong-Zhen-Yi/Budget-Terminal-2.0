import { useEffect, useMemo, useState } from 'react'
import { useHomebuilders } from '@/api/homebuildersQueries'
import { api } from '@/api/client'
import { useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import { HOMEBUILDER_CATALOG, HOMEBUILDER_COVERAGE_NOTE } from '@shared/homebuilderCatalog'
import { homebuilderComparison, homebuilderNews, homebuilderOverview, rowReturns } from '@shared/homebuilders'
import type { HomebuilderRow } from '@shared/homebuilders'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { LineChart } from '@/components/charts/LineChart'
import { colorForIndex } from '@/components/charts/Donut'
import { BuyerEconomics } from '@/components/homebuilders/BuyerEconomics'
import { BuilderCapitalMap } from '@/components/homebuilders/BuilderCapitalMap'
import { compactCurrency, currency } from '@/lib/format'
import '@/styles/homebuilders.css'

const initialRows: HomebuilderRow[] = HOMEBUILDER_CATALOG.map(company => ({ company, market: null, profile: null, news: [],
  progress: { market: 'unavailable', profile: 'unavailable', news: 'unavailable' }, fetchedAt: { market: null, profile: null, news: null } }))
const pct = (value: number | null | undefined) => value === null || value === undefined ? '--' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
const ratio = (value: number | null | undefined) => value === null || value === undefined ? '--' : `${value.toFixed(2)}x`
const signed = (value: number | null | undefined) => <span className={value === null || value === undefined ? 'text-text-dim' : value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-text'}>{pct(value)}</span>
const dateText = (value: number | null | undefined) => value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : '--'
const percentMetric = (value: number | null | undefined) => value === null || value === undefined ? '--' : `${(value * 100).toFixed(1)}%`
const views = [{ id: 'economics', label: 'Housing economics' }, { id: 'stocks', label: 'Stocks & returns' }, { id: 'reports', label: 'Reports & news' }] as const
function SourceLink({ url, children }: { url: string; children: string }) {
  return <button type="button" className="hb-source" onClick={() => void api.openExternal(url)}>{children}</button>
}

export function HomebuildersPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const query = useHomebuilders()
  const now = useSnapshotClock()
  const [symbol, setSymbol] = useState('DHI')
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'all' | 'builder' | 'benchmark'>('all')
  const [range, setRange] = useState<'1M' | '3M' | 'YTD' | '1Y'>('1Y')
  const [compare, setCompare] = useState(['DHI', 'LEN', 'PHM', 'ITB'])
  const [view, setView] = useState<(typeof views)[number]['id']>('economics')
  const [feed, setFeed] = useState<'news' | 'earnings'>('news')
  const rows = query.data?.data.rows ?? initialRows
  const builders = rows.filter(row => row.company.kind === 'builder')
  const selected = rows.find(row => row.company.symbol === symbol) ?? rows[0]
  const overview = useMemo(() => homebuilderOverview(rows), [rows])
  const returns = useMemo(() => new Map(rows.map(row => [row.company.symbol, rowReturns(row, now)])), [rows, now])
  const news = useMemo(() => homebuilderNews(rows), [rows])
  const errors = query.data?.errors ?? []
  const filtered = rows.filter(row => (kind === 'all' || row.company.kind === kind) && `${row.company.symbol} ${row.company.name} ${row.company.focus}`.toLowerCase().includes(search.trim().toLowerCase()))
  const start = new Date(now)
  if (range === 'YTD') start.setUTCFullYear(start.getUTCFullYear(), 0, 1)
  else start.setUTCDate(start.getUTCDate() - ({ '1M': 31, '3M': 93, '1Y': 365 }[range]))
  const startDate = start.toISOString().slice(0, 10)
  const comparison = homebuilderComparison(rows.filter(row => compare.includes(row.company.symbol)), startDate)
  const history = selected?.market?.history.filter(point => point.date >= startDate) ?? []
  const marketToday = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const upcoming = builders.filter(row => row.profile?.earningsDate && new Date(row.profile.earningsDate).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) >= marketToday)
    .sort((a, b) => a.profile!.earningsDate! - b.profile!.earningsDate!)
  const freshnessMs = query.data?.meta.expiresAt !== undefined ? Infinity : FRESHNESS.homebuilders
  useEffect(() => onStatusChange([{ label: 'Homebuilders', envelope: query.data, error: query.error, enabled: query.isEnabled,
    loading: query.isFetching, freshnessMs }], ''), [onStatusChange, query.data, query.error, query.isEnabled, query.isFetching, freshnessMs])

  const columns: Column<HomebuilderRow>[] = [
    { key: 'symbol', header: 'Ticker', cell: row => <button type="button" className="font-semibold text-accent" onClick={() => setSymbol(row.company.symbol)}>{row.company.symbol}</button>, sortValue: row => row.company.symbol },
    { key: 'name', header: 'Company / ETF', cell: row => <span title={row.company.focus}>{row.company.name}</span>, sortValue: row => row.company.name },
    { key: 'price', header: 'USD', cell: row => currency(row.market?.price), sortValue: row => row.market?.price ?? null, numeric: true },
    { key: 'daily', header: '1D', cell: row => signed(row.market?.dailyChange), sortValue: row => row.market?.dailyChange ?? null, numeric: true },
    { key: 'month', header: '1M adj.', cell: row => signed(returns.get(row.company.symbol)?.month), sortValue: row => returns.get(row.company.symbol)?.month ?? null, numeric: true },
    { key: 'ytd', header: 'YTD adj.', cell: row => signed(returns.get(row.company.symbol)?.ytd), sortValue: row => returns.get(row.company.symbol)?.ytd ?? null, numeric: true },
    { key: 'cap', header: 'Mkt cap', cell: row => row.company.kind === 'benchmark' ? '--' : compactCurrency(row.market?.marketCap), sortValue: row => row.company.kind === 'benchmark' ? null : row.market?.marketCap ?? null, numeric: true },
    { key: 'pe', header: 'P/E TTM', cell: row => ratio(row.profile?.trailingPe), sortValue: row => row.profile?.trailingPe ?? null, numeric: true },
    { key: 'pb', header: 'P/B', cell: row => ratio(row.profile?.priceToBook), sortValue: row => row.profile?.priceToBook ?? null, numeric: true },
  ]
  const selectedErrors = errors.filter(error => error.symbol === symbol)
  const dossier = selected ? <aside className="hb-dossier" aria-label="Selected builder research">
    <header><span className="hb-kicker">03 / Company file</span><div className="hb-company-name"><strong>{symbol}</strong><span>{selected.company.name}</span></div></header>
    <div className="hb-quote"><strong>{currency(selected.market?.price)}</strong>{signed(selected.market?.dailyChange)}</div>
    <div className="hb-quote-source">{selected.market?.priceSource ?? 'Quote source unavailable'}{selected.market?.changeBasis === '24h' ? ' · 24h change' : ' · daily change'}<br />{selected.market?.quoteTime ? new Date(selected.market.quoteTime).toLocaleString() : '--'}</div>
    <p className="hb-business">{selected.company.focus}</p>
    {selected.company.kind === 'builder' ? <dl className="hb-facts">
      <div><dt>Price / book</dt><dd>{ratio(selected.profile?.priceToBook)}</dd></div><div><dt>ROE · TTM</dt><dd>{percentMetric(selected.profile?.returnOnEquity)}</dd></div>
      <div><dt>P/E · TTM</dt><dd>{ratio(selected.profile?.trailingPe)}</dd></div><div><dt>P/E · forward est.</dt><dd>{ratio(selected.profile?.forwardPe)}</dd></div>
      <div><dt>Revenue · TTM</dt><dd>{compactCurrency(selected.profile?.revenue)}</dd></div><div><dt>Revenue YoY</dt><dd>{percentMetric(selected.profile?.revenueGrowth)}</dd></div>
      <div><dt>Gross margin · TTM</dt><dd>{percentMetric(selected.profile?.grossMargin)}</dd></div><div><dt>Market cap</dt><dd>{compactCurrency(selected.market?.marketCap)}</dd></div>
    </dl> : <p className="hb-method">Broader housing equity basket. Corporate valuation and margin metrics are omitted for ETFs.</p>}
    <div className="hb-company-actions">{['stocks', 'charts', 'fundamentals', 'options'].map(tab => <Button key={tab} onClick={() => onNavigate(tab, symbol)}>{tab[0].toUpperCase() + tab.slice(1)}</Button>)}</div>
    <div className="hb-next-report"><span>Next earnings · provider estimate</span><strong>{dateText(selected.profile?.earningsDate)}</strong></div>
    <SourceLink url={selected.company.sourceUrl}>{selected.company.kind === 'builder' ? 'Company investor relations ↗' : 'ETF issuer & holdings ↗'}</SourceLink>
    <p className="hb-method">Whole-company metrics. Gross margin is consolidated TTM, not the separately reported homebuilding margin.</p>
    {selectedErrors.length ? <p className="text-warn text-2xs">{selectedErrors.map(error => error.reason).join(' · ')}</p> : null}
    {query.error ? <p className="text-warn text-2xs">{String(query.error)}</p> : null}
  </aside> : <PanelMessage>Company unavailable</PanelMessage>

  return <div className="homebuilders-page" data-homebuilders-page>
    <div className="hb-heading"><div><span className="hb-kicker">Focus / U.S. residential construction</span><h1>Homebuilders</h1></div><nav aria-label="Homebuilder views">{views.map(item => <button type="button" key={item.id} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}</nav></div>
    <div className="hb-ticker-street" aria-label="Homebuilding stocks and benchmarks">
      <div className="hb-builder-tickers">{builders.map(row => <button type="button" key={row.company.symbol} aria-label={`Select ${row.company.symbol}`} aria-pressed={symbol === row.company.symbol} onClick={() => setSymbol(row.company.symbol)}><strong>{row.company.symbol}</strong><span>{signed(row.market?.dailyChange)}</span></button>)}</div>
      <div className="hb-benchmarks">{rows.filter(row => row.company.kind === 'benchmark').map(row => <button type="button" key={row.company.symbol} aria-label={`Select ${row.company.symbol} benchmark`} aria-pressed={symbol === row.company.symbol} onClick={() => setSymbol(row.company.symbol)}><small>Housing ETF</small><strong>{row.company.symbol}</strong><span>{signed(row.market?.dailyChange)}</span></button>)}</div>
    </div>
    <div className="hb-market-context"><span>{overview.advancing} advancing / {overview.declining} declining · {overview.quoteCount}/{overview.count} builder changes · {signed(overview.daily)} equal-weight</span><div><SourceLink url="https://fred.stlouisfed.org/series/MORTGAGE30US">Mortgage rates ↗</SourceLink><SourceLink url="https://fred.stlouisfed.org/series/HOUST">Starts ↗</SourceLink><SourceLink url="https://fred.stlouisfed.org/series/PERMIT">Permits ↗</SourceLink></div></div>
    <div className={`hb-workspace hb-view-${view}`}>
      <div className="hb-economics" hidden={view !== 'economics'}><BuyerEconomics /><BuilderCapitalMap rows={rows} symbol={symbol} onSelect={setSymbol} />{dossier}</div>
      {view === 'stocks' ? <div className="hb-stocks-layout">
        <Panel title="Builder stocks & housing ETFs" className="homebuilders-universe" warning={errors.length ? 'Some company data is missing or cached; see Settings diagnostics.' : undefined}>
          <div className="homebuilders-toolbar"><input type="search" aria-label="Search homebuilding companies" placeholder="Search ticker or company" value={search} onChange={event => setSearch(event.target.value)} />{(['all', 'builder', 'benchmark'] as const).map(value => <Button key={value} variant="toggle" active={kind === value} onClick={() => setKind(value)}>{value === 'all' ? 'All' : value === 'builder' ? 'Builders' : 'ETFs'}</Button>)}</div>
          <DataTable columns={columns} rows={filtered} rowKey={row => row.company.symbol} defaultSort={{ key: 'cap', direction: 'desc' }} minWidth="760px" onRowClick={row => setSymbol(row.company.symbol)} onRowDoubleClick={row => onNavigate('stocks', row.company.symbol)} rowClassName={row => row.company.symbol === symbol ? 'bg-surface-hover' : ''} empty="No companies match your filters" />
          <div className="homebuilders-footnote">USD · 1D quote change · adjusted-close returns · company-wide P/E & P/B · missing data = --</div>
        </Panel>
        <div className="hb-price-workspace"><Panel title="How do the stocks respond?" actions={<div className="flex gap-1">{(['1M', '3M', 'YTD', '1Y'] as const).map(value => <Button key={value} variant="toggle" active={range === value} onClick={() => setRange(value)}>{value}</Button>)}</div>}>
          <div className="homebuilders-toolbar">{compare.map(ticker => <button key={ticker} type="button" className="homebuilders-chip" aria-label={`Remove ${ticker} from comparison`} onClick={() => setCompare(compare.filter(value => value !== ticker))}>{ticker} ×</button>)}<select aria-label="Add comparison company" value="" disabled={compare.length >= 4} onChange={event => { if (event.target.value && compare.length < 4) setCompare([...compare, event.target.value]) }}><option value="">{compare.length >= 4 ? '4 series max' : 'Add ticker…'}</option>{rows.filter(row => !compare.includes(row.company.symbol)).map(row => <option key={row.company.symbol} value={row.company.symbol}>{row.company.symbol}</option>)}</select></div>
          <div className="homebuilders-comparison-chart" data-homebuilder-comparison-chart><LineChart labels={comparison.dates} series={comparison.series.map((series, index) => ({ label: series.symbol, values: series.values, color: colorForIndex(index) }))} format={pct} baseline="zero" empty={query.isFetching ? 'Loading comparison histories…' : 'Choose tickers with overlapping adjusted histories'} /></div>
          <div className="homebuilders-footnote">Rebased to 0% on the first common session · adjusted closes · missing sessions remain gaps</div>
        </Panel><Panel title={`${symbol} · adjusted USD share price`}><div className="homebuilders-comparison-chart" data-homebuilder-price-chart><LineChart labels={history.map(point => point.date)} series={[{ label: symbol, values: history.map(point => point.close), color: colorForIndex(0) }]} format={currency} baseline="auto" empty={query.isFetching ? 'Loading adjusted price history…' : 'Adjusted history unavailable'} /></div><div className="homebuilders-footnote">{selected?.company.name} · {range}</div></Panel></div>
      </div> : null}
      {view === 'reports' ? <div className="hb-reports-layout"><Panel title="Company reporting & housing headlines" warning={errors.some(error => error.operation === 'homebuilders-news') ? 'Some news feeds are unavailable or cached.' : undefined} actions={<><Button variant="toggle" active={feed === 'news'} onClick={() => setFeed('news')}>News</Button><Button variant="toggle" active={feed === 'earnings'} onClick={() => setFeed('earnings')}>Earnings</Button></>}>
        <div className="homebuilders-feed">{feed === 'news' ? news.length ? news.slice(0, 40).map(article => <button type="button" key={article.url || article.id} onClick={() => void api.openExternal(article.url)}><span>{article.title}</span><small>{article.ticker} · {article.source} · {dateText(article.publishedAt)}</small></button>) : <PanelMessage>{query.isFetching ? 'Loading homebuilding headlines…' : 'No homebuilding headlines available'}</PanelMessage> : <><div className="homebuilders-footnote">Provider estimates · dates use New York time and can change.</div>{upcoming.length ? upcoming.map(row => <button type="button" key={row.company.symbol} onClick={() => setSymbol(row.company.symbol)}><span>{row.company.symbol} · {row.company.name}</span><small>{dateText(row.profile?.earningsDate)}</small></button>) : <PanelMessage>No upcoming earnings dates available</PanelMessage>}</>}</div>
      </Panel>{dossier}</div> : null}
    </div>
    <div className="hb-coverage" title={HOMEBUILDER_COVERAGE_NOTE}>Selected U.S. builders · Yahoo Finance company data · ITB/XHB shown separately · scenarios use your assumptions</div>
  </div>
}
