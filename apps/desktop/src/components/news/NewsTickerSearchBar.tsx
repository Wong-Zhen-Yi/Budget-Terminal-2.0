import { useState } from 'react'

import { TICKER_SEARCH_MAX_SYMBOLS } from '@shared/news'
import { Button } from '@/components/ui/Button'

/**
 * News for symbols the user is not holding — `_p34_request_ticker_search`.
 *
 * Temporary by design: the results appear as their own section above the portfolio one and
 * vanish on Clear, and nothing about the search touches the store. The line under the box
 * says so, in the reference's own words, because a box that takes tickers on a page about
 * your portfolio otherwise looks like a way to add them.
 */
export function NewsTickerSearchBar({
  onSearch,
  onClear,
  status,
  busy,
  active,
}: {
  onSearch: (raw: string) => void
  onClear: () => void
  status: string
  busy: boolean
  active: boolean
}) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    if (draft.trim()) onSearch(draft)
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      <span className="pr-1 text-2xs text-text-muted">Outside-portfolio ticker news</span>

      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
          if (event.key === 'Escape') event.stopPropagation()
        }}
        placeholder={`Up to ${TICKER_SEARCH_MAX_SYMBOLS} tickers, separated by commas or spaces`}
        aria-label="Search news for tickers outside the portfolio"
        className="no-drag h-8 min-w-[22rem] flex-1 border border-border-strong bg-surface-raised px-2 text-2xs text-text outline-none placeholder:text-text-dim focus:border-accent"
      />

      <Button variant="accent" onClick={submit} disabled={busy || !draft.trim()}>
        {busy ? 'Searching...' : 'Search'}
      </Button>
      <Button
        onClick={() => {
          setDraft('')
          onClear()
        }}
        disabled={!active && !draft}
      >
        Clear
      </Button>

      <span className="ml-2 min-w-0 flex-1 truncate text-2xs text-text-dim" title={status}>
        {status}
      </span>
    </div>
  )
}
