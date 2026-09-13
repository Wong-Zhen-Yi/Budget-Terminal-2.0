import { Activity, memo, useState, type ReactNode } from 'react'

interface PageCacheProps {
  activeTab: string
  visibleIds: readonly string[]
  renderPage: (tabId: string) => ReactNode
}

export const PageCache = memo(function PageCache({ activeTab, visibleIds, renderPage }: PageCacheProps) {
  const [retained, setRetained] = useState([activeTab])
  const residents = [activeTab, ...retained.filter((id) => id !== activeTab && visibleIds.includes(id))]

  // Adjust before committing so a newly selected page mounts only once. Pages stay
  // retained for the session unless the user explicitly hides them in Settings.
  if (residents.length !== retained.length || residents.some((id, index) => id !== retained[index])) {
    setRetained(residents)
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
