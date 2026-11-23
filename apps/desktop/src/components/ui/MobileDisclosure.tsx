import { useId, useState, type ReactNode } from 'react'
import { Button } from './Button'

/** Keep secondary toolbar controls mounted and collapse them on phone widths. */
export function MobileDisclosure({ label, children, className = '' }: {
  label: string
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <div className={`mobile-disclosure ${className}`}>
      <Button
        className="mobile-disclosure-toggle"
        aria-controls={id}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
        <svg aria-hidden="true" className="ml-1 size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </Button>
      <div id={id} className="mobile-disclosure-content">{children}</div>
    </div>
  )
}
