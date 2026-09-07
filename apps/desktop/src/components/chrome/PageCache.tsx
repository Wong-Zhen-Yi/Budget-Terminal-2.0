import { Activity, memo, useState, type ReactNode } from 'react'

interface PageCacheProps {
  activeTab: string
  visibleIds: readonly string[]
  renderPage: (tabId: string) => ReactNode
}

// Bound retained DOM and state to the active page plus three recent pages.
const PAGE_LIMIT = 4

export const PageCache = memo(function PageCache({ activeTab, visibleIds, renderPage }: PageCacheProps) {
  const [recent, setRecent] = useState([activeTab])
  const residents = [activeTab, ...recent.filter((id) => id !== activeTab && visibleIds.includes(id))]
    .slice(0, PAGE_LIMIT)

  // Adjust before committing so a newly selected page mounts only once.
  if (residents.length !== recent.length || residents.some((id, index) => id !== recent[index])) {
    setRecent(residents)
  }

  return residents.map((id) => (
    <Activity key={id} mode={id === activeTab ? 'visible' : 'hidden'}>
      <div className="flex min-h-0 flex-1 flex-col" data-page-id={id}>
        <CachedPage tabId={id} renderPage={renderPage} />
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
