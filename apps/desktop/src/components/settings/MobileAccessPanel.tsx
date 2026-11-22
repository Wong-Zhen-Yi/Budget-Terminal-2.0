import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MOBILE_DIRECT_SERVE_COMMAND, MOBILE_SERVE_COMMAND } from '@shared/mobileAccess'
import { api } from '@/api/client'
import { Panel } from '@/components/ui/Panel'

const key = ['mobileAccess'] as const
const button = 'rounded border border-border-strong bg-surface-raised px-2 py-1 text-text hover:bg-surface-hover disabled:opacity-50'

export function MobileAccessPanel({ active }: { active: boolean }) {
  const client = useQueryClient()
  const [copied, setCopied] = useState('')
  const status = useQuery({ queryKey: key, queryFn: () => api.mobileAccessStatus(), enabled: active })
  const change = useMutation({
    mutationFn: (enabled: boolean) => api.configureMobileAccess(enabled),
    onSuccess: state => client.setQueryData(key, state),
  })
  const state = status.data
  return <Panel title="Mobile Access">
    <div className="space-y-2 p-3 text-2xs">
      <div className="obscure-mode-row">
        <div>
          <h3 id="lab-mobile-access">Enable Mobile Access</h3>
          <p id="lab-mobile-access-description">Open Budget Terminal on your iPhone or iPad while the app runs on this computer.</p>
        </div>
        <button type="button" className="obscure-switch" role="switch"
          aria-labelledby="lab-mobile-access" aria-describedby="lab-mobile-access-description"
          aria-checked={state?.enabled ?? false} disabled={!state?.available || change.isPending}
          onClick={() => { setCopied(''); change.mutate(!state?.enabled) }}>
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
            <button className={button} type="button" aria-label={`Copy ${label}`} onClick={() => void api.writeClipboard(url).then(() => setCopied(url))}>
              {copied === url ? 'Copied' : 'Copy'}
            </button>
          </div>,
        )}
        <button className={button} type="button" disabled={status.isFetching || change.isPending} onClick={() => void status.refetch()}>Check connection</button>
        <p className="text-text-muted">Send <code>/mobile</code> to your Budget Terminal Telegram bot to get the link on your device.</p>
        {(!state.url || !state.directUrl) && <details className="text-text-muted" open={!state.url && !state.directUrl}>
          <summary className="cursor-pointer text-text">Set up Tailscale links</summary>
          <p className="mt-1">{api.platform === 'win32' ? 'Run the command in an Administrator terminal.' : 'Run the command in a terminal on this computer.'}</p>
          {!state.url && <code className="block break-all text-text">{MOBILE_SERVE_COMMAND}</code>}
          {!state.directUrl && <code className="block break-all text-text">{MOBILE_DIRECT_SERVE_COMMAND}</code>}
        </details>}
        {state.directUrl && <p className="text-text-muted">Connect Tailscale with the same account on both devices. The direct link uses HTTP inside the encrypted Tailscale tunnel.</p>}
      </>}
    </div>
  </Panel>
}
