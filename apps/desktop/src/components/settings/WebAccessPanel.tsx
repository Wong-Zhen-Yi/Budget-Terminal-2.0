import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { isBrowser } from '@/api/browser'
import type { WebAccessStatus } from '@shared/contract'
import { Panel } from '@/components/ui/Panel'
import { useQueryClient } from '@tanstack/react-query'
import { useWebAccessStatus, webAccessStatusKey } from '@/api/webAccessQueries'

const button = 'rounded border border-border-strong px-3 py-2 text-2xs text-text hover:bg-surface-hover disabled:opacity-50'

export function WebAccessPanel() {
  const statusQuery = useWebAccessStatus()
  const status = statusQuery.data
  const client = useQueryClient()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (isBrowser) return
    const timer = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(timer)
  }, [])
  const run = async (action: () => Promise<WebAccessStatus>) => {
    setBusy(true)
    setError('')
    try { client.setQueryData(webAccessStatusKey, await action()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Remote update failed.') }
    finally { setBusy(false) }
  }
  const expired = status?.pairingExpiresAt != null && status.pairingExpiresAt <= now
  return <Panel title="Remote" className="p-3">
    {isBrowser ? <p className="mt-2 text-2xs text-text-muted">You are connected to the Budget Terminal on your PC. Enable Remote, manage pairing codes, revoke remembered browsers, and run backups or data maintenance in desktop Settings. Use Log out in the bottom bar to end this browser session.</p> : <>
      <p className="mt-2 text-2xs text-text-muted">Access this workspace in Chrome or Safari on your iPad through your private Tailscale network. Your PC must stay awake with Budget Terminal running.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-2xs"><input type="checkbox" checked={status?.enabled ?? false} disabled={busy || !status} onChange={(event) => void run(() => api.configureWebAccess(event.target.checked))} />Enable Remote</label>
        <span role="status" className={`text-2xs ${status?.running ? 'text-up' : status?.error ? 'text-down' : 'text-text-muted'}`}>{status ? status.running ? `Running · 127.0.0.1:${status.port}` : status.enabled ? 'Server stopped' : 'Disabled' : 'Checking…'}</span>
      </div>
      {status?.running ? <>
        <p className="mt-3 text-2xs">Pairing code: <strong className="num select-text text-accent-hover">{expired ? 'Expired — generate a new code' : status.pairingCode ?? 'No active code'}</strong></p>
        {status.pairingExpiresAt && !expired ? <p className="mt-1 text-2xs text-text-muted">Expires {new Date(status.pairingExpiresAt).toLocaleTimeString()}</p> : null}
        <p className="mt-1 text-2xs text-text-muted">{status.connectionCount ?? 0} connected · {status.sessionCount} remembered browser(s). Approved browsers reconnect after PC or app restarts, with access renewed for 30 days when reopened.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy} onClick={() => void run(() => api.rotateWebPairingCode())}>New pairing code</button>
          <button type="button" className={button} disabled={busy} onClick={() => void run(() => api.revokeWebSessions())}>Log out all browsers</button>
        </div>
        {status.accessRequests?.length ? <div className="mt-3 rounded border border-accent p-3">
          <h3 className="text-xs font-semibold">Access requests</h3>
          <p className="mt-1 text-2xs text-text-muted">Match the request reference on your iPad before approving.</p>
          {status.accessRequests.map(request => <div key={request.id} className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-2xs">{request.label} · <strong className="num select-text">{request.id}</strong> · expires {new Date(request.expiresAt).toLocaleTimeString()}</span>
            <button type="button" className={button} disabled={busy} onClick={() => void run(() => api.decideWebAccess(request.id, true))}>Approve</button>
            <button type="button" className={button} disabled={busy} onClick={() => void run(() => api.decideWebAccess(request.id, false))}>Decline</button>
          </div>)}
        </div> : null}
        <p className="mt-3 text-2xs text-text-muted">On the PC, run this once in PowerShell, then open the HTTPS address Tailscale prints on your iPad:</p>
        <code className="num mt-2 block overflow-x-auto rounded border border-border bg-bg p-3 text-2xs select-text">tailscale serve --bg http://127.0.0.1:{status.port}</code>
        {status.tailscaleUrl ? <p className="mt-2 text-2xs text-text-muted">Your private address: <span className="select-text break-all text-text">{status.tailscaleUrl}</span>. Run the command above to enable HTTPS forwarding.</p> : null}
        <p className="mt-2 text-2xs text-text-muted">Allow only your intended devices in your tailnet access policy. Disabling Remote or logging out all browsers removes remembered approvals.</p>
      </> : null}
    </>}
    {error || status?.error || statusQuery.error ? <p role="alert" className="mt-2 text-2xs text-down">{error || status?.error || statusQuery.error?.message}</p> : null}
  </Panel>
}
