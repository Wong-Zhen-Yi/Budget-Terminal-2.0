import { useEffect, useState } from 'react'
import { POLYMARKET_ENDPOINTS, POLYMARKET_TTL, type Json, type PolymarketRequest } from '@shared/polymarket'
import { boardRequest, object, rows, usePolymarket } from '@/api/polymarketQueries'
import { api } from '@/api/client'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
const inputClass = 'h-8 min-w-0 border border-border-strong bg-surface-raised px-2 text-xs text-text'
const display = (value: Json | undefined): string => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)

export function PolymarketDataView({ value }: { value: Json | undefined }) {
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


export function PolymarketExplorer({ market, token, active, onStatus }: {
  market: Record<string, Json>
  token?: string
  active: boolean
  onStatus: (status: PanelStatus) => void
}) {
  const [endpointId, setEndpointId] = useState('data:/v2/leaderboard')
  const [draft, setDraft] = useState<Record<string, string>>({ limit: '25', time_period: 'day' })
  const [request, setRequest] = useState<PolymarketRequest>(boardRequest)
  const [endpointFilter, setEndpointFilter] = useState('')
  const endpoint = POLYMARKET_ENDPOINTS.find(item => item.id === endpointId)!
  const explorer = usePolymarket(request, true, active)
  const resultEndpoint = POLYMARKET_ENDPOINTS.find(item => item.id === request.endpoint)!
  const nextCursor = object(object(explorer.data?.data.value).pagination).next_cursor ?? object(explorer.data?.data.value).next_cursor
  useEffect(() => onStatus({ label: 'Public explorer', envelope: explorer.data, loading: explorer.isFetching,
    error: explorer.error, freshnessMs: POLYMARKET_TTL }), [explorer.data, explorer.isFetching, explorer.error, onStatus])
  return <div className="flex min-w-0 flex-col gap-3">
      <Panel title="Explore every documented public GET dataset"><div className="grid gap-3 p-3 md:grid-cols-2"><label className="flex flex-col gap-1 text-xs">Find a dataset<input aria-label="Find a dataset" className={inputClass} placeholder="Wallet, trades, tags, rewards, sports…" value={endpointFilter} onChange={e => setEndpointFilter(e.target.value)}/></label><label className="flex min-w-0 flex-col gap-1 text-xs">Dataset<select aria-label="Dataset" className={inputClass} value={endpointId} onChange={e => { setEndpointId(e.target.value); setDraft({}) }}>{POLYMARKET_ENDPOINTS.filter(item => item.id === endpointId || `${item.label} ${item.id}`.toLowerCase().includes(endpointFilter.toLowerCase())).map(item => <option key={item.id} value={item.id}>{item.group.toUpperCase()} · {item.label}</option>)}</select></label></div>
      <form className="p-3" onSubmit={e => { e.preventDefault(); setRequest({ endpoint: endpointId, params: Object.fromEntries(Object.entries(draft).filter(([, value]) => value.trim())) }) }}><div className="grid gap-3 md:grid-cols-3">{endpoint.params.map(param => <label key={param.name} title={param.description} className="flex min-w-0 flex-col gap-1 text-xs">{param.name}{param.required ? ' *' : ''}<input aria-label={param.name} className={inputClass} required={param.required} value={draft[param.name] ?? ''} placeholder={param.choices?.map(String).join(' / ') ?? (param.type === 'array' ? 'Comma-separated values' : 'Provider default')} onChange={e => setDraft({ ...draft, [param.name]: e.target.value })}/><span className="line-clamp-2 text-text-muted">{param.description}</span></label>)}</div><div className="mt-3 flex gap-2"><Button type="submit">Load dataset</Button><Button type="button" onClick={() => setDraft(previous => ({ ...previous, ...Object.fromEntries(Object.entries({ token_id: token ?? '', condition: String(market.conditionId ?? ''), event_id: String(object(Array.isArray(market.events) ? market.events[0] : null).id ?? '') }).filter(([name]) => endpoint.params.some(param => param.name === name))) }))}>Use selected market identifiers</Button></div></form>
      <p className="px-3 pb-3 text-xs text-text-muted">Blank fields use provider defaults. Enter a public wallet address in user for wallet datasets. Array parameters accept comma-separated values. Pages retain the original filters. No credentials or trading actions are supported.</p></Panel>
      <Panel title={POLYMARKET_ENDPOINTS.find(item => item.id === request.endpoint)?.label ?? 'Results'} warning={explorer.data?.meta.failureReason} actions={<Button onClick={() => void explorer.refetch()}>Refresh</Button>}>
        <p className="break-all p-3 text-xs text-text-muted">{explorer.data?.data.url}</p>{explorer.isPending ? <p className="p-4">Loading dataset…</p> : (explorer.isError && !explorer.data) || explorer.data?.meta.freshness === 'failed' ? <p className="p-4 text-xs">Dataset unavailable or parameters need attention. Check the parameter hints and Settings diagnostics, then retry.</p> : <PolymarketDataView value={explorer.data?.data.value}/>}
        <div className="flex flex-wrap gap-2 p-3"><Button disabled={!nextCursor} onClick={() => setRequest({ ...request, params: { ...request.params, [resultEndpoint.group === 'clob' ? 'next_cursor' : 'cursor']: String(nextCursor) } })}>Next cursor page</Button><Button disabled={!POLYMARKET_ENDPOINTS.find(item => item.id === request.endpoint)?.params.some(p => p.name === 'offset')} onClick={() => setRequest({ ...request, params: { ...request.params, offset: String(Number(request.params?.offset ?? 0) + Number(request.params?.limit ?? 25)), limit: request.params?.limit ?? '25' } })}>Next offset page</Button><Button onClick={() => setRequest({ ...request, params: Object.fromEntries(Object.entries(request.params ?? {}).filter(([key]) => key !== 'cursor' && key !== 'offset' && key !== 'next_cursor')) })}>First page</Button></div>
      </Panel>
    </div>
}
