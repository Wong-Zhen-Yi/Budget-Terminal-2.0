import { useState } from 'react'

import { SETTINGS_TAB_ID, type LabFeatureId } from '@shared/contract'
import { isMainPageAvailable, resolveMainPage, WORKSPACES, workspaceFor } from '@shared/navigation'
import { SectionHeader } from '@/components/settings/SettingsSection'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Panel } from '@/components/ui/Panel'
import { touchShell } from '@/mobile/touch'

export interface NavigationTab {
  id: string
  label: string
  implemented: boolean
}

/**
 * `_build_settings_navigation_box`: which pages appear in the tab strip, and in what
 * order. Selection drives Move Up / Move Down, as it does in the reference — per-row
 * arrows would put two more controls on every one of thirty-one rows.
 */
export function NavigationPanel({
  tabs,
  hidden,
  mainPage,
  enabledLabs,
  canSaveMainPage,
  onSetMainPage,
  onSetHidden,
  onMove,
  onReset,
}: {
  /** Every tab, already in the persisted navigation order. */
  tabs: NavigationTab[]
  hidden: string[]
  mainPage?: string
  enabledLabs?: readonly LabFeatureId[]
  canSaveMainPage: boolean
  onSetMainPage: (id: string | null) => Promise<void>
  onSetHidden: (id: string, value: boolean) => void
  onMove: (id: string, direction: -1 | 1) => void
  onReset: () => void
}) {
  const [selected, setSelected] = useState<string | null>(tabs[0]?.id ?? null)
  const [savingMainPage, setSavingMainPage] = useState(false)
  const index = tabs.findIndex((tab) => tab.id === selected)
  const phone = touchShell()
  const available = tabs.filter(tab => isMainPageAvailable(tab.id, hidden, enabledLabs))
  const defaultPage = resolveMainPage(undefined, tabs.map(tab => tab.id), hidden, enabledLabs)
  const defaultLabel = tabs.find(tab => tab.id === defaultPage)?.label
  const options = (pages: NavigationTab[]) => pages.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)

  return (
    <Panel title="Pages & navigation">
      <div className="flex flex-col gap-2 p-2">
        <div className="settings-main-page">
          <div>
            <label htmlFor="settings-main-page">Choose main page</label>
            <p id="settings-main-page-hint">Opens the next time you launch Budget Terminal.</p>
          </div>
          <select id="settings-main-page" aria-describedby="settings-main-page-hint"
            disabled={!canSaveMainPage || savingMainPage} value={mainPage ?? ''}
            onChange={async event => {
              setSavingMainPage(true)
              try {
                await onSetMainPage(event.currentTarget.value || null)
              } finally {
                setSavingMainPage(false)
              }
            }}>
            <option value="">Default ({defaultLabel})</option>
            {WORKSPACES.map(workspace => {
              const pages = available.filter(tab => workspace.pages.includes(tab.id))
              return pages.length ? <optgroup key={workspace.id} label={workspace.label}>{options(pages)}</optgroup> : null
            })}
            {options(available.filter(tab => !workspaceFor(tab.id)))}
          </select>
        </div>
        <SectionHeader
          title="Visible Pages"
          hint="Choose visible pages and their order within each workspace. Favorites are managed from the page header."
        />
        <ul className="settings-visible-pages max-h-96 overflow-y-auto border border-border bg-bg">
          {tabs.map((tab) => {
            const isSettings = tab.id === SETTINGS_TAB_ID
            return (
              <li key={tab.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(tab.id)}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault()
                      setSelected(tab.id)
                    }
                  }}
                  className={`flex h-8 cursor-pointer items-center gap-2 px-2 ${
                    tab.id === selected ? 'bg-accent-dim' : 'hover:bg-surface-hover'
                  }`}
                >
                  <Checkbox
                    checked={!hidden.includes(tab.id)}
                    disabled={isSettings}
                    title={isSettings ? 'Settings cannot be hidden.' : undefined}
                    onChange={(value) => onSetHidden(tab.id, !value)}
                    label={isSettings ? `${tab.label} (always visible)` : tab.label}
                  />
                  {!tab.implemented ? (
                    <span className="ml-auto shrink-0 text-2xs text-text-dim">not migrated</span>
                  ) : null}
                  {/* On phones the list grows with the page, so the selected row carries its own move buttons. */}
                  {phone && tab.id === selected ? <span className="settings-row-move">
                    <button type="button" disabled={index <= 0} aria-label={`Move ${tab.label} up`}
                      onClick={event => { event.stopPropagation(); onMove(tab.id, -1) }}>↑</button>
                    <button type="button" disabled={index >= tabs.length - 1} aria-label={`Move ${tab.label} down`}
                      onClick={event => { event.stopPropagation(); onMove(tab.id, 1) }}>↓</button>
                  </span> : null}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="flex items-center gap-2">
          {!phone && <><Button
            disabled={index <= 0}
            onClick={() => selected && onMove(selected, -1)}
          >
            Move Up
          </Button>
          <Button
            disabled={index < 0 || index >= tabs.length - 1}
            onClick={() => selected && onMove(selected, 1)}
          >
            Move Down
          </Button></>}
          <Button variant="danger" className="ml-auto" onClick={onReset}>
            Reset Order
          </Button>
        </div>
        <p className="text-2xs text-text-muted">Hiding a page only changes navigation. Every implemented page still loads at startup.</p>
      </div>
    </Panel>
  )
}
