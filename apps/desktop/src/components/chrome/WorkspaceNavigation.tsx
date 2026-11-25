import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { FOCUS_DASHBOARD_TAB_ID, SETTINGS_TAB_ID } from '@shared/contract'
import { FOCUS_WORKSPACE, WORKSPACES, workspaceFor } from '@shared/navigation'
import { NavigationIcon } from './NavigationIcon'

interface NavigationTab {
  id: string
  label: string
  implemented: boolean
}

interface NavigationProps {
  tabs: NavigationTab[]
  activeTab: string
  onSelectTab: (id: string) => void
  isMac: boolean
}

const pageButton = 'rounded px-3 py-1.5 text-left text-2xs transition-colors disabled:opacity-40 '
const selectedStyle = 'bg-accent-dim text-text'
const idleStyle = 'text-text-muted hover:bg-surface-hover hover:text-text'

export function WorkspaceSidebar({ tabs, activeTab, onSelectTab, favorites, favoriteShortcuts = [], recent, collapsed, onToggleCollapsed, saving, isMac, unreadNotifications = 0 }: NavigationProps & {
  favorites: string[]
  /** Favorites reachable with Ctrl/⌘+1…9, in shortcut order. */
  favoriteShortcuts?: readonly string[]
  recent: string[]
  collapsed: boolean
  onToggleCollapsed: () => void
  saving: boolean
  unreadNotifications?: number
}) {
  const remembered = useRef(new Map<string, string>())
  // Recently viewed only gets the height left after Workspaces and Favorites, so the sidebar never scrolls.
  const recentArea = useRef<HTMLDivElement>(null)
  const [recentFit, setRecentFit] = useState(4)
  useLayoutEffect(() => {
    const area = recentArea.current
    if (!area) return
    const measure = () => {
      const heading = area.firstElementChild?.getBoundingClientRect().height ?? 0
      const row = area.querySelector('button')?.getBoundingClientRect().height || 32
      setRecentFit(Math.max(0, Math.min(4, Math.floor((area.clientHeight - heading + 4) / (row + 4)))))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
  }, [collapsed])
  const recentPages = recent.filter((id) => id !== activeTab && tabs.some((tab) => tab.id === id && tab.implemented))
  const navigationButton = (collapsed ? pageButton.replace('px-3', 'px-1') + 'text-center ' : pageButton) + (isMac ? 'rounded-lg ' : '')
  const activeWorkspace = workspaceFor(activeTab)
  useEffect(() => {
    if (activeWorkspace && activeTab !== FOCUS_DASHBOARD_TAB_ID) remembered.current.set(activeWorkspace.id, activeTab)
  }, [activeTab, activeWorkspace])

  return (
    <aside aria-label="Workspace sidebar" className={`workspace-sidebar flex shrink-0 flex-col gap-4 overflow-y-auto border-r border-border ${isMac ? 'bg-[#101722] px-3 py-5' : 'bg-surface px-2 py-4'} ${collapsed ? 'w-16' : isMac ? 'w-52' : 'w-48'}`}>
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
            const target = pages.find((tab) => tab.id === FOCUS_DASHBOARD_TAB_ID) ??
              pages.find((tab) => tab.id === rememberedId) ?? pages[0]
            const active = workspace.id === activeWorkspace?.id
            const unread = target.id === 'notifications' && unreadNotifications > 0
            return (
              <button key={workspace.id} type="button" aria-current={active ? 'page' : undefined}
                aria-label={workspace.label}
                aria-description={unread ? `${unreadNotifications} unread` : undefined}
                title={unread ? `Notifications · ${unreadNotifications} unread` : collapsed ? workspace.label : undefined}
                onClick={() => onSelectTab(target.id)}
                className={`${navigationButton}relative flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-2 ${active ? selectedStyle : idleStyle}`}>
                {collapsed ? <NavigationIcon id={workspace.id} workspace /> : <span>{workspace.label}</span>}
                {!collapsed && unread ? <span className="num text-accent-hover">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span> : null}
                {collapsed && unread ? <span className="absolute right-2 top-1.5 size-1.5 rounded-full bg-accent-hover" aria-hidden="true" /> : null}
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
            const shortcut = favoriteShortcuts.indexOf(id)
            const keys = shortcut >= 0 ? `${isMac ? '⌘' : 'Ctrl+'}${shortcut + 1}` : ''
            return tab ? [<button key={id} type="button" onClick={() => onSelectTab(id)}
              aria-label={tab.label} aria-keyshortcuts={keys ? (isMac ? `Meta+${shortcut + 1}` : `Control+${shortcut + 1}`) : undefined}
              title={collapsed ? (keys ? `${tab.label} (${keys})` : tab.label) : keys || undefined}
              aria-current={id === activeTab ? 'page' : undefined}
              className={navigationButton + (id === activeTab ? selectedStyle : idleStyle)}>{collapsed ? <NavigationIcon id={id} /> : tab.label}</button>] : []
          })}
        </nav>
        {!collapsed && !favorites.some((id) => tabs.some((tab) => tab.id === id && tab.implemented)) ? (
          <p className="px-3 text-2xs text-text-dim">Star a page to pin it here.</p>
        ) : null}
      </div>
      {!collapsed ? <div ref={recentArea} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <p className={`px-3 pb-2 text-2xs text-text-dim ${recentFit && recentPages.length ? '' : 'invisible'}`}>Recently viewed</p>
        <nav aria-label="Recent pages" className="flex flex-col gap-1">
          {recentPages.slice(0, recentFit).flatMap((id) => {
            const tab = tabs.find((entry) => entry.id === id)
            return tab ? [<button key={id} type="button" onClick={() => onSelectTab(id)}
              className={pageButton + idleStyle}>{tab.label}</button>] : []
          })}
        </nav>
      </div> : null}
      <button type="button" onClick={() => onSelectTab(SETTINGS_TAB_ID)}
        aria-label="Settings" title={collapsed ? 'Settings' : undefined}
        aria-current={activeTab === SETTINGS_TAB_ID ? 'page' : undefined}
        className={`${navigationButton}mt-auto shrink-0 ${activeTab === SETTINGS_TAB_ID ? selectedStyle : idleStyle}`}>{collapsed ? <NavigationIcon id={SETTINGS_TAB_ID} /> : 'Settings'}</button>
    </aside>
  )
}

export function WorkspaceHeader({ tabs, activeTab, onSelectTab, favorite, onToggleFavorite, saving, isMac, mobile = false }: NavigationProps & {
  favorite: boolean
  onToggleFavorite: () => void
  saving: boolean
  mobile?: boolean
}) {
  const workspace = workspaceFor(activeTab)
  const page = tabs.find((tab) => tab.id === activeTab)
  const pages = tabs.filter((tab) => workspace?.pages.includes(tab.id))
  const focusLanding = activeTab === FOCUS_DASHBOARD_TAB_ID
  const hasFocusDashboard = workspace === FOCUS_WORKSPACE && pages.some(tab => tab.id === FOCUS_DASHBOARD_TAB_ID && tab.implemented)
  const activePageButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (mobile) activePageButton.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTab, mobile])

  const focusBack = hasFocusDashboard && !focusLanding ? (
    <button type="button" onClick={() => onSelectTab(FOCUS_DASHBOARD_TAB_ID)}
      className="no-drag rounded text-2xs text-text-muted hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-accent-hover">
      <span aria-hidden="true">← </span>Focus Dashboard
    </button>
  ) : null
  const pageLinks = (mobile ? pages.length > 1 : pages.length > 0) && !hasFocusDashboard ? (
    <nav aria-label="Workspace pages" className="workspace-pages mt-2 flex flex-wrap gap-1">
      {pages.map((tab) => <button key={tab.id} type="button" disabled={!tab.implemented}
        ref={mobile && tab.id === activeTab ? activePageButton : undefined}
        aria-current={tab.id === activeTab ? 'page' : undefined} onClick={() => onSelectTab(tab.id)}
        className={pageButton + (isMac ? 'rounded-lg ' : '') + (tab.id === activeTab ? selectedStyle : idleStyle)}>{tab.label}</button>)}
    </nav>
  ) : null

  if (mobile) return focusBack || pageLinks ? <div className="mobile-workspace-nav">{focusBack ?? pageLinks}</div> : null

  return (
    <header className={`workspace-header shrink-0 border-b border-border bg-surface px-4 pt-3 pb-2 ${isMac ? 'px-5 pt-4 pb-3' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="workspace-heading flex min-w-0 items-baseline gap-3">
          {focusBack ?? (!focusLanding ? <span className="text-2xs text-text-muted">{workspace?.label ?? 'Preferences'} /</span> : null)}
          <h1 className={`font-semibold text-text ${focusLanding ? 'text-2xl tracking-tight' : 'text-sm'}`}>{page?.label}</h1>
        </div>
        {workspace ? <button type="button" onClick={onToggleFavorite} disabled={saving}
          aria-pressed={favorite} aria-label={favorite ? 'Remove page from favorites' : 'Add page to favorites'}
          className={`shrink-0 border border-border-strong px-2 py-1 text-2xs text-text-muted hover:bg-surface-hover disabled:opacity-50 ${isMac ? 'rounded-lg bg-surface-raised' : 'rounded'}`}>
          {favorite ? '★ Favorited' : '☆ Favorite'}
        </button> : null}
      </div>
      {pageLinks}
    </header>
  )
}
