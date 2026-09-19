import { useCallback, useEffect, useRef } from 'react'

interface SplitterProps {
  /** Called with the pointer position on the divider's active axis. */
  onDrag: (position: number) => void
  orientation?: 'vertical' | 'horizontal'
}

/**
 * A draggable vertical divider between dashboard columns.
 *
 * Pointer capture keeps the drag alive when the cursor outruns the 4px handle, which
 * it always does — without it the column snaps back the moment the pointer crosses
 * into the chart canvas.
 */
export function Splitter({ onDrag, orientation = 'vertical' }: SplitterProps) {
  const dragging = useRef(false)

  const stop = useCallback(() => {
    dragging.current = false
    document.body.style.cursor = ''
  }, [])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return
      event.preventDefault()
      onDrag(orientation === 'vertical' ? event.clientX : event.clientY)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
  }, [onDrag, orientation, stop])

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      onPointerDown={() => {
        dragging.current = true
        document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize'
      }}
      className={
        orientation === 'vertical'
          ? 'w-2 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent-dim'
          : 'h-2 shrink-0 cursor-row-resize bg-transparent transition-colors hover:bg-accent-dim'
      }
    />
  )
}
