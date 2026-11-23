import { forwardRef } from 'react'

import type { NewsFilter, NewsSort } from '@shared/news'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/SearchInput'
import { Select } from '@/components/ui/Select'
import { useCountUp } from './hooks'

/**
 * The header controls: the three filter buttons with live counts, the free-text filter, the
 * sort, Refresh, Export and the status line — `init_page34`'s controls row.
 */

const FILTERS: ReadonlyArray<{ key: NewsFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'market_macro', label: 'Market & Macro' },
]

const SORTS: ReadonlyArray<{ value: NewsSort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'signal', label: 'Signal' },
]

export type Tone = 'muted' | 'positive' | 'warning' | 'negative'

export const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

/** The count animates rather than snapping, so a refresh reads as the list changing. */
function FilterButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  const shown = useCountUp(count)
  return (
    <Button variant="toggle" active={active} onClick={onClick}>
      {label} <span className="num pl-1">({shown})</span>
    </Button>
  )
}

export const NewsToolbar = forwardRef<
  HTMLInputElement,
  {
    controlsId: string
    controlsOpen: boolean
    mobileDisclosure?: { tickerSearchId: string; onToggle: () => void }
    counts: Record<NewsFilter, number>
    filter: NewsFilter
    onFilter: (filter: NewsFilter) => void
    query: string
    onQuery: (query: string) => void
    sort: NewsSort
    onSort: (sort: NewsSort) => void
    showImages: boolean
    onToggleImages: () => void
    readerOpen: boolean
    readerAvailable: boolean
    exportScope: 'filtered' | 'all'
    onExportScope: (scope: 'filtered' | 'all') => void
    onToggleReader: () => void
    onExport: () => void
    busy: boolean
    status: { text: string; tone: Tone }
  }
>(function NewsToolbar(props, filterRef) {
  const { controlsId, controlsOpen, mobileDisclosure } = props
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      <h1 className="pr-2 text-sm font-semibold text-text">News</h1>
      {mobileDisclosure && (
        <Button
          className="ml-auto min-h-9 gap-1"
          aria-expanded={controlsOpen}
          aria-controls={`${controlsId} ${mobileDisclosure.tickerSearchId}`}
          onClick={mobileDisclosure.onToggle}
          onKeyDown={event => {
            if (event.key === 'Enter') event.stopPropagation()
          }}
        >
          Filters &amp; tools
          <svg className={`size-4${controlsOpen ? ' rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </Button>
      )}

      <div className={mobileDisclosure ? 'flex basis-full flex-wrap items-center gap-1' : 'contents'}>
        {FILTERS.map(({ key, label }) => (
          <FilterButton
            key={key}
            label={label}
            count={props.counts[key]}
            active={props.filter === key}
            onClick={() => props.onFilter(key)}
          />
        ))}
      </div>

      <div id={controlsId} hidden={!controlsOpen} className={controlsOpen ? 'contents' : undefined}>
        <SearchInput
          ref={filterRef}
          value={props.query}
          onChange={props.onQuery}
          placeholder="Filter headlines, tickers, sources, or signals   (/)"
          aria-label="Filter the news feed"
          className={mobileDisclosure ? 'min-w-0 basis-full' : 'ml-1 min-w-[16rem] flex-1'}
        />

        {/* The toolbar gives each full-width Select a fixed-width box. */}
        <div className="w-28 shrink-0">
          <Select
            value={props.sort}
            options={SORTS}
            onChange={props.onSort}
            aria-label="Sort the market feed"
            className="h-8"
          />
        </div>

        <Button
          variant="toggle"
          active={props.showImages}
          onClick={props.onToggleImages}
          title="Fetch article thumbnails. Turn this off on a slow connection."
        >
          Images
        </Button>
        <Button variant="toggle" disabled={!props.readerAvailable} title={props.readerAvailable ? 'Toggle the selected story' : 'Select a story to open the reader'} active={props.readerOpen} onClick={props.onToggleReader}>
          Reader
        </Button>

        <div className="w-44 shrink-0">
          <Select value={props.exportScope} onChange={props.onExportScope}
            options={[{ value: 'filtered', label: 'Filtered results' }, { value: 'all', label: 'All loaded news' }]}
            aria-label="News export scope" className="h-8" />
        </div>
        <Button
          variant="positive"
          onClick={props.onExport}
          title="Copy news in the selected scope to the clipboard for AI."
        >
          Copy News for AI
        </Button>

        <span className={`ml-auto pl-2 text-2xs ${toneClass[props.status.tone]}`}>
          {props.status.text}
        </span>
      </div>
    </div>
  )
})
