import { useEffect, useState } from 'react'

interface NumberInputProps {
  value: number
  onCommit: (value: number) => void
  /** Decimal places shown while the field is not being edited. */
  decimals?: number
  prefix?: string
  min?: number
  max?: number
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * A numeric cell that only reports a value when the edit is finished.
 *
 * Committing on every keystroke would write the store on each digit — typing "150"
 * would pass through 1 and 15 first. This keeps a local draft and commits on blur or
 * Enter, reverts on Escape, and re-syncs whenever the stored value changes underneath.
 */
export function NumberInput({
  value,
  onCommit,
  decimals,
  prefix = '',
  min = 0,
  max = Number.POSITIVE_INFINITY,
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
}: NumberInputProps) {
  const display = decimals === undefined ? String(value) : value.toFixed(decimals)
  const [draft, setDraft] = useState(display)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(display)
  }, [display, editing])

  const commit = () => {
    setEditing(false)
    const parsed = Number(draft.replace(/[$,\s]/g, ''))
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      setDraft(display)
      return
    }
    setDraft(display)
    if (parsed !== value) onCommit(parsed)
  }

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      {prefix ? (
        <span className="pointer-events-none absolute left-1 text-2xs text-text-dim">{prefix}</span>
      ) : null}
      <input
        aria-label={ariaLabel}
        disabled={disabled}
        value={editing ? draft : display}
        inputMode="decimal"
        spellCheck={false}
        onFocus={(event) => {
          setEditing(true)
          setDraft(display)
          event.currentTarget.select()
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(display)
            setEditing(false)
            event.currentTarget.blur()
          }
        }}
        // The prefix is drawn over the field, so the text has to start clear of it —
        // `US$` needs more room than `$`.
        style={prefix ? { paddingLeft: `${0.3 + prefix.length * 0.45}rem` } : undefined}
        className={`num h-7 w-full border border-transparent bg-transparent py-0 text-right text-2xs text-text outline-none hover:border-border-strong focus:border-accent focus:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 ${
          prefix ? 'pr-1' : 'px-1'
        }`}
      />
    </div>
  )
}
