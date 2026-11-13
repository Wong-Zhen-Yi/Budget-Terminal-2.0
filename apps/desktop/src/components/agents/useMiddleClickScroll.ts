import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** Middle click to latch, or hold and move to scroll until release. */
export function useMiddleClickScroll(transcript: RefObject<HTMLDivElement | null>, chatId?: string | null) {
  const scrolling = useRef(false)

  useLayoutEffect(() => {
    const element = transcript.current
    if (!element) return
    const document = element.ownerDocument
    const view = document.defaultView!
    let frame = 0
    let origin = 0
    let pointer = 0
    let previous = 0
    let velocity = 0
    let position = 0
    let moved = false
    let suppressAuxClick = false
    const stop = () => {
      scrolling.current = false
      view.cancelAnimationFrame(frame)
      element.removeAttribute('data-middle-scrolling')
    }
    const animate = (time: number) => {
      if (!scrolling.current) return
      // Time-based motion stays consistent across display refresh rates and stalls.
      const elapsed = Math.min(time - previous, 40)
      previous = time
      if (!element.getClientRects().length) { stop(); return }
      const distance = pointer - origin
      const speed = Math.sign(distance) * Math.min(1200, Math.max(0, Math.abs(distance) - 12) * 7)
      velocity += (speed - velocity) * (1 - Math.exp(-elapsed / 70))
      position = Math.max(0, Math.min(element.scrollHeight - element.clientHeight, position + velocity * elapsed / 1000))
      element.scrollTo({ top: position, behavior: 'instant' })
      frame = view.requestAnimationFrame(animate)
    }
    const down = (event: PointerEvent) => {
      if (scrolling.current) {
        stop()
        if (event.button === 1) { event.preventDefault(); suppressAuxClick = true }
        return
      }
      if (event.defaultPrevented || event.button !== 1 || !(event.target instanceof Element)
        || !element.contains(event.target)
        || event.target.closest('a, button, input, select, textarea, summary, [contenteditable], .agents-market-chart, .agents-candlestick')
        || element.scrollHeight <= element.clientHeight) return
      event.preventDefault()
      suppressAuxClick = true
      scrolling.current = true
      origin = pointer = event.clientY
      position = element.scrollTop
      previous = view.performance.now()
      velocity = 0
      moved = false
      element.setAttribute('data-middle-scrolling', '')
      frame = view.requestAnimationFrame(animate)
    }
    const move = (event: PointerEvent) => {
      if (!scrolling.current) return
      pointer = event.clientY
      if (Math.abs(pointer - origin) > 12) moved = true
    }
    const up = (event: PointerEvent) => {
      if (event.button === 1 && moved) stop()
    }
    const auxClick = (event: MouseEvent) => {
      if (event.button !== 1 || !suppressAuxClick) return
      event.preventDefault()
      suppressAuxClick = false
    }
    const key = (event: KeyboardEvent) => {
      if (!scrolling.current) return
      stop()
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation() }
    }
    const visibility = () => { if (document.hidden) stop() }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', stop)
    document.addEventListener('auxclick', auxClick, true)
    document.addEventListener('keydown', key, true)
    document.addEventListener('wheel', stop, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    view.addEventListener('blur', stop)
    return () => {
      stop()
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', stop)
      document.removeEventListener('auxclick', auxClick, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('wheel', stop)
      document.removeEventListener('visibilitychange', visibility)
      view.removeEventListener('blur', stop)
    }
  }, [transcript, chatId])

  return scrolling
}
