import { ArticlesPage } from '@/pages/ArticlesPage'
import { BrowserPage } from '@/pages/BrowserPage'
import { AgentsPage } from '@/pages/AgentsPage'
import { useAgents, useAgentCommand } from '@/api/agentsQueries'
import { Sp500Page } from '@/pages/Sp500Page'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { SETTINGS_TAB_ID, TABS } from '@shared/contract'
import { DEFAULT_TAB_ID, WORKSPACES } from '@shared/navigation'
import { useWarmPages } from '@/api/prefetch'
import { useMcpScreenshot, useScreenshotReady } from '@/api/mcpScreenshot'
import { useReloadAll } from '@/api/queries'
import { useSettings, useSettingsMutation } from '@/api/settingsQueries'
import { PageCache } from '@/components/chrome/PageCache'
import { StatusBar, type PanelStatus } from '@/components/chrome/StatusBar'
import { TabBar } from '@/components/chrome/TabBar'
import { TabPicker } from '@/components/chrome/TabPicker'
import { WorkspaceHeader, WorkspaceSidebar } from '@/components/chrome/WorkspaceNavigation'
import { isTextEntry } from '@/lib/shortcuts'
import { DashboardPage } from '@/pages/DashboardPage'
import { BacktestPage } from '@/pages/BacktestPage'
import { CardsPage } from '@/pages/CardsPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { ChartsPage } from '@/pages/ChartsPage'
import { BitcoinPage } from '@/pages/BitcoinPage'
import { BmnrPage } from '@/pages/BmnrPage'
import { SofiPage } from '@/pages/SofiPage'
import { HoodPage } from '@/pages/HoodPage'
import { PltrPage } from '@/pages/PltrPage'
import { HimsPage } from '@/pages/HimsPage'
import { MuPage } from '@/pages/MuPage'
import { AmznPage } from '@/pages/AmznPage'
import { AvgoPage } from '@/pages/AvgoPage'
import { SemiconductorsPage } from '@/pages/SemiconductorsPage'
import { VstPage } from '@/pages/VstPage'
import { MoneyPage } from '@/pages/MoneyPage'
import { BondsPage } from '@/pages/BondsPage'
import { ForexPage } from '@/pages/ForexPage'
import { GoldPage } from '@/pages/GoldPage'
import { OilPage } from '@/pages/OilPage'
import { CryptoPage } from '@/pages/CryptoPage'
import { DictionaryPage } from '@/pages/DictionaryPage'
import { FundamentalsPage } from '@/pages/FundamentalsPage'
import { DefeatBetaPage } from '@/pages/DefeatBetaPage'
import { EtfPage } from '@/pages/EtfPage'
import { HeatmapPage } from '@/pages/HeatmapPage'
import { InstitutionsPage } from '@/pages/InstitutionsPage'
import { GlobalPage } from '@/pages/GlobalPage'
import { PersonalFinancePage } from '@/pages/PersonalFinancePage'
import { PortfolioPage } from '@/pages/PortfolioPage'
import { NewsPage } from '@/pages/NewsPage'
import { OptionsPage } from '@/pages/OptionsPage'
import { ProjectionsPage } from '@/pages/ProjectionsPage'
import { PreMarketPage } from '@/pages/PreMarketPage'
import { MarketCapPage } from '@/pages/MarketCapPage'
import { PricePage } from '@/pages/PricePage'
import { QuantPage } from '@/pages/QuantPage'
import { TechnicalScreenPage } from '@/pages/TechnicalScreenPage'
import { IpoPage } from '@/pages/IpoPage'
import { PoliticsPage } from '@/pages/PoliticsPage'
import { BetaPage } from '@/pages/BetaPage'
import { TradingVolumesPage } from '@/pages/TradingVolumesPage'
import { UpDownPage } from '@/pages/UpDownPage'
import { ValuationPage } from '@/pages/ValuationPage'
import { EconomicPage } from '@/pages/EconomicPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { StocksPage } from '@/pages/StocksPage'
import { StockDiscoveryPage } from '@/pages/StockDiscoveryPage'
import { YouTubePage } from '@/pages/YouTubePage'
import { useDataHealth } from '@/stores/dataHealth'
import { useChartsStore } from '@/stores/charts'
import { useFundamentalsStore } from '@/stores/fundamentals'
import { useOptionsPage } from '@/stores/options'
import { useStocksPage } from '@/stores/stocks'
import { useValuationPage } from '@/stores/valuation'
import { useNavigation } from '@/stores/navigation'

const TAB_BY_ID = new Map(TABS.map((tab) => [tab.id, tab]))

export function App() {
  const isMac = window.api.platform === 'darwin'
  const [selectedTab, setActiveTab] = useState(DEFAULT_TAB_ID)
  const { command: screenshot, complete: completeScreenshot } = useMcpScreenshot()
  const screenshotPage = screenshot?.page ?? null
  const activeTab = screenshotPage ?? selectedTab
  const recent = useNavigation((state) => state.recent)
  const visit = useNavigation((state) => state.visit)
  useEffect(() => visit(selectedTab), [selectedTab, visit])
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
  const mutateSettings = useSettingsMutation()
  const [savingFavorite, setSavingFavorite] = useState(false)
  const [savingSidebar, setSavingSidebar] = useState(false)
  const toggleSidebar = async () => {
    if (savingSidebar || !settings) return
    setSavingSidebar(true)
    try {
      const result = await mutateSettings({ type: 'setSidebarCollapsed', value: !settings.sidebarCollapsed })
      if (result.errors.length) setNotice(result.errors.map((error) => error.reason).join(' · '))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save sidebar preference.')
    } finally {
      setSavingSidebar(false)
    }
  }
  const favorites = settings?.favoriteTabs ?? []
  const toggleFavorite = useCallback(async () => {
    if (savingFavorite || !settings) return
    setSavingFavorite(true)
    try {
      const result = await mutateSettings({ type: 'setTabFavorite', id: activeTab, favorite: !favorites.includes(activeTab) })
      if (result.errors.length) setNotice(result.errors.map((error) => error.reason).join(' · '))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save favorite.')
    } finally {
      setSavingFavorite(false)
    }
  }, [savingFavorite, settings, mutateSettings, activeTab, favorites])
  const record = useDataHealth((state) => state.record)
  // Start every page's automatic initial load after local settings and holdings settle.
  const warm = useWarmPages(settings, !settingsQuery.isPending, selectedTab, recent,
    settingsQuery.error ?? (settingsQuery.data?.meta.freshness === 'failed' ? settingsQuery.data.meta.failureReason || 'Settings could not load' : undefined))
  const hideCurrent = obscured && (settings?.obscuredTabs ?? []).includes(activeTab)
  useScreenshotReady(screenshot, activeTab, hideCurrent, warm.active, completeScreenshot)
  const setFundamentalsSymbol = useFundamentalsStore((state) => state.setSymbol)
  const setOptionsSymbol = useOptionsPage((state) => state.setSymbol)

  /** The tab strip: Settings' order, minus what Settings hides. */
  const visibleTabs = useMemo(() => {
    const order = settings?.tabOrder ?? TABS.map((tab) => tab.id)
    const hidden = new Set(settings?.hiddenTabs ?? [])
    return order.flatMap((id) => {
      const tab = TAB_BY_ID.get(id)
      return tab && (!hidden.has(id) || screenshotPage === id) ? [tab] : []
    })
  }, [settings, screenshotPage])

  // Hiding the page you are standing on has to move you somewhere that still exists.
  useEffect(() => {
    if (screenshotPage || visibleTabs.some((tab) => tab.id === activeTab)) return
    const fallback = visibleTabs.find((tab) => tab.implemented) ?? visibleTabs[0]
    if (fallback) setActiveTab(fallback.id)
  }, [visibleTabs, activeTab, screenshotPage])

  // A shell notice describes what just happened on the page it happened on; leaving it
  // up after a tab switch would mask that page's own health line.
  useEffect(() => setNotice(''), [activeTab])

  // The status callback is handed to every page, so it has to keep one identity; the
  // active tab it labels health records with is read through a ref instead of a closure.
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  /**
   * One status callback per tab, cached so each page sees a stable identity — several
   * pages hold it in an effect's dependency list.
   *
   * The tab id is bound rather than read off `activeTabRef`, because a kept-alive page
   * reports are recorded under their own page. Only the active page can update the
   * footer; a hidden page must not overwrite the current page's status.
   */
  const statusHandlers = useRef(new Map<string, (next: PanelStatus[], path: string) => void>())
  // Read through a ref rather than closed over: the handlers are cached for the life of
  // the session, so a cached one would go on calling whichever `record` existed when it
  // was first created.
  const recordRef = useRef(record)
  recordRef.current = record
  const statusFor = useCallback((tabId: string) => {
    const cached = statusHandlers.current.get(tabId)
    if (cached) return cached
    const handler = (next: PanelStatus[], path: string) => {
      recordRef.current(tabId, next)
      if (activeTabRef.current !== tabId) return
      setPanels(next)
      setSourcePath(path)
    }
    statusHandlers.current.set(tabId, handler)
    return handler
  }, [])

  const setChartsSymbol = useChartsStore((state) => state.setSymbol)
  const setStocksSymbol = useStocksPage((state) => state.setSymbol)

  /**
   * A page handing a symbol to another page. Stocks uses it for Fundamentals and Options;
   * the Heatmap's double-click uses the Charts branch, as `_p17_open_symbol_in_charts`
   * does — set the target page's symbol first, then switch, so it mounts already loading
   * the right ticker.
   */
  const handleStocksNavigate = useCallback((tabId: string, symbol?: string) => {
    if (!visibleTabs.some((tab) => tab.id === tabId)) {
      setNotice('This page is hidden. Show it in Settings to open it.')
      return
    }
    if (symbol) useNavigation.getState().setSymbol(symbol)
    if (tabId === 'stocks' && symbol) setStocksSymbol(symbol)
    if (tabId === 'fundamentals' && symbol) setFundamentalsSymbol(symbol)
    if (tabId === 'options' && symbol) {
      setOptionsSymbol(symbol)
      useOptionsPage.getState().setTab('chain')
      useOptionsPage.getState().setLoaded(true)
    }
    if (tabId === 'charts' && symbol) setChartsSymbol(symbol)
    if (tabId === 'valuation' && symbol) useValuationPage.getState().setTicker(symbol)
    setActiveTab(tabId)
  }, [setStocksSymbol, setFundamentalsSymbol, setOptionsSymbol, setChartsSymbol, visibleTabs])

  // Keep agent navigation active even when its page is not mounted.
  const agents = useAgents(true)
  const agentCommand = useAgentCommand()
  const handledNavigation = useRef('')
  useEffect(() => {
    const navigation = agents.data?.data.navigation
    if (!navigation || handledNavigation.current === navigation.id) return
    handledNavigation.current = navigation.id
    const available = visibleTabs.some(tab => tab.id === navigation.page)
    if (available) handleStocksNavigate(navigation.page, navigation.symbol)
    void agentCommand({ type: 'navigationResult', id: navigation.id,
      error: available ? undefined : 'This page is hidden. Show it in Settings to open it.' }).catch(error => setNotice(String(error)))
  }, [agents.data, visibleTabs, handleStocksNavigate, agentCommand])

  const reload = useCallback(async () => {
    setReloading(true)
    try {
      await reloadAll()
    } finally {
      setReloading(false)
    }
  }, [reloadAll])

  const workspaceTabs = useMemo(() => [
    ...WORKSPACES.flatMap((workspace) =>
      visibleTabs.filter((tab) => tab.implemented && workspace.pages.includes(tab.id)),
    ),
    ...visibleTabs.filter((tab) => tab.implemented && tab.id === SETTINGS_TAB_ID),
  ], [visibleTabs])

  /** Step through visible pages, wrapping at both ends. */
  const stepTab = useCallback(
    (direction: -1 | 1, tabs = visibleTabs) => {
      if (!tabs.length) return
      const current = tabs.findIndex((tab) => tab.id === activeTabRef.current)
      const next = current < 0 ? 0 : (current + direction + tabs.length) % tabs.length
      setActiveTab(tabs[next].id)
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPickerOpen((open) => !open)
        return
      }

      // Ctrl+Tab cycles regardless of what has focus, but not over the open picker.
      if (event.key === 'Tab' && event.ctrlKey && !event.altKey) {
        if (pickerOpen) return
        event.preventDefault()
        stepTab(event.shiftKey ? -1 : 1, workspaceTabs)
        return
      }

      if (event.key === 'F5' || (isMac && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'r')) {
        event.preventDefault()
        void reload()
        return
      }

      if (event.key === 'H' || event.key === 'h') {
        if ((event.ctrlKey || (isMac && event.metaKey)) && event.shiftKey) {
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
  }, [isMac, pickerOpen, reload, stepTab, toggleObscure, workspaceTabs])

  const visibleIds = useMemo(() => visibleTabs.map((tab) => tab.id), [visibleTabs])
  const renderCachedPage = useCallback((tabId: string) => renderPage({
    tabId,
    active: tabId === activeTab && !hideCurrent && !pickerOpen,
    onStatusChange: statusFor(tabId),
    onNavigate: handleStocksNavigate,
    onSelectTab: setActiveTab,
    agentFavorite: favorites.includes('agents'),
    savingFavorite: savingFavorite || !settings,
    onToggleFavorite: toggleFavorite,
  }), [statusFor, handleStocksNavigate, activeTab, hideCurrent, pickerOpen, favorites, savingFavorite, settings, toggleFavorite])

  return (
    <div className={`terminal-shell flex h-full flex-col bg-bg ${isMac ? 'platform-mac' : ''}`}>
      <TabBar
        onOpenPicker={() => setPickerOpen(true)}
        onReload={() => void reload()}
        reloading={reloading}
        clockCountry={settings?.clockCountry ?? 'US'}
        time12h={settings?.time12h ?? true}
        obscured={obscured}
        onToggleObscure={toggleObscure}
        agentChatAvailable={!screenshotPage && !pickerOpen && !(obscured && (settings?.obscuredTabs ?? []).includes('agents'))}
      />

      {!screenshotPage && agents.data?.data.notifications?.some(notification => !notification.read) && (
        <div role="status" className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-4 py-1 text-2xs text-text-muted">
          <button onClick={() => handleStocksNavigate('agents')}>Agents · {agents.data.data.notifications.filter(notification => !notification.read).length} unread notifications</button>
          <button onClick={() => void agentCommand({ type: 'readNotifications' }).catch(error => setNotice(String(error)))}>Mark all read</button>
        </div>
      )}
      <div className="terminal-workspace flex min-h-0 flex-1">
        <WorkspaceSidebar
          tabs={visibleTabs} activeTab={activeTab} onSelectTab={setActiveTab} favorites={favorites} recent={recent}
          collapsed={settings?.sidebarCollapsed ?? false} onToggleCollapsed={() => void toggleSidebar()}
          isMac={isMac}
          saving={savingSidebar || !settings}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeTab !== 'agents' && <WorkspaceHeader tabs={visibleTabs} activeTab={activeTab} onSelectTab={setActiveTab}
            isMac={isMac}
            favorite={favorites.includes(activeTab)} onToggleFavorite={() => void toggleFavorite()}
            saving={savingFavorite || !settings} />}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* Blurred and inert, matching the reference's blur effect plus `setEnabled(False)`. */}
            <div
              aria-hidden={hideCurrent}
              className={`flex min-h-0 flex-1 flex-col ${
                hideCurrent ? 'pointer-events-none blur-md select-none' : ''
              }`}
            >
              <PageCache activeTab={activeTab} retainedTab={screenshotPage ? selectedTab : undefined} visibleIds={visibleIds} renderPage={renderCachedPage} />
            </div>

            {hideCurrent ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="border border-border-strong bg-surface px-3 py-2 text-2xs text-text-muted">
                  This page is obscured. Press {isMac ? '⌘⇧H' : 'Ctrl+Shift+H'} to reveal it.
                </p>
              </div>
            ) : null}
          </div>

        </div>
      </div>

      <StatusBar
        panels={panels}
        sourcePath={sourcePath}
        notice={notice}
        warming={
          warm.active
            ? `Loading pages (${warm.done}/${warm.total} complete): ${warm.label}...${warm.failed ? ` · ${warm.failed} failed` : ''}${warm.degraded ? ` · ${warm.degraded} incomplete` : ''}`
            : warm.failed || warm.degraded ? `${warm.failed} startup load(s) failed · ${warm.degraded} incomplete. Open Settings for details.` : ''
        }
      />

      {pickerOpen && !screenshotPage ? (
        <TabPicker
          tabs={visibleTabs.map((tab) => ({ ...tab }))}
          recent={recent}
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

/** Defensive fallback for an unknown page id. */
function PlaceholderPage({ tabId }: { tabId: string }) {
  const label = TABS.find((tab) => tab.id === tabId)?.label ?? tabId
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <p className="text-2xs text-text-dim">{label} is unavailable.</p>
    </div>
  )
}

/**
 * One page, by tab id. Lifted out of `App` so the keep-alive host can render the same
 * chain for a hidden page as for the one on screen.
 */
function renderPage({
  tabId,
  active,
  onStatusChange,
  onNavigate,
  onSelectTab,
  agentFavorite,
  savingFavorite,
  onToggleFavorite,
}: {
  tabId: string
  active: boolean
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
  onSelectTab: (tabId: string) => void
  agentFavorite: boolean
  savingFavorite: boolean
  onToggleFavorite: () => void
}) {
  return (
    tabId === 'agents' ? (
      <AgentsPage onStatusChange={onStatusChange} favorite={agentFavorite} savingFavorite={savingFavorite} onToggleFavorite={onToggleFavorite} />
    ) : tabId === 'browser' ? (
      <BrowserPage active={active} onStatusChange={onStatusChange} />
    ) : tabId === 'articles' ? (
      <ArticlesPage onStatusChange={onStatusChange} />
    ) : tabId === 'dashboard' || tabId === 'dashboard-2' ? (
      <DashboardPage onStatusChange={onStatusChange} newsFocused={tabId === 'dashboard-2'} />
    ) : tabId === 'global' ? (
      <GlobalPage onStatusChange={onStatusChange} />
    ) : tabId === 'portfolio' ? (
      <PortfolioPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'cards' ? (
      <CardsPage onStatusChange={onStatusChange} onNavigate={onSelectTab} />
    ) : tabId === 'personal-finance' ? (
      <PersonalFinancePage onStatusChange={onStatusChange} />
    ) : tabId === 'pre-market' ? (
      <PreMarketPage onStatusChange={onStatusChange} />
    ) : tabId === 'up-down' ? (
      <UpDownPage onStatusChange={onStatusChange} />
    ) : tabId === 'trading-volumes' ? (
      <TradingVolumesPage onStatusChange={onStatusChange} />
    ) : tabId === 'beta' ? (
      <BetaPage onStatusChange={onStatusChange} />
    ) : tabId === 'market-cap' ? (
      <MarketCapPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'price' ? (
      <PricePage onStatusChange={onStatusChange} />
    ) : tabId === 'news' ? (
      <NewsPage onStatusChange={onStatusChange} />
    ) : tabId === 'calendar' ? (
      <CalendarPage onStatusChange={onStatusChange} />
    ) : tabId === 'heatmap' ? (
      <HeatmapPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'etf' ? (
      <EtfPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'forex' ? (
      <ForexPage onStatusChange={onStatusChange} />
    ) : tabId === 'crypto' ? (
      <CryptoPage onStatusChange={onStatusChange} />
    ) : tabId === 'bitcoin' ? (
      <BitcoinPage onStatusChange={onStatusChange} />
    ) : tabId === 'bmnr' ? (
      <BmnrPage onStatusChange={onStatusChange} />
    ) : tabId === 'sofi' ? (
      <SofiPage onStatusChange={onStatusChange} />
    ) : tabId === 'vst' ? (
      <VstPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'avgo' ? (
      <AvgoPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'semiconductors' ? (
      <SemiconductorsPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'mu' ? (
      <MuPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'amzn' ? (
      <AmznPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'hims' ? (
      <HimsPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'hood' ? (
      <HoodPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'pltr' ? (
      <PltrPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'sp500' ? (
      <Sp500Page onStatusChange={onStatusChange} />
    ) : tabId === 'gold' ? (
      <GoldPage onStatusChange={onStatusChange} />
    ) : tabId === 'oil' ? (
      <OilPage onStatusChange={onStatusChange} />
    ) : tabId === 'dictionary' ? (
      <DictionaryPage onStatusChange={onStatusChange} />
    ) : tabId === 'money' ? (
      <MoneyPage onStatusChange={onStatusChange} />
    ) : tabId === 'bonds' ? (
      <BondsPage onStatusChange={onStatusChange} />
    ) : tabId === 'charts' ? (
      <ChartsPage onStatusChange={onStatusChange} />
    ) : tabId === 'stocks' ? (
      <StocksPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'stock-discovery' ? (
      <StockDiscoveryPage active={active} onStatusChange={onStatusChange} />
    ) : tabId === 'fundamentals' ? (
      <FundamentalsPage onStatusChange={onStatusChange} />
    ) : tabId === 'defeatbeta' ? (
      <DefeatBetaPage active={active} onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'valuation' ? (
      <ValuationPage onStatusChange={onStatusChange} />
    ) : tabId === 'economic' ? (
      <EconomicPage onStatusChange={onStatusChange} />
    ) : tabId === 'options' ? (
      <OptionsPage onStatusChange={onStatusChange} />
    ) : tabId === 'projections' ? (
      <ProjectionsPage onStatusChange={onStatusChange} />
    ) : tabId === 'ipo' ? (
      <IpoPage onStatusChange={onStatusChange} />
    ) : tabId === 'politics' ? (
      <PoliticsPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'backtest' ? (
      <BacktestPage onStatusChange={onStatusChange} />
    ) : tabId === 'quant' ? (
      <QuantPage onStatusChange={onStatusChange} />
    ) : tabId === 'technical-screen' ? (
      <TechnicalScreenPage onStatusChange={onStatusChange} onNavigate={onNavigate} />
    ) : tabId === 'youtube' ? (
      <YouTubePage onStatusChange={onStatusChange} />
    ) : tabId === 'institutions' ? (
      <InstitutionsPage onStatusChange={onStatusChange} />
    ) : tabId === SETTINGS_TAB_ID ? (
      <SettingsPage onStatusChange={onStatusChange} />
    ) : (
      <PlaceholderPage tabId={tabId} />
    )
  )
}
