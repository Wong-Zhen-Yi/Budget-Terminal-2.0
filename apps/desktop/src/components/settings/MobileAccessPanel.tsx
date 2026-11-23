import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_MOBILE_VIEWPORT, MOBILE_DIRECT_SERVE_COMMAND, MOBILE_SERVE_COMMAND, MOBILE_VIEWPORTS,
  isMobileViewportId, type MobileViewportId,
} from '@shared/mobileAccess'
import { api } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'

const key = ['mobileAccess'] as const
const button = 'rounded border border-border-strong bg-surface-raised px-2 py-1 text-text hover:bg-surface-hover disabled:opacity-50'

export function MobileAccessPanel({ active }: { active: boolean }) {
  const client = useQueryClient()
  const [copyResult, setCopyResult] = useState<{ text: string; ok: boolean }>()
  const [viewport, setViewport] = useState<MobileViewportId>(DEFAULT_MOBILE_VIEWPORT)
  const status = useQuery({ queryKey: key, queryFn: () => api.mobileAccessStatus(), enabled: active })
  const change = useMutation({
    mutationFn: (enabled: boolean) => api.configureMobileAccess(enabled),
    onSuccess: state => client.setQueryData(key, state),
  })
  const launch = useMutation({ mutationFn: (model: MobileViewportId) => api.launchMobileWindow(model) })
  const state = status.data
  const setupCommands = [!state?.url && MOBILE_SERVE_COMMAND, !state?.directUrl && MOBILE_DIRECT_SERVE_COMMAND]
    .filter(Boolean).join('\n')
  async function copy(text: string) {
    try {
      await api.writeClipboard(text)
      setCopyResult({ text, ok: true })
    } catch {
      setCopyResult({ text, ok: false })
    }
  }
  const copyLabel = (text: string, label: string) =>
    copyResult?.text === text ? (copyResult.ok ? 'Copied' : 'Copy failed. Retry') : label
  return <Panel title="Mobile Access">
    <div className="space-y-2 p-3 text-2xs">
      {api.platform === 'win32' && state?.available && <>
        <div className="settings-main-page">
          <div>
            <label htmlFor="mobile-viewport">Viewport model</label>
            <p id="mobile-viewport-hint">Open your workspace in a mobile window on this computer.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select id="mobile-viewport" aria-describedby="mobile-viewport-hint" value={viewport} disabled={launch.isPending}
              onChange={event => {
                const value = event.currentTarget.value
                if (isMobileViewportId(value)) setViewport(value)
              }}>
              {Object.entries(MOBILE_VIEWPORTS).map(([id, profile]) => <option key={id} value={id}>{profile.label}</option>)}
            </select>
            <Button variant="accent" disabled={launch.isPending} onClick={() => launch.mutate(viewport)}>
              {launch.isPending ? 'Launching…' : 'Launch'}
            </Button>
          </div>
        </div>
        {launch.isError && <p role="alert" className="text-warn">Could not open the mobile window. Rebuild Budget Terminal and try again.</p>}
      </>}
      <div className="obscure-mode-row">
        <div>
          <h3 id="lab-mobile-access">Enable Mobile Access</h3>
          <p id="lab-mobile-access-description">Open Budget Terminal on your iPhone or iPad while the app runs on this computer.</p>
        </div>
        <button type="button" className="obscure-switch" role="switch"
          aria-labelledby="lab-mobile-access" aria-describedby="lab-mobile-access-description"
          aria-checked={state?.enabled ?? false} disabled={!state?.available || change.isPending}
          onClick={() => { setCopyResult(undefined); change.mutate(!state?.enabled) }}>
          <span className="obscure-switch-track" aria-hidden="true" />
          <span aria-hidden="true">{state?.enabled ? 'On' : 'Off'}</span>
        </button>
      </div>
      <p role="status" className={state?.url || state?.directUrl ? 'text-up' : 'text-text-muted'}>
        {change.isError || status.isError ? 'Could not check Mobile Access.' : state?.message ?? 'Checking Mobile Access…'}
      </p>
      {state?.enabled && <>
        {[[state.directUrl, 'Direct link (works without DNS)'], [state.url, 'HTTPS link (uses MagicDNS)']].map(([url, label]) => url &&
          <div key={url} className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1"><p>{label}</p><p className="break-all text-text-muted">{url}</p></div>
            <button className={button} type="button" aria-label={`Copy ${label}`} onClick={() => void copy(url)}>
              <span aria-live="polite">{copyLabel(url, 'Copy')}</span>
            </button>
          </div>,
        )}
        <button className={button} type="button" disabled={status.isFetching || change.isPending} onClick={() => void status.refetch()}>Check connection</button>
        <p className="text-text-muted">Send <code>/mobile</code> to your Budget Terminal Telegram bot to get the link on your device.</p>
        {setupCommands && <details className="text-text-muted" open={!state.url && !state.directUrl}>
          <summary className="cursor-pointer text-text">Set up Tailscale links</summary>
          <p className="mt-1">{api.platform === 'win32' ? 'Run the setup in an Administrator terminal.' : 'Run the setup in a terminal on this computer.'}</p>
          <code className="block whitespace-pre-wrap break-all text-text">{setupCommands}</code>
          <button className={`${button} mt-1`} type="button" aria-label="Copy Tailscale setup commands" onClick={() => void copy(setupCommands)}>
            <span aria-live="polite">{copyLabel(setupCommands, 'Copy setup commands')}</span>
          </button>
        </details>}
        {state.directUrl && <p className="text-text-muted">Connect Tailscale with the same account on both devices. The direct link uses HTTP inside the encrypted Tailscale tunnel.</p>}
      </>}
    </div>
  </Panel>
}
