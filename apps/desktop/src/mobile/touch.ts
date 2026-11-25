/**
 * Phone browsers have no double-click. iOS Safari rarely sends `dblclick` for a double tap and
 * Android Chrome only sometimes does, so pages that open a row or tile on double-click would do
 * nothing on a phone. Two quick taps on the same spot become one `dblclick` here, after the
 * second `click` has reached the page, in the same order a mouse produces. A native `dblclick`
 * that follows a synthesized one is dropped so the action runs once.
 */
const DOUBLE_TAP_MS = 350
const DOUBLE_TAP_DISTANCE = 24

export function installDoubleTap(root: Document = document) {
  let touchPointer = false
  let last: { x: number; y: number; time: number } | null = null
  let synthesizedAt = -Infinity

  root.addEventListener('pointerdown', event => { touchPointer = event.pointerType === 'touch' }, { capture: true, passive: true })

  // Registered on the window, so React's root listener has already handled the click.
  root.defaultView?.addEventListener('click', event => {
    if (!touchPointer || !event.isTrusted) {
      last = null
      return
    }
    const now = event.timeStamp
    const previous = last
    if (previous && now - previous.time < DOUBLE_TAP_MS && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < DOUBLE_TAP_DISTANCE) {
      last = null
      const target = event.target
      if (!(target instanceof Element) || !target.isConnected) return
      synthesizedAt = performance.now()
      target.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true, cancelable: true, composed: true, view: root.defaultView, detail: 2,
        clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY,
      }))
      return
    }
    last = { x: event.clientX, y: event.clientY, time: now }
  })

  root.addEventListener('dblclick', event => {
    if (event.isTrusted && performance.now() - synthesizedAt < 600) {
      event.stopImmediatePropagation()
      event.preventDefault()
    }
  }, { capture: true })
}

/** True when the page runs in the phone browser shell. */
export const touchShell = () => document.documentElement.hasAttribute('data-terminal-mobile')

/** Name the gesture the viewer actually has: a phone has taps and pinches, not clicks and wheels. */
export const pointerText = (mouse: string, touch: string) => touchShell() ? touch : mouse
