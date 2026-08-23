import { useEffect, useRef, useState, type RefObject } from 'react'

import { columnsForWidth } from '@shared/news'

/**
 * The card grid's column count, from the width of the grid container rather than the
 * window.
 *
 * It has to be the container: opening the reader rail narrows the grid without the window
 * changing at all, and a window-width breakpoint would leave three columns crammed into
 * the space left over. `columnsForWidth` is `_p34_columns_for_width` itself, so the
 * 1050/700 breakpoints are shared with the reference rather than re-guessed here.
 */
export function useCardColumns(ref: RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(3)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0) setColumns(columnsForWidth(width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return columns
}

/** Cards rendered in the first pass; the rest arrive a frame at a time. */
const FIRST_BATCH = 48

/**
 * How many of `total` cards to render right now, raised a batch per frame until it catches
 * up. The reference does the same thing with `run_batched(DEFAULT_MAX_ITEMS)` — a hundred
 * and seventy cards mounted in one commit is a visible stall.
 *
 * `startedAt` is state, not a ref, so the rAF loop lives in an effect keyed on it. Under
 * StrictMode the double-mount would otherwise cancel a loop started outside the effect and
 * never restart it, leaving the page stuck at the first batch.
 */
export function useProgressiveCount(total: number): number {
  const [visible, setVisible] = useState(() => Math.min(total, FIRST_BATCH))
  const [startedAt, setStartedAt] = useState(0)

  // A fresh token whenever the list changes, so the ramp restarts for the new list.
  useEffect(() => {
    setVisible(Math.min(total, FIRST_BATCH))
    setStartedAt((token) => token + 1)
  }, [total])

  useEffect(() => {
    if (startedAt === 0) return
    let frame = 0
    const step = () => {
      setVisible((current) => {
        if (current >= total) return current
        frame = requestAnimationFrame(step)
        return Math.min(total, current + FIRST_BATCH)
      })
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [startedAt, total])

  return Math.min(visible, total)
}

/**
 * A number that counts up to its target rather than jumping, for the filter-button counts.
 *
 * `useAnimatedProgress` is a 0..1 sweep for a chart, not a value interpolator, so this is a
 * small sibling rather than a reuse — but it keeps the same `startedAt`-as-state rule for
 * the same StrictMode reason.
 */
export function useCountUp(target: number, durationMs = 220): number {
  const [value, setValue] = useState(target)
  const [startedAt, setStartedAt] = useState(0)
  const from = useRef(target)

  useEffect(() => {
    from.current = value
    setStartedAt(performance.now())
    // Only the target drives the animation; `value` is where it happens to start from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  useEffect(() => {
    if (startedAt === 0) return
    let frame = 0
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / durationMs)
      setValue(Math.round(from.current + (target - from.current) * elapsed))
      if (elapsed < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [startedAt, target, durationMs])

  return value
}
