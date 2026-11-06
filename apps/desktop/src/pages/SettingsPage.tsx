import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { AppSettings, AppSettingsMutation, MaintenanceAction } from '@shared/contract'
import { DEFAULT_CLOCK_COUNTRY, SETTINGS_TAB_ID, TABS } from '@shared/contract'
import { DEFAULT_BACKTEST_PAGE_SETTINGS } from '@shared/backtest'
import { DEFAULT_QUANT_PAGE_SETTINGS } from '@shared/quant'
import { DEFAULT_YOUTUBE_PAGE_SETTINGS } from '@shared/youtube'
import { usePortfolio } from '@/api/queries'
import { useMaintenance, useSettings, useSettingsMutation } from '@/api/settingsQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
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
import { useSettingsNavigation } from '@/stores/settingsNavigation'
import { AppDashboard } from '@/components/settings/AppDashboard'
import '@/styles/settings.css'

const categories = [
  { id: 'dashboard', label: 'App dashboard' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'data', label: 'Data & storage' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'diagnostics', label: 'Diagnostics' },
] as const
type Category = (typeof categories)[number]['id']
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
  const [category, setCategory] = useState<Category>('dashboard')
  const [search, setSearch] = useState('')
  const diagnosticsRequest = useSettingsNavigation(state => state.diagnosticsRequest)
  useEffect(() => {
    if (!diagnosticsRequest) return
    setCategory('diagnostics')
    setSearch('')
    scrollRef.current?.scrollTo({ top: 0 })
  }, [diagnosticsRequest])
  const scrollRef = useRef<HTMLDivElement>(null)

  const chooseCategory = (next: Category) => {
    setCategory(next)
    setSearch('')
    scrollRef.current?.scrollTo({ top: 0 })
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
        .map((id) => TAB_BY_ID.get(id))
        .filter((tab): tab is (typeof TABS)[number] => Boolean(tab))
        .map((tab) => ({ id: tab.id, label: tab.label, implemented: tab.implemented })),
    [settings.tabOrder],
  )

  const privacyTabs = useMemo(
    () => orderedTabs.filter((tab) => tab.id !== SETTINGS_TAB_ID),
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

  const groups: Array<{ id: string; title: string; hint: string; cards: SettingsCard[] }> = [
    {
      id: 'workspace', title: 'Workspace', hint: 'A familiar workspace, arranged around the way you research.',
      cards: [
        { id: 'navigation', category: 'workspace', terms: 'pages navigation visible hidden order move favorites reset', content:
          <NavigationPanel tabs={orderedTabs} hidden={settings.hiddenTabs}
            onSetHidden={(id, hidden) => void write({ type: 'setTabHidden', id, hidden }, 'Page navigation updated.')}
            onMove={(id, direction) => void write({ type: 'moveTab', id, direction }, 'Page navigation order updated.')}
            onReset={() => void write({ type: 'resetNavigation' }, 'Page navigation reset.')} /> },
        { id: 'clock', category: 'workspace', column: 'secondary', terms: 'general clock keyboard shortcuts country market timezone time format 12 hour', content:
          <div className="settings-stack">
            <ClockPanel country={settings.clockCountry} time12h={settings.time12h}
              onSetCountry={(code) => void write({ type: 'setClockCountry', code }, 'Clock market updated.')}
              onSetTime12h={(value) => void write({ type: 'setTime12h', value }, 'Clock format updated.')} />
            <ShortcutsPanel />
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
      ],
    },
    {
      id: 'logs', title: 'Application logs', hint: 'Search local diagnostic events and inspect previous sessions.',
      cards: [{ id: 'logs', category: 'diagnostics', terms: 'application diagnostic logs events search severity area session export folder pause live',
        content: <DiagnosticLogsPanel active={active && category === 'diagnostics'} /> }],
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
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (card: SettingsCard) => card.category === category &&
    terms.every(term => `${card.terms} ${categories.find(entry => entry.id === card.category)?.label}`.toLowerCase().includes(term))
  const resultCount = groups.flatMap(group => group.cards).filter(matches).length
  const navigation = categories.map(entry => (
    <button key={entry.id} type="button" aria-pressed={category === entry.id}
      onClick={() => chooseCategory(entry.id)} data-settings-category={entry.id}>
      {entry.label}
    </button>
  ))

  return (
    <div className="settings-page">
      <header className="settings-toolbar">
        <nav className="settings-tabs" aria-label="Settings categories">{navigation}</nav>
        <label className={`settings-search${category === 'dashboard' ? ' settings-search--inactive' : ''}`} aria-hidden={category === 'dashboard'}><span aria-hidden="true">⌕</span>
          <input type="search" aria-label="Search settings" placeholder="Search settings…" value={search} disabled={category === 'dashboard'}
            onChange={event => { setSearch(event.target.value); scrollRef.current?.scrollTo({ top: 0 }) }} />
        </label>
      </header>
      <div className="settings-dashboard-host" hidden={category !== 'dashboard'}>
        <AppDashboard settings={settings} />
      </div>
      <div className="settings-scroll" ref={scrollRef} hidden={category === 'dashboard'}>
        <div className="settings-content">
          {settingsQuery.error && <p role="alert" className="settings-error">Settings could not load. {settingsQuery.error.message}</p>}
          {status.text && <div className={`settings-feedback settings-feedback--${status.tone}`}>
            <span role={status.tone === 'negative' ? 'alert' : 'status'}>{status.text}</span>
            <button type="button" aria-label="Dismiss settings message" onClick={() => setStatus({ text: '', tone: 'muted' })}>×</button>
          </div>}
          {search && <p className="settings-search-count" role="status">{resultCount} matching {resultCount === 1 ? 'panel' : 'panels'}</p>}
          {groups.map((group, index) => <section className="settings-group" key={group.id}
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
          {resultCount === 0 && <div className="settings-empty"><h2>No settings match your search.</h2>
            <p>Try a different term or choose another category.</p>
            <button type="button" onClick={() => setSearch('')}>Clear search</button>
          </div>}
        </div>
      </div>
    </div>
  )
}

