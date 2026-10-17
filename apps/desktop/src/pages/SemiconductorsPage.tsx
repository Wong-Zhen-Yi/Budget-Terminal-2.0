import { useEffect, useMemo, useState } from 'react'
import { useSemiconductors, useRefreshSemiconductors } from '@/api/semiconductorsQueries'
import { api } from '@/api/client'
import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import { SEMICONDUCTOR_CATALOG, SEMICONDUCTOR_COVERAGE_NOTE, SEMICONDUCTOR_REVIEW_DATE } from '@shared/semiconductorCatalog'
import { SEMICONDUCTOR_GROUPS, rowReturns, semiconductorComparison, semiconductorNews, semiconductorOverview, semiconductorLaneStatus } from '@shared/semiconductors'
import type { SemiconductorGroup, SemiconductorRow } from '@shared/semiconductors'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { LineChart } from '@/components/charts/LineChart'
import { colorForIndex } from '@/components/charts/Donut'
import { compactCurrency, currency, plainPercent } from '@/lib/format'
import { SupplyChainExplorer, SubsectorPerformance } from '@/components/semiconductors/SupplyChainExplorer'
import '@/styles/semiconductors.css'

const initialRows: SemiconductorRow[] = SEMICONDUCTOR_CATALOG.map(company => ({ company, market: null, profile: null, news: [],
  progress: { market: 'unavailable', profile: 'unavailable', news: 'unavailable' }, fetchedAt: { market: null, profile: null, news: null } }))
const groupName = (id: SemiconductorGroup) => SEMICONDUCTOR_GROUPS.find(group => group.id === id)!.label
const pct = (value: number | null | undefined) => value === null || value === undefined ? '--' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
const ratio = (value: number | null | undefined) => value === null || value === undefined ? '--' : `${value.toFixed(2)}x`
const dateText = (value: number | null | undefined) => value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : '--'
const signed = (value: number | null | undefined) => <span className={value === null || value === undefined ? 'text-text-dim' : value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-text'}>{pct(value)}</span>
function SourceLink({ url, label }: { url: string; label: string }) {
  return <button type="button" className="text-accent hover:underline" title={url} onClick={() => void api.openExternal(url)}>{label}</button>
}

export function SemiconductorsPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const query = useSemiconductors()
  const refresh = useRefreshSemiconductors()
  const now = useSnapshotClock()
  const [group, setGroup] = useState<SemiconductorGroup | 'all'>('all')
  const [search, setSearch] = useState('')
  const [symbol, setSymbol] = useState('NVDA')
  const [compare, setCompare] = useState(['NVDA', 'AMD', 'AVGO', 'MU'])
  const [range, setRange] = useState<'1M' | '3M' | 'YTD' | '1Y'>('1Y')
  const [notice, setNotice] = useState('')
  const [view, setView] = useState<'supply' | 'companies' | 'compare' | 'news'>('supply')
  const [feed, setFeed] = useState<'news' | 'earnings'>('news')
  const [detailed, setDetailed] = useState(false)
  const rows = query.data?.data.rows ?? initialRows
  const busy = query.isFetching
  // The payload combines five-minute prices, ten-minute news and twelve-hour
  // profiles. Its dependency expiry, not the oldest profile's retrieval age,
  // determines whether the whole snapshot is still usable as current data.
  const freshnessMs = query.data?.meta.expiresAt !== undefined ? Infinity : FRESHNESS.semiconductors
  const freshness = query.data ? effectiveFreshness(query.data, now, freshnessMs) : 'unavailable'
  const selected = rows.find(row => row.company.symbol === symbol) ?? rows[0]
  const overview = useMemo(() => semiconductorOverview(rows), [rows])
  const returns = useMemo(() => new Map(rows.map(row => [row.company.symbol, rowReturns(row, now)])), [rows, now])
  const filtered = useMemo(() => {
    const wanted = search.trim().toLowerCase()
    return rows.filter(row => (group === 'all' || row.company.group === group) && (!wanted || `${row.company.symbol} ${row.company.name} ${row.company.rationale}`.toLowerCase().includes(wanted)))
  }, [rows, group, search])
  const comparisonRows = compare.flatMap(ticker => rows.find(row => row.company.symbol === ticker) ?? [])
  const start = new Date(now)
  if (range === 'YTD') start.setUTCFullYear(start.getUTCFullYear(), 0, 1)
  else start.setUTCDate(start.getUTCDate() - ({ '1M': 31, '3M': 93, '1Y': 365 }[range]))
  const startDate = start.toISOString().slice(0, 10)
  const comparison = semiconductorComparison(comparisonRows, startDate)
  const comparisonColor = (ticker: string) => {
    const index = comparison.series.findIndex(series => series.symbol === ticker)
    return index < 0 ? 'var(--color-text-dim)' : colorForIndex(index)
  }
  const selectedHistory = selected?.market?.history.filter(point => point.date >= startDate) ?? []
  const news = useMemo(() => semiconductorNews(rows), [rows])
  const marketToday = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const upcoming = rows.filter(row => row.profile?.earningsDate && new Date(row.profile.earningsDate).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) >= marketToday)
    .sort((a, b) => a.profile!.earningsDate! - b.profile!.earningsDate!)
  const errors = query.data?.errors ?? []
  const selectedErrors = errors.filter(error => error.symbol === selected?.company.symbol)
  const issueCompanies = new Set(errors.map(error => error.symbol).filter(Boolean)).size
  const generalWarnings = errors.filter(error => !error.symbol).map(error => `${error.source}: ${error.reason}`).join(' · ')
  const states = (row: SemiconductorRow) => (['market', 'profile', 'news'] as const).map(lane => semiconductorLaneStatus(row, lane, now))

  useEffect(() => onStatusChange([{ label: 'Semiconductors', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: busy, freshnessMs }], ''),
    [onStatusChange, query.data, query.error, query.isEnabled, busy, freshnessMs])
  const onRefresh = async () => {
    setNotice('')
    try { await refresh() } catch (error) { setNotice(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const selectGroup = (next: SemiconductorGroup | 'all') => {
    setGroup(next)
    setSearch('')
    if (next !== 'all' && selected?.company.group !== next) {
      const members = rows.filter(row => row.company.group === next)
      const leader = [...members].sort((a, b) => (b.market?.marketCap ?? 0) - (a.market?.marketCap ?? 0))[0]
      if (leader) setSymbol(leader.company.symbol)
    }
  }
  const columns: Column<SemiconductorRow>[] = [
    { key: 'symbol', header: 'Ticker', cell: row => <span className="font-semibold text-accent">{row.company.symbol}</span>, sortValue: row => row.company.symbol },
    { key: 'company', header: 'Company', cell: row => <span title={row.company.rationale}>{row.company.name}{row.company.diversified ? ' · diversified' : ''}</span>, sortValue: row => row.company.name, width: '16%', wrap: true },
    { key: 'group', header: 'Subsector', cell: row => groupName(row.company.group), sortValue: row => groupName(row.company.group), wrap: true },
    { key: 'price', header: 'Price · USD', cell: row => currency(row.market?.price), sortValue: row => row.market?.price ?? null, numeric: true },
    { key: 'daily', header: '1D', cell: row => signed(row.market?.dailyChange), sortValue: row => row.market?.dailyChange ?? null, numeric: true },
    { key: 'month', header: '1M adj.', cell: row => signed(returns.get(row.company.symbol)?.month), sortValue: row => returns.get(row.company.symbol)?.month ?? null, numeric: true },
    { key: 'ytd', header: 'YTD adj.', cell: row => signed(returns.get(row.company.symbol)?.ytd), sortValue: row => returns.get(row.company.symbol)?.ytd ?? null, numeric: true },
    { key: 'cap', header: 'Market cap', cell: row => compactCurrency(row.market?.marketCap), sortValue: row => row.market?.marketCap ?? null, numeric: true },
    { key: 'pe', header: 'P/E · TTM', cell: row => ratio(row.profile?.trailingPe), sortValue: row => row.profile?.trailingPe ?? null, numeric: true },
    { key: 'forward', header: 'P/E · est.', cell: row => ratio(row.profile?.forwardPe), sortValue: row => row.profile?.forwardPe ?? null, numeric: true },
    { key: 'growth', header: 'Revenue YoY', cell: row => signed(row.profile?.revenueGrowth === null || row.profile?.revenueGrowth === undefined ? null : row.profile.revenueGrowth * 100), sortValue: row => row.profile?.revenueGrowth ?? null, numeric: true },
    { key: 'margin', header: 'Gross margin', cell: row => plainPercent(row.profile?.grossMargin === null || row.profile?.grossMargin === undefined ? null : row.profile.grossMargin * 100, 1), sortValue: row => row.profile?.grossMargin ?? null, numeric: true },
    { key: 'earnings', header: 'Earnings · est.', cell: row => dateText(row.profile?.earningsDate), sortValue: row => row.profile?.earningsDate ?? null },
    { key: 'status', header: 'Data status', cell: row => <span title={(['market', 'profile', 'news'] as const).map(lane => `${lane}: ${semiconductorLaneStatus(row, lane, now)}`).join(' · ')}>{states(row).every(state => state === 'loaded') ? 'Ready' : states(row).every(state => state === 'unavailable') ? busy ? 'Loading' : 'Unavailable' : states(row).includes('stale') ? 'Cached / stale' : 'Partial'}</span> },
  ]
  const companyPanel = (
    <Panel title={`${group === 'all' ? 'Company universe' : groupName(group) + ' · companies'} · ${filtered.length}/${rows.length}`} actions={<Button variant="toggle" active={detailed} onClick={() => setDetailed(!detailed)}>Detailed columns</Button>}>
      <div className="shrink-0 border-b border-border px-2 py-1 text-2xs text-text-dim">Yahoo Finance supplies market data and company profiles. The status bar shows source freshness and failures.</div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
        <input type="search" aria-label="Search semiconductor companies" placeholder="Search ticker, company or business" value={search} onChange={event => setSearch(event.target.value)}
          className="min-w-0 flex-1 border border-border-strong bg-bg px-2 py-1 text-2xs text-text outline-none focus:border-accent" />
        <Button variant="toggle" active={group === 'all'} onClick={() => selectGroup('all')}>All subsectors</Button>
      </div>
      <DataTable columns={detailed ? columns : columns.filter(column => ['symbol', 'company', 'price', 'daily', 'month', 'ytd', 'cap', 'forward', 'status'].includes(column.key)).map(column => column.key === 'company' ? { ...column, wrap: false } : column)} rows={filtered} rowKey={row => row.company.symbol} defaultSort={{ key: 'cap', direction: 'desc' }} minWidth={detailed ? '1450px' : '850px'}
        onRowClick={row => setSymbol(row.company.symbol)} onRowDoubleClick={row => onNavigate('stocks', row.company.symbol)}
        rowClassName={row => row.company.symbol === symbol ? 'bg-surface-hover' : ''} empty="No companies match your filters" />
      <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-dim">USD quotes · 1D price change; 1M/YTD adjusted-close returns · revenue growth is latest reported quarter YoY · gross margin is TTM · P/E forward and earnings dates are provider estimates. Missing data = --.</div>
    </Panel>
  )
  const pricePanel = (
      <Panel title={`${selected?.company.symbol ?? '--'} · adjusted share price`} className="h-[350px] min-w-0" warning={selectedErrors.filter(error => error.operation === 'semiconductors-market').map(error => error.reason).join(' · ') || undefined}
        actions={<div className="flex gap-1">{(['1M', '3M', 'YTD', '1Y'] as const).map(value => <Button key={value} variant="toggle" active={range === value} onClick={() => setRange(value)}>{value}</Button>)}</div>}>
        {selectedHistory.length ? <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2" data-semiconductor-price-chart><LineChart labels={selectedHistory.map(point => point.date)} series={[{ label: symbol, values: selectedHistory.map(point => point.close), color: colorForIndex(0) }]} format={currency} baseline="auto" /></div> : <PanelMessage>{busy ? 'Loading adjusted price history…' : 'Adjusted price history unavailable'}</PanelMessage>}
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-dim">Split/dividend-adjusted USD close · quote {selected?.market?.quoteTime ? new Date(selected.market.quoteTime).toLocaleString() : '--'}</div>
      </Panel>
  )
  const researchPanel = (
      <Panel title={`${selected?.company.symbol ?? '--'} · ${selected?.company.name ?? '--'} · company research`} warning={selectedErrors.map(error => error.reason).join(' · ') || undefined}>
        {selected ? <div className="semi-research-scroll text-2xs text-text">
          <div className="semi-quote"><strong className="num">{currency(selected.market?.price)}</strong>{signed(selected.market?.dailyChange)}</div>
          {view === 'supply' ? <><div className="flex flex-wrap items-center justify-between gap-1 pb-2"><span className="text-text-muted">Adjusted share price</span><div className="flex gap-1">{(['1M', '3M', 'YTD', '1Y'] as const).map(value => <Button key={value} variant="toggle" active={range === value} onClick={() => setRange(value)}>{value}</Button>)}</div></div>
          <div className="semi-selected-chart" data-semiconductor-price-chart>{selectedHistory.length ? <LineChart labels={selectedHistory.map(point => point.date)} series={[{ label: symbol, values: selectedHistory.map(point => point.close), color: colorForIndex(0) }]} format={currency} baseline="auto" /> : <PanelMessage>{busy ? 'Loading adjusted price history…' : 'Adjusted price history unavailable'}</PanelMessage>}</div>
          <div className="mb-2 text-text-dim">Split/dividend-adjusted USD close · quote {selected.market?.quoteTime ? new Date(selected.market.quoteTime).toLocaleString() : '--'}</div></> : null}
          <div className="flex flex-wrap gap-1 pb-2"><Button onClick={() => onNavigate('charts', symbol)}>Charts</Button><Button onClick={() => onNavigate('stocks', symbol)}>Stocks</Button><Button onClick={() => onNavigate('fundamentals', symbol)}>Fundamentals</Button>{['MU', 'AVGO'].includes(symbol) ? <Button onClick={() => onNavigate(symbol.toLowerCase())}>{symbol} Focus</Button> : null}
            <Button disabled={compare.includes(symbol) || compare.length >= 4} onClick={() => setCompare([...compare, symbol])}>+ Compare</Button></div>
          <div className="text-text-muted">{groupName(selected.company.group)} · {selected.company.headquarters} · {selected.company.exchange}{selected.company.diversified ? ' · diversified business' : ''}</div>
          <p className="my-2 font-semibold">{selected.company.rationale}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-y border-border py-2">
            <span>Price · USD {currency(selected.market?.price)}</span><span>Market cap {compactCurrency(selected.market?.marketCap)}</span>
            <span>P/E · TTM {ratio(selected.profile?.trailingPe)}</span><span>P/E · estimate {ratio(selected.profile?.forwardPe)}</span>
            <span>Revenue · TTM {compactCurrency(selected.profile?.revenue)}</span><span>Next earnings · estimate {dateText(selected.profile?.earningsDate)}</span>
          </div>
          <p className="my-2 text-text-muted">{selected.profile?.description || (busy ? 'Loading company profile…' : 'Company description unavailable.')}</p>
          <div className="flex flex-wrap gap-3">{selected.company.sourceUrls.map((url, index) => <SourceLink key={url} url={url} label={index === 0 ? 'Annual report' : index === 1 ? 'SEC filings' : `Company source ${index - 1}`} />)}</div>
          <div className="mt-2 text-text-dim">Reviewed {selected.company.reviewedAt} · financial metrics apply to the whole company.</div>
          {(['market', 'profile', 'news'] as const).map(lane => <div key={lane} className="mt-1 text-text-dim">{lane}: {busy && selected.progress[lane] === 'unavailable' ? 'loading' : semiconductorLaneStatus(selected, lane, now)} · fetched {selected.fetchedAt[lane] ? new Date(selected.fetchedAt[lane]!).toLocaleString() : '--'}</div>)}
          {selectedErrors.length ? <div className="mt-2 text-warn">{selectedErrors.map(error => `${error.operation.replace('semiconductors-', '')}: ${error.reason}`).join(' · ')}</div> : null}
        </div> : <PanelMessage>Company unavailable</PanelMessage>}
      </Panel>
  )
  const comparisonPanel = (
    <Panel title="Peer comparison · adjusted price performance" className={view === 'compare' ? 'semi-detail-panel' : ''}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2 text-2xs">
        {compare.map(ticker => <button type="button" key={ticker} className="border border-border-strong px-2 py-1 text-text hover:border-accent" aria-label={`Remove ${ticker} from comparison`} onClick={() => setCompare(compare.filter(value => value !== ticker))}><span className="mr-1 inline-block size-2" style={{ backgroundColor: comparisonColor(ticker) }} />{ticker} ×</button>)}
        <select aria-label="Add comparison company" value="" disabled={compare.length >= 4} className="max-w-full border border-border-strong bg-surface px-2 py-1 text-text" onChange={event => { if (event.target.value && compare.length < 4) setCompare([...compare, event.target.value]) }}>
          <option value="">{compare.length >= 4 ? 'Four-company limit' : 'Add company…'}</option>{rows.filter(row => !compare.includes(row.company.symbol)).map(row => <option key={row.company.symbol} value={row.company.symbol}>{row.company.symbol} · {row.company.name}</option>)}
        </select><div className="flex gap-1">{(['1M', '3M', 'YTD', '1Y'] as const).map(value => <Button key={value} variant="toggle" active={range === value} onClick={() => setRange(value)}>{value}</Button>)}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2" data-semiconductor-comparison-chart><LineChart labels={comparison.dates} series={comparison.series.map((series, index) => ({ label: series.symbol, values: series.values, color: colorForIndex(index) }))} format={value => pct(value)} baseline="zero" empty={busy ? 'Loading comparison histories…' : 'Select companies with overlapping adjusted histories'} /></div>
      {view === 'compare' ? <div className="flex h-[140px] shrink-0 flex-col border-t border-border"><DataTable columns={[
        { key: 'symbol', header: 'Ticker', cell: row => row.company.symbol },
        { key: 'cap', header: 'Market cap', cell: row => compactCurrency(row.market?.marketCap), numeric: true },
        { key: 'pe', header: 'P/E · TTM', cell: row => ratio(row.profile?.trailingPe), numeric: true },
        { key: 'forward', header: 'P/E · est.', cell: row => ratio(row.profile?.forwardPe), numeric: true },
        { key: 'growth', header: 'Revenue YoY', cell: row => pct(row.profile?.revenueGrowth === null || row.profile?.revenueGrowth === undefined ? null : row.profile.revenueGrowth * 100), numeric: true },
        { key: 'margin', header: 'Gross margin · TTM', cell: row => pct(row.profile?.grossMargin === null || row.profile?.grossMargin === undefined ? null : row.profile.grossMargin * 100), numeric: true },
      ]} rows={comparisonRows} rowKey={row => row.company.symbol} minWidth="640px" empty="No comparison companies selected" /></div> : null}
      <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-dim">{range} · adjusted returns from first shared session · gaps remain missing</div>
      {comparisonRows.some(row => !row.market?.history.length) ? <div className="shrink-0 px-2 text-2xs text-warn">Missing histories: {comparisonRows.filter(row => !row.market?.history.length).map(row => row.company.symbol).join(', ')}</div> : null}
    </Panel>
  )
  const feedPanel = (
    <Panel title="News & upcoming earnings" className={view === 'news' ? 'semi-detail-panel' : ''} warning={errors.some(error => error.operation === 'semiconductors-news') ? 'Some company news feeds are unavailable or cached.' : undefined}>
      <div className="semi-feed-tabs" aria-label="News and earnings views"><button aria-pressed={feed === 'news'} onClick={() => setFeed('news')}>Latest news</button><button aria-pressed={feed === 'earnings'} onClick={() => setFeed('earnings')}>Upcoming earnings</button></div>
      {feed === 'earnings' ? <>
        <DataTable columns={[
          { key: 'date', header: 'Date · New York', cell: row => dateText(row.profile?.earningsDate) },
          { key: 'symbol', header: 'Ticker', cell: row => row.company.symbol },
          { key: 'name', header: 'Company', cell: row => row.company.name, wrap: true },
        ]} rows={upcoming} rowKey={row => row.company.symbol} onRowClick={row => { setSymbol(row.company.symbol); setGroup(row.company.group); setSearch(''); setView('supply') }} empty={busy ? 'Loading earnings estimates…' : 'No upcoming earnings estimates available'} />
        <div className="shrink-0 border-t border-border p-2 text-2xs text-text-dim">{rows.filter(row => row.profile?.earningsDate).length}/{rows.length} companies have a date estimate. Dates can change; missing estimates are not confirmed absences.</div>
      </> : <>
        {news.length ? <div className="min-h-0 flex-1 overflow-auto px-2">{news.slice(0, 100).map(article => <div key={article.url || article.id} className="border-b border-border py-2 text-2xs"><SourceLink url={article.url} label={article.title} /><div className="mt-1 text-text-dim">{article.ticker} · {article.source} · {new Date(article.publishedAt).toLocaleString()}</div></div>)}</div> : <PanelMessage>{busy ? 'Loading company news…' : rows.every(row => row.progress.news === 'unavailable') ? 'Company news unavailable' : 'No matching company headlines returned'}</PanelMessage>}
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-dim">Ticker-associated headlines · latest 100 · {rows.filter(row => row.progress.news !== 'unavailable').length}/{rows.length} company feeds</div>
      </>}
    </Panel>
  )

  return <div className="semi-page" data-semiconductors-page>
    <div className="semi-header">
      <div className="semi-title"><h1>Semiconductors</h1><p>U.S. supply chain</p></div>
      <div className="semi-summary">
        <div title={`Catalog reviewed ${query.data?.data.catalogReviewedAt ?? SEMICONDUCTOR_REVIEW_DATE}`}><strong className="num">{overview.count}</strong><span>Reviewed companies</span></div>
        <div title={`${overview.capCount}/${overview.count} market cap observations · whole companies`}><strong className="num">{overview.capCount ? compactCurrency(overview.marketCap) : '--'}</strong><span>Combined market cap · USD</span></div>
        <div title={`${overview.unchanged} unchanged · ${overview.quoteCount}/${overview.count} daily quotes`}><strong className="num">{overview.quoteCount ? <><span className="text-up">{overview.advancing} ↑</span> / <span className="text-down">{overview.declining} ↓</span></> : '--'}</strong><span>Daily breadth</span></div>
        <div title={`${overview.quoteCount}/${overview.count} observations · equal weight`}><strong className="num">{signed(overview.daily)}</strong><span>Equal-weight daily return</span></div>
      </div>
      <div className="semi-load-status"><Button variant="accent" disabled={busy} onClick={() => void onRefresh()}>{busy ? 'Refreshing...' : 'Refresh'}</Button><span role="status">{notice || (busy ? 'Loading company quotes, profiles, adjusted histories and news…' : query.error ? `Load failed: ${query.error.message}` : `${freshness} · ${rows.filter(row => row.market).length}/${rows.length} market snapshots`)}</span></div>
    </div>
    {(errors.length || query.error || notice) ? <div role="alert" className="shrink-0 border border-warn/40 bg-surface px-2 py-1 text-2xs text-warn">{query.error?.message || notice || `${errors.length} data issue(s) across ${issueCompanies} companies. Usable data remains visible; select a company to inspect its warnings. ${generalWarnings}`}</div> : null}
    <nav className="semi-nav" aria-label="Semiconductor views">{([
      ['supply', 'Supply chain'], ['companies', 'Companies'], ['compare', 'Compare'], ['news', 'News & earnings'],
    ] as const).map(([id, label]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</nav>
    {view === 'supply' ? <>
      <SupplyChainExplorer rows={rows} group={group} onSelect={selectGroup} loading={busy} />
      <div className="semi-screen-grid" data-semiconductor-universe>{companyPanel}<Panel title="Subsector performance"><SubsectorPerformance rows={rows} group={group} onSelect={selectGroup} /></Panel></div>
      <div className="semi-bottom-grid">{researchPanel}{comparisonPanel}{feedPanel}</div>
    </> : view === 'companies' ? <>
      <div className="flex shrink-0 flex-wrap gap-1" aria-label="Subsector filters">{SEMICONDUCTOR_GROUPS.map(item => <Button key={item.id} variant="toggle" active={group === item.id} onClick={() => selectGroup(group === item.id ? 'all' : item.id)}>{item.label}</Button>)}</div>
      <div className="semi-screen-grid semi-companies-view" data-semiconductor-universe>{companyPanel}</div>
      <div className="semi-research-view">{pricePanel}{researchPanel}</div>
    </> : view === 'compare' ? comparisonPanel : feedPanel}
    <div className="shrink-0 border border-border bg-surface p-2 text-2xs text-text-dim">{SEMICONDUCTOR_COVERAGE_NOTE} <SourceLink url="https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt" label="Listing directory" /> · Company-specific inclusion evidence is linked above.</div>
  </div>
}
