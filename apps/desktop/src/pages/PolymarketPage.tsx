import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { POLYMARKET_ENDPOINTS, POLYMARKET_TTL, type Json, type PolymarketRequest } from '@shared/polymarket'
import { boardRequest, list, marketDetails, marketRequest, object, rows, usePolymarket } from '@/api/polymarketQueries'
import { api } from '@/api/client'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'

const inputClass = 'h-8 min-w-0 border border-border-strong bg-surface-raised px-2 text-xs text-text'
const display = (value: Json | undefined): string => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const number = (value: Json | undefined) => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Intl.NumberFormat('en', { maximumFractionDigits: 2, notation: 'compact' }).format(Number(value))

function DataView({ value }: { value: Json | undefined }) {
  const [raw, setRaw] = useState(false)
  const data = rows(value)
  const keys = [...new Set(data.flatMap(row => Object.keys(row)))]
  return <div className="flex min-h-0 flex-col gap-2 p-3">
    <div className="flex items-center gap-3 text-xs text-text-muted"><span>{data.length ? `${data.length} records` : 'Response'}</span><Button onClick={() => setRaw(!raw)}>{raw ? 'Table' : 'Full JSON'}</Button><Button onClick={() => void api.writeClipboard(JSON.stringify(value ?? null, null, 2))}>Copy JSON</Button></div>
    <div className="max-h-96 overflow-auto">
      {raw || !data.length || !keys.length ? <pre className="whitespace-pre-wrap break-all text-xs">{value == null ? 'No data returned.' : JSON.stringify(value, null, 2)}</pre> : <table className="w-full text-left text-xs"><thead><tr>{keys.map(key => <th key={key} className="sticky top-0 border-b border-border bg-surface-raised p-2">{key}</th>)}</tr></thead><tbody>{data.map((row, index) => <tr key={index}>{keys.map(key => <td key={key} className="max-w-80 border-b border-border p-2 align-top"><div className="max-h-28 overflow-auto break-words" title={display(row[key])}>{display(row[key])}</div></td>)}</tr>)}</tbody></table>}
    </div>
  </div>
}

function OrderBook({ value }: { value: Json | undefined }) {
  const book = object(value)
  const side = (name: 'bids' | 'asks') => {
    const levels = Array.isArray(book[name]) ? book[name].map(item => object(item)).sort((a, b) => name === 'bids' ? Number(b.price) - Number(a.price) : Number(a.price) - Number(b.price)) : []
    return <div className="min-w-0"><h3 className="mb-2 text-xs font-semibold">{name === 'bids' ? 'Bids · buyers' : 'Asks · sellers'}</h3><div className="max-h-56 overflow-auto"><table className="w-full text-right text-xs"><thead><tr><th>Price</th><th>Shares</th></tr></thead><tbody>{levels.map((level, i) => <tr key={i} className="border-b border-border"><td className={name === 'bids' ? 'p-1 text-up' : 'p-1 text-down'}>{(Number(level.price) * 100).toFixed(2)}¢</td><td className="p-1">{number(level.size)}</td></tr>)}</tbody></table>{!levels.length && <p className="p-2 text-xs text-text-muted">No resting orders.</p>}</div></div>
  }
  return <><div className="grid grid-cols-2 gap-4 p-3">{side('bids')}{side('asks')}</div><details className="p-3 text-xs"><summary>Full order book and trading constraints</summary><DataView value={value}/></details></>
}

function ProbabilityChart({ value }: { value: Json | undefined }) {
  const points = rows(value).map(row => ({ t: Number(row.timestamp ?? row.t), p: Number(row.price ?? row.p) })).filter(point => Number.isFinite(point.t) && Number.isFinite(point.p)).sort((a, b) => a.t - b.t)
  if (!points.length) return <p className="p-4 text-xs text-text-muted">No price history available for this outcome and range.</p>
  const first = points[0].t
  const last = points[points.length - 1].t
  const path = points.map((point, i) => `${i ? 'L' : 'M'}${48 + (point.t - first) / Math.max(1, last - first) * 690},${170 - point.p * 145}`).join(' ')
  return <div className="p-3"><svg viewBox="0 0 760 205" role="img" aria-label="Outcome probability over time" className="w-full text-text-muted">
    {[0, .5, 1].map(p => <g key={p}><line x1="48" x2="738" y1={170 - p * 145} y2={170 - p * 145} stroke="currentColor" opacity=".15"/><text x="0" y={174 - p * 145} fill="currentColor" fontSize="11">{p * 100}%</text></g>)}
    <path d={path} fill="none" stroke="#60a5fa" strokeWidth="2"/><text x="48" y="196" fill="currentColor" fontSize="11">{new Date(first * 1000).toLocaleString()}</text><text x="738" y="196" textAnchor="end" fill="currentColor" fontSize="11">{new Date(last * 1000).toLocaleString()}</text>
  </svg></div>
}

function Feed({ title, request, active, onStatus, chart = false }: { title: string; request: PolymarketRequest; active: boolean; onStatus: (status: PanelStatus) => void; chart?: boolean }) {
  const query = usePolymarket(request, true, active)
  useEffect(() => onStatus({ label: title, envelope: query.data, loading: query.isFetching, error: query.error, freshnessMs: POLYMARKET_TTL }), [title, query.data, query.isFetching, query.error, onStatus])
  return <Panel title={title} warning={query.data?.meta.failureReason} actions={<Button onClick={() => void query.refetch()}>Refresh</Button>}>
    {query.isPending ? <p className="p-4 text-xs">Loading {title.toLowerCase()}…</p> : (query.isError && !query.data) || query.data?.meta.freshness === 'failed' ? <div className="p-4 text-xs">This dataset is unavailable. Retry with Refresh; details are in Settings.</div> : chart ? <><ProbabilityChart value={query.data?.data.value}/><details className="p-2 text-xs"><summary>History records</summary><DataView value={query.data?.data.value}/></details></> : request.endpoint === 'clob:/book' ? <OrderBook value={query.data?.data.value}/> : <DataView value={query.data?.data.value}/>}
  </Panel>
}

export function PolymarketPage({ active, onStatusChange }: { active: boolean; onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const client = useQueryClient()
  const [view, setView] = useState('markets')
  const [page, setPage] = useState(0)
  const [closed, setClosed] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Record<string, Json> | null>(null)
  const [outcome, setOutcome] = useState(0)
  const [interval, setInterval] = useState('1w')
  const [auto, setAuto] = useState(false)
  const [endpointId, setEndpointId] = useState('data:/v2/leaderboard')
  const [draft, setDraft] = useState<Record<string, string>>({ limit: '25', time_period: 'day' })
  const [request, setRequest] = useState<PolymarketRequest>(boardRequest)
  const [endpointFilter, setEndpointFilter] = useState('')
  const endpoint = POLYMARKET_ENDPOINTS.find(item => item.id === endpointId)!
  const marketReq = useMemo(() => ({ ...marketRequest, params: { ...marketRequest.params, closed: String(closed), offset: String(page * 25) } }), [page, closed])
  const markets = usePolymarket(marketReq, true, active && auto)
  const explorer = usePolymarket(request, true, active && auto && view === 'explorer')
  const marketRows = rows(markets.data?.data.value)
  const market = selected ?? marketRows[0] ?? {}
  const token = list(market.clobTokenIds)[outcome]
  const details = marketDetails(market)
  const book = details.find(item => item.endpoint === 'clob:/book')
  const history = details.find(item => item.endpoint === 'data:/v2/prices-history')
  const [statuses, setStatuses] = useState<Record<string, PanelStatus>>({})
  const receiveStatus = useMemo(() => (status: PanelStatus) => setStatuses(previous => ({ ...previous, [status.label]: status })), [])
  useEffect(() => {
    onStatusChange([
      { label: 'Markets', envelope: markets.data, loading: markets.isFetching, error: markets.error, freshnessMs: POLYMARKET_TTL },
      { label: 'Public explorer', envelope: explorer.data, loading: explorer.isFetching, error: explorer.error, freshnessMs: POLYMARKET_TTL },
      ...Object.values(statuses),
    ], 'https://docs.polymarket.com/market-data/overview')
  }, [markets.data, markets.isFetching, markets.error, explorer.data, explorer.isFetching, explorer.error, statuses, onStatusChange])
  const pagination = object(object(explorer.data?.data.value).pagination)
  const nextCursor = pagination.next_cursor ?? object(explorer.data?.data.value).next_cursor
  const shown = marketRows.filter(row => display(row.question).toLowerCase().includes(filter.toLowerCase()))
  const refreshAll = () => { void client.refetchQueries({ queryKey: ['polymarket'], type: 'active' }) }
  return <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3 text-text">
    <div className="mb-3 flex flex-wrap items-center gap-2"><h1 className="mr-4 text-lg font-semibold">Polymarket</h1>{['markets', 'explorer'].map(item => <Button key={item} onClick={() => setView(item)}>{item === 'markets' ? 'Market workspace' : `Public data explorer (${POLYMARKET_ENDPOINTS.length})`}</Button>)}<label className="ml-auto flex items-center gap-2 text-xs"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)}/>Auto-refresh · 30s</label><Button onClick={refreshAll}>Refresh all</Button></div>
    <p className="mb-3 text-xs text-text-muted">Public prediction-market data · No account or API key required · Prices reflect market-implied probabilities. Refreshes are snapshots; streaming feeds are separate.</p>
    {view === 'markets' ? <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(300px,1fr)_minmax(0,2fr)]">
      <Panel title="Discover markets"><div className="flex flex-wrap gap-2 p-3"><input aria-label="Filter loaded markets" placeholder="Filter these 25 markets" className={`${inputClass} flex-1`} value={filter} onChange={e => setFilter(e.target.value)}/><select aria-label="Market status" className={inputClass} value={String(closed)} onChange={e => { setClosed(e.target.value === 'true'); setPage(0); setSelected(null); setOutcome(0) }}><option value="false">Active</option><option value="true">Closed</option></select></div>
        <div className="max-h-[750px] overflow-auto">{markets.isPending ? <p className="p-4">Loading markets…</p> : !shown.length ? <p className="p-4 text-xs">{markets.isError || markets.data?.meta.freshness === 'failed' ? 'Markets unavailable. Retry with Refresh all; details are in Settings.' : 'No markets on this page match the filter.'}</p> : shown.map(row => <button key={display(row.id)} className={`block w-full border-b border-border p-3 text-left hover:bg-surface-raised ${row.id === market.id ? 'bg-surface-raised' : ''}`} onClick={() => { setSelected(row); setOutcome(0) }}><div className="mb-2 text-sm font-medium">{display(row.question)}</div><div className="flex flex-wrap gap-3 text-xs text-text-muted">{list(row.outcomes).map((name, i) => <span key={i}>{name} {list(row.outcomePrices)[i] == null ? '—' : `${(Number(list(row.outcomePrices)[i]) * 100).toFixed(1)}%`}</span>)}</div><div className="mt-2 text-xs text-text-muted">Volume ${number(row.volume)} · Liquidity ${number(row.liquidity)} · Ends {typeof row.endDate === 'string' ? new Date(row.endDate).toLocaleDateString() : '—'}</div></button>)}</div>
        <div className="flex items-center justify-between gap-2 p-3 text-xs"><Button disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(null); setOutcome(0) }}>Previous</Button><span>Page {page + 1}</span><Button disabled={marketRows.length < 25} onClick={() => { setPage(page + 1); setSelected(null); setOutcome(0) }}>Next</Button></div>
      </Panel>
      <div className="flex min-w-0 flex-col gap-3">
        <Panel title={display(market.question)}><p className="whitespace-pre-wrap p-3 text-sm">{display(market.description)}</p><div className="flex flex-wrap gap-2 px-3 pb-3"><select aria-label="Outcome" value={outcome} className={inputClass} onChange={e => setOutcome(Number(e.target.value))}>{list(market.outcomes).map((name, i) => <option key={i} value={i}>{name}</option>)}</select><select aria-label="History range" value={interval} className={inputClass} onChange={e => setInterval(e.target.value)}>{['1h', '1d', '1w', '1m', 'max'].map(value => <option key={value}>{value}</option>)}</select><Button onClick={() => { setView('explorer'); setEndpointId('gamma:/public-search'); setDraft({ q: '' }) }}>Search all events & markets</Button></div><details className="p-3 text-xs"><summary>All market metadata, rules and identifiers</summary><DataView value={market}/></details></Panel>
        {book && token && <Feed key={`book-${token}`} title="Order book · selected outcome" request={{ ...book, params: { token_id: token } }} active={active && auto} onStatus={receiveStatus}/>}
        {history && token && <Feed key={`history-${token}-${interval}`} title="Probability history · selected outcome" request={{ ...history, params: { token_id: token, interval } }} active={active && auto} onStatus={receiveStatus} chart/>}
        {details.filter(item => item !== book && item !== history).map(item => <Feed key={`${item.endpoint}-${market.id}`} title={item.endpoint.split('/').pop() === 'oi' ? 'Open interest' : item.endpoint.endsWith('trades') ? 'Recent trades' : 'Top holders'} request={item} active={active && auto} onStatus={receiveStatus}/>)}
      </div>
    </div> : <div className="flex min-w-0 flex-col gap-3">
      <Panel title="Explore every documented public GET dataset"><div className="grid gap-3 p-3 md:grid-cols-2"><label className="flex flex-col gap-1 text-xs">Find a dataset<input aria-label="Find a dataset" className={inputClass} placeholder="Wallet, trades, tags, rewards, sports…" value={endpointFilter} onChange={e => setEndpointFilter(e.target.value)}/></label><label className="flex min-w-0 flex-col gap-1 text-xs">Dataset<select aria-label="Dataset" className={inputClass} value={endpointId} onChange={e => { setEndpointId(e.target.value); setDraft({}) }}>{POLYMARKET_ENDPOINTS.filter(item => item.id === endpointId || `${item.label} ${item.id}`.toLowerCase().includes(endpointFilter.toLowerCase())).map(item => <option key={item.id} value={item.id}>{item.group.toUpperCase()} · {item.label}</option>)}</select></label></div>
      <form className="p-3" onSubmit={e => { e.preventDefault(); setRequest({ endpoint: endpointId, params: Object.fromEntries(Object.entries(draft).filter(([, value]) => value.trim())) }) }}><div className="grid gap-3 md:grid-cols-3">{endpoint.params.map(param => <label key={param.name} title={param.description} className="flex min-w-0 flex-col gap-1 text-xs">{param.name}{param.required ? ' *' : ''}<input aria-label={param.name} className={inputClass} required={param.required} value={draft[param.name] ?? ''} placeholder={param.choices?.map(String).join(' / ') ?? (param.type === 'array' ? 'Comma-separated values' : 'Provider default')} onChange={e => setDraft({ ...draft, [param.name]: e.target.value })}/><span className="line-clamp-2 text-text-muted">{param.description}</span></label>)}</div><div className="mt-3 flex gap-2"><Button type="submit">Load dataset</Button><Button type="button" onClick={() => setDraft(previous => ({ ...previous, ...Object.fromEntries(Object.entries({ token_id: token ?? '', condition: String(market.conditionId ?? ''), event_id: String(object(Array.isArray(market.events) ? market.events[0] : null).id ?? '') }).filter(([name]) => endpoint.params.some(param => param.name === name))) }))}>Use selected market identifiers</Button></div></form>
      <p className="px-3 pb-3 text-xs text-text-muted">Blank fields use provider defaults. Enter a public wallet address in user for wallet datasets. Array parameters accept comma-separated values. Pages retain the original filters. No credentials or trading actions are supported.</p></Panel>
      <Panel title={POLYMARKET_ENDPOINTS.find(item => item.id === request.endpoint)?.label ?? 'Results'} warning={explorer.data?.meta.failureReason} actions={<Button onClick={() => void explorer.refetch()}>Refresh</Button>}>
        <p className="break-all p-3 text-xs text-text-muted">{explorer.data?.data.url}</p>{explorer.isPending ? <p className="p-4">Loading dataset…</p> : (explorer.isError && !explorer.data) || explorer.data?.meta.freshness === 'failed' ? <p className="p-4 text-xs">Dataset unavailable or parameters need attention. Check the parameter hints and Settings diagnostics, then retry.</p> : <DataView value={explorer.data?.data.value}/>}
        <div className="flex flex-wrap gap-2 p-3"><Button disabled={!nextCursor} onClick={() => setRequest({ ...request, params: { ...request.params, [endpoint.group === 'clob' ? 'next_cursor' : 'cursor']: String(nextCursor) } })}>Next cursor page</Button><Button disabled={!POLYMARKET_ENDPOINTS.find(item => item.id === request.endpoint)?.params.some(p => p.name === 'offset')} onClick={() => setRequest({ ...request, params: { ...request.params, offset: String(Number(request.params?.offset ?? 0) + Number(request.params?.limit ?? 25)), limit: request.params?.limit ?? '25' } })}>Next offset page</Button><Button onClick={() => setRequest({ ...request, params: Object.fromEntries(Object.entries(request.params ?? {}).filter(([key]) => key !== 'cursor' && key !== 'offset' && key !== 'next_cursor')) })}>First page</Button></div>
      </Panel>
    </div>}
  </div>
}
