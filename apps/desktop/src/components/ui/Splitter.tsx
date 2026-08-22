import { useCallback, useEffect, useRef } from 'react'

interface SplitterProps {
  /** Called with the pointer's x position, in pixels from the viewport's left edge. */
  onDrag: (clientX: number) => void
}

/**
 * A draggable vertical divider between dashboard columns.
 *
 * Pointer capture keeps the drag alive when the cursor outruns the 4px handle, which
 * it always does — without it the column snaps back the moment the pointer crosses
 * into the chart canvas.
 */
export function Splitter({ onDrag }: SplitterProps) {
  const dragging = useRef(false)

  const stop = useCallback(() => {
    dragging.current = false
    document.body.style.cursor = ''
  }, [])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return
      event.preventDefault()
      onDrag(event.clientX)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
  }, [onDrag, stop])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={() => {
        dragging.current = true
        document.body.style.cursor = 'col-resize'
      }}
      className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent-dim"
    />
  )
}
