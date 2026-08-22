interface SelectOption<T extends string> {
  value: T
  label: string
}

interface SelectProps<T extends string> {
  value: T
  options: ReadonlyArray<SelectOption<T>>
  onChange: (value: T) => void
  className?: string
  'aria-label'?: string
}

/**
 * A dropdown sized for a table cell. Unlike the text and number inputs there is no
 * draft to keep: a select commits the moment it changes.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className = '',
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className={`no-drag h-7 w-full border border-border-strong bg-surface-raised px-1 text-2xs text-text outline-none hover:border-accent-dim focus:border-accent ${className}`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-surface text-text">
          {option.label}
        </option>
      ))}
    </select>
  )
}
