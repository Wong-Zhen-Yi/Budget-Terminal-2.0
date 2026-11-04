import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AppMetrics, AppSettings, ApiUsageSnapshot, Envelope, PortfolioPayload, PersonalFinancePayload, McpStatus, CardsPayload } from '@shared/contract'
import type { AgentsState } from '@shared/agents'
import type { ArticlesPayload } from '@shared/articles'
import type { CacheStatus } from '@shared/cachePolicy'
import { MIB } from '@shared/cachePolicy'
import { TABS } from '@shared/contract'
import { api, queryKeys } from '@/api/client'
import { rendererQueryPersister } from '@/api/queryPersistence'
import { sortRecords, useDataHealth } from '@/stores/dataHealth'
import '@/styles/appDashboard.css'

const colors = ['#20c9ad', '#399dff', '#f5bd50', '#ad7aeb', '#f16f78', '#7895ab']
interface Datum { label: string; value: number; color?: string }
interface Sample { at: number; active: number; queued?: number }
function activitySample(usage: ApiUsageSnapshot): Sample {
  const queues = usage.providers.filter(provider => provider.queued !== undefined)
  return { at: usage.sampledAt, active: usage.providers.reduce((sum, provider) => sum + provider.inFlight, 0),
    queued: queues.length ? queues.reduce((sum, provider) => sum + (provider.queued ?? 0), 0) : undefined }
}
const number = (value: number) => Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
const usable = (rows: Datum[]) => rows.filter(row => Number.isFinite(row.value) && row.value >= 0)

function Empty({ children = 'No data yet' }: { children?: ReactNode }) {
  return <div className="app-dash-empty">{children}</div>
}

function Donut({ rows, unit }: { rows: Datum[]; unit: string }) {
  const nonzero = usable(rows).filter(row => row.value > 0)
  const data = nonzero.length > 6 ? [...nonzero.slice(0, 5), { label: 'Other', value: nonzero.slice(5).reduce((sum, row) => sum + row.value, 0) }] : nonzero
  const total = data.reduce((sum, row) => sum + row.value, 0)
  if (!total) return <Empty>No {unit.toLowerCase()} recorded</Empty>
  let offset = 0
  return <div className="app-dash-donut">
    <svg viewBox="0 0 110 110" role="img" aria-label={`${unit}: ${data.map(row => `${row.label} ${number(row.value)}`).join(', ')}`}>
      <circle cx="55" cy="55" r="41" fill="none" stroke="var(--color-border)" strokeWidth="13" />
      {data.map((row, index) => {
        const fraction = row.value / total * 100
        const start = offset
        offset += fraction
        return <circle key={row.label} cx="55" cy="55" r="41" fill="none" stroke={row.color ?? colors[index % colors.length]}
          strokeWidth="13" pathLength="100" strokeDasharray={`${fraction} ${100 - fraction}`} strokeDashoffset={-start} transform="rotate(-90 55 55)"><title>{row.label}: {number(row.value)}</title></circle>
      })}
      <text x="55" y="53" textAnchor="middle" className="app-dash-total">{number(total)}</text>
      <text x="55" y="68" textAnchor="middle">{unit}</text>
    </svg>
    <ul>{data.map((row, index) => <li key={row.label}><i style={{ background: row.color ?? colors[index % colors.length] }} /><span>{row.label}</span><b>{number(row.value)}</b></li>)}</ul>
  </div>
}

function Bars({ rows, unit, capacities }: { rows: Datum[]; unit: string; capacities?: number[] }) {
  const data = rows.filter(row => Number.isFinite(row.value))
  if (!data.length) return <Empty />
  const max = Math.max(1, ...data.map(row => Math.abs(row.value)))
  const signed = !capacities && data.some(row => row.value < 0)
  return <div className="app-dash-bars" role="img" aria-label={`${unit}: ${data.map(row => `${row.label} ${number(row.value)}`).join(', ')}`}>
    {data.map((row, index) => <div className="app-dash-bar" key={row.label} title={`${row.label}: ${number(row.value)}${capacities ? ` / ${number(capacities[index])}` : ''} ${unit}`}>
      <span>{row.label}</span><div className={signed ? 'app-dash-bar-signed' : undefined}><i style={{ width: `${Math.min(signed ? 50 : 100, Math.abs(row.value) / Math.max(1, capacities?.[index] ?? max) * (signed ? 50 : 100))}%`, background: row.color ?? colors[1], ...(signed ? { position: 'absolute', [row.value < 0 ? 'right' : 'left']: '50%' } : {}) }} /></div>
      <b>{number(row.value)}{capacities ? ` / ${number(capacities[index])}` : ''}</b>
    </div>)}<small>{unit}</small>
  </div>
}

function Lines({ samples, labels, unit }: { samples: { at: number; values: (number | undefined)[] }[]; labels: string[]; unit: string }) {
  if (!samples.length) return <Empty>Waiting for first measurement</Empty>
  const max = Math.max(1, ...samples.flatMap(sample => sample.values.filter((value): value is number => value !== undefined && Number.isFinite(value))))
  const start = samples[0].at
  const span = Math.max(1, samples[samples.length - 1].at - start)
  const points = (index: number) => samples.flatMap(sample => {
    const value = sample.values[index]
    return value === undefined || !Number.isFinite(value) ? [] : [{ x: samples.length === 1 ? 145 : 30 + (sample.at - start) / span * 230, y: 100 - value / max * 78 }]
  })
  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return <div className="app-dash-line"><div>{labels.map((label, index) => points(index).length > 0 && <span key={label} style={{ color: colors[index + 1] }}>● {label}</span>)}</div>
    <svg viewBox="0 0 280 130" role="img" aria-label={`${unit}: ${labels.map((label, index) => `${label} ${samples.at(-1)?.values[index] ?? 'unmeasured'}`).join(', ')}`}>
      {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1="30" x2="260" y1={100 - fraction * 78} y2={100 - fraction * 78} stroke="var(--color-border)" /><text x="25" y={104 - fraction * 78} textAnchor="end">{number(fraction * max)}</text></g>)}
      {labels.map((label, index) => <g key={label}><polyline points={points(index).map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={colors[index + 1]} strokeWidth="2" />{points(index).slice(-1).map(point => <circle key="latest" cx={point.x} cy={point.y} r="2.5" fill={colors[index + 1]} />)}</g>)}
      <text x="30" y="120">{time(start)}</text><text x="260" y="120" textAnchor="end">{time(samples[samples.length - 1].at)}</text>
    </svg><small>{unit} · sampled every 5s</small></div>
}

function Latency({ providers }: { providers: ApiUsageSnapshot['providers'] }) {
  const observed = providers.filter(provider => provider.latencyMs)
  const max = Math.max(1, ...observed.map(provider => provider.latencyMs!.p95))
  if (!observed.length) return <Empty>Waiting for a completed provider request</Empty>
  return <div className="app-dash-bars"><small>p50 / p95 · milliseconds</small>{observed.map(provider => <div className="app-dash-bar" key={provider.id} title={`${provider.latencyMs!.samples} completed requests`}><span>{provider.label}</span><div className="app-dash-latency"><i style={{ width: `${provider.latencyMs!.p50 / max * 100}%`, background: colors[1] }} /><i style={{ width: `${provider.latencyMs!.p95 / max * 100}%`, background: colors[3] }} /></div><b>{number(provider.latencyMs!.p50)} / {number(provider.latencyMs!.p95)}</b></div>)}</div>
}

function Card({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return <section className="app-dash-card"><h3>{title}</h3><div className="app-dash-plot">{children}</div>{note && <p>{note}</p>}</section>
}

/** Reads prepared query results only; never starts a second market-data warm-up. */
export function AppDashboard({ settings }: { settings: AppSettings }) {
  const client = useQueryClient()
  const startup = useDataHealth(state => state.startup)
  const records = useDataHealth(state => state.records)
  const [snapshot, setSnapshot] = useState<{ usage?: ApiUsageSnapshot; cache?: CacheStatus; mcp?: McpStatus; metrics?: AppMetrics }>(() => ({
    usage: client.getQueryData<ApiUsageSnapshot>(['apiUsage']),
    cache: client.getQueryData<Envelope<CacheStatus>>(['cacheStatus'])?.data,
    mcp: client.getQueryData<McpStatus>(['mcpStatus']),
    metrics: client.getQueryData<Envelope<AppMetrics>>(['appMetrics'])?.data,
  }))
  const [samples, setSamples] = useState<Sample[]>(() => {
    const usage = client.getQueryData<ApiUsageSnapshot>(['apiUsage'])
    return usage ? [activitySample(usage)] : []
  })
  const [failed, setFailed] = useState<string[]>([])
  useEffect(() => {
    let active = true
    let busy = false
    const refresh = async () => {
      if (busy) return
      busy = true
      try {
        const [usage, cache, mcp, metrics] = await Promise.allSettled([api.apiUsage(), api.cacheStatus(), api.mcpStatus(), api.appMetrics()])
        if (!active) return
        const cacheOk = cache.status === 'fulfilled' && cache.value.meta.freshness !== 'failed' && !cache.value.meta.failureReason
        const mcpOk = mcp.status === 'fulfilled' && mcp.value.available
        const metricsOk = metrics.status === 'fulfilled' && metrics.value.meta.freshness !== 'failed'
        setFailed([usage.status === 'rejected' ? 'Providers' : '', !cacheOk ? 'Cache' : '', !mcpOk ? 'MCP' : '', !metricsOk || metrics.status === 'fulfilled' && metrics.value.errors.length ? 'Runtime/backup' : ''].filter(Boolean))
        setSnapshot(previous => ({ usage: usage.status === 'fulfilled' ? usage.value : previous.usage,
          cache: cacheOk && cache.status === 'fulfilled' ? cache.value.data : previous.cache,
          mcp: mcpOk && mcp.status === 'fulfilled' ? mcp.value : previous.mcp,
          metrics: metricsOk && metrics.status === 'fulfilled' ? metrics.value.data : previous.metrics }))
        if (usage.status === 'fulfilled') {
          setSamples(previous => [...previous, activitySample(usage.value)].slice(-120))
        }
      } finally { busy = false }
    }
    // Startup already prepares these local snapshots. First visit renders them
    // immediately; the timer subsequently samples without a first-visit reload.
    if (!client.getQueryData(['apiUsage']) || !client.getQueryData(['cacheStatus']) || !client.getQueryData(['mcpStatus']) || !client.getQueryData(['appMetrics'])) void refresh()
    const timer = window.setInterval(() => void refresh(), 5_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [client])

  const cached = <T,>(key: readonly unknown[]) => client.getQueryData<Envelope<T>>(key)?.data
  const portfolio = cached<PortfolioPayload>(queryKeys.portfolio)
  const finance = cached<PersonalFinancePayload>(queryKeys.personalFinance)
  const cards = cached<CardsPayload>(queryKeys.cards)
  const articles = cached<ArticlesPayload>(queryKeys.articles)
  const agents = cached<AgentsState>(queryKeys.agents)
  // Settings remains private even when another page has been temporarily revealed.
  const protectedPage = (id: string) => settings.obscuredTabs.includes(id)
  const privatePortfolio = protectedPage('portfolio') || protectedPage('dashboard') || protectedPage('dashboard-2')
  const privateFinance = protectedPage('personal-finance')
  const privateAgents = protectedPage('agents')
  const portfolios = portfolio?.portfolios.filter(item => !item.readOnly) ?? []
  const renderer = rendererQueryPersister.stats()
  const cache = snapshot.cache
  const service = cache?.service
  const providers = snapshot.usage?.providers ?? []
  const pages = Object.values(startup?.pages ?? {})
  const ready = pages.filter(page => page.state === 'ready').length
  const health = sortRecords(records).filter(record => !record.previousSession)
  const pageStates = ['ready', 'loading', 'degraded', 'failed', 'idle'] as const
  const pageLabels = ['Ready', 'Loading', 'Incomplete', 'Failed', 'Awaiting input']
  const feedStates = ['fresh', 'cached', 'stale', 'partial', 'failed'] as const
  const hits = service ? service.hits + service.misses : 0
  const partitions = service ? [service.market.bytes / MIB, service.assets.bytes / MIB, renderer.bytes / MIB] : []
  const totalMiB = partitions.reduce((sum, value) => sum + value, 0)
  const activity = snapshot.mcp?.diagnostics?.activity
  const mcpStates = ['success', 'partial', 'failed', 'blocked', 'running', 'approval', 'replayed', 'cancelled'] as const
  const runs = [...new Map((agents?.messages ?? []).flatMap(message => message.run ? [[message.run.id, message.run] as const] : [])).values()]
  const runStates = ['completed', 'running', 'partial', 'failed', 'stopped'] as const
  const queryGroups = [
    { label: 'Stocks', roots: ['stocks', 'fundamentalsPage'] }, { label: 'ETFs', roots: ['etfAum', 'etfHoldings'] },
    { label: 'Crypto', roots: ['crypto', 'bitcoin'] }, { label: 'FX', roots: ['forexQuotes', 'forexHistory'] },
    { label: 'Charts', roots: ['chart', 'chartsHistory'] },
  ]
  const saved: Datum[] = []
  if (portfolio && !privatePortfolio) saved.push({ label: 'Holdings', value: portfolios.reduce((sum, item) => sum + Object.keys(item.holdings).length, 0) })
  if (finance && !privateFinance) saved.push({ label: 'Finance entries', value: finance.cash.length + finance.debt.length + finance.recurringBills.length })
  if (cards && !protectedPage('cards')) saved.push({ label: 'Cards', value: cards.customCards.length })
  if (articles && !protectedPage('articles')) saved.push({ label: 'Articles', value: articles.articles.length })
  const configuration = (label: string, value: number, rest: string) => <div className="app-dash-config"><span>{label}</span><div><i style={{ width: `${value / TABS.length * 100}%` }}>{value || ''}</i><b>{TABS.length - value}</b></div><small>{label} / {rest} · {TABS.length} pages</small></div>
  const privateMessage = <Empty>Protected in Settings<br />Change page privacy to display</Empty>
  const columns: { title: string; cards: ReactNode[] }[] = [
    { title: 'Startup & reliability', cards: [
      <Card title="Page loading" note="All implemented pages preload" key="pages"><Donut unit="pages" rows={pages.length ? pageStates.map((state, index) => ({ label: pageLabels[index], value: pages.filter(page => page.state === state).length, color: [colors[0], colors[1], colors[2], colors[4], colors[5]][index] })) : []} /></Card>,
      <Card title="Slowest page loads" key="timings"><Bars unit="seconds" rows={[...(startup?.timings ?? [])].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5).map(item => ({ label: TABS.find(tab => tab.id === item.tab)?.label ?? 'Page', value: item.durationMs / 1000 }))} /></Card>,
      <Card title="Feed freshness" note="Current-session observed feeds" key="feeds"><Donut unit="feeds" rows={health.length ? feedStates.map(state => ({ label: state[0].toUpperCase() + state.slice(1), value: health.filter(record => record.freshness === state).length })) : []} /></Card>,
    ] },
    { title: 'Providers & requests', cards: [
      <Card title="Provider requests" note="Rolling windows vary by provider" key="providers"><Bars unit="requests in provider window" rows={providers.map(provider => ({ label: provider.label, value: provider.requestCount }))} /></Card>,
      <Card title="Request activity" note="Active: all providers · queue: measured providers only" key="volume"><Lines samples={samples.map(sample => ({ at: sample.at, values: [sample.active, sample.queued] }))} labels={['Active', 'Known queued']} unit="Outstanding requests" /></Card>,
      <Card title="Provider response time" note="Last 200 completed requests per provider" key="latency"><Latency providers={providers} /></Card>,
    ] },
    { title: 'Cache & storage', cards: [
      <Card title="Storage breakdown" key="storage"><Donut unit="MiB" rows={partitions.map((value, index) => ({ label: ['Market', 'Assets', 'Snapshots'][index], value }))} /></Card>,
      <Card title="Cache outcomes" note={service ? `${number(service.errors)} load errors · separate from lookups` : undefined} key="cache"><Donut unit="lookups" rows={service ? [{ label: 'Hits', value: service.hits }, { label: 'Misses', value: service.misses }] : []} /></Card>,
      <Card title="Storage vs limits" note={service ? `${number(service.market.expiredEntries + service.assets.expiredEntries)} expired · ${number(service.market.evictions + service.assets.evictions + renderer.evictions)} evictions` : undefined} key="limits"><Bars unit="MiB used / limit" capacities={cache ? [cache.settings.marketMiB, cache.settings.assetsMiB, cache.settings.rendererMiB] : undefined} rows={partitions.map((value, index) => ({ label: ['Market', 'Assets', 'Snapshots'][index], value }))} /></Card>,
    ] },
    { title: 'Runtime & integrations', cards: [
      <Card title="Memory over time" note="Working set · main / renderers / other processes" key="memory"><Lines samples={(snapshot.metrics?.memory ?? []).map(sample => ({ at: sample.at, values: [sample.mainMiB, sample.rendererMiB, sample.otherMiB] }))} labels={['Main', 'Renderer', 'Other']} unit="MiB" /></Card>,
      <Card title="MCP outcomes" note="Bounded session activity" key="mcp">{activity ? <Donut unit="calls" rows={mcpStates.map(state => ({ label: state, value: activity.filter(item => item.state === state).length }))} /> : <Empty />}</Card>,
      <Card title="Agent activity" note="Runs in the current conversation" key="agents">{privateAgents ? privateMessage : agents ? <Bars unit="runs" rows={runStates.map(state => ({ label: state, value: runs.filter(run => run.status === state).length }))} /> : <Empty />}</Card>,
    ] },
    { title: 'Workspace & research', cards: [
      <Card title="Saved items" note="Protected pages excluded" key="saved"><Bars unit="records" rows={saved} /></Card>,
      <Card title="Research snapshots" note="Prepared queries, not instrument counts" key="coverage"><Bars unit="cached queries" rows={queryGroups.map(group => ({ label: group.label, value: client.getQueryCache().getAll().filter(query => group.roots.includes(String(query.queryKey[0])) && query.state.data !== undefined).length }))} /></Card>,
      <Card title="Page configuration" key="configuration">{configuration('Visible', TABS.length - settings.hiddenTabs.length, 'Hidden')}{configuration('Protected', settings.obscuredTabs.length, 'Unprotected')}</Card>,
    ] },
    { title: 'Finances & protection', cards: [
      <Card title="Portfolio composition" note="Holdings per saved portfolio · counts" key="portfolio">{privatePortfolio ? privateMessage : portfolio ? <Donut unit="holdings" rows={portfolios.map((item, index) => ({ label: `Portfolio ${index + 1}`, value: Object.keys(item.holdings).length }))} /> : <Empty />}</Card>,
      <Card title="Personal balances" note="Saved balances · SGD" key="finance">{privateFinance ? privateMessage : finance ? <Bars unit="SGD" rows={[{ label: 'Cash', value: finance.cash.reduce((sum, item) => sum + item.amount, 0) }, { label: 'Debt', value: finance.debt.reduce((sum, item) => sum + item.amount, 0), color: colors[2] }]} /> : <Empty />}</Card>,
      <Card title="Backups & retention" note={`${snapshot.metrics?.backup.savedAt ? `Backup ${new Date(snapshot.metrics.backup.savedAt).toLocaleDateString()} · ` : ''}${cache ? `${cache.settings.retentionDays}-day page snapshot retention` : ''}`} key="backup">{snapshot.metrics?.backup.state === 'available' && snapshot.metrics.backup.bytes !== undefined ? <Bars unit="MiB · current automatic backup" rows={[{ label: 'Automatic', value: snapshot.metrics.backup.bytes / MIB }]} /> : <Empty>{snapshot.metrics?.backup.state === 'not-created' ? 'No automatic backup file yet' : snapshot.metrics?.backup.state === 'unavailable' ? 'Backup file could not be measured' : 'Reading backup size…'}</Empty>}</Card>,
    ] },
  ]
  return <section className="app-dashboard" aria-label="App dashboard">
    <div className="app-dash-kpis">{[
      ['Pages loaded', pages.length ? `${ready} / ${pages.length}` : '—'], ['Active requests', snapshot.usage ? number(providers.reduce((sum, provider) => sum + provider.inFlight, 0)) : '—'],
      ['Cache hit rate', hits && service ? `${(service.hits / hits * 100).toFixed(1)}%` : '—'], ['Local cache', service ? `${number(totalMiB)} MiB` : '—'],
    ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    {failed.length > 0 && <p className="app-dash-error" role="status">{failed.join(', ')} updates unavailable. Showing last successful samples where available.</p>}
    <div className="app-dash-grid">{columns.map((column, index) => <section className="app-dash-column" key={column.title}><h2><span>{String(index + 1).padStart(2, '0')}</span>{column.title}</h2>{column.cards}</section>)}</div>
    <p className="app-dash-footnote">Live local metrics · history covers this dashboard session · protected page values stay hidden · detailed failures in Diagnostics</p>
  </section>
}
