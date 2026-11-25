import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/api/client'

const key = ['launchOnStartup'] as const
export const LAUNCH_ON_STARTUP_LABEL = 'Launch on startup'
export const LAUNCH_ON_STARTUP_DESCRIPTION = 'Open Budget Terminal when you sign in to Windows, using the most recent build. Run the launcher to rebuild after updates.'

/** The sign-in entry belongs to Windows, so the switch shows what Windows reports rather than a saved preference. */
export function LaunchOnStartupRow({ onResult }: { onResult: (text: string, ok: boolean) => void }) {
  const client = useQueryClient()
  const status = useQuery({ queryKey: key, queryFn: () => api.launchOnStartupStatus() })
  const change = useMutation({
    mutationFn: (enabled: boolean) => api.configureLaunchOnStartup(enabled),
    onSuccess: (state, enabled) => {
      client.setQueryData(key, state)
      if (state.enabled === enabled) onResult(enabled ? 'Budget Terminal will open when you sign in.' : 'Launch on startup disabled.', true)
      else onResult('Windows did not apply the startup change. Check Task Manager → Startup apps.', false)
    },
    onError: () => onResult('Unable to change launch on startup. Please try again.', false),
  })
  const state = status.data
  const enabled = state?.enabled ?? false
  const description = state && !state.supported && state.reason
    ? `${LAUNCH_ON_STARTUP_DESCRIPTION} ${state.reason}`
    : LAUNCH_ON_STARTUP_DESCRIPTION
  return <li className="obscure-mode-row">
    <div>
      <h3 id="lab-launch-on-startup">{LAUNCH_ON_STARTUP_LABEL}</h3>
      <p id="lab-launch-on-startup-description">{description}</p>
    </div>
    <button type="button" className="obscure-switch" role="switch"
      aria-labelledby="lab-launch-on-startup" aria-describedby="lab-launch-on-startup-description" aria-checked={enabled}
      disabled={!state?.supported || change.isPending}
      onClick={() => change.mutate(!enabled)}>
      <span className="obscure-switch-track" aria-hidden="true" />
      <span aria-hidden="true">{enabled ? 'On' : 'Off'}</span>
    </button>
  </li>
}
