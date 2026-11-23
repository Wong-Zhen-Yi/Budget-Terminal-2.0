import { useEffect, useRef, useState } from 'react'
import { WORKSPACES, workspaceFor } from '@shared/navigation'
import { NavigationIcon } from '@/components/chrome/NavigationIcon'

interface NavigationPage {
  id: string
  label: string
}

export function MobileNavigation({ tabs, activeTab, onSelect }: {
  tabs: readonly NavigationPage[]
  activeTab: string
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const viewport = window.visualViewport
    const scroll = list.current
    if (!viewport || !scroll) return
    const fit = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      scroll.style.marginBottom = viewport.scale === 1 ? `${Math.max(0, covered)}px` : ''
    }
    fit()
    viewport.addEventListener('resize', fit)
    viewport.addEventListener('scroll', fit)
    return () => {
      viewport.removeEventListener('resize', fit)
      viewport.removeEventListener('scroll', fit)
    }
  }, [])

  const search = query.trim().toLowerCase()
  const groups = [
    ...WORKSPACES.map(({ id, label, pages }) => ({ id, label, tabs: tabs.filter(tab => pages.includes(tab.id)) })),
    { id: 'settings', label: 'Preferences', tabs: tabs.filter(tab => !workspaceFor(tab.id)) },
  ].map(group => ({
    ...group,
    tabs: group.label.toLowerCase().includes(search) ? group.tabs : group.tabs.filter(tab => tab.label.toLowerCase().includes(search)),
  })).filter(group => group.tabs.length > 0)

  return <nav id="mobile-navigation" className="mobile-navigation" aria-labelledby="mobile-navigation-title">
    <form className="mobile-navigation-search" role="search" onSubmit={event => {
      event.preventDefault()
      const matches = groups.flatMap(group => group.tabs)
      const page = matches.find(tab => tab.label.toLowerCase() === search) ?? (matches.length === 1 ? matches[0] : undefined)
      if (page) onSelect(page.id)
    }}>
      <h2 id="mobile-navigation-title">Workspaces</h2>
      <input type="search" aria-label="Search pages or workspaces" placeholder="Search pages or workspaces"
        autoComplete="off" value={query} onChange={event => {
          setQuery(event.target.value)
          if (list.current) list.current.scrollTop = 0
        }} />
    </form>
    <div ref={list} className="mobile-navigation-scroll">
      <div className="mobile-navigation-groups">
        {groups.map(group => (
          <section key={group.id} className="mobile-navigation-group" aria-labelledby={`mobile-workspace-${group.id}`}>
            <h3 id={`mobile-workspace-${group.id}`}>
              <NavigationIcon id={group.id} workspace={group.id !== 'settings'} />
              {group.label}
            </h3>
            <ul>
              {group.tabs.map(tab => <li key={tab.id}>
                <button type="button" className="mobile-navigation-pill" data-navigation-page={tab.id}
                  aria-current={tab.id === activeTab ? 'page' : undefined} onClick={() => onSelect(tab.id)}>
                  {tab.label}
                </button>
              </li>)}
            </ul>
          </section>
        ))}
        {!groups.length && <p className="mobile-navigation-empty" role="status">No pages match your search.</p>}
      </div>
    </div>
  </nav>
}
