import { useState } from 'react'
import { TABS } from '@shared/contract'
import { useDataHealth } from '@/stores/dataHealth'
import { effectiveFreshness, errorMessage, useSnapshotClock } from '@/api/snapshotHealth'
import type { PanelStatus } from './StatusBar'

export function PageReadiness({ page }: { page: string }) {
  const status = useDataHealth(state => state.startup?.pages?.[page])
  const label = !status ? 'Waiting' : status.refreshing ? 'Refreshing' : ({
    loading: 'Loading', ready: 'Ready', degraded: 'Incomplete', failed: 'Failed', idle: 'Needs input',
  })[status.state]
  return <span data-page-readiness={page} className={`ml-2 text-[10px] ${status?.state === 'failed' || status?.state === 'degraded' ? 'text-warn' : 'text-text-dim'}`}
    title={status?.reason}>{label}</span>
}

/** Visible feedback for both startup and later refreshes, without blocking content. */
export function LoadingStatus({ page, panels, retry }: {
  page: string
  panels: PanelStatus[]
  retry: (page?: string) => void
}) {
  const startup = useDataHealth(state => state.startup)
  const [expanded, setExpanded] = useState(false)
  const now = useSnapshotClock()
  const pages = startup?.pages ?? {}
  const states = Object.values(pages)
  const ready = states.filter(status => status.state === 'ready').length
  const unhealthy = states.filter(status => status.state === 'failed' || status.state === 'degraded').length
  const pending = states.filter(status => status.state === 'loading').length
  const idle = states.filter(status => status.state === 'idle').length
  const current = pages[page]
  const expected = panels.filter(panel => panel.enabled !== false)
  const snapshots = expected.flatMap(panel => panel.envelope ? [panel.envelope] : [])
  const refreshing = current?.refreshing || expected.some(panel => panel.loading && panel.envelope)
  const error = expected.map(panel => errorMessage(panel.error)).find(Boolean)
  const stale = expected.some(panel => panel.envelope && effectiveFreshness(panel.envelope, now, panel.freshnessMs) === 'stale')
  const cachedAt = snapshots.length ? Math.min(...snapshots.map(snapshot => snapshot.meta.fetchedAt)) : current?.cachedAt
  const stamp = cachedAt ? new Date(cachedAt).toLocaleString() : ''
  const incomplete = expected.find(panel => !panel.loading && panel.envelope && ['failed', 'partial'].includes(panel.envelope.meta.freshness))
  const warning = error || (incomplete ? incomplete.envelope?.meta.failureReason || 'Some page data is incomplete' : '')
    || (current?.state === 'failed' || current?.state === 'degraded' ? current.reason || 'Some page data could not load' : '')
  return <section aria-label="Page loading status" className="shrink-0 border-b border-border bg-surface px-3 py-2 text-2xs">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="text-text-muted hover:text-text">
        {!startup ? 'Preparing pages…' : `Pages ${ready}/${states.length} ready${pending ? ` · ${pending} loading` : ''}${unhealthy ? ` · ${unhealthy} need attention` : ''}${idle ? ` · ${idle} need input` : ''}`} {expanded ? '▴' : '▾'}
      </button>
      <span role="status" aria-live="polite" className={warning ? 'text-warn' : 'text-text-muted'}>
        {warning ? `Page needs attention${cachedAt ? ' · Showing saved content' : ''}` : refreshing ? 'Refreshing · Keeping current content visible'
          : current?.state === 'loading' ? cachedAt ? 'Showing saved content · Refreshing' : 'Loading current page…' : stale ? 'Showing older data' : ''}
      </span>
      {stamp ? <span className="text-text-dim" title="Oldest retrieval time among this page’s reported snapshots">Data retrieved {stamp}</span> : null}
      {warning ? <span className="max-w-xl truncate text-warn" title={warning}>{warning}</span> : null}
      {warning ? <button type="button" disabled={Boolean(refreshing)} onClick={() => retry(page)} className="text-accent hover:underline disabled:opacity-50">Retry current page</button> : null}
      {unhealthy ? <button type="button" onClick={() => retry()} className="ml-auto text-accent hover:underline">Retry failed / incomplete</button> : null}
    </div>
    {expanded ? <div className="mt-2 max-h-56 overflow-auto border-t border-border pt-2" aria-label="Startup page details">
      <p className="mb-2 text-text-dim">Every page loads at startup. Saved content stays visible while data refreshes. {startup ? `${startup.timings.length}/${startup.planned} initial tasks settled.` : ''}</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
        {TABS.filter(tab => tab.implemented).map(tab => {
          const status = pages[tab.id]
          const failed = status?.state === 'failed' || status?.state === 'degraded'
          return <div key={tab.id} className="min-w-0 rounded border border-border p-2">
            <span>{tab.label}</span><PageReadiness page={tab.id} />
            {status?.reason ? <p className="truncate text-text-dim" title={status.reason}>{status.reason}</p> : null}
            {failed ? <button type="button" disabled={status.refreshing} onClick={() => retry(tab.id)} className="mt-1 text-accent disabled:opacity-50">{status.refreshing ? 'Retrying…' : `Retry ${tab.label}`}</button> : null}
          </div>
        })}
      </div>
    </div> : null}
  </section>
}
