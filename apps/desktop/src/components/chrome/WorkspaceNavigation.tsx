import { useEffect, useRef } from 'react'

import { SETTINGS_TAB_ID } from '@shared/contract'
import { WORKSPACES, workspaceFor } from '@shared/navigation'

interface NavigationTab {
  id: string
  label: string
  implemented: boolean
}

interface NavigationProps {
  tabs: NavigationTab[]
  activeTab: string
  onSelectTab: (id: string) => void
}

const pageButton = 'rounded px-3 py-2 text-left text-2xs transition-colors disabled:opacity-40 '
const selectedStyle = 'bg-accent-dim text-text'
const idleStyle = 'text-text-muted hover:bg-surface-hover hover:text-text'

export function WorkspaceSidebar({ tabs, activeTab, onSelectTab, favorites, collapsed, onToggleCollapsed, saving }: NavigationProps & {
  favorites: string[]
  collapsed: boolean
  onToggleCollapsed: () => void
  saving: boolean
}) {
  const remembered = useRef(new Map<string, string>())
  const navigationButton = collapsed ? pageButton.replace('px-3', 'px-1') + 'text-center ' : pageButton
  const activeWorkspace = workspaceFor(activeTab)
  useEffect(() => {
    if (activeWorkspace) remembered.current.set(activeWorkspace.id, activeTab)
  }, [activeTab, activeWorkspace])

  return (
    <aside aria-label="Workspace sidebar" className={`flex shrink-0 flex-col gap-6 overflow-y-auto border-r border-border bg-surface px-2 py-4 ${collapsed ? 'w-16' : 'w-48'}`}>
      <div>
        <div className="mb-2 flex items-center justify-between">
          {!collapsed ? <p className="px-3 text-2xs text-text-dim">Workspaces</p> : null}
          <button type="button" onClick={onToggleCollapsed} disabled={saving}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-10 rounded py-1 text-2xs text-text-muted hover:bg-surface-hover disabled:opacity-50">
            {collapsed ? '»' : '«'}
          </button>
        </div>
        <nav aria-label="Workspaces" className="flex flex-col gap-1">
          {WORKSPACES.map((workspace) => {
            const pages = tabs.filter((tab) => workspace.pages.includes(tab.id) && tab.implemented)
            if (!pages.length) return null
            const rememberedId = remembered.current.get(workspace.id)
            const target = pages.find((tab) => tab.id === rememberedId) ?? pages[0]
            const active = workspace.id === activeWorkspace?.id
            return (
              <button key={workspace.id} type="button" aria-current={active ? 'page' : undefined}
                aria-label={workspace.label} title={collapsed ? workspace.label : undefined}
                onClick={() => onSelectTab(target.id)}
                className={`${navigationButton}flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-2 ${active ? selectedStyle : idleStyle}`}>
                <span>{collapsed ? workspace.label.split(/[ &]+/).map((word) => word[0]).join('').toUpperCase() : workspace.label}</span>
                {!collapsed ? <span className="num text-text-dim">{pages.length}</span> : null}
              </button>
            )
          })}
        </nav>
      </div>
      <div>
        <p className="px-3 pb-2 text-2xs text-text-dim" aria-label="Favorites">{collapsed ? '★' : 'Favorites'}</p>
        <nav aria-label="Favorite pages" className="flex flex-col gap-1">
          {favorites.flatMap((id) => {
            const tab = tabs.find((entry) => entry.id === id && entry.implemented)
            return tab ? [<button key={id} type="button" onClick={() => onSelectTab(id)}
              aria-label={tab.label} title={collapsed ? tab.label : undefined}
              aria-current={id === activeTab ? 'page' : undefined}
              className={navigationButton + (id === activeTab ? selectedStyle : idleStyle)}>{collapsed ? tab.label.slice(0, 2) : tab.label}</button>] : []
          })}
        </nav>
        {!collapsed && !favorites.some((id) => tabs.some((tab) => tab.id === id && tab.implemented)) ? (
          <p className="px-3 text-2xs text-text-dim">Star a page to pin it here.</p>
        ) : null}
      </div>
      <button type="button" onClick={() => onSelectTab(SETTINGS_TAB_ID)}
        aria-label="Settings" title={collapsed ? 'Settings' : undefined}
        aria-current={activeTab === SETTINGS_TAB_ID ? 'page' : undefined}
        className={`${navigationButton}mt-auto ${activeTab === SETTINGS_TAB_ID ? selectedStyle : idleStyle}`}>{collapsed ? '⚙' : 'Settings'}</button>
    </aside>
  )
}

export function WorkspaceHeader({ tabs, activeTab, onSelectTab, favorite, onToggleFavorite, saving }: NavigationProps & {
  favorite: boolean
  onToggleFavorite: () => void
  saving: boolean
}) {
  const workspace = workspaceFor(activeTab)
  const page = tabs.find((tab) => tab.id === activeTab)
  const pages = tabs.filter((tab) => workspace?.pages.includes(tab.id))
  return (
    <header className="shrink-0 border-b border-border bg-surface px-4 pt-3 pb-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="text-2xs text-text-muted">{workspace?.label ?? 'Preferences'} /</span>
          <h1 className="text-sm font-semibold text-text">{page?.label}</h1>
        </div>
        {workspace ? <button type="button" onClick={onToggleFavorite} disabled={saving}
          aria-pressed={favorite} aria-label={favorite ? 'Remove page from favorites' : 'Add page to favorites'}
          className="shrink-0 rounded border border-border-strong px-2 py-1 text-2xs text-text-muted hover:bg-surface-hover disabled:opacity-50">
          {favorite ? '★ Favorited' : '☆ Favorite'}
        </button> : null}
      </div>
      {pages.length ? <nav aria-label="Workspace pages" className="mt-2 flex flex-wrap gap-1">
        {pages.map((tab) => <button key={tab.id} type="button" disabled={!tab.implemented}
          aria-current={tab.id === activeTab ? 'page' : undefined} onClick={() => onSelectTab(tab.id)}
          className={pageButton + (tab.id === activeTab ? selectedStyle : idleStyle)}>{tab.label}</button>)}
      </nav> : null}
    </header>
  )
}
