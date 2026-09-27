import { SectionHeader } from '@/components/settings/SettingsSection'
import { Panel } from '@/components/ui/Panel'
import { shortcutsForPlatform } from '@/lib/shortcuts'

/** `_build_settings_shortcuts_box`, reading off the same table the app binds. */
export function ShortcutsPanel() {
  const shortcuts = shortcutsForPlatform(window.api.platform === 'darwin')
  return (
    <Panel title="Keyboard Shortcuts">
      <div className="flex flex-col gap-2 p-2">
        <SectionHeader
          title="Navigation"
          hint="Reference for the app-wide shortcuts and the built-in page picker."
        />
        <table className="w-full border-collapse text-2xs">
          <thead>
            <tr className="text-left text-text">
              <th className="w-32 border-b border-border pb-1 font-semibold">Shortcut</th>
              <th className="border-b border-border pb-1 font-semibold">Behavior</th>
            </tr>
          </thead>
          <tbody>
            {shortcuts.map((row) => (
              <tr key={row.keys} className="align-top">
                <td className="py-1 pr-3">
                  <kbd className="num inline-block border border-border-strong bg-surface-raised px-1.5 py-0.5 text-2xs text-accent-hover">
                    {row.keys}
                  </kbd>
                </td>
                <td className="py-1 text-text-muted">{row.behavior}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
