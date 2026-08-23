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
    onToggleReader: () => void
    onRefresh: () => void
    onExport: () => void
    busy: boolean
    status: { text: string; tone: Tone }
  }
>(function NewsToolbar(props, filterRef) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      <h1 className="pr-2 text-sm font-semibold text-text">News</h1>

      {FILTERS.map(({ key, label }) => (
        <FilterButton
          key={key}
          label={label}
          count={props.counts[key]}
          active={props.filter === key}
          onClick={() => props.onFilter(key)}
        />
      ))}

      <SearchInput
        ref={filterRef}
        value={props.query}
        onChange={props.onQuery}
        placeholder="Filter headlines, tickers, sources, or signals   (/)"
        aria-label="Filter the news feed"
        className="ml-1 min-w-[16rem] flex-1"
      />

      {/* `Select` is `w-full` for table cells, which a width class here cannot outrank,
          so the toolbar gives it a box to fill rather than fighting the cascade. */}
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
      <Button variant="toggle" active={props.readerOpen} onClick={props.onToggleReader}>
        Reader
      </Button>

      <Button className="ml-1" onClick={props.onRefresh} disabled={props.busy}>
        {props.busy ? 'Refreshing...' : 'Refresh'}
      </Button>
      <Button
        variant="positive"
        onClick={props.onExport}
        title="Export every loaded article, ignoring the filter and the search box."
      >
        Export News for AI
      </Button>

      <span className={`ml-auto pl-2 text-2xs ${toneClass[props.status.tone]}`}>
        {props.status.text}
      </span>
    </div>
  )
})
