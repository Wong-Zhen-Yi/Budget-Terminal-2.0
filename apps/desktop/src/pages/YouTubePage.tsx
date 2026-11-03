import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { YouTubeVideo } from '@shared/contract'
import { filterYouTubeVideos, normalizeYouTubePageSettings, sortYouTubeVideos, videoKey, YOUTUBE_MAX_AGE_DAYS, YOUTUBE_MIN_VIEW_COUNT } from '@shared/youtube'
import { usePortfolio } from '@/api/queries'
import { useSettings, useSettingsMutation } from '@/api/settingsQueries'
import { useYouTube, useYouTubeThumbnail } from '@/api/youtubeQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { youtubeEmbedUrl } from '@shared/youtubePlayer'
import '@/styles/youtube.css'

const SORT_OPTIONS = [
  { label: 'Newest first', column: -1, descending: false },
  { label: 'Oldest first', column: 5, descending: true },
  { label: 'Most viewed', column: 3, descending: true },
  { label: 'Least viewed', column: 3, descending: false },
  { label: 'Ticker A–Z', column: 0, descending: false },
  { label: 'Ticker Z–A', column: 0, descending: true },
  { label: 'Title A–Z', column: 1, descending: false },
  { label: 'Title Z–A', column: 1, descending: true },
  { label: 'Channel A–Z', column: 2, descending: false },
  { label: 'Channel Z–A', column: 2, descending: true },
  { label: 'Published date ↓', column: 4, descending: true },
  { label: 'Published date ↑', column: 4, descending: false },
  { label: 'Days ago ↑', column: 5, descending: false },
  { label: 'Longest first', column: 6, descending: true },
  { label: 'Shortest first', column: 6, descending: false },
] as const

function rowKey(video: YouTubeVideo): string {
  return video.ticker + ':' + videoKey(video)
}

function publishedAge(video: YouTubeVideo): string {
  if (video.publishedDays === null) return video.publishedText || 'Date unavailable'
  if (video.publishedDays === 0) return 'Today'
  return video.publishedDays + (video.publishedDays === 1 ? ' day ago' : ' days ago')
}

function Icon({ name }: { name: 'search' | 'refresh' | 'external' | 'play' | 'close' }) {
  const paths = {
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3',
    external: 'M14 3h7v7M21 3L10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6',
    play: 'M9 5l11 7-11 7z',
    close: 'M6 6l12 12M18 6L6 18',
  }
  return <svg viewBox="0 0 24 24" fill={name === 'play' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

function VideoThumbnail({ video, preview = false }: { video: YouTubeVideo | null; preview?: boolean }) {
  const query = useYouTubeThumbnail(video)
  const dataUri = query.data?.data.dataUri
  return (
    <span className={preview ? 'youtube-image youtube-image--preview' : 'youtube-image'}>
      {dataUri ? <img src={dataUri} alt="" /> : (
        <span className="youtube-image-fallback">
          <span className="youtube-image-symbol">{video?.ticker || 'YouTube'}</span>
          <span>{query.isFetching ? 'Loading thumbnail…' : video ? 'Thumbnail unavailable' : 'No video selected'}</span>
        </span>
      )}
      {video?.durationText && <span className="youtube-duration">{video.durationText}</span>}
      {preview && video?.url && <span className="youtube-play"><Icon name="play" /></span>}
    </span>
  )
}

function VideoPlayer({ video, onClose }: { video: YouTubeVideo; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return <dialog ref={dialog} className="youtube-player-dialog" aria-label={'Playing ' + video.title} onCancel={onClose}>
    <header><h2>{video.title}</h2><button type="button" onClick={onClose} aria-label="Close video player" autoFocus><Icon name="close" /></button></header>
    <iframe key={video.videoId} src={youtubeEmbedUrl(video.videoId) ?? undefined} title={video.title}
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
    <p>YouTube playback controls include fullscreen. Press Escape or close the player to return to your feed.</p>
  </dialog>
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return <div className="youtube-meta-row"><dt>{label}</dt><dd title={value}>{value || '—'}</dd></div>
}


/** Paginate text within its measured space rather than clipping it or adding a scrollbar. */
function FittedText({ text, label }: { text: string; label: string }) {
  const area = useRef<HTMLParagraphElement>(null)
  const [pages, setPages] = useState<string[]>([text])
  const [page, setPage] = useState(0)
  useLayoutEffect(() => {
    const element = area.current
    if (!element) return
    const measure = () => {
      const context = document.createElement('canvas').getContext('2d')
      if (!context || element.clientWidth <= 0 || element.clientHeight <= 0) return
      const style = getComputedStyle(element)
      context.font = style.font
      const width = Math.max(1, element.clientWidth - 2)
      const lines: string[] = []
      let line = ''
      for (const word of text.split(/\s+/)) {
        const candidate = line ? line + ' ' + word : word
        if (context.measureText(candidate).width <= width) {
          line = candidate
          continue
        }
        if (line) lines.push(line)
        line = ''
        for (const character of word) {
          if (line && context.measureText(line + character).width > width) {
            lines.push(line)
            line = ''
          }
          line += character
        }
      }
      if (line || !lines.length) lines.push(line)
      const count = Math.max(1, Math.floor(element.clientHeight / Number.parseFloat(style.lineHeight)))
      const result: string[] = []
      for (let start = 0; start < lines.length; start += count) result.push(lines.slice(start, start + count).join('\n'))
      setPages(result)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [text])
  const current = Math.min(page, pages.length - 1)
  return <div className="youtube-fitted-text">
    <p ref={area}>{pages[current]}</p>
    <div className="youtube-text-pagination">
      {pages.length > 1 && <>
        <button type="button" aria-label={'Previous ' + label + ' page'} disabled={!current} onClick={() => setPage(current - 1)}>‹</button>
        <span>{current + 1} / {pages.length}</span>
        <button type="button" aria-label={'Next ' + label + ' page'} disabled={current === pages.length - 1} onClick={() => setPage(current + 1)}>›</button>
      </>}
    </div>
  </div>
}

const COLUMNS = [
  { label: 'Ticker', column: 0, className: 'youtube-col-ticker' },
  { label: 'Video', column: 1, className: 'youtube-col-video' },
  { label: 'Channel', column: 2, className: 'youtube-col-channel' },
  { label: 'Views', column: 3, className: 'youtube-col-views' },
  { label: 'Published', column: 5, className: 'youtube-col-published' },
  { label: 'Length', column: 6, className: 'youtube-col-length' },
] as const

export function YouTubePage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const portfolioQuery = usePortfolio()
  const settingsQuery = useSettings()
  const saveSettings = useSettingsMutation()
  const tickers = useMemo(() => {
    const seen = new Set<string>()
    for (const portfolio of portfolioQuery.data?.data.portfolios ?? []) {
      for (const ticker of portfolio.tickers) {
        const normalized = ticker.trim().toUpperCase()
        if (normalized) seen.add(normalized)
      }
    }
    return [...seen]
  }, [portfolioQuery.data])
  const query = useYouTube(tickers)
  const [playingVideo, setPlayingVideo] = useState<YouTubeVideo | null>(null)
  const [filter, setFilter] = useState('')
  const [tickerFilter, setTickerFilter] = useState('')
  const [sortColumn, setSortColumn] = useState<number>(() => normalizeYouTubePageSettings(settingsQuery.data?.data.youtubePage).sortColumn)
  const [sortDescending, setSortDescending] = useState<boolean>(() => normalizeYouTubePageSettings(settingsQuery.data?.data.youtubePage).sortDescending)
  const [manualSelectedKey, setManualSelectedKey] = useState('')
  const refreshing = false
  const refreshError = ''
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(1)
  const [inspectorTab, setInspectorTab] = useState<'details' | 'description'>('details')
  const tableArea = useRef<HTMLDivElement>(null)
  const hydrated = useRef(false)

  useLayoutEffect(() => {
    const element = tableArea.current
    if (!element) return
    const measure = () => {
      if (!element.clientHeight) return
      const rowHeight = Number.parseFloat(getComputedStyle(element).getPropertyValue('--youtube-row-height')) || 50
      const headerHeight = element.querySelector('thead')?.getBoundingClientRect().height ?? 32
      setPageSize(Math.max(1, Math.floor((element.clientHeight - headerHeight - 1) / rowHeight)))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])
  const activeTicker = tickers.includes(tickerFilter) ? tickerFilter : ''

  useEffect(() => {
    if (hydrated.current || !settingsQuery.data?.data) return
    const settings = normalizeYouTubePageSettings(settingsQuery.data.data.youtubePage)
    hydrated.current = true
    setSortColumn(settings.sortColumn)
    setSortDescending(settings.sortDescending)
  }, [settingsQuery.data])

  useEffect(() => {
    onStatusChange([
      { label: 'YouTube', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching },
      { label: 'Holdings', envelope: portfolioQuery.data, error: portfolioQuery.error, enabled: portfolioQuery.isEnabled, loading: portfolioQuery.isFetching },
    ], settingsQuery.data?.data.sourcePath ?? '')
  }, [onStatusChange, portfolioQuery.data, portfolioQuery.error, portfolioQuery.isEnabled, portfolioQuery.isFetching,
    query.data, query.error, query.isEnabled, query.isFetching, settingsQuery.data])

  const payload = query.data?.data
  const sorted = useMemo(() => sortYouTubeVideos(payload?.items ?? [], sortColumn, sortDescending), [payload?.items, sortColumn, sortDescending])
  const visible = useMemo(() => filterYouTubeVideos(
    activeTicker ? sorted.filter(item => item.ticker === activeTicker) : sorted, filter,
  ), [activeTicker, filter, sorted])
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const start = currentPage * pageSize
  const pageItems = visible.slice(start, start + pageSize)
  const selected = pageItems.find(item => rowKey(item) === manualSelectedKey) ?? pageItems[0] ?? null
  const busy = refreshing || query.isFetching
  const hasFilters = Boolean(filter.trim() || activeTicker)
  const status = useMemo<{ text: string; tone: 'muted' | 'positive' | 'warning' | 'negative' }>(() => {
    const failure = refreshError || query.error?.message || (query.data?.meta.freshness === 'failed' ? query.data.meta.failureReason || 'Request failed' : '')
    if (failure) return { text: 'YouTube refresh failed: ' + failure, tone: 'negative' }
    if (portfolioQuery.isPending) return { text: 'Loading portfolio tickers…', tone: 'muted' }
    if (portfolioQuery.error) return { text: 'Holdings could not load: ' + portfolioQuery.error.message, tone: 'negative' }
    if (!tickers.length) return { text: 'Add portfolio tickers to discover videos.', tone: 'warning' }
    if (busy) return { text: payload ? 'Refreshing videos · showing loaded results' : 'Loading portfolio videos…', tone: 'muted' }
    if (!payload) return { text: 'Waiting for portfolio videos…', tone: 'muted' }
    const freshness = query.data?.meta.freshness
    if (freshness === 'stale' || freshness === 'partial') {
      return { text: (freshness === 'stale' ? 'Showing stale results' : 'Some results are unavailable') + (query.data?.meta.failureReason ? ' · ' + query.data.meta.failureReason : ''), tone: 'warning' }
    }
    return { text: payload.warnings.length ? '' : 'Videos up to date', tone: 'positive' }
  }, [busy, payload, portfolioQuery.error, portfolioQuery.isPending, query.data, query.error, refreshError, tickers.length])

  const onSort = (value: string) => {
    const [column, descending] = value.split(':')
    const next = { sortColumn: Number(column), sortDescending: descending === 'true' }
    setPage(0)
    setSortColumn(next.sortColumn)
    setSortDescending(next.sortDescending)
    void saveSettings({ type: 'setYouTubePage', value: next })
  }
  const openVideo = useCallback((video: YouTubeVideo | null) => {
    if (video && youtubeEmbedUrl(video.videoId)) setPlayingVideo(video)
  }, [])
  const clearFilters = () => {
    setFilter('')
    setTickerFilter('')
    setPage(0)
  }
  const emptyTitle = hasFilters && sorted.length ? 'No matching videos' : busy ? 'Loading your feed' : 'No videos available'
  const emptyMessage = hasFilters && sorted.length ? 'Try a different ticker or search term.' : !tickers.length
    ? 'Save tickers in a portfolio to see their recent research videos here.'
    : status.tone === 'negative' ? 'Use Reload (F5) to try again. Failure details are shown above.'
    : 'Videos with at least 1,000 views from the last 90 days will appear here.'
  const currentSort = sortColumn < 0 ? '-1:false' : sortColumn + ':' + sortDescending
  const updatedAt = payload?.fetchedAt ?? 0

  return (
    <div className="youtube-workspace" data-youtube-page>
      {playingVideo && <VideoPlayer video={playingVideo} onClose={() => setPlayingVideo(null)} />}
      <header className="youtube-header">
        <div><h1>YouTube</h1><p>Research videos for your portfolio</p></div>
        <span className="youtube-coverage">Last {YOUTUBE_MAX_AGE_DAYS} days · {YOUTUBE_MIN_VIEW_COUNT.toLocaleString()}+ views</span>
      </header>
      <div className="youtube-toolbar">
        <div className="youtube-search">
          <Icon name="search" />
          <input value={filter} onChange={event => { setFilter(event.target.value); setPage(0) }} placeholder="Filter ticker, title or channel" aria-label="Filter YouTube videos" />
          {filter && <button type="button" onClick={() => { setFilter(''); setPage(0) }} aria-label="Clear search"><Icon name="close" /></button>}
        </div>
        <select className="youtube-ticker-filter" aria-label="Filter by portfolio ticker" value={activeTicker} onChange={event => { setTickerFilter(event.target.value); setPage(0) }}>
          <option value="">All tickers</option>
          {tickers.map(ticker => <option key={ticker} value={ticker}>{ticker}</option>)}
        </select>
        <select className="youtube-sort" aria-label="Sort videos" value={currentSort} onChange={event => onSort(event.target.value)}>
          {SORT_OPTIONS.map(option => <option key={option.column + ':' + option.descending} value={option.column + ':' + option.descending}>{option.label}</option>)}
        </select>

      </div>
      <div className="youtube-status-line">
        <span className="youtube-count">{visible.length === sorted.length ? sorted.length + ' videos' : visible.length + ' of ' + sorted.length + ' videos'} · {payload?.tickersTotal ?? tickers.length} tickers</span>
        {status.text && <span className={'youtube-status youtube-status--' + status.tone} role="status" title={status.text}><i aria-hidden="true" /><span>{status.text}</span></span>}
        {payload?.fetchedAt ? <span className="youtube-updated" title={new Date(updatedAt).toLocaleString()}>Updated {new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : null}
      </div>

      <div className="youtube-body">
        <section className="youtube-feed" aria-label="Portfolio YouTube feed" aria-busy={busy}>
          <header className="youtube-feed-header"><h2>Portfolio feed <span>({visible.length})</span></h2><span>Select a video to inspect</span></header>
          <div className="youtube-table-wrap" ref={tableArea}>
            <table className="youtube-table">
              <colgroup>{COLUMNS.map(column => <col key={column.column} className={column.className} />)}</colgroup>
              <thead><tr>{COLUMNS.map(column => {
                const active = sortColumn < 0 ? column.column === 5 : sortColumn === column.column
                const descending = sortColumn >= 0 && sortDescending
                return <th key={column.column} className={column.className} aria-sort={active ? descending ? 'descending' : 'ascending' : 'none'}>
                  <button type="button" onClick={() => onSort(column.column + ':' + (active ? !descending : column.column === 3 || column.column === 6))}>{column.label}{active ? descending ? ' ↓' : ' ↑' : ''}</button>
                </th>
              })}</tr></thead>
              <tbody>{pageItems.map(item => {
                const key = rowKey(item)
                const active = Boolean(selected && rowKey(selected) === key)
                return <tr key={key} className="youtube-video-row" aria-selected={active} tabIndex={0} aria-label={'Select ' + item.title + ' for ' + item.ticker} onClick={() => setManualSelectedKey(key)} onDoubleClick={() => openVideo(item)} onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setManualSelectedKey(key) }
                }}>
                  <td className="youtube-col-ticker"><span className="youtube-ticker" title={item.ticker}>{item.ticker}</span></td>
                  <td className="youtube-col-video"><span className="youtube-video-cell"><VideoThumbnail video={item} /><span className="youtube-video-title" title={item.title}>{item.title}</span></span></td>
                  <td className="youtube-col-channel"><span title={item.channel}>{item.channel || 'Unavailable'}</span></td>
                  <td className="youtube-col-views">{item.viewCountText || 'N/A'}</td>
                  <td className="youtube-col-published"><span title={item.publishedText}>{publishedAge(item)}</span></td>
                  <td className="youtube-col-length">{item.durationText || '—'}</td>
                </tr>
              })}</tbody>
            </table>
            {!pageItems.length && <div className="youtube-empty"><h2>{emptyTitle}</h2><p>{emptyMessage}</p>{hasFilters && <button type="button" onClick={clearFilters}>Clear filters</button>}</div>}
          </div>
          <footer className="youtube-feed-footer">
            <span>{visible.length ? start + 1 : 0}–{Math.min(start + pageSize, visible.length)} of {visible.length} videos</span>
            <nav className="youtube-pagination" aria-label="Video pages">
              <button type="button" aria-label="Previous video page" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>‹</button>
              <span>Page {currentPage + 1} of {pageCount}</span>
              <button type="button" aria-label="Next video page" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>›</button>
            </nav>
          </footer>
        </section>

        <section className="youtube-focus" aria-label="Selected video">
          <div className="youtube-eyebrow">Selected video{selected && <span className="youtube-ticker">{selected.ticker}</span>}</div>
          <button type="button" className="youtube-preview" onClick={() => openVideo(selected)} disabled={!selected?.url} aria-label={selected ? 'Watch ' + selected.title + ' in app' : 'No video selected'}><VideoThumbnail key={selected ? videoKey(selected) : 'empty'} video={selected} preview /></button>
          <div className="youtube-title-row"><h2 title={selected?.title}>{selected?.title || emptyTitle}</h2><span className="youtube-channel" title={selected?.channel}>{selected?.channel || (selected ? 'Channel unavailable' : emptyMessage)}</span></div>
          {selected ? <button type="button" className="youtube-watch" onClick={() => openVideo(selected)} disabled={!selected.url}>Play video<Icon name="play" /></button> : <button type="button" className="youtube-watch-placeholder" onClick={clearFilters} disabled={!hasFilters}>{hasFilters ? 'Clear filters' : 'Waiting for videos'}</button>}
          <div className="youtube-inspector-tabs" role="group" aria-label="Video information">
            <button type="button" aria-pressed={inspectorTab === 'details'} onClick={() => setInspectorTab('details')}>Details</button>
            <button type="button" aria-pressed={inspectorTab === 'description'} onClick={() => setInspectorTab('description')}>Description</button>
          </div>
          <div className="youtube-information">
            {inspectorTab === 'details' ? <dl className="youtube-details">
              <MetaRow label="Ticker" value={selected?.ticker ?? ''} /><MetaRow label="Views" value={selected?.viewCountText ?? ''} />
              <MetaRow label="Published" value={selected?.publishedText ?? ''} /><MetaRow label="Age" value={selected ? publishedAge(selected) : ''} />
              <MetaRow label="Duration" value={selected?.durationText ?? ''} /><MetaRow label="Channel" value={selected?.channel ?? ''} />
            </dl> : <FittedText key={(selected ? rowKey(selected) : '') + ':description'} text={selected?.descriptionSnippet || (selected ? 'No description is available for this video.' : emptyMessage)} label="description" />}
          </div>
        </section>
      </div>
    </div>
  )
}
