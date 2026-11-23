import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { AppSettings, AppSettingsMutation, LabFeatureId, MaintenanceAction } from '@shared/contract'
import { DEFAULT_CLOCK_COUNTRY, LAB_FEATURES, SETTINGS_TAB_ID, TABS } from '@shared/contract'
import { isLabPageEnabled } from '@shared/navigation'
import { DEFAULT_BACKTEST_PAGE_SETTINGS } from '@shared/backtest'
import { DEFAULT_QUANT_PAGE_SETTINGS } from '@shared/quant'
import { DEFAULT_YOUTUBE_PAGE_SETTINGS } from '@shared/youtube'
import { usePortfolio } from '@/api/queries'
import { useMaintenance, useSettings, useSettingsMutation } from '@/api/settingsQueries'
import { api } from '@/api/client'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { ControllerControls } from '@/components/settings/ControllerControls'
import { ClockPanel } from '@/components/settings/ClockPanel'
import { DataHealthPanel } from '@/components/settings/DataHealthPanel'
import { NavigationPanel, type NavigationTab } from '@/components/settings/NavigationPanel'
import { PageLoadOrderPanel } from '@/components/settings/PageLoadOrderPanel'
import { PrivacyPanel } from '@/components/settings/PrivacyPanel'
import { ShortcutsPanel } from '@/components/settings/ShortcutsPanel'
import { UserDataPanel } from '@/components/settings/UserDataPanel'
import { ApiUsagePanel } from '@/components/settings/ApiUsagePanel'
import { CachePanel } from '@/components/settings/CachePanel'
import { McpPanel } from '@/components/settings/McpPanel'
import { MarketApiKeysPanel } from '@/components/settings/MarketApiKeysPanel'
import { CloudSyncPanel } from '@/components/settings/CloudSyncPanel'
import { DiagnosticLogsPanel } from '@/components/settings/DiagnosticLogsPanel'
import { MobileAccessPanel } from '@/components/settings/MobileAccessPanel'
import { downloadMobileBackup, isMobileTerminal } from '@/mobile/client'
import { useSettingsNavigation } from '@/stores/settingsNavigation'
import { AppDashboard } from '@/components/settings/AppDashboard'
import { Panel } from '@/components/ui/Panel'
import '@/styles/settings.css'

const categories = [
  { id: 'dashboard', label: 'App dashboard' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'controller', label: 'Controller controls' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'data', label: 'Data & storage' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'labs', label: 'Labs' },
  { id: 'diagnostics', label: 'Diagnostics' },
] as const
type Category = (typeof categories)[number]['id']
const searchDestinations = [
  { id: 'dashboard', label: 'App dashboard', terms: 'check for updates app version startup status app metrics' },
  { id: 'controller', label: 'Controller controls', terms: 'gamepad steam deck playstation xbox button mapping input test controller shortcuts' },
] as const
const logSearchTerms = 'application diagnostic logs events search severity area session export folder pause live'
const mobileAccessTerms = 'mobile access launch window viewport model ipad iphone tailscale tailnet magicdns telegram private link ios safari'

interface SettingsCard {
  id: string
  category: Category
  terms: string
  content: ReactNode
  column?: 'secondary'
}

const TAB_BY_ID = new Map(TABS.map((tab) => [tab.id, tab]))

const fallbackSettings: AppSettings = {
  clockCountry: DEFAULT_CLOCK_COUNTRY,
  time12h: true,
  tabOrder: TABS.map((tab) => tab.id),
  hiddenTabs: [],
  enabledLabs: [],
  favoriteTabs: [],
  sidebarCollapsed: false,
  obscuredTabs: [],
  backtestPage: DEFAULT_BACKTEST_PAGE_SETTINGS,
  signalsPage: { filter: 'all', setup: 'all', search: '' },
  quantPage: DEFAULT_QUANT_PAGE_SETTINGS,
  youtubePage: DEFAULT_YOUTUBE_PAGE_SETTINGS,
  sourcePath: '',
}

type StatusTone = 'muted' | 'positive' | 'negative'

/** All panels stay mounted when filtering, so diagnostics and prepared data keep updating. */
export function SettingsPage({
  active,
  onStatusChange,
}: {
  active: boolean
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const mobile = isMobileTerminal()
  const settingsQuery = useSettings()
  const mutate = useSettingsMutation()
  const runMaintenance = useMaintenance()
  // Only for the store path the User Data panel names; the query is already cached by
  // whichever page loaded it first.
  const portfolioQuery = usePortfolio()
  const holdingsPath = portfolioQuery.data?.data.sourcePath ?? ''

  const settings = settingsQuery.data?.data ?? fallbackSettings
  const [status, setStatus] = useState<{ text: string; tone: StatusTone }>({
    text: '',
    tone: 'muted',
  })
  const [busy, setBusy] = useState<MaintenanceAction | null>(null)
  const [savingLab, setSavingLab] = useState<LabFeatureId | null>(null)
  const [category, setCategory] = useState<Category>(mobile ? 'workspace' : 'dashboard')
  const [search, setSearch] = useState('')
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'failed'>('idle')
  const [downloading, setDownloading] = useState(false)
  const downloadBackup = async () => {
    setDownloading(true)
    try {
      await downloadMobileBackup()
      setStatus({ text: 'Backup downloaded.', tone: 'positive' })
    } catch {
      setStatus({ text: 'Could not download the backup. Please try again.', tone: 'negative' })
    } finally { setDownloading(false) }
  }
  const checkForUpdates = async () => {
    setUpdateState('checking')
    try {
      await api.checkForUpdates()
      setUpdateState('idle')
    } catch {
      setUpdateState('failed')
    }
  }
  const diagnosticsRequest = useSettingsNavigation(state => state.diagnosticsRequest)
  useEffect(() => {
    if (!diagnosticsRequest) return
    setCategory('diagnostics')
    setSearch('')
    scrollRef.current?.scrollTo({ top: 0 })
  }, [diagnosticsRequest])
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const updateSearch = (value: string) => {
    setSearch(value)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  const clearSearch = () => {
    updateSearch('')
    searchRef.current?.focus()
  }

  const chooseCategory = (next: Category) => {
    setCategory(next)
    updateSearch('')
  }

  useEffect(() => {
    onStatusChange(
      [
        {
          label: 'Settings',
          envelope: settingsQuery.data, error: settingsQuery.error, enabled: settingsQuery.isEnabled,
          loading: settingsQuery.isLoading,
        },
      ],
      settings.sourcePath,
    )
  }, [onStatusChange, settingsQuery.data, settingsQuery.error, settingsQuery.isEnabled, settingsQuery.isLoading, settings.sourcePath])

  /** Every control writes the same way: apply, then report what the store came back with. */
  const write = useCallback(
    async (mutation: AppSettingsMutation, done: string) => {
      try {
        const result = await mutate(mutation)
        const reason = result.meta.failureReason
        setStatus(reason ? { text: reason, tone: 'negative' } : { text: done, tone: 'positive' })
      } catch {
        setStatus({ text: 'Unable to save this setting. Please try again.', tone: 'negative' })
      }
    },
    [mutate],
  )

  const orderedTabs = useMemo<NavigationTab[]>(
    () =>
      settings.tabOrder
        .filter(id => isLabPageEnabled(id, settings.enabledLabs))
        .map((id) => TAB_BY_ID.get(id))
        .filter((tab): tab is (typeof TABS)[number] => Boolean(tab))
        .map((tab) => ({ id: tab.id, label: tab.label, implemented: tab.implemented })),
    [settings.tabOrder, settings.enabledLabs],
  )

  const privacyTabs = useMemo(
    () => orderedTabs.filter((tab) => tab.implemented && tab.id !== SETTINGS_TAB_ID),
    [orderedTabs],
  )

  const onRunMaintenance = useCallback(
    async (action: MaintenanceAction) => {
      setBusy(action)
      setStatus({ text: 'Working...', tone: 'muted' })
      try {
        const result = await runMaintenance(action)
        setStatus({
          text: result.meta.failureReason ?? result.data.message,
          tone: result.meta.failureReason ? 'negative' : result.data.performed ? 'positive' : 'muted',
        })
      } catch {
        setStatus({ text: 'The action could not complete. Please try again.', tone: 'negative' })
      } finally {
        setBusy(null)
      }
    },
    [runMaintenance],
  )

  const searching = search.trim().length > 0
  const terms = search.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const matchesSearch = (value: string) => {
    const index = value.toLowerCase()
    return terms.length > 0 && terms.every(term => index.includes(term))
  }
  const matches = (card: Pick<SettingsCard, 'category' | 'terms'>) => searching
    ? matchesSearch(`${card.terms} ${categories.find(entry => entry.id === card.category)?.label ?? ''}`)
    : card.category === category
  const destinations = searching && !mobile ? searchDestinations.filter(({ label, terms }) => matchesSearch(`${label} ${terms}`)) : []

  const groups: Array<{ id: string; title: string; hint: string; cards: SettingsCard[] }> = [
    {
      id: 'workspace', title: 'Workspace', hint: 'A familiar workspace, arranged around the way you research.',
      cards: [
        { id: 'navigation', category: 'workspace', terms: 'choose main page startup homepage launch pages navigation visible hidden order move favorites reset', content:
          <NavigationPanel tabs={orderedTabs} hidden={settings.hiddenTabs} mainPage={settings.mainPage} enabledLabs={settings.enabledLabs}
            canSaveMainPage={Boolean(settingsQuery.data && settingsQuery.data.meta.freshness !== 'failed')}
            onSetMainPage={(id) => write({ type: 'setMainPage', id }, 'Main page updated for the next launch.')}
            onSetHidden={(id, hidden) => void write({ type: 'setTabHidden', id, hidden }, 'Page navigation updated.')}
            onMove={(id, direction) => void write({ type: 'moveTab', id, direction }, 'Page navigation order updated.')}
            onReset={() => void write({ type: 'resetNavigation' }, 'Page navigation reset.')} /> },
        { id: 'clock', category: 'workspace', column: 'secondary', terms: 'general clock keyboard shortcuts controller gamepad steam deck country market timezone time format 12 hour', content:
          <div className="settings-stack">
            <ClockPanel country={settings.clockCountry} time12h={settings.time12h}
              onSetCountry={(code) => void write({ type: 'setClockCountry', code }, 'Clock market updated.')}
              onSetTime12h={(value) => void write({ type: 'setTime12h', value }, 'Clock format updated.')} />
            {!mobile && <ShortcutsPanel />}
          </div> },
      ],
    },
    {
      id: 'privacy-integrations', title: 'Privacy & integrations', hint: 'Control what is visible and how external tools access your terminal.',
      cards: [
        { id: 'privacy', category: 'privacy', terms: 'obscure privacy protected pages hide mask blur portfolio finance shortcut', content:
          <PrivacyPanel tabs={privacyTabs} obscured={settings.obscuredTabs}
            onSetObscured={(id, obscured) => void write({ type: 'setTabObscured', id, obscured }, 'Privacy settings updated.')} /> },
        { id: 'mcp', category: 'integrations', column: 'secondary', terms: 'local mcp chatgpt codex tools connection permissions read only approval browser client setup activity', content: <McpPanel /> },
        { id: 'market-api-keys', category: 'integrations', terms: 'finnhub financial modeling modelling prep fmp binance coinbase world bank imf sdmx api keys credentials inactive providers', content: <MarketApiKeysPanel /> },
        ...(mobile ? [{ id: 'host-settings', category: 'integrations' as const, terms: 'mobile access desktop cloud sync mcp credentials backups cache updates', content: <Panel title="Computer settings">
          <p className="p-3 text-2xs text-text-muted">Manage Mobile Access, cloud sync, credentials, MCP, backups, and updates in Budget Terminal on the computer.</p>
        </Panel> }] : []),
      ],
    },
    {
      id: 'data', title: 'Data & storage', hint: 'Keep useful data close and your saved work protected.',
      cards: [
        { id: 'cloud-sync', category: 'data', terms: 'cloud convex sync devices account offline github browser sign in email backup conflicts', content: <CloudSyncPanel /> },
        { id: 'cache', category: 'data', terms: 'cache retention disk memory snapshots market images previews limits startup', content: <CachePanel /> },
        { id: 'backups', category: 'data', column: 'secondary', terms: 'automatic backups saved data export import restore storage location portfolios cards finance', content:
          <UserDataPanel mode="backups" onRun={onRunMaintenance} busy={busy} sourcePath={holdingsPath}
            lastBackupAt={settings.lastBackupAt} automaticBackup={settings.automaticBackup} /> },
        { id: 'maintenance', category: 'data', column: 'secondary', terms: 'maintenance reset cache clear remove delete user data portfolios cards finance', content:
          <UserDataPanel mode="maintenance" onRun={onRunMaintenance} busy={busy} sourcePath={holdingsPath} /> },
        ...(mobile ? [{ id: 'mobile-backup', category: 'data' as const, terms: 'export download backup saved data portfolios cards finance settings', content: <Panel title="Backup">
          <div className="space-y-2 p-2 text-2xs text-text-muted">
            <p>Download a copy of your saved records. Restore a backup in Budget Terminal on the computer.</p>
            <button type="button" className="min-h-11 rounded border border-border-strong px-3 text-text" disabled={downloading} onClick={() => void downloadBackup()}>
              {downloading ? 'Downloading…' : 'Download backup'}
            </button>
          </div>
        </Panel> }] : []),
      ],
    },
    {
      id: 'labs', title: 'Labs', hint: 'Try experimental features on this device.',
      cards: [{ id: 'labs', category: 'labs', terms: `experimental opt in ${LAB_FEATURES.map(feature => `${feature.label} ${feature.description}`).join(' ')}`,
        content: <Panel title="Experiments">
          <ul className="settings-labs">
            {LAB_FEATURES.map(feature => {
              const enabled = settings.enabledLabs?.includes(feature.id) ?? false
              return <li key={feature.id} className="obscure-mode-row">
                <div>
                  <h3 id={`lab-${feature.id}`}>{feature.label}</h3>
                  <p id={`lab-${feature.id}-description`}>{feature.description}</p>
                </div>
                <button type="button" className="obscure-switch" role="switch"
                  aria-labelledby={`lab-${feature.id}`} aria-describedby={`lab-${feature.id}-description`} aria-checked={enabled}
                  disabled={savingLab !== null || !settingsQuery.data || settingsQuery.data.meta.freshness === 'failed'}
                  onClick={async () => {
                    setSavingLab(feature.id)
                    try {
                      await write({ type: 'setLabEnabled', id: feature.id, enabled: !enabled },
                        enabled ? `${feature.label} disabled.` : `${feature.label} enabled.`)
                    } finally {
                      setSavingLab(null)
                    }
                  }}>
                  <span className="obscure-switch-track" aria-hidden="true" />
                  <span aria-hidden="true">{enabled ? 'On' : 'Off'}</span>
                </button>
              </li>
            })}
          </ul>
      </Panel> },
      ...(!mobile ? [{ id: 'mobile-access', category: 'labs' as const, terms: mobileAccessTerms,
        content: <MobileAccessPanel active={active && matches({ category: 'labs', terms: mobileAccessTerms })} /> }] : [])],
    },
    {
      id: 'logs', title: 'Application logs', hint: 'Search local diagnostic events and inspect previous sessions.',
      cards: [{ id: 'logs', category: 'diagnostics', terms: logSearchTerms,
        content: <DiagnosticLogsPanel active={active && matches({ category: 'diagnostics', terms: logSearchTerms })} /> }],
    },
    {
      id: 'startup', title: 'Startup & providers', hint: 'Detailed loading progress and request pressure live here in Settings.',
      cards: [
        { id: 'api', category: 'diagnostics', terms: 'startup providers api usage requests rate limit queue directory health failures loading progress', content: <ApiUsagePanel /> },
        { id: 'load-order', category: 'diagnostics', terms: 'startup page load order timings priority failures export ai report', content: <PageLoadOrderPanel /> },
      ],
    },
    {
      id: 'health', title: 'Data health', hint: 'Inspect current feed results and previous-session observations.',
      cards: [
        { id: 'health', category: 'diagnostics', terms: 'data health feed fresh stale errors failed previous session report copy clear history', content:
          <DataHealthPanel onStatus={(text) => setStatus({ text, tone: 'positive' })} /> },
      ],
    },
  ]
  const mobileCards = new Set(['navigation', 'clock', 'privacy', 'host-settings', 'mobile-backup', 'labs', 'load-order', 'health'])
  const availableGroups = mobile ? groups.map(group => ({ ...group, cards: group.cards.filter(card => mobileCards.has(card.id)) })) : groups
  const resultCount = destinations.length + availableGroups.flatMap(group => group.cards).filter(matches).length
  const showDashboard = !searching && category === 'dashboard'
  const showController = !searching && category === 'controller'
  const navigation = categories.filter(entry => !mobile || availableGroups.some(group => group.cards.some(card => card.category === entry.id))).map(entry => (
    <button key={entry.id} type="button" aria-pressed={!searching && category === entry.id}
      onClick={() => chooseCategory(entry.id)} data-settings-category={entry.id}>
      {entry.label}
    </button>
  ))

  return (
    <div className="settings-page">
      <header className="settings-toolbar">
        <nav className="settings-tabs" aria-label="Settings categories">{navigation}</nav>
        <div className="settings-toolbar-actions">
          {showDashboard && <button className="settings-update" type="button" disabled={updateState === 'checking'}
            onClick={() => void checkForUpdates()}>
            {updateState === 'checking' ? 'Checking for updates…' : updateState === 'failed' ? 'Retry update check' : 'Check for updates'}
          </button>}
          <div className="settings-search" role="search" aria-label="Settings">
            <span aria-hidden="true">⌕</span>
            <input ref={searchRef} type="search" aria-label="Search settings" placeholder="Search settings…" value={search}
              onChange={event => updateSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape' && search) {
                  event.preventDefault()
                  clearSearch()
                }
              }} />
            {search && <button type="button" aria-label="Clear settings search" onClick={clearSearch}>×</button>}
          </div>
        </div>
      </header>
      {!mobile && <div className="settings-dashboard-host" hidden={!showDashboard}>
        <AppDashboard settings={settings} />
      </div>}
      {!mobile && <div className="controller-host" hidden={!showController}>
        <ControllerControls active={active && showController} />
      </div>}
      <div className="settings-scroll" ref={scrollRef} hidden={showDashboard || showController}>
        <div className="settings-content">
          {settingsQuery.error && <p role="alert" className="settings-error">Settings could not load. {settingsQuery.error.message}</p>}
          {status.text && <div className={`settings-feedback settings-feedback--${status.tone}`}>
            <span role={status.tone === 'negative' ? 'alert' : 'status'}>{status.text}</span>
            <button type="button" aria-label="Dismiss settings message" onClick={() => setStatus({ text: '', tone: 'muted' })}>×</button>
          </div>}
          {searching && <p className="settings-search-count" role="status">{resultCount} {resultCount === 1 ? 'result' : 'results'} in Settings</p>}
          {destinations.length > 0 && <ul className="settings-search-destinations">
            {destinations.map(({ id, label }) => <li key={id}><button type="button" onClick={() => chooseCategory(id)}>{label}</button></li>)}
          </ul>}
          {availableGroups.map((group, index) => <section className="settings-group" key={group.id}
            hidden={!group.cards.some(matches)} aria-labelledby={`settings-group-${group.id}`}>
            <header className="settings-group-heading"><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div><h2 id={`settings-group-${group.id}`}>{group.title}</h2><p>{group.hint}</p></div>
            </header>
            <div className="settings-grid">{[undefined, 'secondary'].map(column => {
              const cards = group.cards.filter(card => card.column === column)
              return <div key={column ?? 'primary'} className="settings-column" hidden={!cards.some(matches)}>
                {cards.map(card => <div key={card.id} hidden={!matches(card)} className="settings-card" data-settings-card={card.id}>{card.content}</div>)}
              </div>
            })}</div>
          </section>)}
          {searching && resultCount === 0 && <div className="settings-empty"><h2>No settings match your search.</h2>
            <p>Try a different term.</p>
            <button type="button" onClick={clearSearch}>Clear search</button>
          </div>}
        </div>
      </div>
    </div>
  )
}

