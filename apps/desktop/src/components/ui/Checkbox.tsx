import type { ReactNode } from 'react'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  disabled?: boolean
  title?: string
  className?: string
}

/**
 * A checkable row. The native box is kept for the accessibility tree and hidden behind
 * a drawn square, because the platform control ignores the terminal palette.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  title,
  className = '',
}: CheckboxProps) {
  return (
    <label
      title={title}
      className={`no-drag flex items-center gap-2 text-2xs ${
        disabled ? 'cursor-not-allowed text-text-dim' : 'cursor-pointer text-text'
      } ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`flex size-4 shrink-0 items-center justify-center border text-[11px] leading-none peer-focus-visible:border-accent ${
          checked
            ? 'border-accent bg-accent-dim text-text'
            : 'border-border-strong bg-surface-raised text-transparent'
        }`}
      >
        ✓
      </span>
      <span className="truncate">{label}</span>
    </label>
  )
}
