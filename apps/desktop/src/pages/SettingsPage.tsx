import { useCallback, useEffect, useMemo, useState } from 'react'

import type { AppSettings, AppSettingsMutation, MaintenanceAction } from '@shared/contract'
import { DEFAULT_CLOCK_COUNTRY, SETTINGS_TAB_ID, TABS } from '@shared/contract'
import { DEFAULT_BACKTEST_PAGE_SETTINGS } from '@shared/backtest'
import { DEFAULT_YOUTUBE_PAGE_SETTINGS } from '@shared/youtube'
import { usePortfolio } from '@/api/queries'
import { useMaintenance, useSettings, useSettingsMutation } from '@/api/settingsQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { ClockPanel } from '@/components/settings/ClockPanel'
import { DataHealthPanel } from '@/components/settings/DataHealthPanel'
import { NavigationPanel, type NavigationTab } from '@/components/settings/NavigationPanel'
import { PrivacyPanel } from '@/components/settings/PrivacyPanel'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { ShortcutsPanel } from '@/components/settings/ShortcutsPanel'
import { UserDataPanel } from '@/components/settings/UserDataPanel'

const TAB_BY_ID = new Map(TABS.map((tab) => [tab.id, tab]))

const fallbackSettings: AppSettings = {
  clockCountry: DEFAULT_CLOCK_COUNTRY,
  time12h: true,
  tabOrder: TABS.map((tab) => tab.id),
  hiddenTabs: [],
  obscuredTabs: [],
  backtestPage: DEFAULT_BACKTEST_PAGE_SETTINGS,
  signalsPage: { filter: 'all', search: '' },
  youtubePage: DEFAULT_YOUTUBE_PAGE_SETTINGS,
  sourcePath: '',
}

type StatusTone = 'muted' | 'positive' | 'negative'

/**
 * The Settings page, ported from the PySide6 `mixins/settings.py`.
 *
 * The reference splits its panels across General / Workspace / Data / Diagnostics
 * subtabs; this is one scrolling page grouped Data, General, Workspace. The Diagnostics
 * panels are not ported: the live Python logger, the startup profiler and the crash
 * report folder have no counterpart here, and the one part of that subtab that does —
 * the data-health view — belongs with the other Data controls anyway.
 */
export function SettingsPage({
  onStatusChange,
}: {
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
    text: 'Ready',
    tone: 'muted',
  })
  const [busy, setBusy] = useState<MaintenanceAction | null>(null)

  useEffect(() => {
    onStatusChange(
      [
        {
          label: 'Settings',
          envelope: settingsQuery.data,
          loading: settingsQuery.isLoading,
        },
      ],
      settings.sourcePath,
    )
  }, [onStatusChange, settingsQuery.data, settingsQuery.isLoading, settings.sourcePath])

  /** Every control writes the same way: apply, then report what the store came back with. */
  const write = useCallback(
    async (mutation: AppSettingsMutation, done: string) => {
      const result = await mutate(mutation)
      const reason = result.meta.failureReason
      setStatus(reason ? { text: reason, tone: 'negative' } : { text: done, tone: 'positive' })
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
          text: result.data.message,
          tone: result.data.performed ? 'positive' : result.meta.failureReason ? 'negative' : 'muted',
        })
      } finally {
        setBusy(null)
      }
    },
    [runMaintenance],
  )

  const tone =
    status.tone === 'positive'
      ? 'text-up'
      : status.tone === 'negative'
        ? 'text-down'
        : 'text-text-muted'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <header className="flex flex-col gap-1 border border-border bg-surface p-3">
          <h1 className="text-sm font-semibold text-text">Settings</h1>
          <p className="text-2xs text-text-muted">
            Tune the workspace, manage saved data, and inspect this session without leaving Budget
            Terminal.
          </p>
        </header>

        <SettingsSection title="Data" hint="Backups, maintenance and this session's feed health.">
          <UserDataPanel onRun={onRunMaintenance} busy={busy} sourcePath={holdingsPath} />
          <DataHealthPanel onStatus={(text) => setStatus({ text, tone: 'positive' })} />
        </SettingsSection>

        <SettingsSection title="General" hint="Top-bar clock and the app-wide keyboard shortcuts.">
          <ClockPanel
            country={settings.clockCountry}
            time12h={settings.time12h}
            onSetCountry={(code) =>
              void write({ type: 'setClockCountry', code }, 'Clock market updated.')
            }
            onSetTime12h={(value) =>
              void write({ type: 'setTime12h', value }, 'Clock format updated.')
            }
          />
          <ShortcutsPanel />
        </SettingsSection>

        <SettingsSection title="Workspace" hint="Which pages appear, in what order, and what Obscure hides.">
          <NavigationPanel
            tabs={orderedTabs}
            hidden={settings.hiddenTabs}
            onSetHidden={(id, hidden) =>
              void write({ type: 'setTabHidden', id, hidden }, 'Page navigation updated.')
            }
            onMove={(id, direction) =>
              void write({ type: 'moveTab', id, direction }, 'Page navigation order updated.')
            }
            onReset={() => void write({ type: 'resetNavigation' }, 'Page navigation reset.')}
          />
          <PrivacyPanel
            tabs={privacyTabs}
            obscured={settings.obscuredTabs}
            onSetObscured={(id, obscured) =>
              void write({ type: 'setTabObscured', id, obscured }, 'Privacy settings updated.')
            }
          />
        </SettingsSection>
      </div>

      <div className="flex h-7 shrink-0 items-center border-t border-border bg-surface px-3">
        <span className={`truncate text-2xs ${tone}`}>{status.text}</span>
        <span className="ml-auto truncate text-2xs text-text-dim" title={settings.sourcePath}>
          {settings.sourcePath}
        </span>
      </div>
    </div>
  )
}
