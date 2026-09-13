import {
  Activity,
  Component,
  memo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'

interface PageCacheProps {
  activeTab: string
  visibleIds: readonly string[]
  renderPage: (tabId: string) => ReactNode
}

/** Hidden chart trees retain sizeable canvas/GPU resources, so keep only recent pages. */
const MAX_RESIDENT_PAGES = 3

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

export const PageCache = memo(function PageCache({ activeTab, visibleIds, renderPage }: PageCacheProps) {
  const [retained, setRetained] = useState([activeTab])
  const residents = [
    activeTab,
    ...retained.filter((id) => id !== activeTab && visibleIds.includes(id)),
  ].slice(0, MAX_RESIDENT_PAGES)

  // Adjust before committing so a newly selected page mounts only once. Pages stay
  // retained for the session unless the user explicitly hides them in Settings.
  if (residents.length !== retained.length || residents.some((id, index) => id !== retained[index])) {
    setRetained(residents)
  }

  return residents.map((id) => (
    <Activity key={id} mode={id === activeTab ? 'visible' : 'hidden'}>
      <div className="flex min-h-0 flex-1 flex-col" data-page-id={id}>
        <PageErrorBoundary tabId={id}>
          <CachedPage tabId={id} renderPage={renderPage} />
        </PageErrorBoundary>
      </div>
    </Activity>
  ))
})

// Shell notices, loading progress and status updates must not redraw page tables.
const CachedPage = memo(function CachedPage({ tabId, renderPage }: {
  tabId: string
  renderPage: (tabId: string) => ReactNode
}) {
  return renderPage(tabId)
})
