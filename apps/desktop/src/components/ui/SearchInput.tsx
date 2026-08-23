import { forwardRef, useEffect, useState } from 'react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  'aria-label'?: string
}

/**
 * A live filter box.
 *
 * `TextInput` cannot do this job: its whole contract is draft-and-commit on blur or Enter,
 * because a table cell that wrote on every keystroke would persist "D", "DB", "DBS" in
 * turn. A filter is the opposite — the reference wires `textChanged` straight to
 * `_p34_refresh_cards` and the list narrows as you type. Bending `TextInput` to do both
 * would put a branch in every table in the app, so this is its own component.
 *
 * The 120ms debounce is the one concession: re-filtering and re-sorting a few hundred
 * articles on every keystroke is visible on a long list.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, placeholder, className = '', 'aria-label': ariaLabel },
  ref,
) {
  const [draft, setDraft] = useState(value)

  // Re-sync when the value is cleared from outside, e.g. by the Clear button.
  useEffect(() => setDraft(value), [value])

  useEffect(() => {
    if (draft === value) return
    const timer = setTimeout(() => onChange(draft), 120)
    return () => clearTimeout(timer)
  }, [draft, value, onChange])

  return (
    <div className={`relative flex items-center ${className}`}>
      <input
        ref={ref}
        type="text"
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setDraft('')
            onChange('')
          }
        }}
        className="no-drag h-8 w-full border border-border-strong bg-surface-raised px-2 pr-6 text-2xs text-text outline-none placeholder:text-text-dim focus:border-accent"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear the filter"
          onClick={() => {
            setDraft('')
            onChange('')
          }}
          className="absolute right-1 px-1 text-2xs text-text-dim hover:text-text"
        >
          ×
        </button>
      ) : null}
    </div>
  )
})
