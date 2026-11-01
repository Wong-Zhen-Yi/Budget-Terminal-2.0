import { useEffect, useMemo, useState } from 'react'
import { recentTvVideos, TV_CHANNELS, type TvVideo } from '@shared/tv'
import { api } from '@/api/client'
import { useRefreshTv, useTv } from '@/api/tvQueries'
import { useYouTubeThumbnail } from '@/api/youtubeQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import '@/styles/tv.css'

function publishedAgo(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (minutes < 1) return 'Just published'
  if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago')
  const days = Math.floor(hours / 24)
  return days + (days === 1 ? ' day ago' : ' days ago')
}

function Thumbnail({ video }: { video: TvVideo }) {
  const query = useYouTubeThumbnail(video)
  const dataUri = query.data?.data.dataUri
  return <span className="tv-thumbnail">
    {dataUri ? <img src={dataUri} alt="" /> : <span className="tv-image-fallback">{video.channel}<small>{query.isFetching ? 'Loading thumbnail…' : 'Thumbnail unavailable'}</small></span>}
    <span className="tv-play" aria-hidden="true">▶</span>
  </span>
}

export function TvPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const query = useTv()
  const refresh = useRefreshTv()
  const [channel, setChannel] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    onStatusChange([{ label: 'TV', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching }], '')
  }, [onStatusChange, query.data, query.error, query.isEnabled, query.isFetching])

  const items = useMemo(() => recentTvVideos(query.data?.data.items ?? [], now), [now, query.data])
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter(item => (!channel || item.channelId === channel)
      && (!term || (item.title + ' ' + item.channel + ' ' + item.descriptionSnippet).toLowerCase().includes(term)))
  }, [channel, items, search])
  const selected = visible.find(item => item.videoId === selectedId) ?? visible[0]
  const busy = refreshing || query.isFetching
  const payload = query.data?.data
  const freshness = query.data?.meta.freshness
  const failure = refreshError || query.error?.message || (freshness === 'failed' ? query.data?.meta.failureReason || 'Channel feeds could not load.' : '')
  const warnings = payload?.warnings ?? []
  const degraded = freshness === 'partial' || freshness === 'stale' || warnings.length > 0
  const status = failure ? 'Refresh failed: ' + failure : busy ? (payload ? 'Refreshing market coverage…' : 'Loading market coverage…')
    : degraded ? (freshness === 'stale' ? 'Showing saved uploads; channel refresh failed.' : 'Some channels could not refresh.')
    : payload ? 'Market feed up to date' : 'Waiting for market coverage…'
  const hasFilters = Boolean(channel || search.trim())
  const emptyTitle = busy ? 'Loading market coverage' : hasFilters && items.length ? 'No matching videos' : 'No recent market videos'
  const emptyMessage = failure ? 'Use Refresh to retry. The error is shown above.' : hasFilters && items.length
    ? 'Try another channel or search term.' : 'Matching stock market uploads from the last seven days will appear here.'
  const openVideo = (video: TvVideo) => { void api.openExternal(video.url) }
  const onRefresh = async () => {
    setRefreshError('')
    setRefreshing(true)
    try { await refresh(); setNow(Date.now()) }
    catch (error) { setRefreshError(error instanceof Error ? error.message : String(error)) }
    finally { setRefreshing(false) }
  }

  return <div className="tv-workspace" data-tv-page>
    <header className="tv-header">
      <div><div className="tv-eyebrow">Market television</div><h1>TV <span>Latest market coverage</span></h1>
        <p>Stocks, earnings and the economy. Recent YouTube uploads, newest first.</p></div>
      <button type="button" className="tv-refresh" disabled={busy} onClick={() => void onRefresh()}>{busy ? 'Refreshing…' : 'Refresh'}</button>
    </header>
    <div className="tv-controls">
      <div className="tv-channels" role="group" aria-label="TV channels">
        <button type="button" aria-pressed={!channel} onClick={() => setChannel('')}>All channels</button>
        {TV_CHANNELS.map(item => <button type="button" key={item.id} aria-pressed={channel === item.id} onClick={() => setChannel(item.id)}>{item.name}</button>)}
      </div>
      <input aria-label="Search TV videos" placeholder="Search market coverage" value={search} onChange={event => setSearch(event.target.value)} />
    </div>
    <div className="tv-status-line">
      <span>{visible.length} videos · Last 7 days · Newest first</span>
      <span className={'tv-status' + (failure ? ' tv-status--error' : degraded ? ' tv-status--warning' : '')} role="status">{status}</span>
      {payload && <span>{payload.channelsLoaded}/{payload.channelsTotal} channels refreshed · Checked {new Date(payload.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
    </div>
    {(warnings.length > 0 || (degraded && query.data?.meta.failureReason)) && <details className="tv-warnings"><summary>Channel warnings</summary>
      {(warnings.length ? warnings : [query.data?.meta.failureReason]).map((warning, index) => <p key={index}>{warning}</p>)}
    </details>}
    <div className="tv-content" aria-busy={busy}>
      {selected ? <>
        <section className="tv-feature" aria-label="Selected market video">
          <button className="tv-feature-image" type="button" onClick={() => openVideo(selected)} aria-label={'Watch ' + selected.title + ' on YouTube'}><Thumbnail video={selected} /></button>
          <div className="tv-feature-copy"><div className="tv-eyebrow">{selected.channel}</div><h2>{selected.title}</h2>
            <time dateTime={new Date(selected.publishedAt).toISOString()} title={new Date(selected.publishedAt).toLocaleString()}>{publishedAgo(selected.publishedAt, now)} · {new Date(selected.publishedAt).toLocaleString()}</time>
            <p>{selected.descriptionSnippet || 'Watch this market update on YouTube.'}</p>
            <button className="tv-watch" type="button" onClick={() => openVideo(selected)}>Watch on YouTube ↗</button>
          </div>
        </section>
        <section aria-label="Latest market videos" className="tv-feed"><h2>Latest coverage <span>{visible.length}</span></h2>
          <ul className="tv-grid">{visible.map(video => <li key={video.videoId}>
            <button type="button" className="tv-card" aria-pressed={selected.videoId === video.videoId} onClick={() => setSelectedId(video.videoId)} onDoubleClick={() => openVideo(video)}>
              <Thumbnail video={video} /><span className="tv-card-copy"><span className="tv-card-channel">{video.channel}</span><span className="tv-card-title">{video.title}</span>
                <time dateTime={new Date(video.publishedAt).toISOString()} title={new Date(video.publishedAt).toLocaleString()}>{publishedAgo(video.publishedAt, now)}</time></span>
            </button>
          </li>)}</ul>
        </section>
      </> : <div className="tv-empty"><span aria-hidden="true">▶</span><h2>{emptyTitle}</h2><p>{emptyMessage}</p>
        {hasFilters && <button type="button" onClick={() => { setChannel(''); setSearch('') }}>Clear filters</button>}
      </div>}
      <footer className="tv-footer">Latest matching uploads available in the public feeds of CNBC Television, Yahoo Finance and Bloomberg Television. Refreshes every 5 minutes. No minimum view count.</footer>
    </div>
  </div>
}
