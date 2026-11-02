import {
  Activity,
  Component,
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'

interface PageCacheProps {
  activeTab: string
  /** Preserve the user's page (including scroll/form state) during MCP captures. */
  retainedTab?: string
  visibleIds: readonly string[]
  renderPage: (tabId: string) => ReactNode
}

/** Hidden chart trees retain sizeable canvas/GPU resources, so keep only recent pages. */
const MAX_RESIDENT_PAGES = 3
// Keep inexpensive readers and controls longer without increasing the chart/GPU budget.
const LIGHT_PAGES = new Set(['dictionary', 'settings', 'articles', 'notifications', 'news', 'calendar', 'ipo', 'politics', 'institutions'])
const MAX_LIGHT_PAGES = 8
type ScrollPositions = Map<string, { path: number[]; top: number; left: number }>

function PageFrame({ tabId, active, positions, children }: {
  tabId: string; active: boolean; positions: ScrollPositions; children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!active) return
    const restore = () => {
      for (const position of positions.values()) {
        let element: Element | undefined = root.current ?? undefined
        for (const index of position.path) element = element?.children[index]
        if (element instanceof HTMLElement) {
          element.scrollTop = position.top
          element.scrollLeft = position.left
        }
      }
    }
    restore()
    const frame = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(frame)
  }, [active, positions])
  return <div ref={root} className="flex min-h-0 flex-1 flex-col" data-page-id={tabId} onScrollCapture={event => {
    if (!active || !(event.target instanceof HTMLElement)) return
    const target = event.target
    const path: number[] = []
    let element: Element | null = target
    while (element && element !== root.current) {
      const parent: Element | null = element.parentElement
      if (!parent) return
      path.unshift(Array.prototype.indexOf.call(parent.children, element))
      element = parent
    }
    if (element === root.current) positions.set(path.join('.'), { path, top: target.scrollTop, left: target.scrollLeft })
  }}>{children}</div>
}

class PageErrorBoundary extends Component<{
  children: ReactNode
  tabId: string
}, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[page:${this.props.tabId}] Render failed.`, error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-xl border border-negative/50 bg-surface p-4 text-sm text-text">
          <h2 className="font-semibold text-negative">This page could not render</h2>
          <p className="mt-2 text-text-muted">{this.state.error.message}</p>
          <button
            className="mt-3 border border-border-strong bg-surface-raised px-3 py-1 text-xs hover:border-accent"
            onClick={() => this.setState({ error: null })}
            type="button"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}

export const PageCache = memo(function PageCache({ activeTab, retainedTab, visibleIds, renderPage }: PageCacheProps) {
  const [retained, setRetained] = useState([activeTab])
  const scrolls = useRef(new Map<string, ScrollPositions>())
  let heavy = 0
  let light = 0
  const residents = [
    activeTab,
    ...(retainedTab && retainedTab !== activeTab ? [retainedTab] : []),
    ...retained.filter((id) => id !== activeTab && id !== retainedTab && visibleIds.includes(id)),
  ].filter(id => LIGHT_PAGES.has(id) ? ++light <= MAX_LIGHT_PAGES : ++heavy <= MAX_RESIDENT_PAGES)

  // Adjust before committing so a newly selected page mounts only once. Keep the
  // most recent chart trees and inexpensive readers resident in separate budgets.
  if (residents.length !== retained.length || residents.some((id, index) => id !== retained[index])) {
    setRetained(residents)
  }

  return residents.map((id) => {
    let positions = scrolls.current.get(id)
    if (!positions) { positions = new Map(); scrolls.current.set(id, positions) }
    return (
      <Activity key={id} mode={id === activeTab ? 'visible' : 'hidden'}>
        <PageFrame tabId={id} active={id === activeTab} positions={positions}>
          <PageErrorBoundary tabId={id}>
            <CachedPage tabId={id} renderPage={renderPage} />
          </PageErrorBoundary>
        </PageFrame>
      </Activity>
    )
  })
})

// Shell notices, loading progress and status updates must not redraw page tables.
const CachedPage = memo(function CachedPage({ tabId, renderPage }: {
  tabId: string
  renderPage: (tabId: string) => ReactNode
}) {
  return renderPage(tabId)
})
