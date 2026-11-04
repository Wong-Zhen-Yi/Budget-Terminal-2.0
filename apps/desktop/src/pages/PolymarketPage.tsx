import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { Envelope } from '@shared/contract'
import { POLYMARKET_TTL, type Json, type PolymarketRequest, type PolymarketResult } from '@shared/polymarket'
import { boardRequest, list, marketRequest, object, rows, usePolymarket } from '@/api/polymarketQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { PolymarketExplorer } from './PolymarketExplorer'
import { MarketChart, MarketImage, MarketBook, MarketActivity, formatMoney, formatNumber, probability } from './polymarket/MarketViews'
import '@/styles/polymarket.css'

type RecordData = Record<string, Json>
const topics = ['Trending', 'Politics', 'Sports', 'Crypto', 'Finance', 'Economy', 'Tech']
const ranges = [['1h', '1H'], ['1d', '1D'], ['1w', '1W'], ['1m', '1M'], ['max', 'ALL']]
const fallback: PolymarketRequest = { endpoint: 'clob:/time' }

function useRead(label: string, request: PolymarketRequest, enabled: boolean, live: boolean, report: (status: PanelStatus) => void) {
  const query = usePolymarket(request, enabled, live && enabled)
  useEffect(() => report({ label, envelope: query.data, loading: query.isFetching, error: query.error, enabled, freshnessMs: POLYMARKET_TTL }),
    [label, query.data, query.isFetching, query.error, enabled, report])
  return query
}
function Empty({ query, children }: { query: UseQueryResult<Envelope<PolymarketResult>>; children: ReactNode }) {
  return !query.data ? <div className="poly-empty">{query.isFetching ? 'Getting market data…' : query.isError ? 'This data is unavailable. Retry with Refresh; details are in Settings.' : 'Choose a market to explore.'}</div> : <>{children}</>
}

export function PolymarketPage({ active, onStatusChange }: { active: boolean; onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const client = useQueryClient()
  const [view, setView] = useState('markets')
  const [topic, setTopic] = useState('Trending')
  const [page, setPage] = useState(0)
  const [closed, setClosed] = useState(false)
  const [search, setSearch] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')
  const [selected, setSelected] = useState<RecordData | null>(null)
  const [outcome, setOutcome] = useState(0)
  const [interval, setInterval] = useState('1w')
  const [auto, setAuto] = useState(false)
  const [detailTab, setDetailTab] = useState('Activity')
  const [statuses, setStatuses] = useState<Record<string, PanelStatus>>({})
  const report = useCallback((status: PanelStatus) => setStatuses(previous => ({ ...previous, [status.label]: status })), [])
  const live = active && auto
  const tag = useRead('Category', { endpoint: 'gamma:/tags/slug/{slug}', params: { slug: topic.toLowerCase() } }, topic !== 'Trending', false, report)
  const tagId = object(tag.data?.data.value).id
  const request = useMemo<PolymarketRequest>(() => ({ ...marketRequest, params: { ...marketRequest.params, closed: String(closed), offset: String(page * 25), ...(topic !== 'Trending' && tagId != null ? { tag_id: String(tagId) } : {}) } }), [closed, page, topic, tagId])
  const markets = useRead('Markets', request, topic === 'Trending' || tagId != null, live, report)
  const searchQuery = useRead('Market search', { endpoint: 'gamma:/public-search', params: { q: submittedSearch } }, Boolean(submittedSearch), false, report)
  const sourceRows = rows(markets.data?.data.value)
  const foundRows = useMemo(() => {
    const events = object(searchQuery.data?.data.value).events
    return Array.isArray(events) ? events.flatMap(event => {
      const value = object(event).markets
      return Array.isArray(value) ? value.map(item => object(item)) : []
    }) : []
  }, [searchQuery.data])
  const shown = submittedSearch ? foundRows : topic !== 'Trending' && tagId == null ? [] : sourceRows
  const market = selected ?? shown[0] ?? {}
  const names = list(market.outcomes)
  const prices = list(market.outcomePrices)
  const token = list(market.clobTokenIds)[outcome]
  const condition = String(market.conditionId ?? '')
  const book = useRead('Order book', token ? { endpoint: 'clob:/book', params: { token_id: token } } : fallback, Boolean(token), live, report)
  const history = useRead('Probability history', token ? { endpoint: 'data:/v2/prices-history', params: { token_id: token, interval } } : fallback, Boolean(token), live, report)
  const trades = useRead('Recent trades', { endpoint: 'data:/v2/trades', params: { condition, limit: '25' } }, Boolean(condition), live, report)
  const interest = useRead('Open interest', { endpoint: 'data:/v2/oi', params: { condition } }, Boolean(condition), live, report)
  const holders = useRead('Top holders', { endpoint: 'data:/v2/holders', params: { condition, limit: '20' } }, Boolean(condition), live, report)
  const board = useRead('Leaderboard', boardRequest, true, live, report)
  useEffect(() => { onStatusChange(Object.values(statuses), 'https://docs.polymarket.com/market-data/overview') }, [statuses, onStatusChange])
  const pick = (row: RecordData, index = 0) => { setSelected(row); setOutcome(index) }
  const reset = () => { setPage(0); setSelected(null); setOutcome(0) }
  const chartPoints = rows(history.data?.data.value)
  const lastPoint = chartPoints[chartPoints.length - 1]
  const lastPrice = lastPoint?.price
  const chance = prices[outcome] == null ? lastPrice : Number(prices[outcome])
  const dayChange = market.oneDayPriceChange == null ? null : Number(market.oneDayPriceChange) * (outcome === 1 ? -100 : 100)
  const oi = rows(interest.data?.data.value)[0]?.value
  const currentQuery = submittedSearch ? searchQuery : markets
  const end = typeof market.endDate === 'string' ? new Date(market.endDate) : null
  return <div className="poly-page">
    <header className="poly-header">
      <div className="poly-brand"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M3 5h22v18H3zM3 16l7-5 7 4 8-9M10 11v12M17 15v8"/></svg><h1>Polymarket</h1><span>Prediction markets</span></div>
      <div className="poly-header-actions"><label className="poly-auto"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)}/>Auto-refresh · 30s</label><button className="poly-button" onClick={() => void client.refetchQueries({ queryKey: ['polymarket'], type: 'active' })}>↻ Refresh</button></div>
    </header>
    <div className="poly-navigation"><nav aria-label="Polymarket views">{[['markets', 'Markets'], ['explorer', 'Data explorer']].map(([id, label]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</nav><span className="poly-readonly">Public data · Read only</span></div>
    {view === 'explorer' ? <div className="poly-explorer"><div className="poly-section-heading"><div><h2>Public data explorer</h2><p>Markets, wallets, leaderboards and every public dataset. Full records when you need them.</p></div></div><PolymarketExplorer market={market} token={token} active={live} onStatus={report}/></div> : <>
      <div className="poly-discovery-bar"><nav aria-label="Market categories">{topics.map(item => <button key={item} aria-pressed={topic === item && !submittedSearch} onClick={() => { setTopic(item); setSubmittedSearch(''); setSearch(''); reset() }}>{item === 'Trending' ? '↗ ' : ''}{item}</button>)}</nav><form className="poly-search" onSubmit={e => { e.preventDefault(); setSubmittedSearch(search.trim()); reset() }}><span aria-hidden="true">⌕</span><input aria-label="Search markets" placeholder="Search all markets" value={search} onChange={e => { setSearch(e.target.value); if (!e.target.value) { setSubmittedSearch(''); reset() } }}/><button type="submit" aria-label="Submit market search">↵</button></form></div>
      <div className="poly-workspace">
      <section className="poly-discover"><div className="poly-section-heading"><div><h2>{submittedSearch ? `Results for “${submittedSearch}”` : topic === 'Trending' ? 'Trending markets' : `${topic} markets`}</h2><p>{submittedSearch ? `${shown.length} markets found` : 'Explore the questions moving the crowd.'}</p></div><select aria-label="Market status" value={String(closed)} onChange={e => { setClosed(e.target.value === 'true'); reset() }}><option value="false">Active markets</option><option value="true">Closed markets</option></select></div>
        {currentQuery.isFetching && !shown.length ? <div className="poly-skeletons">{[0, 1, 2].map(i => <div key={i}/>)}</div> : !shown.length ? <div className="poly-empty">{currentQuery.isError || (topic !== 'Trending' && tag.isError) ? 'Markets unavailable. Retry with Refresh; details are in Settings.' : 'No matching markets. Try another topic or search.'}</div> : <div className="poly-market-grid">{shown.map(row => <article className="poly-market-card" key={String(row.id)} data-selected={row.id === market.id}>
          <button className="poly-card-question" onClick={() => pick(row)}><MarketImage market={row}/><h3>{String(row.question ?? 'Untitled market')}</h3></button><div className="poly-card-outcomes">{list(row.outcomes).slice(0, 2).map((name, i) => <button key={i} className={i === 1 ? 'poly-no' : 'poly-yes'} onClick={() => pick(row, i)}><span>{name}</span><strong>{probability(list(row.outcomePrices)[i])}</strong></button>)}</div><div className="poly-card-footer"><span>{formatMoney(row.volume)} Vol.</span><span>{formatNumber(row.liquidity)} liquidity</span><button aria-label={`Explore ${String(row.question)}`} onClick={() => pick(row)}>↗</button></div>
        </article>)}</div>}
        {!submittedSearch && <div className="poly-pagination"><button disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(null); setOutcome(0) }}>← Previous</button><span>Page {page + 1}</span><button disabled={sourceRows.length < 25} onClick={() => { setPage(page + 1); setSelected(null); setOutcome(0) }}>Next →</button></div>}
      </section>
      <div className="poly-analysis">
      <div className="poly-detail-layout">
        <main className="poly-feature">
          <div className="poly-question"><MarketImage market={market}/><div><div className="poly-eyebrow">{closed ? 'Closed market' : 'Market spotlight'}<span>•</span>{end && Number.isFinite(end.getTime()) ? `Ends ${end.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Prediction market'}</div><h2>{String(market.question ?? (currentQuery.isFetching ? 'Finding the next market…' : 'No markets to display'))}</h2></div></div>
          <div className="poly-probability"><strong>{probability(chance)}</strong><div><span>Chance of {names[outcome] ?? 'outcome'}</span>{dayChange != null && Number.isFinite(dayChange) && <small className={dayChange >= 0 ? 'poly-positive' : 'poly-negative'}>{dayChange >= 0 ? '↗ +' : '↘ '}{dayChange.toFixed(1)} pts today</small>}</div><div className="poly-outcomes">{names.map((name, i) => <button key={i} className={i === 1 ? 'poly-no' : 'poly-yes'} aria-pressed={outcome === i} onClick={() => setOutcome(i)}>{name}<strong>{prices[i] == null ? '—' : `${(Number(prices[i]) * 100).toFixed(1)}¢`}</strong></button>)}</div></div>
          <div className="poly-chart-toolbar"><span className="poly-chart-legend"><i/>{names[outcome] ?? 'Outcome'} probability</span><div aria-label="History range">{ranges.map(([value, label]) => <button key={value} aria-pressed={interval === value} onClick={() => setInterval(value)}>{label}</button>)}</div></div>
          <Empty query={history}><MarketChart value={history.data?.data.value}/></Empty>
          <div className="poly-market-metrics"><div><span>Total volume</span><strong>{formatMoney(market.volume)}</strong></div><div><span>24h volume</span><strong>{formatMoney(market.volume24hr)}</strong></div><div><span>Liquidity</span><strong>{formatMoney(market.liquidity)}</strong></div><div><span>Open interest</span><strong>{interest.error ? 'Unavailable' : formatMoney(oi)}</strong></div></div>
        </main>
        <aside className="poly-book-panel"><div className="poly-card-heading"><h3>Order book</h3><span>{names[outcome] ?? 'Outcome'}</span></div><Empty query={book}><MarketBook value={book.data?.data.value}/></Empty><div className="poly-book-note"><strong>Market-implied probability</strong><p>Outcome prices reflect what traders are willing to pay. Winning shares settle at $1.</p></div></aside>
      </div>
      <section className="poly-activity-panel"><div className="poly-tab-heading"><nav aria-label="Market details">{['Activity', 'Order book', 'Top holders', 'Rules', 'Leaderboard'].map(label => <button key={label} aria-pressed={detailTab === label} onClick={() => setDetailTab(label)}>{label}</button>)}</nav><span>{detailTab === 'Activity' ? 'Latest matched trades' : detailTab === 'Top holders' ? 'Public market positions' : detailTab === 'Leaderboard' ? 'Daily profit & loss' : 'Resolution criteria'}</span></div>
        {detailTab === 'Order book' ? <div className="poly-expanded-book"><Empty query={book}><MarketBook value={book.data?.data.value}/></Empty></div> : detailTab === 'Rules' ? <div className="poly-rules"><p>{String(market.description ?? 'No resolution criteria supplied.')}</p><dl><div><dt>Condition ID</dt><dd>{condition || '—'}</dd></div><div><dt>Selected outcome ID</dt><dd>{token ?? '—'}</dd></div></dl></div> : <Empty query={detailTab === 'Activity' ? trades : detailTab === 'Top holders' ? holders : board}><MarketActivity value={(detailTab === 'Activity' ? trades : detailTab === 'Top holders' ? holders : board).data?.data.value} kind={detailTab} outcome={names[outcome]} token={token}/></Empty>}
      </section>
      </div>
      </div>
    </>}
  </div>
}
