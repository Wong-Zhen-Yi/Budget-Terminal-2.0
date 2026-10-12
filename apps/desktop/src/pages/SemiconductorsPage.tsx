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

const initialRows: SemiconductorRow[] = SEMICONDUCTOR_CATALOG.map(company => ({ company, market: null, profile: null, news: [],
  progress: { market: 'unavailable', profile: 'unavailable', news: 'unavailable' }, fetchedAt: { market: null, profile: null, news: null } }))
const groupName = (id: SemiconductorGroup) => SEMICONDUCTOR_GROUPS.find(group => group.id === id)!.label
const pct = (value: number | null | undefined) => value === null || value === undefined ? '--' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
const ratio = (value: number | null | undefined) => value === null || value === undefined ? '--' : `${value.toFixed(2)}x`
const dateText = (value: number | null | undefined) => value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : '--'
const signed = (value: number | null | undefined) => <span className={value === null || value === undefined ? 'text-text-dim' : value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-text'}>{pct(value)}</span>
function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="min-w-0 border border-border bg-surface px-3 py-2"><div className="text-2xs text-text-muted">{label}</div><div className="num text-lg font-semibold text-text">{value}</div><div className="text-2xs text-text-dim">{note}</div></div>
}
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

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-auto p-2" data-semiconductors-page>
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <h1 className="text-sm font-semibold text-text">Semiconductors · U.S. supply chain</h1>
      <span className="ml-auto text-2xs text-text-muted" role="status">{notice || (busy ? 'Loading company quotes, profiles, adjusted histories and news…' : query.error ? `Load failed: ${query.error.message}` : `${freshness} · ${rows.filter(row => row.market).length}/${rows.length} market snapshots`)}</span>
      <Button variant="accent" disabled={busy} onClick={() => void onRefresh()}>{busy ? 'Refreshing...' : 'Refresh'}</Button>
    </div>
    {(errors.length || query.error || notice) ? <div role="alert" className="shrink-0 border border-warn/40 bg-surface px-2 py-1 text-2xs text-warn">{query.error?.message || notice || `${errors.length} data issue(s) across ${issueCompanies} companies. Usable data remains visible; select a company to inspect its warnings. ${generalWarnings}`}</div> : null}
    <div className="grid shrink-0 grid-cols-2 gap-2 xl:grid-cols-4">
      <Tile label="Reviewed companies" value={String(overview.count)} note={`Catalog reviewed ${query.data?.data.catalogReviewedAt ?? SEMICONDUCTOR_REVIEW_DATE}`} />
      <Tile label="Combined market cap · USD" value={overview.capCount ? compactCurrency(overview.marketCap) : '--'} note={`${overview.capCount}/${overview.count} observations · whole companies`} />
      <Tile label="Daily breadth" value={overview.quoteCount ? `${overview.advancing} ↑ / ${overview.declining} ↓` : '--'} note={`${overview.unchanged} unchanged · ${overview.quoteCount}/${overview.count} observations`} />
      <Tile label="Equal-weight daily return" value={pct(overview.daily)} note={`${overview.quoteCount}/${overview.count} quotes · entire reviewed catalog`} />
    </div>
    <Panel title="Semiconductor supply chain" className="shrink-0">
      <div className="grid grid-cols-2 gap-1 p-2 md:grid-cols-4">
        {SEMICONDUCTOR_GROUPS.map(item => {
          const members = rows.filter(row => row.company.group === item.id)
          const stats = semiconductorOverview(members)
          return <button type="button" key={item.id} aria-pressed={group === item.id} onClick={() => setGroup(group === item.id ? 'all' : item.id)}
            className={`min-w-0 border p-2 text-left ${group === item.id ? 'border-accent bg-surface-hover' : 'border-border hover:bg-surface-hover'}`}>
            <div className="flex flex-wrap justify-between gap-1 text-2xs font-semibold text-text"><span>{item.label} · {members.length}</span>{signed(stats.daily)}</div>
            <div className="mt-1 text-2xs text-text-muted">{item.description}</div><div className="mt-1 text-2xs text-text-dim">{stats.quoteCount}/{members.length} daily observations</div>
          </button>
        })}
      </div>
    </Panel>
    <Panel title={`Company universe · ${filtered.length}/${rows.length}`} className="h-[430px] shrink-0" actions={<Button active={group === 'all'} variant="toggle" onClick={() => setGroup('all')}>All subsectors</Button>}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
        <input type="search" aria-label="Search semiconductor companies" placeholder="Search ticker, company or business" value={search} onChange={event => setSearch(event.target.value)}
          className="min-w-0 flex-1 border border-border-strong bg-bg px-2 py-1 text-2xs text-text outline-none focus:border-accent" />
        <span className="text-2xs text-text-muted">Click to inspect · double-click opens Stocks</span>
      </div>
      <DataTable columns={columns} rows={filtered} rowKey={row => row.company.symbol} defaultSort={{ key: 'cap', direction: 'desc' }} minWidth="1450px"
        onRowClick={row => setSymbol(row.company.symbol)} onRowDoubleClick={row => onNavigate('stocks', row.company.symbol)}
        rowClassName={row => row.company.symbol === symbol ? 'bg-surface-hover' : ''} empty="No companies match your filters" />
      <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-dim">USD quotes · 1D price change; 1M/YTD adjusted-close returns · revenue growth is latest reported quarter YoY · gross margin is TTM · P/E forward and earnings dates are provider estimates. Missing data = --.</div>
    </Panel>

    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title={`${selected?.company.symbol ?? '--'} · adjusted share price`} className="h-[350px] min-w-0" warning={selectedErrors.filter(error => error.operation === 'semiconductors-market').map(error => error.reason).join(' · ') || undefined}
        actions={<div className="flex gap-1">{(['1M', '3M', 'YTD', '1Y'] as const).map(value => <Button key={value} variant="toggle" active={range === value} onClick={() => setRange(value)}>{value}</Button>)}</div>}>
        {selectedHistory.length ? <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2" data-semiconductor-price-chart><LineChart labels={selectedHistory.map(point => point.date)} series={[{ label: symbol, values: selectedHistory.map(point => point.close), color: colorForIndex(0) }]} format={currency} baseline="auto" /></div> : <PanelMessage>{busy ? 'Loading adjusted price history…' : 'Adjusted price history unavailable'}</PanelMessage>}
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-dim">Split/dividend-adjusted USD close · quote {selected?.market?.quoteTime ? new Date(selected.market.quoteTime).toLocaleString() : '--'}</div>
      </Panel>
      <Panel title={`${selected?.company.name ?? '--'} · company research`} className="h-[350px] min-w-0" warning={selectedErrors.map(error => error.reason).join(' · ') || undefined}>
        {selected ? <div className="min-h-0 flex-1 overflow-auto p-2 text-2xs text-text">
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
    </div>

    <Panel title="Peer comparison · adjusted price performance" className="h-[430px] shrink-0">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2 text-2xs">
        {compare.map(ticker => <button type="button" key={ticker} className="border border-border-strong px-2 py-1 text-text hover:border-accent" aria-label={`Remove ${ticker} from comparison`} onClick={() => setCompare(compare.filter(value => value !== ticker))}><span className="mr-1 inline-block size-2" style={{ backgroundColor: comparisonColor(ticker) }} />{ticker} ×</button>)}
        <select aria-label="Add comparison company" value="" disabled={compare.length >= 4} className="max-w-full border border-border-strong bg-surface px-2 py-1 text-text" onChange={event => { if (event.target.value && compare.length < 4) setCompare([...compare, event.target.value]) }}>
          <option value="">{compare.length >= 4 ? 'Four-company limit' : 'Add company…'}</option>{rows.filter(row => !compare.includes(row.company.symbol)).map(row => <option key={row.company.symbol} value={row.company.symbol}>{row.company.symbol} · {row.company.name}</option>)}
        </select><span className="text-text-dim">{range} · starts at first shared session · missing dates leave gaps</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2" data-semiconductor-comparison-chart><LineChart labels={comparison.dates} series={comparison.series.map((series, index) => ({ label: series.symbol, values: series.values, color: colorForIndex(index) }))} format={value => pct(value)} baseline="zero" empty={busy ? 'Loading comparison histories…' : 'Select companies with overlapping adjusted histories'} /></div>
      <div className="flex h-[140px] shrink-0 flex-col border-t border-border"><DataTable columns={[
        { key: 'symbol', header: 'Ticker', cell: row => row.company.symbol },
        { key: 'cap', header: 'Market cap', cell: row => compactCurrency(row.market?.marketCap), numeric: true },
        { key: 'pe', header: 'P/E · TTM', cell: row => ratio(row.profile?.trailingPe), numeric: true },
        { key: 'forward', header: 'P/E · est.', cell: row => ratio(row.profile?.forwardPe), numeric: true },
        { key: 'growth', header: 'Revenue YoY', cell: row => pct(row.profile?.revenueGrowth === null || row.profile?.revenueGrowth === undefined ? null : row.profile.revenueGrowth * 100), numeric: true },
        { key: 'margin', header: 'Gross margin · TTM', cell: row => pct(row.profile?.grossMargin === null || row.profile?.grossMargin === undefined ? null : row.profile.grossMargin * 100), numeric: true },
      ]} rows={comparisonRows} rowKey={row => row.company.symbol} minWidth="640px" empty="No comparison companies selected" /></div>
      {comparisonRows.some(row => !row.market?.history.length) ? <div className="shrink-0 px-2 text-2xs text-warn">Missing histories: {comparisonRows.filter(row => !row.market?.history.length).map(row => row.company.symbol).join(', ')}</div> : null}
    </Panel>

    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title="Upcoming earnings · provider estimates" className="h-[280px] min-w-0">
        <DataTable columns={[
          { key: 'date', header: 'Date · New York', cell: row => dateText(row.profile?.earningsDate) },
          { key: 'symbol', header: 'Ticker', cell: row => row.company.symbol },
          { key: 'name', header: 'Company', cell: row => row.company.name, wrap: true },
        ]} rows={upcoming} rowKey={row => row.company.symbol} onRowClick={row => setSymbol(row.company.symbol)} empty={busy ? 'Loading earnings estimates…' : 'No upcoming earnings estimates available'} />
        <div className="shrink-0 border-t border-border p-2 text-2xs text-text-dim">{rows.filter(row => row.profile?.earningsDate).length}/{rows.length} companies have a date estimate. Dates can change; missing estimates are not confirmed absences.</div>
      </Panel>
      <Panel title={`Industry news · ${news.length} headlines`} className="h-[280px] min-w-0" warning={errors.some(error => error.operation === 'semiconductors-news') ? 'Some company news feeds are unavailable or cached.' : undefined}>
        {news.length ? <div className="min-h-0 flex-1 overflow-auto px-2">{news.slice(0, 100).map(article => <div key={article.url || article.id} className="border-b border-border py-2 text-2xs"><SourceLink url={article.url} label={article.title} /><div className="mt-1 text-text-dim">{article.ticker} · {article.source} · {new Date(article.publishedAt).toLocaleString()}</div></div>)}</div> : <PanelMessage>{busy ? 'Loading company news…' : rows.every(row => row.progress.news === 'unavailable') ? 'Company news unavailable' : 'No matching company headlines returned'}</PanelMessage>}
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-dim">Ticker-associated headlines · latest 100 · {rows.filter(row => row.progress.news !== 'unavailable').length}/{rows.length} company feeds</div>
      </Panel>
    </div>
    <div className="shrink-0 border border-border bg-surface p-2 text-2xs text-text-dim">{SEMICONDUCTOR_COVERAGE_NOTE} <SourceLink url="https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt" label="Listing directory" /> · Company-specific inclusion evidence is linked above.</div>
  </div>
}
