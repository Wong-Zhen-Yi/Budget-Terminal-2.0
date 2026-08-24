import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { SETTINGS_TAB_ID, TABS } from '@shared/contract'
import { useReloadAll } from '@/api/queries'
import { useSettings } from '@/api/settingsQueries'
import { StatusBar, type PanelStatus } from '@/components/chrome/StatusBar'
import { TabBar } from '@/components/chrome/TabBar'
import { TabPicker } from '@/components/chrome/TabPicker'
import { isTextEntry } from '@/lib/shortcuts'
import { DashboardPage } from '@/pages/DashboardPage'
import { GlobalPage } from '@/pages/GlobalPage'
import { PersonalFinancePage } from '@/pages/PersonalFinancePage'
import { PortfolioPage } from '@/pages/PortfolioPage'
import { NewsPage } from '@/pages/NewsPage'
import { PreMarketPage } from '@/pages/PreMarketPage'
import { TradingVolumesPage } from '@/pages/TradingVolumesPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { useDataHealth } from '@/stores/dataHealth'

const TAB_BY_ID = new Map(TABS.map((tab) => [tab.id, tab]))

export function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [panels, setPanels] = useState<PanelStatus[]>([])
  const [sourcePath, setSourcePath] = useState('')
  const [reloading, setReloading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  /** Obscure is a session state, like the reference's `_privacy_obscured`, but it starts on. */
  const [obscured, setObscured] = useState(true)
  const [notice, setNotice] = useState('')
  const reloadAll = useReloadAll()

  const settingsQuery = useSettings()
  const settings = settingsQuery.data?.data
  const record = useDataHealth((state) => state.record)

  /** The tab strip: Settings' order, minus what Settings hides. */
  const visibleTabs = useMemo(() => {
    const order = settings?.tabOrder ?? TABS.map((tab) => tab.id)
    const hidden = new Set(settings?.hiddenTabs ?? [])
    return order.flatMap((id) => {
      const tab = TAB_BY_ID.get(id)
      return tab && !hidden.has(id) ? [tab] : []
    })
  }, [settings])

  // Hiding the page you are standing on has to move you somewhere that still exists.
  useEffect(() => {
    if (visibleTabs.some((tab) => tab.id === activeTab)) return
    const fallback = visibleTabs.find((tab) => tab.implemented) ?? visibleTabs[0]
    if (fallback) setActiveTab(fallback.id)
  }, [visibleTabs, activeTab])

  // A shell notice describes what just happened on the page it happened on; leaving it
  // up after a tab switch would mask that page's own health line.
  useEffect(() => setNotice(''), [activeTab])

  // The status callback is handed to every page, so it has to keep one identity; the
  // active tab it labels health records with is read through a ref instead of a closure.
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  const handleStatusChange = useCallback(
    (next: PanelStatus[], path: string) => {
      setPanels(next)
      setSourcePath(path)
      record(activeTabRef.current, next)
    },
    [record],
  )

  const reload = useCallback(async () => {
    setReloading(true)
    try {
      await reloadAll()
    } finally {
      setReloading(false)
    }
  }, [reloadAll])

  /** `_step_main_tab`: forward or back through the visible tabs, wrapping at both ends. */
  const stepTab = useCallback(
    (direction: -1 | 1) => {
      if (!visibleTabs.length) return
      const current = visibleTabs.findIndex((tab) => tab.id === activeTabRef.current)
      const next = current < 0 ? 0 : (current + direction + visibleTabs.length) % visibleTabs.length
      setActiveTab(visibleTabs[next].id)
    },
    [visibleTabs],
  )

  const toggleObscure = useCallback(() => {
    const targets = settings?.obscuredTabs ?? []
    setObscured((was) => {
      const now = !was
      if (!now) setNotice('Configured pages are visible.')
      else if (!targets.length) setNotice('Obscure is active, but no pages are selected in Settings.')
      else setNotice(`${targets.length} configured page(s) are obscured.`)
      return now
    })
  }, [settings])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+Tab cycles regardless of what has focus, but not over the open picker.
      if (event.key === 'Tab' && event.ctrlKey && !event.altKey) {
        if (pickerOpen) return
        event.preventDefault()
        stepTab(event.shiftKey ? -1 : 1)
        return
      }

      if (event.key === 'F5') {
        event.preventDefault()
        void reload()
        return
      }

      if (event.key === 'H' || event.key === 'h') {
        if (event.ctrlKey && event.shiftKey) {
          event.preventDefault()
          toggleObscure()
        }
        return
      }

      if (event.key === 'Escape') {
        if (pickerOpen) {
          event.preventDefault()
          setPickerOpen(false)
        } else if (isTextEntry(event.target)) {
          // Leave the field without changing pages, as `_dismiss_main_window_text_input`
          // does. The input's own Escape handler has already reverted its draft.
          ;(event.target as HTMLElement).blur()
        }
        return
      }

      if (event.ctrlKey || event.altKey || event.metaKey) return

      if (event.key === '`') {
        event.preventDefault()
        // Typing into a field first exits it, then opens the picker.
        if (isTextEntry(event.target)) (event.target as HTMLElement).blur()
        setPickerOpen((open) => !open)
        return
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (pickerOpen || isTextEntry(event.target)) return
        event.preventDefault()
        stepTab(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pickerOpen, reload, stepTab, toggleObscure])

  const hideCurrent = obscured && (settings?.obscuredTabs ?? []).includes(activeTab)

  return (
    <div className="flex h-full flex-col bg-bg">
      <TabBar
        tabs={visibleTabs}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onReload={() => void reload()}
        reloading={reloading}
        clockCountry={settings?.clockCountry ?? 'US'}
        time12h={settings?.time12h ?? true}
        obscured={obscured}
        onToggleObscure={toggleObscure}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Blurred and inert, matching the reference's blur effect plus `setEnabled(False)`. */}
        <div
          aria-hidden={hideCurrent}
          className={`flex min-h-0 flex-1 flex-col ${
            hideCurrent ? 'pointer-events-none blur-md select-none' : ''
          }`}
        >
          {activeTab === 'dashboard' ? (
            <DashboardPage onStatusChange={handleStatusChange} />
          ) : activeTab === 'global' ? (
            <GlobalPage onStatusChange={handleStatusChange} />
          ) : activeTab === 'portfolio' ? (
            <PortfolioPage onStatusChange={handleStatusChange} />
          ) : activeTab === 'personal-finance' ? (
            <PersonalFinancePage onStatusChange={handleStatusChange} />
          ) : activeTab === 'pre-market' ? (
            <PreMarketPage onStatusChange={handleStatusChange} />
          ) : activeTab === 'trading-volumes' ? (
            <TradingVolumesPage onStatusChange={handleStatusChange} />
          ) : activeTab === 'news' ? (
            <NewsPage onStatusChange={handleStatusChange} />
          ) : activeTab === SETTINGS_TAB_ID ? (
            <SettingsPage onStatusChange={handleStatusChange} />
          ) : (
            <PlaceholderPage tabId={activeTab} />
          )}
        </div>

        {hideCurrent ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="border border-border-strong bg-surface px-3 py-2 text-2xs text-text-muted">
              This page is obscured. Press Ctrl+Shift+H to reveal it.
            </p>
          </div>
        ) : null}
      </div>

      <StatusBar panels={panels} sourcePath={sourcePath} notice={notice} />

      {pickerOpen ? (
        <TabPicker
          tabs={visibleTabs.map((tab) => ({ ...tab }))}
          onSelect={(id) => {
            setPickerOpen(false)
            if (TAB_BY_ID.get(id)?.implemented) setActiveTab(id)
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  )
}

/** Every other page is still in the PySide6 app; this says so rather than showing blank. */
function PlaceholderPage({ tabId }: { tabId: string }) {
  const label = TABS.find((tab) => tab.id === tabId)?.label ?? tabId
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <p className="text-2xs text-text-dim">{label} has not been migrated yet.</p>
    </div>
  )
}

