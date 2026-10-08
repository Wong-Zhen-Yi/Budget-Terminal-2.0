import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { YouTubeVideo } from '@shared/contract'
import {
  filterYouTubeVideos,
  normalizeYouTubePageSettings,
  sortYouTubeVideos,
  videoKey,
} from '@shared/youtube'
import { usePortfolio } from '@/api/queries'
import { useSettings, useSettingsMutation } from '@/api/settingsQueries'
import {
  useRefreshYouTube,
  useYouTube,
  useYouTubeThumbnail,
} from '@/api/youtubeQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { Splitter } from '@/components/ui/Splitter'
import { api } from '@/api/client'

type Tone = 'muted' | 'positive' | 'warning' | 'negative'

const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

const COLUMNS = ['Ticker', 'Title', 'Channel', 'Views', 'Published', 'Days Ago', 'Duration'] as const
const MIN_DETAIL_WIDTH = 300
const MAX_DETAIL_WIDTH = 520
const MIN_TABLE_WIDTH = 520

function countText(visible: number, total: number): string {
  const noun = total === 1 ? 'video' : 'videos'
  return visible === total ? `${total} ${noun}` : `${visible} of ${total} ${noun}`
}

function sortMark(column: number, active: number, descending: boolean): string {
  if (active < 0) return column === 5 ? ' ↑' : ''
  if (column !== active) return ''
  return descending ? ' ↓' : ' ↑'
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-2xs">
      <dt className="text-text-muted">{label}:</dt>
      <dd className="min-w-0 break-words text-text">{value || '-'}</dd>
    </div>
  )
}

export function YouTubePage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
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
  const refresh = useRefreshYouTube(tickers)
  const [filter, setFilter] = useState('')
  const [sortColumn, setSortColumn] = useState<number>(() => normalizeYouTubePageSettings(settingsQuery.data?.data.youtubePage).sortColumn)
  const [sortDescending, setSortDescending] = useState<boolean>(() => normalizeYouTubePageSettings(settingsQuery.data?.data.youtubePage).sortDescending)
  const [manualSelectedKey, setManualSelectedKey] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [detailWidth, setDetailWidth] = useState(360)
  const hydrated = useRef(false)
  const pageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hydrated.current || !settingsQuery.data?.data) return
    const settings = normalizeYouTubePageSettings(settingsQuery.data.data.youtubePage)
    hydrated.current = true
    setSortColumn(settings.sortColumn)
    setSortDescending(settings.sortDescending)
  }, [settingsQuery.data])

  useEffect(() => {
    onStatusChange(
      [
        { label: 'YouTube', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching },
        { label: 'Holdings', envelope: portfolioQuery.data, error: portfolioQuery.error, enabled: portfolioQuery.isEnabled, loading: portfolioQuery.isFetching },
      ],
      settingsQuery.data?.data.sourcePath ?? '',
    )
  }, [
    onStatusChange,
    portfolioQuery.data,
    portfolioQuery.isFetching,
    query.data,
    query.isFetching,
    settingsQuery.data,
  ])

  const payload = query.data?.data
  const sorted = useMemo(
    () => sortYouTubeVideos(payload?.items ?? [], sortColumn, sortDescending),
    [payload?.items, sortColumn, sortDescending],
  )
  const visible = useMemo(() => filterYouTubeVideos(sorted, filter), [filter, sorted])
  const selected = useMemo(() => {
    const manual = visible.find((item) => videoKey(item) === manualSelectedKey)
    return manual ?? visible[0] ?? null
  }, [manualSelectedKey, visible])
  const thumbnail = useYouTubeThumbnail(selected)

  const status = useMemo<{ text: string; tone: Tone }>(() => {
    if (!tickers.length) {
      return { text: 'No saved portfolio tickers are available yet.', tone: 'warning' }
    }
    if (query.isFetching) {
      return {
        text: payload ? 'Refreshing cached/stale YouTube results...' : 'Checking cached YouTube results...',
        tone: 'muted',
      }
    }
    if (query.data?.meta.freshness === 'failed') {
      return {
        text: `YouTube refresh failed: ${query.data.meta.failureReason ?? 'unknown error'}`,
        tone: 'negative',
      }
    }
    if (!payload) return { text: 'Open the tab to load YouTube results.', tone: 'muted' }
    if (!payload.items.length) {
      return {
        text: payload.tickersTotal
          ? `No YouTube matches loaded for ${payload.tickersTotal} ticker(s).`
          : 'No YouTube results found.',
        tone: payload.warnings.length ? 'warning' : 'muted',
      }
    }
    return {
      text: `Loaded ${payload.items.length} video result(s) for ${payload.tickersTotal} ticker(s) (${payload.fromCacheCount} cached, ${payload.fetchedCount} fresh).`,
      tone: payload.warnings.length ? 'warning' : 'positive',
    }
  }, [payload, query.data, query.isFetching, tickers.length])

  const onSort = useCallback((column: number) => {
    const descending = column === sortColumn
      ? !sortDescending
      : column === 3 || column === 4 || column === 6
    setSortColumn(column)
    setSortDescending(descending)
    void saveSettings({
      type: 'setYouTubePage',
      value: { sortColumn: column, sortDescending: descending },
    })
  }, [saveSettings, sortColumn, sortDescending])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  const openVideo = useCallback((video: YouTubeVideo | null) => {
    if (video?.url) void api.openExternal(video.url)
  }, [])

  const onDrag = useCallback((clientX: number) => {
    const box = pageRef.current?.getBoundingClientRect()
    if (!box) return
    setDetailWidth(
      Math.min(MAX_DETAIL_WIDTH, Math.max(MIN_DETAIL_WIDTH, Math.min(clientX - box.left, box.width - MIN_TABLE_WIDTH))),
    )
  }, [])

  const warnings = payload?.warnings ?? []
  const displayWarnings = warnings.slice(0, 5)
  const busy = refreshing || query.isFetching
  const thumbnailData = thumbnail.data?.data.dataUri ?? ''

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
      <header className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="mr-auto min-w-64">
          <h1 className="text-sm font-semibold text-text">YouTube</h1>
          <p className="text-2xs text-text-muted">
            Recent portfolio videos with at least 1,000 views, published in the last 90 days.
          </p>
        </div>
        <span className="text-2xs text-text-muted">{countText(visible.length, sorted.length)}</span>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter ticker, title, or channel..."
          aria-label="Filter YouTube videos"
          className="h-8 w-60 border border-border-strong bg-surface-raised px-2 text-2xs text-text outline-none placeholder:text-text-dim focus:border-accent"
        />
        <Button variant="accent" onClick={() => void onRefresh()} disabled={busy || !tickers.length}>
          {busy ? 'Refreshing...' : 'Refresh Videos'}
        </Button>
      </header>

      <p className={`shrink-0 text-2xs ${toneClass[status.tone]}`}>{status.text}</p>
      {displayWarnings.length ? (
        <div className="shrink-0 border border-warn/40 bg-warn-bg px-2 py-1 text-2xs text-warn">
          {displayWarnings.map((warning) => <p key={warning}>{warning}</p>)}
          {warnings.length > displayWarnings.length ? (
            <p>+{warnings.length - displayWarnings.length} more warning(s)</p>
          ) : null}
        </div>
      ) : null}

      <div ref={pageRef} className="flex min-h-0 flex-1">
        <section
          className="flex min-h-0 shrink-0 flex-col gap-2 border border-border bg-surface p-2"
          style={{ width: detailWidth }}
          aria-label="Selected Video"
        >
          <h2 className="shrink-0 text-xs font-semibold text-text">Selected Video</h2>
          <button
            type="button"
            disabled={!selected?.url}
            onClick={() => openVideo(selected)}
            className="flex aspect-video w-[280px] max-w-full shrink-0 items-center justify-center self-center overflow-hidden border border-border-strong bg-bg text-2xs text-text-dim disabled:cursor-default"
          >
            {thumbnailData ? (
              <img src={thumbnailData} alt={selected?.title ?? 'YouTube thumbnail'} className="h-full w-full object-contain" />
            ) : thumbnail.isFetching ? (
              'Loading thumbnail...'
            ) : selected ? (
              'Thumbnail unavailable'
            ) : (
              filter && sorted.length ? 'No matching videos' : 'No video selected'
            )}
          </button>
          {selected ? (
            <p className="shrink-0 text-center text-2xs text-text-muted">
              {thumbnailData ? 'Click the thumbnail to watch in your browser.' : 'Thumbnail unavailable. Click here to watch in your browser.'}
            </p>
          ) : null}
          <h3 className="shrink-0 text-xs font-semibold leading-snug text-text">
            {selected?.title ?? (filter && sorted.length ? 'No matching videos' : 'No video selected')}
          </h3>
          <Button variant="accent" onClick={() => openVideo(selected)} disabled={!selected?.url}>
            Watch on YouTube
          </Button>
          <dl className="shrink-0 space-y-1">
            <MetaRow label="Ticker" value={selected?.ticker ?? '-'} />
            <MetaRow label="Channel" value={selected?.channel ?? '-'} />
            <MetaRow label="Views" value={selected?.viewCountText ?? '-'} />
            <MetaRow label="Published" value={selected?.publishedText ?? '-'} />
            <MetaRow label="Days Ago" value={selected?.publishedDaysText ?? '-'} />
            <MetaRow label="Duration" value={selected?.durationText ?? '-'} />
          </dl>
          <h3 className="shrink-0 text-xs font-semibold text-text">Description</h3>
          <div className="min-h-20 flex-1 overflow-y-auto border border-border bg-bg p-2 text-2xs leading-relaxed text-text-muted">
            {selected?.descriptionSnippet
              || (selected ? 'Description unavailable.' : filter && sorted.length
                ? 'Clear or adjust the filter to see loaded videos.'
                : 'No YouTube results are currently loaded.')}
          </div>
        </section>

        <Splitter onDrag={onDrag} />

        <section className="flex min-h-0 min-w-0 flex-1 flex-col border border-border bg-surface p-1" aria-label="Portfolio YouTube Feed">
          <h2 className="shrink-0 px-1 py-1 text-xs font-semibold text-text">Portfolio YouTube Feed</h2>
          <div className="min-h-0 flex-1 overflow-auto border border-border">
            <table className="w-full min-w-[780px] border-collapse text-2xs">
              <thead className="sticky top-0 z-10 bg-surface-raised text-left text-text-muted">
                <tr>
                  {COLUMNS.map((label, column) => (
                    <th
                      key={label}
                      className={`${column === 1 ? 'min-w-64' : 'whitespace-nowrap'} border-b border-border px-2 py-1 font-medium`}
                      aria-sort={
                        (sortColumn < 0 ? column === 5 : sortColumn === column)
                          ? (sortColumn >= 0 && sortDescending ? 'descending' : 'ascending')
                          : 'none'
                      }
                    >
                      <button type="button" onClick={() => onSort(column)} className="w-full text-left hover:text-text">
                        {label}{sortMark(column, sortColumn, sortDescending)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const key = videoKey(item)
                  const active = selected ? videoKey(selected) === key : false
                  return (
                    <tr
                      key={key}
                      onClick={() => setManualSelectedKey(key)}
                      onDoubleClick={() => openVideo(item)}
                      className={`cursor-default border-b border-border/60 ${active ? 'bg-accent-dim/60' : 'odd:bg-bg/30 hover:bg-surface-hover'}`}
                    >
                      <td className="whitespace-nowrap px-2 py-1 text-text">{item.ticker}</td>
                      <td className="px-2 py-1 text-accent" title={item.descriptionSnippet || item.title}>{item.title}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-text">{item.channel}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right text-text">{item.viewCountText}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-text">{item.publishedText}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right text-text">{item.publishedDaysText}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right text-text">{item.durationText}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!visible.length ? (
              <div className="flex min-h-32 items-center justify-center text-2xs text-text-dim">
                {query.isFetching
                  ? 'Loading videos...'
                  : filter && sorted.length
                    ? 'No matching videos. Clear or adjust the filter.'
                    : 'No YouTube results are currently loaded.'}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
