import { useState } from 'react'

import { SETTINGS_TAB_ID } from '@shared/contract'
import { SectionHeader } from '@/components/settings/SettingsSection'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Panel } from '@/components/ui/Panel'

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
  onSetHidden,
  onMove,
  onReset,
}: {
  /** Every tab, already in the persisted navigation order. */
  tabs: NavigationTab[]
  hidden: string[]
  onSetHidden: (id: string, value: boolean) => void
  onMove: (id: string, direction: -1 | 1) => void
  onReset: () => void
}) {
  const [selected, setSelected] = useState<string | null>(tabs[0]?.id ?? null)
  const index = tabs.findIndex((tab) => tab.id === selected)

  return (
    <Panel title="Page Navigation">
      <div className="flex flex-col gap-2 p-2">
        <SectionHeader
          title="Visible Pages"
          hint="Choose visible pages and their order within each workspace. Favorites are managed from the page header."
        />
        <ul className="max-h-96 overflow-y-auto border border-border bg-bg">
          {tabs.map((tab) => {
            const isSettings = tab.id === SETTINGS_TAB_ID
            return (
              <li key={tab.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setSelected(tab.id)
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
                </div>
              </li>
            )
          })}
        </ul>
        <div className="flex items-center gap-2">
          <Button
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
          </Button>
          <Button variant="danger" className="ml-auto" onClick={onReset}>
            Reset Order
          </Button>
        </div>
      </div>
    </Panel>
  )
}
