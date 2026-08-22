import { useEffect, useMemo, useRef, useState } from 'react'

interface PickerTab {
  id: string
  label: string
  implemented: boolean
}

/**
 * The typed page picker behind the backtick key, from `_show_tab_picker`.
 *
 * Ranking matches the reference's `_filter_tab_picker_items`: exact match first, then
 * prefix, then anything else containing the query, ties broken by navigation order.
 */
function rank(label: string, query: string): number | null {
  const text = label.toLowerCase()
  if (!query) return 0
  if (!text.includes(query)) return null
  if (text === query) return 0
  if (text.startsWith(query)) return 1
  return 2
}

export function TabPicker({
  tabs,
  onSelect,
  onClose,
}: {
  /** The visible tabs, in navigation order. */
  tabs: PickerTab[]
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return tabs
      .map((tab, order) => ({ tab, order, score: rank(tab.label, needle) }))
      .filter((entry): entry is { tab: PickerTab; order: number; score: number } =>
        entry.score !== null,
      )
      .sort((a, b) => a.score - b.score || a.order - b.order)
      .map((entry) => entry.tab)
  }, [tabs, query])

  // A narrowing query can leave the highlight past the end of the list.
  const active = Math.min(highlighted, Math.max(0, matches.length - 1))

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-40 flex justify-end bg-black/30 pt-14 pr-4"
    >
      <div
        role="dialog"
        aria-label="Page search"
        onClick={(event) => event.stopPropagation()}
        className="flex h-fit max-h-[70vh] w-80 flex-col border border-border-strong bg-surface shadow-2xl"
      >
        <input
          ref={input}
          value={query}
          placeholder="Search pages"
          aria-label="Search pages"
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlighted(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setHighlighted((value) => Math.min(value + 1, matches.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setHighlighted((value) => Math.max(value - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const chosen = matches[active]
              if (chosen) onSelect(chosen.id)
            } else if (event.key === 'Escape' || event.key === '`') {
              event.preventDefault()
              // Without this the window-level handler sees the same backtick and
              // reopens the picker in the same tick.
              event.stopPropagation()
              onClose()
            }
          }}
          className="h-9 shrink-0 border-b border-border bg-surface-raised px-2 text-2xs text-text outline-none"
        />
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {matches.map((tab, index) => (
            <li key={tab.id}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => onSelect(tab.id)}
                className={`flex h-8 w-full items-center gap-2 px-2 text-left text-2xs ${
                  index === active ? 'bg-accent-dim text-text' : 'text-text-muted hover:bg-surface-hover'
                }`}
              >
                <span className="truncate">{tab.label}</span>
                {!tab.implemented ? (
                  <span className="ml-auto shrink-0 text-text-dim">not migrated</span>
                ) : null}
              </button>
            </li>
          ))}
          {!matches.length ? (
            <li className="p-3 text-center text-2xs text-text-dim">No page matches that search.</li>
          ) : null}
        </ul>
      </div>
    </div>
  )
}
