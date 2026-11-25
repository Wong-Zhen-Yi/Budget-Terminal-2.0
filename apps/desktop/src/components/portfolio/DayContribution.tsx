import { useLayoutEffect, useRef, useState } from 'react'

import type { PositionRow } from '@shared/portfolioMath'
import { PrivateNumber } from '@/components/ui/NumberPrivacy'
import { currency, percent, plainPercent } from '@/lib/format'

/** Heading, row and bottom padding heights in rem; they match h-8, h-7 and pb-2 below. */
const HEADING_REM = 2
const ROW_REM = 1.75
const PADDING_REM = 0.5
/** With room for fewer rows than this the strip would be a heading and a sliver, so it hides. */
const MIN_ROWS = 2

/** Today's dollar move for a position, from its market value and the day's percent change. */
function dayMove(row: PositionRow): number | null {
  if (row.marketValue === null || row.changePercent === null || row.changePercent <= -100) return null
  return row.marketValue - row.marketValue / (1 + row.changePercent / 100)
}

/**
 * Fills the space under a short positions table with what changed today: each holding's
 * weight and its dollar move, largest movers first. A long table takes the height
 * instead, and this strip disappears.
 */
export function DayContribution({ rows }: { rows: PositionRow[] }) {
  const host = useRef<HTMLDivElement>(null)
  // How many whole rows fit. Rows that do not fit are left out rather than clipped mid-row.
  const [capacity, setCapacity] = useState(0)
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setCapacity(Math.max(0, Math.floor((element.clientHeight - (HEADING_REM + PADDING_REM) * rem) / (ROW_REM * rem))))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const movers = rows
    .map((row) => ({ row, move: dayMove(row) }))
    .filter((entry) => entry.row.shares > 0 && entry.move !== null)
    .sort((a, b) => Math.abs(b.move ?? 0) - Math.abs(a.move ?? 0))
  const total = movers.reduce((sum, entry) => sum + (entry.move ?? 0), 0)
  const largest = Math.max(...movers.map((entry) => Math.abs(entry.move ?? 0)), 0)
  const visible = capacity >= MIN_ROWS
  const shown = movers.slice(0, capacity)
  const partial = shown.length < movers.length

  return (
    <div ref={host} data-day-contribution={visible && movers.length ? 'shown' : 'hidden'}
      className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
      {visible && movers.length ? <>
        <div className="flex h-8 shrink-0 items-center gap-3 px-2 text-2xs">
          <span className="font-semibold tracking-wide text-text uppercase">Today by position</span>
          <span className="truncate text-text-muted">
            {partial ? `Top ${shown.length} of ${movers.length} by dollar move` : 'Largest dollar moves first'}
          </span>
          <span className={`num ml-auto shrink-0 ${total >= 0 ? 'text-up' : 'text-down'}`} title="Net move across all positions today">
            <PrivateNumber>{`${total >= 0 ? '+' : '-'}${currency(Math.abs(total))}`}</PrivateNumber>
          </span>
        </div>
        <ul className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
          {shown.map(({ row, move }) => {
            const up = (move ?? 0) >= 0
            const width = largest ? Math.max(2, (Math.abs(move ?? 0) / largest) * 100) : 0
            return (
              <li key={row.ticker} className="grid h-7 grid-cols-[64px_56px_minmax(0,1fr)_96px_64px] items-center gap-2 text-2xs">
                <span className="font-semibold text-text">{row.ticker}</span>
                <span className="num text-right text-text-muted" title="Portfolio weight">{row.weight === null ? '--' : plainPercent(row.weight)}</span>
                <span className="relative h-2.5 overflow-hidden rounded-sm bg-surface-raised" aria-hidden="true">
                  <span className={`absolute inset-y-0 left-0 rounded-sm ${up ? 'bg-up/70' : 'bg-down/70'}`} style={{ width: `${width}%` }} />
                </span>
                <span className={`num text-right ${up ? 'text-up' : 'text-down'}`}>
                  <PrivateNumber>{`${up ? '+' : '-'}${currency(Math.abs(move ?? 0))}`}</PrivateNumber>
                </span>
                <span className={`num text-right ${up ? 'text-up' : 'text-down'}`}>{percent(row.changePercent)}</span>
              </li>
            )
          })}
        </ul>
      </> : null}
    </div>
  )
}
