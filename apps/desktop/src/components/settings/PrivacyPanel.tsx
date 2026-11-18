import { useState } from 'react'

import { VALUE_MASKED_TABS } from '@shared/contract'
import { workspaceFor } from '@shared/navigation'
import type { NavigationTab } from '@/components/settings/NavigationPanel'
import { Checkbox } from '@/components/ui/Checkbox'
import { Panel } from '@/components/ui/Panel'
import { useObscureMode } from '@/stores/obscureMode'

export function PrivacyPanel({
  tabs,
  obscured,
  onSetObscured,
}: {
  tabs: NavigationTab[]
  obscured: string[]
  onSetObscured: (id: string, value: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const enabled = useObscureMode(state => state.enabled)
  const toggle = useObscureMode(state => state.toggle)
  const shortcut = window.api.platform === 'darwin' ? '⌘⇧H' : 'Ctrl+Shift+H'
  const selected = new Set(obscured)
  const selectedCount = tabs.filter(tab => selected.has(tab.id)).length
  const query = search.trim().toLowerCase()
  const pages = tabs.flatMap(tab => {
    const workspace = workspaceFor(tab.id)?.label
    const checked = selected.has(tab.id)
    const matches = `${tab.label} ${workspace ?? ''}`.toLowerCase().includes(query)
    return matches && (!selectedOnly || checked) ? [{ ...tab, workspace, checked }] : []
  })

  return (
    <Panel title="Obscure mode">
      <div className="obscure-settings">
        <div className="obscure-mode-row">
          <div>
            <h3>Protect selected pages</h3>
            <p id="obscure-mode-hint">Starts on each launch. Press <kbd>{shortcut}</kbd> to toggle.</p>
          </div>
          <button type="button" role="switch" aria-label="Obscure mode" aria-checked={enabled}
            aria-describedby="obscure-mode-hint" className="obscure-switch" onClick={toggle}>
            <span aria-hidden="true" className="obscure-switch-track" />
            {enabled ? 'On' : 'Off'}
          </button>
        </div>
        <div className="obscure-page-heading">
          <h3 id="obscure-page-heading">Pages to protect</h3>
          <span>{selectedCount} selected</span>
        </div>
        <div className="obscure-page-tools">
          <input type="search" aria-label="Find pages to protect" placeholder="Find a page or workspace…"
            value={search} onChange={event => setSearch(event.target.value)} />
          <button type="button" aria-pressed={selectedOnly} onClick={() => setSelectedOnly(value => !value)}>
            Selected only
          </button>
        </div>
        {pages.length ? (
          <ul className="obscure-page-grid" aria-labelledby="obscure-page-heading">
            {pages.map(({ id, label, workspace, checked }) => (
              <li key={id}>
                <Checkbox checked={checked} onChange={(value) => onSetObscured(id, value)}
                  className="obscure-page"
                  label={<span className="obscure-page-label">
                    <span>{label}</span>
                    <span>
                      {workspace && `${workspace} · `}
                      {VALUE_MASKED_TABS.includes(id)
                        ? id === 'personal-finance' ? 'Masks values and recurring bill names' : 'Masks values'
                        : 'Blurs and locks'}
                    </span>
                  </span>}
                />
              </li>
            ))}
          </ul>
        ) : <p className="obscure-page-empty" role="status">
          {selectedOnly && selectedCount === 0 ? 'No pages selected. Turn off “Selected only” to choose pages.' : 'No matching pages.'}
        </p>}
      </div>
    </Panel>
  )
}
