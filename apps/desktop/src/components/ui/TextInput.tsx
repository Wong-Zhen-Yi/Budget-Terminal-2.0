import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface TextInputProps {
  value: string
  onCommit: (value: string) => void
  maxLength?: number
  placeholder?: string
  /**
   * Let the text run onto as many lines as it needs, growing the row, instead of
   * clipping to one. Pair it with a `wrap` column so the table gives the row the height.
   */
  wrap?: boolean
  className?: string
  'aria-label'?: string
}

const base =
  'w-full border border-transparent bg-transparent px-1 text-2xs text-text outline-none hover:border-border-strong focus:border-accent focus:bg-surface-raised'

/**
 * The text twin of `NumberInput`, with the same draft-and-commit contract.
 *
 * Writing on every keystroke would persist "D", "DB", "DBS" in turn — and because a
 * refused write comes back as the unchanged document, a blank intermediate value would
 * bounce the field back under the cursor. This keeps a local draft, commits on blur or
 * Enter, reverts on Escape, and re-syncs when the stored value changes underneath.
 *
 * `wrap` swaps the input for a textarea sized to its content. An `<input>` is single
 * line whatever the cell around it does, so a wrapping column cannot rescue a long
 * description without it.
 */
export function TextInput({
  value,
  onCommit,
  maxLength,
  placeholder,
  wrap = false,
  className = '',
  'aria-label': ariaLabel,
}: TextInputProps) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const lastWidth = useRef(0)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const shown = editing ? draft : value

  const fit = useCallback(() => {
    const element = areaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [])

  // Measure after layout so the row settles in the same frame the text changes in.
  useLayoutEffect(fit, [fit, shown, wrap])

  // The number of lines depends on the column width, which changes when the window is
  // resized without the text changing at all. Without this the row keeps the height it
  // was measured at and `overflow-hidden` eats the wrapped line.
  useEffect(() => {
    const element = areaRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      // Only width matters. Reacting to height would re-enter on our own change.
      if (width === lastWidth.current) return
      lastWidth.current = width
      fit()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [fit, wrap])

  const commit = () => {
    setEditing(false)
    // A textarea can carry newlines; the stored description is always one line.
    const trimmed = draft.replace(/\s+/g, ' ').trim()
    if (!trimmed) {
      setDraft(value)
      return
    }
    setDraft(value)
    if (trimmed !== value) onCommit(trimmed)
  }

  const shared = {
    'aria-label': ariaLabel,
    value: shown,
    maxLength,
    placeholder,
    spellCheck: false,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit,
  }

  if (!wrap) {
    return (
      <input
        {...shared}
        onFocus={(event) => {
          setEditing(true)
          setDraft(value)
          event.currentTarget.select()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(value)
            setEditing(false)
            event.currentTarget.blur()
          }
        }}
        className={`${base} h-7 py-0 ${className}`}
      />
    )
  }

  return (
    <textarea
      {...shared}
      ref={areaRef}
      rows={1}
      onFocus={(event) => {
        setEditing(true)
        setDraft(value)
        event.currentTarget.select()
      }}
      onKeyDown={(event) => {
        // Enter commits rather than opening a second line — the value is one line.
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          setDraft(value)
          setEditing(false)
          event.currentTarget.blur()
        }
      }}
      className={`${base} block resize-none overflow-hidden py-[3px] leading-tight ${className}`}
    />
  )
}
