import { TABS } from '@shared/contract'
import { FOCUS_WORKSPACE } from '@shared/navigation'

/**
 * Small phone-browser adjustments that every page shares, applied to the page on screen:
 *
 * - Wide tables keep their ticker or name column in place while the other columns swipe
 *   sideways, and any sideways scroller fades at the edge that has more to show.
 * - Ticker fields open the keyboard in capitals without autocorrect, with a Go key.
 * - A page heading that repeats the page name in the header is hidden. Focus pages keep their
 *   titles, which are part of each page's own design.
 *
 * Pages keep their markup; the scan only sets data attributes that `mobile.css` styles, so
 * rows that mount later (sorting, virtual scrolling, new results) pick up the same styling.
 */

const LABELS = new Set(TABS.map(tab => normalize(tab.label)))
const KEY_COLUMN = /^(ticker|symbol|company|name|asset|holding|instrument|pair|coin|fund|etf|market|contract|series|indicator|metric|financial metrics|member|politician|country|currency|sector|strategy|stock|term)\b/i
const TICKER_FIELD = /ticker|symbol|compan/i
const SCROLLERS = '.workspace-pages, [role="tablist"], .mobile-tab-strip, .news-toolbar-filters, .semi-nav'

function normalize(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function scrollsSideways(element: Element) {
  return /(auto|scroll)/.test(getComputedStyle(element).overflowX)
}

function scrollParent(table: Element) {
  for (let parent = table.parentElement; parent && !parent.hasAttribute('data-page-id'); parent = parent.parentElement) {
    if (scrollsSideways(parent)) return parent
  }
  return null
}

function opaqueBackground(element: Element | null) {
  for (let node = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor
    if (color && color !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(color)) return color
  }
  return 'rgb(8, 11, 18)'
}

/** Mark which edges of a sideways scroller have more content. */
export function markEdges(element: HTMLElement) {
  const overflow = element.scrollWidth - element.clientWidth
  const start = overflow > 2 && element.scrollLeft > 2
  const end = overflow > 2 && element.scrollLeft < overflow - 2
  const state = start && end ? 'both' : start ? 'start' : end ? 'end' : ''
  if (element.dataset.mobileMore !== state) {
    if (state) element.dataset.mobileMore = state
    else delete element.dataset.mobileMore
  }
}

function freezeColumns(table: HTMLTableElement, scroller: HTMLElement) {
  const header = table.tHead?.rows[table.tHead.rows.length - 1] ?? table.rows[0]
  const cells = header ? [...header.cells] : []
  let count = 0
  let lefts: number[] = []
  if (scroller.scrollWidth > scroller.clientWidth + 2 && cells.length > 2) {
    const key = cells.slice(0, 3).findIndex(cell => KEY_COLUMN.test(normalize(cell.textContent ?? '').replace(/[▲▼↑↓]/g, '').trim()))
    if (key >= 0 && cells.every((cell, index) => index > key || cell.colSpan === 1)) {
      // Widths, not offsets: a frozen cell's offset moves while the table is swiped.
      lefts = cells.slice(0, key + 2).map((_cell, index) => cells.slice(0, index).reduce((sum, cell) => sum + cell.offsetWidth, 0))
      const width = lefts[key + 1]
      // A frozen block wider than about half the screen would leave nothing to swipe.
      if (width > 0 && width <= scroller.clientWidth * 0.5) count = key + 1
    }
  }
  const frozen = String(count)
  if (!count) {
    if (table.dataset.mobileFreeze) delete table.dataset.mobileFreeze
    scroller.style.removeProperty('--freeze-width')
    return 0
  }
  for (let index = 1; index < count; index++) {
    table.style.setProperty(`--freeze-left-${index + 1}`, `${lefts[index]}px`)
  }
  table.style.setProperty('--freeze-bg', opaqueBackground(table))
  table.style.setProperty('--freeze-head-bg', opaqueBackground(cells[0]))
  scroller.style.setProperty('--freeze-width', `${lefts[count]}px`)
  if (table.dataset.mobileFreeze !== frozen) table.dataset.mobileFreeze = frozen
  return count
}

function tuneKeyboard(input: HTMLInputElement) {
  if (input.dataset.mobileKeyboard) return
  input.dataset.mobileKeyboard = '1'
  if (!/^(text|search|)$/.test(input.getAttribute('type') ?? '')) return
  const label = [input.placeholder, input.getAttribute('aria-label'), input.name, input.id, input.labels?.[0]?.textContent].join(' ')
  if (TICKER_FIELD.test(label) && !/search\s+(by|for)?\s*(name|news|articles)/i.test(label)) {
    input.setAttribute('autocapitalize', 'characters')
    input.setAttribute('autocorrect', 'off')
    input.setAttribute('autocomplete', 'off')
    input.spellcheck = false
  }
  if (!input.hasAttribute('enterkeyhint')) input.setAttribute('enterkeyhint', input.type === 'search' || /search|filter/i.test(label) ? 'search' : input.form ? 'go' : 'done')
}

function hideRepeatedTitle(page: HTMLElement) {
  if (FOCUS_WORKSPACE.pages.includes(page.dataset.pageId ?? '')) return
  for (const heading of page.querySelectorAll<HTMLHeadingElement>('h1')) {
    if (heading.dataset.mobileRepeat || !LABELS.has(normalize(heading.textContent ?? ''))) continue
    const group = heading.parentElement
    // Hide the whole title block (heading, eyebrow, one-line description) when it holds no controls.
    const block = group && group !== page && !group.querySelector('button, input, select, a, summary, [role="status"]')
      && [...group.children].every(child => /^(H1|P|SPAN)$/.test(child.tagName)) ? group : heading
    block.dataset.mobileRepeat = '1'
    heading.dataset.mobileRepeat = '1'
  }
}

export function installMobileLayout(root: Document = document) {
  let queued = false
  let lastScan = 0
  const watched = new WeakSet<Element>()
  const resize = new ResizeObserver(entries => {
    for (const entry of entries) if (entry.target instanceof HTMLElement) markEdges(entry.target)
    schedule()
  })

  const watch = (element: HTMLElement) => {
    markEdges(element)
    if (watched.has(element)) return
    watched.add(element)
    resize.observe(element)
  }

  const scan = () => {
    queued = false
    lastScan = performance.now()
    for (const strip of root.querySelectorAll<HTMLElement>('.workspace-pages')) watch(strip)
    const page = [...root.querySelectorAll<HTMLElement>('[data-page-id]')].find(element => element.getClientRects().length > 0)
    if (!page) return
    hideRepeatedTitle(page)
    for (const input of page.querySelectorAll<HTMLInputElement>('input')) tuneKeyboard(input)
    for (const strip of page.querySelectorAll<HTMLElement>(SCROLLERS)) if (scrollsSideways(strip)) watch(strip)
    for (const table of page.querySelectorAll<HTMLTableElement>('table')) {
      if (!table.getClientRects().length) continue
      const scroller = scrollParent(table)
      if (!scroller) continue
      freezeColumns(table, scroller)
      watch(scroller)
    }
  }

  // Live prices re-render constantly, so scans run at most a few times a second.
  function schedule() {
    if (queued) return
    queued = true
    const wait = Math.max(0, 300 - (performance.now() - lastScan))
    window.setTimeout(() => requestAnimationFrame(scan), wait)
  }

  let edgeFrame = 0
  const pending = new Set<HTMLElement>()
  root.addEventListener('scroll', event => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.dataset || !watched.has(target)) return
    pending.add(target)
    if (edgeFrame) return
    edgeFrame = requestAnimationFrame(() => {
      edgeFrame = 0
      for (const element of pending) markEdges(element)
      pending.clear()
    })
  }, { capture: true, passive: true })

  new MutationObserver(schedule).observe(root.body, { childList: true, subtree: true })
  window.addEventListener('resize', schedule)
  schedule()
}
