import type { ReactNode } from 'react'

export type ChipTone = 'muted' | 'accent' | 'up' | 'warn' | 'down'

const tones: Record<ChipTone, string> = {
  muted: 'border-border-strong text-text-muted',
  accent: 'border-accent text-accent-hover',
  up: 'border-up/60 text-up',
  warn: 'border-warn/60 text-warn',
  down: 'border-down/60 text-down',
}

/**
 * A small bordered label: a ticker, a signal tag, a feed's health.
 *
 * Square like everything else in this theme, and outlined rather than filled — a grid of
 * filled chips on a card competes with the headline for attention, which is the one thing
 * on the card that has to win.
 */
export function Chip({
  tone = 'muted',
  title,
  className = '',
  children,
}: {
  tone?: ChipTone
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center border px-1 text-2xs leading-4 whitespace-nowrap ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
