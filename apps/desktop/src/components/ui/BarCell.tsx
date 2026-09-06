import type { ReactNode } from 'react'

/**
 * A magnitude bar painted behind a `DataTable` cell's value.
 *
 * `DataTable` needs no say in this: its `td` is already `overflow-hidden`, so the bar is
 * clipped to the cell for free. What the cell does have to supply is its own positioned,
 * block-level wrapper — a percentage width has no basis inside an inline box, and
 * `position: relative` on a `td` is not worth relying on.
 *
 * The value is `relative` rather than raised with a `z-index`: both children are
 * positioned, so the later one in document order paints on top. Drop that `relative` and
 * the bar covers the digits.
 */
export function BarCell({
  fraction,
  children,
  title,
}: {
  /** 0..1, clamped — a stale denominator must not paint past the cell. */
  fraction: number
  children: ReactNode
  title?: string
}) {
  return (
    <span className="relative block w-full overflow-hidden" title={title}>
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-accent/30"
        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
      />
      <span className="relative truncate">{children}</span>
    </span>
  )
}
