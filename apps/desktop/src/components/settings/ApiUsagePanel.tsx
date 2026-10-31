import { useEffect, useState } from 'react'
import type { ApiProviderUsage, ApiUsageSnapshot } from '@shared/contract'
import { TABS } from '@shared/contract'
import { useDataHealth } from '@/stores/dataHealth'
import { API_CATALOG } from './apiCatalog'
import '@/styles/apiUsage.css'

const labels = new Map(TABS.map(tab => [tab.id, tab.label]))
const pageStates = {
  ready: { label: 'Ready', tone: 'ready', priority: 4 },
  loading: { label: 'Loading', tone: 'waiting', priority: 2 },
  degraded: { label: 'Incomplete data', tone: 'waiting', priority: 1 },
  failed: { label: 'Failed', tone: 'error', priority: 0 },
  idle: { label: 'Awaiting input', tone: 'muted', priority: 3 },
} as const

function providerState(provider: ApiProviderUsage) {
  if (provider.throttled) return { label: `Rate limited · ${Math.ceil(provider.cooldownMs / 1000)}s cooldown`, tone: 'error' }
  if (provider.percent >= 90) return { label: 'High usage', tone: 'waiting' }
  return { label: 'Within soft limit', tone: 'ready' }
}

/** Keep live session diagnostics separate from the static dependency directory. */
export function ApiUsagePanel() {
  const [snapshot, setSnapshot] = useState<ApiUsageSnapshot | null>(null)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState('')
  const startup = useDataHealth(state => state.startup)

  useEffect(() => {
    let active = true
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const next = await window.api.apiUsage()
        if (active) { setSnapshot(next); setError(false) }
      } catch { if (active) setError(true) }
      finally { refreshing = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  const pages = (startup?.pageOrder ?? Object.keys(startup?.pages ?? {})).map(id => ({
    id, state: startup?.pages?.[id]?.state ?? 'loading',
  })).sort((left, right) => pageStates[left.state].priority - pageStates[right.state].priority)
  const ready = pages.filter(page => page.state === 'ready').length
  const loading = pages.filter(page => page.state === 'loading').length
  const incomplete = pages.filter(page => page.state === 'degraded' || page.state === 'failed').length
  const idle = pages.filter(page => page.state === 'idle').length
  const term = search.trim().toLowerCase()
  const entries = API_CATALOG.map(api => ({ ...api, uses: api.uses.filter(use =>
    (!page || use.pages.includes(page)) &&
    `${api.label} ${use.purpose} ${use.pages.map(id => labels.get(id) ?? id).join(' ')}`.toLowerCase().includes(term),
  ) })).filter(api => api.uses.length)

  return <section className="api-usage" aria-labelledby="api-usage-title">
    <header className="api-usage__header">
      <div><h2 id="api-usage-title">API usage</h2><p>Startup health and provider activity, at a glance.</p></div>
      <span className={`api-usage__badge api-usage__tone--${error ? 'error' : snapshot ? 'ready' : 'muted'}`} role="status">
        <span className="api-usage__dot" />{error ? 'Updates unavailable' : snapshot ? 'Live · every 2s' : 'Connecting…'}
      </span>
    </header>
    {error ? <p role="alert" className="api-usage__alert">Live usage unavailable. {snapshot ? 'Showing the last successful snapshot.' : 'Waiting for a successful sample.'}</p> : null}
    <div className="api-usage__overview">
      <section className="api-usage__startup" aria-labelledby="api-startup-title">
        <div className="api-usage__section-heading">
          <h3 id="api-startup-title">Startup status</h3>
          <span className={`api-usage__badge api-usage__tone--${incomplete || loading ? 'waiting' : pages.length && !idle ? 'ready' : 'muted'}`}>
            {incomplete ? `${incomplete} incomplete` : loading ? `${loading} loading` : idle ? `${idle} awaiting input` : pages.length ? 'Startup complete' : 'Waiting for startup'}
          </span>
        </div>
        <p className="api-usage__hint">All implemented pages preload when the app opens. Failed and incomplete pages appear first.</p>
        <div className="api-usage__page-scroll" tabIndex={0} role="region" aria-label="Startup page statuses">
          <table className="api-usage__table" aria-label="Startup status">
            <thead><tr><th scope="col">Page</th><th scope="col">Status</th></tr></thead>
            <tbody>{pages.map(page => {
              const status = pageStates[page.state]
              return <tr key={page.id}>
                <th scope="row">{labels.get(page.id) ?? page.id}</th>
                <td><span className={`api-usage__state api-usage__tone--${status.tone}`}><span className="api-usage__dot" />{status.label}</span></td>
              </tr>
            })}</tbody>
          </table>
          {!pages.length ? <p className="api-usage__empty">Page readiness will appear when startup begins.</p> : null}
        </div>
        <p className="api-usage__hint api-usage__startup-note">{pages.length ? `${ready} of ${pages.length} pages ready. ` : ''}Timings and failure details are in Page Load Order below.</p>
      </section>
      <section className="api-usage__providers" aria-labelledby="api-provider-title">
        <div className="api-usage__section-heading"><h3 id="api-provider-title">Provider usage</h3><span className="api-usage__eyebrow">Rolling requests</span></div>
        <p className="api-usage__hint">Shared across all pages, startup loading and Agents.</p>
        <div className="api-usage__table-scroll" tabIndex={0} role="region" aria-label="Live provider usage">
          <table className="api-usage__table api-usage__provider-table" aria-label="Provider usage">
            <thead><tr><th scope="col">Provider</th><th scope="col">Used / soft limit</th><th scope="col">Activity</th><th scope="col">Status</th></tr></thead>
            <tbody>{snapshot?.providers.map(provider => {
              const status = providerState(provider)
              return <tr key={provider.id}>
                <th scope="row">{provider.label}</th>
                <td><span className="api-usage__number">{provider.requestCount}<span className="api-usage__secondary"> / {provider.softLimit}</span></span><small>Last {provider.windowSeconds}s</small></td>
                <td><span className="api-usage__number">{provider.inFlight} active</span><small>{provider.queued === undefined ? 'Queue not measured' : `${provider.queued} queued`}</small></td>
                <td><span className={`api-usage__state api-usage__tone--${status.tone}`}><span className="api-usage__dot" />{status.label}</span></td>
              </tr>
            })}</tbody>
          </table>
          {!snapshot?.providers.length ? <p className="api-usage__empty">{snapshot ? 'No instrumented providers reported usage.' : error ? 'Live provider usage is unavailable.' : 'Loading live provider usage…'}</p> : null}
        </div>
        <p className="api-usage__hint api-usage__startup-note">App soft limits are estimates, not provider quotas, billing or remaining credits. Counts roll off each provider's time window.</p>
      </section>
    </div>
    <footer className="api-usage__footer">
      <span className={`api-usage__state api-usage__tone--${incomplete || loading ? 'waiting' : 'muted'}`}>
        <span className="api-usage__dot" />{pages.length ? `${ready} ready · ${loading} loading · ${incomplete} incomplete${idle ? ` · ${idle} awaiting input` : ''}` : 'Startup status pending'}
      </span>
      <span>{snapshot ? `Last sample ${new Date(snapshot.sampledAt).toLocaleTimeString()}` : 'No usage sample yet'}</span>
    </footer>
    <details className="api-usage__directory">
      <summary><span>API &amp; page directory</span><span className="api-usage__secondary">{API_CATALOG.length} API / feed groups</span></summary>
      <div className="api-usage__directory-body">
        <p className="api-usage__hint">Explore shared and fallback dependencies. Page rows describe purpose, not measured request counts. Cached reads may send no requests.</p>
        <div className="api-usage__filters">
          <input aria-label="Search APIs and purposes" placeholder="Search API, page or purpose…" value={search} onChange={event => setSearch(event.target.value)} />
          <select aria-label="Filter API usage by page" value={page} onChange={event => setPage(event.target.value)}>
            <option value="">All pages</option>{TABS.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
          </select>
        </div>
        <p className="api-usage__hint">{entries.length} of {API_CATALOG.length} API / feed groups shown. Personal Finance, Dictionary and local settings do not require an external market-data API. Live counts cover instrumented providers only and reset when the app restarts.</p>
        {entries.map(api => <details key={api.id} className="api-usage__dependency">
          <summary>{api.label}<span className="api-usage__secondary">View page dependencies</span></summary>
          <div className="api-usage__table-scroll"><table className="api-usage__table">
            <thead><tr><th scope="col">Pages</th><th scope="col">Purpose</th></tr></thead>
            <tbody>{api.uses.map((use, index) => <tr key={index}><td>{use.pages.filter(id => !page || id === page).map(id => labels.get(id) ?? id).join(', ')}</td><td>{use.purpose}</td></tr>)}</tbody>
          </table></div>
        </details>)}
        {!entries.length ? <p role="status" className="api-usage__empty">No API dependencies match these filters.</p> : null}
      </div>
    </details>
  </section>
}
