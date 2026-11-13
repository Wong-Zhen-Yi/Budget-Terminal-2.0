const check = (value: unknown, message: string) => { if (!value) throw Error(message) }
const settle = () => new Promise(resolve => setTimeout(resolve, 50))
const svg = () => document.querySelector('svg')!
const dots = () => [...svg().querySelectorAll('circle')].filter(dot => dot.getAttribute('fill') !== 'none')
const positions = () => dots().map(dot => [Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))])
export const resetZoomButton = () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Reset zoom')!

export function scrollPlot(deltaY = -120, deltaMode = 0, location?: { x: number; y: number }) {
  const chart = svg()
  const clip = chart.querySelector('clipPath rect')!
  const x = location?.x ?? Number(clip.getAttribute('x')) + Number(clip.getAttribute('width')) / 2
  const y = location?.y ?? Number(clip.getAttribute('y')) + Number(clip.getAttribute('height')) / 2
  const rect = chart.getBoundingClientRect()
  const width = chart.viewBox.baseVal.width || chart.width.baseVal.value
  const height = chart.viewBox.baseVal.height || chart.height.baseVal.value
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaMode,
    clientX: rect.left + x * rect.width / width, clientY: rect.top + y * rect.height / height })
  chart.dispatchEvent(event)
  return event.defaultPrevented
}

/** Exercise the real rendered SVG and native wheel listener, with no data providers. */
export async function verifyPlotZoom() {
  const initial = positions()
  check(resetZoomButton().disabled, 'Reset zoom disabled at full extent')
  check(!scrollPlot(-120, 0, { x: 0, y: 0 }), 'Scrolling outside plot retains normal scrolling')
  check(!scrollPlot(0), 'Horizontal/zero wheel does not zoom')
  const anchor = initial[Math.floor(initial.length / 2)]
  const rect = svg().getBoundingClientRect()
  const width = svg().viewBox.baseVal.width || svg().width.baseVal.value
  const height = svg().viewBox.baseVal.height || svg().height.baseVal.value
  // WheelEvent client coordinates use integer CSS pixels.
  const pointer = [
    (Math.trunc(rect.left + anchor[0] * rect.width / width) - rect.left) * width / rect.width,
    (Math.trunc(rect.top + anchor[1] * rect.height / height) - rect.top) * height / rect.height,
  ]
  check(scrollPlot(-120, 0, { x: anchor[0], y: anchor[1] }), 'Plot wheel prevents page scrolling')
  await settle()
  const zoomed = positions()
  check(!resetZoomButton().disabled, 'Scroll up enables Reset zoom')
  const expected = Math.exp(0.24)
  for (let i = 0; i < initial.length; i++) {
    for (let axis = 0; axis < 2; axis++) {
      check(Math.abs((zoomed[i][axis] - pointer[axis]) - (initial[i][axis] - pointer[axis]) * expected) < 1e-6, 'Zoom expands coordinates around the pointer on both axes')
    }
  }
  scrollPlot(120, 0, { x: anchor[0], y: anchor[1] })
  await settle()
  const restored = positions()
  check(initial.every((p, i) => p.every((value, axis) => Math.abs(restored[i][axis] - value) < 1e-6)), 'Scroll down restores full extent')
  check(resetZoomButton().disabled, 'Zoom out stops at full extent')
  for (let i = 0; i < 80; i++) scrollPlot(-120)
  await settle()
  const limited = positions()
  scrollPlot(-120)
  await settle()
  check(JSON.stringify(limited) === JSON.stringify(positions()), 'Rapid wheel input stops at maximum zoom')
  check(limited.flat().every(Number.isFinite), 'Maximum zoom has finite coordinates')
  check(svg().querySelector('g[clip-path]'), 'Data layer is clipped to plot bounds')
  svg().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await settle()
  check(resetZoomButton().disabled, 'Double-click resets zoom')
  check(scrollPlot(-3, 1), 'Line-mode wheel supported')
  await settle()
  check(!resetZoomButton().disabled, 'Line-mode wheel zooms')
  resetZoomButton().click()
  await settle()
  check(scrollPlot(-1, 2), 'Page-mode wheel supported')
  await settle()
  check(!resetZoomButton().disabled, 'Page-mode wheel zooms')
  resetZoomButton().click()
  await settle()
  check(JSON.stringify(initial) === JSON.stringify(positions()), 'Reset button restores original coordinates')
}
