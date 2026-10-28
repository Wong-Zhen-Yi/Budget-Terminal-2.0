import { SectionHeader } from '@/components/settings/SettingsSection'
import { Checkbox } from '@/components/ui/Checkbox'
import { Panel } from '@/components/ui/Panel'
import type { NavigationTab } from '@/components/settings/NavigationPanel'

/**
 * Pages protected by Obscure. Finance pages mask numbers; other pages blur and lock.
 *
 * An empty selection is allowed — the reference says so explicitly, and Obscure then
 * reports that nothing is configured rather than refusing to turn on.
 */
export function PrivacyPanel({
  tabs,
  obscured,
  onSetObscured,
}: {
  /** Every tab except Settings, in navigation order. */
  tabs: NavigationTab[]
  obscured: string[]
  onSetObscured: (id: string, value: boolean) => void
}) {
  return (
    <Panel title="Privacy">
      <div className="flex flex-col gap-2 p-2">
        <SectionHeader
          title="Obscured Pages"
          hint="Choose which main pages Obscure protects. Portfolio and Personal Finance replace numbers with ****; other pages blur and lock. An empty selection is allowed."
        />
        <ul className="grid max-h-72 grid-cols-2 gap-x-4 gap-y-0.5 overflow-y-auto border border-border bg-bg p-2">
          {tabs.map((tab) => (
            <li key={tab.id} className="flex h-7 items-center">
              <Checkbox
                checked={obscured.includes(tab.id)}
                onChange={(value) => onSetObscured(tab.id, value)}
                label={tab.label}
              />
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}
