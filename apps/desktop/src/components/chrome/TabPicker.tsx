import { useEffect, useMemo, useRef, useState } from 'react'
import { workspaceFor } from '@shared/navigation'

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

  useEffect(() => {
    const previous = document.activeElement
    input.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return tabs
      .map((tab, order) => ({ tab, order, score: rank(tab.label, needle) ?? (workspaceFor(tab.id)?.label.toLowerCase().includes(needle) ? 3 : null) }))
      .filter((entry): entry is { tab: PickerTab; order: number; score: number } =>
        entry.score !== null,
      )
      .sort((a, b) => a.score - b.score || a.order - b.order)
      .map((entry) => entry.tab)
  }, [tabs, query])

  useEffect(() => {
    input.current?.closest('[role=dialog]')?.querySelector(`[data-result-index="${highlighted}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  // A narrowing query can leave the highlight past the end of the list.
  const active = Math.min(highlighted, Math.max(0, matches.length - 1))

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-40 flex justify-center bg-black/50 px-4 pt-16"
    >
      <div
        role="dialog"
        aria-label="Page search"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)'))
          const next = event.shiftKey ? controls.at(-1) : controls[0]
          if (event.target === (event.shiftKey ? controls[0] : controls.at(-1))) {
            event.preventDefault()
            next?.focus()
          }
        }}
        onClick={(event) => event.stopPropagation()}
        className="flex h-fit max-h-[70vh] w-full max-w-lg flex-col rounded border border-border-strong bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2 text-2xs text-text-muted">
          <span>Find a page · {tabs.length} available</span>
          <button type="button" onClick={onClose} className="px-2 py-1 hover:text-text">Close (Esc)</button>
        </div>
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
              setHighlighted((value) => Math.max(0, Math.min(value + 1, matches.length - 1)))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setHighlighted((value) => Math.max(value - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const chosen = matches[active]
              if (chosen?.implemented) onSelect(chosen.id)
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
                data-result-index={index}
                disabled={!tab.implemented}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => onSelect(tab.id)}
                className={`flex h-8 w-full items-center gap-2 px-2 text-left text-2xs ${
                  index === active ? 'bg-accent-dim text-text' : 'text-text-muted hover:bg-surface-hover'
                }`}
              >
                <span className="truncate">{tab.label}</span>
                <span className="ml-auto text-text-dim">{workspaceFor(tab.id)?.label ?? 'Preferences'}</span>
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
