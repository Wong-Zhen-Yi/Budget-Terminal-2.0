import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'

const FULL_VIEW = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }
const MIN_SPAN = 1 / 64

/** Zoom in normalized plot coordinates so resizing and replay retain the view. */
export function usePlotZoom(
  svgRef: RefObject<SVGSVGElement | null>,
  bounds: { left: number; top: number; width: number; height: number },
  resetKey: unknown,
) {
  const [state, setState] = useState({ key: resetKey, view: FULL_VIEW })
  const view = state.key === resetKey ? state.view : FULL_VIEW
  const resetZoom = useCallback(() => setState({ key: resetKey, view: FULL_VIEW }), [resetKey])
  const { left, top, width, height } = bounds

  useEffect(() => {
    // Conditional empty states can replace the SVG without changing its bounds.
    // Rebind after each commit so the listener always follows the mounted element.
    const svg = svgRef.current
    if (!svg) return
    const wheel = (event: WheelEvent) => {
      const rect = svg.getBoundingClientRect()
      const svgWidth = svg.viewBox.baseVal.width || svg.width.baseVal.value
      const svgHeight = svg.viewBox.baseVal.height || svg.height.baseVal.value
      if (rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) return
      const x = (event.clientX - rect.left) * svgWidth / rect.width
      const y = (event.clientY - rect.top) * svgHeight / rect.height
      if (x < left || x > left + width || y < top || y > top + height) return
      if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return
      event.preventDefault()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1)
      const factor = Math.exp(Math.max(-240, Math.min(240, delta)) * 0.002)
      const zoomAxis = (min: number, max: number, anchor: number) => {
        if (factor < 1 && max - min <= MIN_SPAN + 1e-12) return [min, max]
        const span = Math.max(MIN_SPAN, Math.min(1, (max - min) * factor))
        if (span >= 1 - 1e-12) return [0, 1]
        const nextMin = Math.max(0, Math.min(1 - span, min + anchor * (max - min - span)))
        return [nextMin, nextMin + span]
      }
      setState((previous) => {
        const current = previous.key === resetKey ? previous.view : FULL_VIEW
        const [xMin, xMax] = zoomAxis(current.xMin, current.xMax, (x - left) / width)
        const [yMin, yMax] = zoomAxis(current.yMin, current.yMax, 1 - (y - top) / height)
        return { key: resetKey, view: { xMin, xMax, yMin, yMax } }
      })
    }
    // React wheel listeners are passive; a native listener keeps scrolling in the plot.
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  })

  return { view, resetZoom, zoomed: view.xMin !== 0 || view.xMax !== 1 || view.yMin !== 0 || view.yMax !== 1 }
}
