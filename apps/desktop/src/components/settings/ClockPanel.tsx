import { CLOCK_COUNTRIES } from '@shared/contract'
import { SectionHeader } from '@/components/settings/SettingsSection'
import { Checkbox } from '@/components/ui/Checkbox'
import { Panel } from '@/components/ui/Panel'
import { Select } from '@/components/ui/Select'
import { clockTime } from '@/lib/format'

const OPTIONS = CLOCK_COUNTRIES.map((entry) => ({ value: entry.code, label: entry.name }))

/** `_build_settings_preferences_box`: the market the top-bar clock follows, and its format. */
export function ClockPanel({
  country,
  time12h,
  onSetCountry,
  onSetTime12h,
}: {
  country: string
  time12h: boolean
  onSetCountry: (code: string) => void
  onSetTime12h: (value: boolean) => void
}) {
  const zone = CLOCK_COUNTRIES.find((entry) => entry.code === country)?.zone ?? 'America/New_York'

  return (
    <Panel title="Preferences">
      <div className="flex flex-col gap-2 p-2">
        <SectionHeader title="Clock" hint="Set the top-bar market country and display format." />
        <div className="flex items-center gap-2">
          <Select
            aria-label="Clock market country"
            value={country}
            options={OPTIONS}
            onChange={onSetCountry}
            className="h-8 max-w-72"
          />
          <span className="num text-2xs text-text-muted">{clockTime(new Date(), zone, time12h)}</span>
          <span className="text-2xs text-text-dim">{zone}</span>
        </div>
        <Checkbox
          checked={time12h}
          onChange={onSetTime12h}
          label="Use 12-hour time in the top-bar clock"
        />
      </div>
    </Panel>
  )
}
