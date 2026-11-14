import { useEffect, useState } from 'react'
import type { CloudSyncCommand } from '@shared/cloudSync'
import { useCloudSyncCommand, useCloudSyncStatus } from '@/api/cloudSyncQueries'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { useAuthPrompt } from '@/stores/authPrompt'

export function CloudSyncPanel() {
  const query = useCloudSyncStatus()
  const runCommand = useCloudSyncCommand()
  const status = query.data?.data
  const [url, setUrl] = useState(() => status?.url ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const failure = error || query.data?.meta.failureReason || (query.error ? 'Sync settings are unavailable. Local saves continue as usual.' : '')
  const [choice, setChoice] = useState<'local' | 'cloud' | null>(null)
  const hideAuthPrompt = useAuthPrompt((state) => state.hidden)

  useEffect(() => {
    if (status?.signedIn) { setUrl(''); setError('') }
  }, [status?.signedIn])

  useEffect(() => {
    if (!status?.signedIn && status?.url) setUrl(current => current || status.url)
  }, [status?.signedIn, status?.url])

  const run = async (command: CloudSyncCommand) => {
    setBusy(true)
    setError('')
    try {
      const result = await runCommand(command)
      if (result.meta.failureReason) setError(result.meta.failureReason)
      else {
        setChoice(null)
      }
    } catch { setError('Unable to complete sync. Local saves continue as usual.') }
    finally { setBusy(false) }
  }
  const inputClass = 'h-8 min-w-0 w-full border border-border bg-bg px-2 text-xs text-text'
  const stateLabels = { disconnected: 'Not connected', idle: 'Changes pending', syncing: 'Syncing', synced: 'Up to date', conflict: 'Choose a copy', error: 'Needs attention' }

  return <Panel title="Cloud sync · Convex">
    <div className="flex flex-col gap-2 p-2" data-cloud-sync>
      <p className="text-2xs text-text-muted">Your data always saves on this device. Optional Convex sync shares portfolios, finance, cards, articles and preferences across your devices. The app works normally without a cloud connection.</p>
      <p className="text-xs" role="status">{status ? stateLabels[status.state] : 'Checking sync settings…'}
        {status?.lastSyncedAt ? ` · Last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : ''}
        {status?.pending ? ' · Local changes pending' : ''}</p>
      {status?.signedIn && (status.localUpdatedAt || status.cloudUpdatedAt) ? <p className="text-2xs text-text-muted">
        {status.cloudUpdatedAt ? `Cloud data updated ${new Date(status.cloudUpdatedAt).toLocaleString()} · Revision ${status.revision ?? 0}` : ''}
        {status.localUpdatedAt ? `${status.cloudUpdatedAt ? ' · ' : ''}Local data updated ${new Date(status.localUpdatedAt).toLocaleString()}` : ''}
      </p> : null}
      {status?.signedIn ? <>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || status.state === 'syncing'} onClick={() => void run({ type: 'sync' })}>Sync now</Button>
          <Button disabled={busy} onClick={() => void run({ type: 'disconnect' })}>Disconnect sync</Button>
        </div>
        {status.state === 'conflict' ? <div className="flex flex-col gap-2 border border-border p-2">
          <p className="text-2xs text-text-muted">{status.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => setChoice('local')}>Keep this device’s copy</Button>
            <Button disabled={busy} onClick={() => setChoice('cloud')}>Use cloud copy</Button>
          </div>
          {choice ? <div role="alert" className="text-2xs">
            <p>{choice === 'local' ? 'Replace the complete cloud copy with this device’s data? Other connected devices will receive this copy.' : 'Replace this device’s data with the complete cloud copy? A recovery backup will be saved locally first.'}</p>
            <div className="mt-2 flex gap-2"><Button disabled={busy} onClick={() => void run({ type: 'resolve', use: choice })}>Confirm replacement</Button><Button disabled={busy} onClick={() => setChoice(null)}>Cancel</Button></div>
          </div> : null}
        </div> : null}
      </> : status?.signInPending ? <div className="flex flex-col gap-2">
        <p className="text-2xs" role="status">{status.message ?? 'Waiting for GitHub approval in your browser…'}</p>
        <Button disabled={busy} onClick={() => void run({ type: 'cancelSignIn' })}>Cancel sign-in</Button>
      </div> : <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void run({ type: 'signInGitHub', url }) }}>
        <label className="text-2xs">Convex deployment URL<input className={inputClass} type="url" required aria-label="Convex deployment URL" placeholder="https://your-deployment.convex.cloud" value={url} disabled={busy} onChange={event => setUrl(event.target.value)} /></label>
        <Button type="submit" variant="accent" disabled={busy || !status?.encryptionAvailable || !url.trim()}>Sign in with GitHub</Button>
        <p className="text-2xs text-text-muted">Approve sign-in in your system browser, then return here. No Convex developer login or deployment key is needed in the app.</p>
        <p className="text-2xs text-text-muted">Secured by Convex Auth v2. Reconnect with your existing GitHub account after upgrading. Email-code sign-in is unavailable in v2.</p>
        {status?.message && status.state !== 'error' ? <p role="status" className="text-2xs">{status.message}</p> : null}
        {status && !status.encryptionAvailable ? <p className="text-2xs text-warn">Enable your OS credential keyring to connect sync. Local saves remain available.</p> : null}
        <p className="text-2xs text-text-dim">Deploy this repository’s Convex backend first; setup instructions are in docs/convex-sync.md. No deployment key is needed in the app.</p>
      </form>}
      <p className="text-2xs text-text-dim">Browser sessions, provider API keys, agents and market caches stay on this device. Disconnect keeps your local data and your cloud copy.</p>
      <p className="text-2xs text-text-muted">You stay signed in on this device until you disconnect or your session expires.</p>
      <label className="flex items-center gap-2 text-2xs text-text-muted">
        <input type="checkbox" checked={!hideAuthPrompt} onChange={event => useAuthPrompt.getState().setHidden(!event.target.checked)} />
        Show sign-in popup at startup
      </label>
      {failure || status?.state === 'error' ? <p role="alert" className="text-2xs text-down">{failure || status?.message}</p> : null}
    </div>
  </Panel>
}
