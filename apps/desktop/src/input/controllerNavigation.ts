import { ControllerReader, type ControllerAction } from './controller'

const controls = 'button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"]'
const visible = (element: HTMLElement) => !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
  !element.matches(':disabled, [aria-disabled="true"]') && element.getClientRects().length > 0 &&
  getComputedStyle(element).visibility === 'visible'
const candidates = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>(controls))
  .filter(element => element.tabIndex >= 0 && visible(element))
const modal = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], dialog[open], [aria-modal="true"]')).filter(visible).at(-1)
const scope = () => modal() ?? document

function focus(element: HTMLElement) {
  document.querySelector('[data-controller-focus]')?.removeAttribute('data-controller-focus')
  element.focus({ preventScroll: true })
  element.setAttribute('data-controller-focus', '')
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

export function moveControllerFocus(direction: 'up' | 'down' | 'left' | 'right') {
  const root = scope()
  const items = candidates(root)
  const current = document.activeElement
  if (!(current instanceof HTMLElement) || !items.includes(current)) {
    const first = items.find(item => item.closest('[data-page-id]')) ?? items[0]
    if (first) focus(first)
    return
  }
  if (current instanceof HTMLSelectElement && (direction === 'up' || direction === 'down')) {
    const options = Array.from(current.options).filter(option => !option.disabled && !option.closest('optgroup:disabled'))
    const index = options.findIndex(option => option.selected)
    const option = options[index + (direction === 'up' ? -1 : 1)]
    if (option) {
      current.value = option.value
      current.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return
  }
  const rect = current.getBoundingClientRect()
  const horizontal = direction === 'left' || direction === 'right'
  const sign = direction === 'left' || direction === 'up' ? -1 : 1
  let best: HTMLElement | undefined, bestScore = Infinity
  for (const item of items) {
    if (item === current || item.contains(current) || current.contains(item)) continue
    const next = item.getBoundingClientRect()
    const dx = next.x + next.width / 2 - rect.x - rect.width / 2
    const dy = next.y + next.height / 2 - rect.y - rect.height / 2
    const along = (horizontal ? dx : dy) * sign
    const across = Math.abs(horizontal ? dy : dx)
    if (along <= 1) continue
    const score = along + across * 3
    if (score < bestScore) { best = item; bestScore = score }
  }
  if (best) focus(best)
}

export function scrollControllerPanel(x: number, y: number) {
  const root = scope()
  const canScroll = (element: HTMLElement) => visible(element) &&
    ((y !== 0 && element.scrollHeight > element.clientHeight && /auto|scroll/.test(getComputedStyle(element).overflowY)) ||
      (x !== 0 && element.scrollWidth > element.clientWidth && /auto|scroll/.test(getComputedStyle(element).overflowX)))
  let target = document.activeElement instanceof HTMLElement ? document.activeElement : null
  while (target && (!root.contains(target) || !canScroll(target))) target = target.parentElement
  target ??= Array.from(root.querySelectorAll<HTMLElement>('*')).filter(canScroll)
    .filter(element => root !== document || element.closest('[data-page-id]'))
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? null
  target?.scrollBy({ left: x, top: y, behavior: 'instant' })
}

export interface ControllerNavigationOptions {
  stepPage: (direction: -1 | 1) => void
  togglePicker: () => void
  enabled: boolean
}

export function performControllerAction(action: ControllerAction, options: ControllerNavigationOptions) {
  if (action === 'picker') {
    const dialog = modal()
    if (!dialog || dialog.getAttribute('aria-label') === 'Page search') options.togglePicker()
    return
  }
  if (action === 'previousPage' || action === 'nextPage') {
    if (!modal()) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      options.stepPage(action === 'previousPage' ? -1 : 1)
    }
  } else if (action === 'activate') {
    const target = document.activeElement
    if (target instanceof HTMLElement && candidates(scope()).includes(target)) {
      focus(target)
      if (!target.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable]')) target.click()
    } else moveControllerFocus('down')
  } else if (action === 'back') {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
    const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    if (!event.defaultPrevented && target.matches('input, textarea, select, [contenteditable]')) target.blur()
    const dialog = modal()
    if (!event.defaultPrevented && dialog instanceof HTMLDialogElement) dialog.requestClose()
  } else moveControllerFocus(action)
}

/** Poll only the focused app; clean up polling and focus decoration on unmount. */
export function startControllerNavigation(getOptions: () => ControllerNavigationOptions) {
  if (!navigator.getGamepads) return () => {}
  const reader = new ControllerReader()
  let frame = 0, previousTime = 0, wasTesting = false
  const clearFocus = () => document.querySelector('[data-controller-focus]')?.removeAttribute('data-controller-focus')
  const tick = (now: number) => {
    const options = getOptions()
    const testing = Boolean(document.querySelector('[data-controller-test]'))
    if (testing !== wasTesting) { reader.reset(); wasTesting = testing }
    if (document.hidden || !document.hasFocus() || !options.enabled) reader.reset()
    else {
      const pads = Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => Boolean(pad?.connected && pad.mapping === 'standard'))
      const { actions, scroll } = reader.read(pads[0], now)
      // One action per frame prevents confirm and navigation firing together.
      const action = actions.find(value => ['back', 'picker', 'previousPage', 'nextPage'].includes(value)) ?? actions[0]
      if (testing) {
        if (actions.includes('back')) performControllerAction('back', options)
      } else if (action) performControllerAction(action, options)
      if (!testing && scroll.some(value => value !== 0)) {
        const distance = Math.min(32, now - previousTime) * 0.7
        scrollControllerPanel(scroll[0] * distance, scroll[1] * distance)
      }
    }
    previousTime = now
    frame = requestAnimationFrame(tick)
  }
  const reset = () => { reader.reset(); clearFocus() }
  window.addEventListener('blur', reset)
  window.addEventListener('gamepaddisconnected', reset)
  window.addEventListener('pointerdown', clearFocus)
  window.addEventListener('keydown', clearFocus)
  frame = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(frame)
    clearFocus()
    window.removeEventListener('blur', reset)
    window.removeEventListener('gamepaddisconnected', reset)
    window.removeEventListener('pointerdown', clearFocus)
    window.removeEventListener('keydown', clearFocus)
  }
}
