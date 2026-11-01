import { useEffect, useState, type FormEvent } from 'react'
import { dehydrate, useQuery, useQueryClient } from '@tanstack/react-query'
import { CACHE_SETTING_BOUNDS, DEFAULT_CACHE_SETTINGS, MIB, validCacheSettings, type CacheSettings } from '@shared/cachePolicy'
import { api } from '@/api/client'
import { configureRendererCache, rendererCacheSettings, rendererQueryPersister, RENDERER_CACHE_BUSTER, shouldPersistRemoteQuery } from '@/api/queryPersistence'
import { Button } from '@/components/ui/Button'

const labels: Record<keyof CacheSettings, string> = {
  rendererMiB: 'Page snapshots (MiB)', marketMiB: 'Market data (MiB)',
  assetsMiB: 'Images and previews (MiB)', retentionDays: 'Snapshot retention (days)',
}
const size = (bytes: number) => `${(bytes / MIB).toFixed(1)} MiB`

function Usage({ label, bytes, limit, detail }: { label: string; bytes: number; limit: number; detail: string }) {
  return <div className="min-w-0 border border-border p-2">
    <div className="flex justify-between gap-2 text-2xs"><span>{label}</span><span className="num">{size(bytes)} / {limit} MiB</span></div>
    <meter className="mt-1 h-2 w-full" min={0} max={limit * MIB} value={bytes} aria-label={`${label} cache usage`} />
    <p className="mt-1 text-2xs text-text-muted">{detail}</p>
  </div>
}

export function CachePanel() {
  const client = useQueryClient()
  const status = useQuery({ queryKey: ['cacheStatus'], queryFn: () => api.cacheStatus(),
    refetchInterval: 5_000, refetchIntervalInBackground: false, staleTime: 1_000 })
  const settings = status.data?.data.settings
  const service = status.data?.data.service
  const [draft, setDraft] = useState<CacheSettings>(rendererCacheSettings)
  const [renderer, setRenderer] = useState(() => rendererQueryPersister.stats())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState(false)
  useEffect(() => { if (settings) setDraft(settings) }, [settings?.rendererMiB, settings?.marketMiB, settings?.assetsMiB, settings?.retentionDays])
  useEffect(() => {
    const timer = setInterval(() => setRenderer(rendererQueryPersister.stats()), 2_000)
    return () => clearInterval(timer)
  }, [])

  const apply = async (event: FormEvent) => {
    event.preventDefault()
    if (!validCacheSettings(draft)) { setFailure(true); setMessage('Enter whole numbers within the shown ranges.'); return }
    setBusy(true)
    setMessage('Saving cache limits...')
    setFailure(false)
    try {
      const result = await api.configureCache(draft)
      if (result.meta.failureReason) throw new Error(result.meta.failureReason)
      configureRendererCache(result.data.settings)
      await rendererQueryPersister.persistClient({ timestamp: Date.now(), buster: RENDERER_CACHE_BUSTER,
        clientState: dehydrate(client, { shouldDehydrateQuery: shouldPersistRemoteQuery }) })
      await rendererQueryPersister.flush()
      if (rendererQueryPersister.stats().error) throw new Error(rendererQueryPersister.stats().error)
      setRenderer(rendererQueryPersister.stats())
      client.setQueryData(['cacheStatus'], result)
      setMessage('Cache limits saved and applied. All pages continue loading and refreshing in the background.')
    } catch (error) { setFailure(true); setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  const active = settings ?? rendererCacheSettings()
  return <section className="border border-border bg-surface p-3" aria-labelledby="cache-title">
    <h2 id="cache-title" className="text-xs font-semibold text-text">Cache and startup</h2>
    <p className="mt-1 text-2xs text-text-muted">Saved pages appear immediately while every page prepares its data. A refresh check being due does not invalidate saved market history. Data ages and refresh failures remain visible. Disk limits do not reserve RAM.</p>
    <div className="mt-3 grid gap-2 lg:grid-cols-3">
      <Usage label="Page snapshots" bytes={renderer.bytes} limit={active.rendererMiB} detail={`${renderer.saved} saved queries · ${renderer.evictions} evictions this session`} />
      <Usage label="Market data" bytes={service?.market.bytes ?? 0} limit={active.marketMiB} detail={`${service?.market.entries ?? 0} entries · ${service?.market.expiredEntries ?? 0} due for a check · ${service?.market.evictions ?? 0} evictions this session`} />
      <Usage label="Images and previews" bytes={service?.assets.bytes ?? 0} limit={active.assetsMiB} detail={`${service?.assets.entries ?? 0} entries · ${service?.assets.evictions ?? 0} evictions this session`} />
    </div>
    <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event => void apply(event)}>
      {(Object.keys(labels) as Array<keyof CacheSettings>).map(key => <label key={key} className="flex flex-col gap-1 text-2xs text-text-muted">
        {labels[key]}
        <input type="number" min={CACHE_SETTING_BOUNDS[key].min} max={CACHE_SETTING_BOUNDS[key].max} step={1}
          className="w-40 border border-border bg-surface-raised px-2 py-1 text-text" value={draft[key]}
          onChange={event => setDraft(previous => ({ ...previous, [key]: Number(event.target.value) }))} required />
        <span>{CACHE_SETTING_BOUNDS[key].min}–{CACHE_SETTING_BOUNDS[key].max}</span>
      </label>)}
      <Button type="submit" disabled={busy || !settings}>{busy ? 'Applying...' : 'Apply cache limits'}</Button>
      <Button type="button" disabled={busy} onClick={() => setDraft({ ...DEFAULT_CACHE_SETTINGS })}>Use defaults</Button>
    </form>
    <p className="mt-2 text-2xs text-text-muted">Snapshot retention controls how long saved pages remain available, not how fresh their data is. Lowering a limit removes older cached results. Images have a separate budget and cannot evict market data.</p>
    <p className="mt-2 text-2xs text-text-muted">Yahoo U.S. stock quotes and chart history reuse checked closing data until the next regular session, after a 20-minute closing update window. During trading, quote checks use 30 seconds and daily history uses 30 minutes. Unknown markets keep their normal intervals. Live perpetual feeds and manual refresh remain available.</p>
    <p className="mt-2 text-2xs text-text-muted">This launch restored {renderer.restored} queries; {renderer.expiredOnRestore} exceeded retention. Service reads: {service?.hits ?? 0} hits, {service?.misses ?? 0} missing, {service?.expired ?? 0} due for a check. Provider loads: {service?.loads ?? 0}, including {service?.forced ?? 0} forced refreshes.</p>
    <details className="mt-2 text-2xs">
      <summary className="cursor-pointer text-text-muted">Why data is loading or refreshing</summary>
      <div className="mt-2 max-h-52 overflow-auto">
        <table className="w-full text-left"><caption className="sr-only">Cache decisions by query family this session</caption>
          <thead><tr>{['Data family', 'Reused', 'Missing', 'Check due / requested', 'Recovering'].map(label => <th key={label} className="p-1 font-medium">{label}</th>)}</tr></thead>
          <tbody>{Object.entries(renderer.refreshes).sort(([left], [right]) => left.localeCompare(right)).map(([root, counts]) => <tr key={root} className="border-t border-border">
            <td className="p-1">{root}</td>{[counts.reused, counts.missing, counts.expired, counts.recovery].map((count, index) => <td key={index} className="num p-1">{count}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <p className="mt-1 text-text-muted">Counts cover startup and background maintenance in this session. Missing data may never have loaded or may have been evicted. A reused snapshot can still need a later refresh.</p>
    </details>
    {renderer.error && <p role="alert" className="mt-2 text-2xs text-down">Page cache could not save or restore: {renderer.error}</p>}
    {service?.lastError && <p role="alert" className="mt-2 text-2xs text-down">Service cache: {service.lastError}</p>}
    {status.error && <p role="alert" className="mt-2 text-2xs text-down">Cache diagnostics unavailable: {status.error.message}</p>}
    {message && <p role="status" className={`mt-2 text-2xs ${failure ? 'text-down' : 'text-text-muted'}`}>{message}</p>}
  </section>
}
