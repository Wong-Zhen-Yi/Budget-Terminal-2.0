import type { ReactNode } from 'react'

/**
 * One of the three groups the Settings page is ordered into.
 *
 * The reference splits the same panels across four subtabs; this app shows them all on
 * one scrolling page, so the group heading is what tells the reader where they are.
 */
export function SettingsSection({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-3 border-b border-border pb-1">
        <h2 className="text-xs font-semibold tracking-widest text-accent-hover uppercase">
          {title}
        </h2>
        <p className="truncate text-2xs text-text-dim">{hint}</p>
      </header>
      {children}
    </section>
  )
}

/** The small title-and-hint block above a group of controls inside a panel. */
export function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs font-semibold text-text">{title}</span>
      <span className="text-2xs text-text-muted">{hint}</span>
    </div>
  )
}
