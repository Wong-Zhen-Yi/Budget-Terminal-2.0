import { useEffect, useState } from 'react'

interface NumberInputProps {
  value: number
  onCommit: (value: number) => void
  /** Decimal places shown while the field is not being edited. */
  decimals?: number
  prefix?: string
  /**
   * Unit drawn after the number, e.g. `%` or `x`. Without it a form of bare decimals is
   * ambiguous — a 2.5 terminal growth and a 15.0 exit multiple read alike.
   */
  suffix?: string
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
  suffix = '',
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
        // Both adornments are drawn over the field, so the text has to start and end clear
        // of them — `US$` needs more room than `$`.
        style={{
          ...(prefix ? { paddingLeft: `${0.3 + prefix.length * 0.45}rem` } : {}),
          ...(suffix ? { paddingRight: `${0.3 + suffix.length * 0.5}rem` } : {}),
        }}
        className={`num h-7 w-full border border-transparent bg-transparent py-0 text-right text-2xs text-text outline-none hover:border-border-strong focus:border-accent focus:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 ${
          prefix || suffix ? '' : 'px-1'
        } ${prefix && !suffix ? 'pr-1' : ''}`}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-1 text-2xs text-text-dim">{suffix}</span>
      ) : null}
    </div>
  )
}
