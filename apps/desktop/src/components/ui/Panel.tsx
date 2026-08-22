import type { ReactNode } from 'react'

interface PanelProps {
  title: ReactNode
  /** Controls rendered on the right of the header strip. */
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Set when the panel's data failed or came back partial; shows a warning dot. */
  warning?: string
}

/** The bordered, titled box every dashboard section sits in. */
export function Panel({ title, actions, children, className = '', warning }: PanelProps) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden border border-border bg-surface ${className}`}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-2">
        <h2 className="truncate text-2xs font-semibold tracking-wide text-text uppercase">
          {title}
        </h2>
        {warning ? (
          <span
            title={warning}
            className="size-1.5 shrink-0 rounded-full bg-down"
            aria-label={warning}
          />
        ) : null}
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  )
}

/** Centred message for the empty, loading and failed states inside a panel. */
export function PanelMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4 text-center text-2xs text-text-dim">
      {children}
    </div>
  )
}
