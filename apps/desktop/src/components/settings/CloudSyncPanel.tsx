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
  const [workspaceChoice, setWorkspaceChoice] = useState<'local' | 'cloud' | null>(null)
  const [confirmSessions, setConfirmSessions] = useState(false)
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
        setWorkspaceChoice(null)
        setConfirmSessions(false)
      }
    } catch { setError('Unable to complete sync. Local saves continue as usual.') }
    finally { setBusy(false) }
  }
  const inputClass = 'h-8 min-w-0 w-full border border-border bg-bg px-2 text-xs text-text'
  const stateLabels = { disconnected: 'Not connected', idle: 'Changes pending', syncing: 'Syncing', synced: 'Up to date', conflict: 'Choose a copy', error: 'Needs attention' }
  const authLabels = { restoring: 'Restoring saved sign-in', signedOut: 'Signed out', signingIn: 'Waiting for GitHub approval',
    authenticated: 'Signed in', offline: 'Saved sign-in · Connection unavailable', reauthRequired: 'Sign in again', keyringUnavailable: 'Credential keyring unavailable', storageError: 'Credential storage needs attention' }

  return <Panel title="Cloud sync · Convex">
    <div className="flex flex-col gap-2 p-2" data-cloud-sync>
      <p className="text-2xs text-text-muted">Your data always saves on this device. Optional Convex sync shares portfolios, finance, cards, articles and preferences across your devices. The app works normally without a cloud connection.</p>
      <p className="text-xs" role="status">{status ? status.workspaceApprovalRequired ? 'Sync paused · Choose a workspace' : stateLabels[status.state] : 'Checking sync settings…'}
        {status?.lastSyncedAt ? ` · Last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : ''}
        {status?.pending ? ' · Local changes pending' : ''}</p>
      {status?.authState && <p className="text-2xs text-text-muted">{authLabels[status.authState]}</p>}
      {status?.credentialCleanupRequired ? <Button disabled={busy} onClick={() => void run({ type: 'retryCredentialCleanup' })}>Retry credential cleanup</Button> :
        ['keyringUnavailable', 'storageError'].includes(status?.authState ?? '') && !status?.signedIn && <Button disabled={busy} onClick={() => void run({ type: 'retrySession' })}>Retry saved sign-in</Button>}
      {status?.signedIn && <p className="text-2xs break-all">{status.githubLogin ? `GitHub · @${status.githubLogin}` : 'GitHub account connected'}<br /><span className="text-text-muted">{status.url}</span></p>}
      {status?.signedIn && ['keyringUnavailable', 'storageError'].includes(status.authState ?? '') && <Button disabled={busy} onClick={() => void run({ type: 'retrySession' })}>Retry saving sign-in</Button>}
      {status?.signedIn && (status.localUpdatedAt || status.cloudUpdatedAt) ? <p className="text-2xs text-text-muted">
        {status.cloudUpdatedAt ? `Cloud data updated ${new Date(status.cloudUpdatedAt).toLocaleString()} · Revision ${status.revision ?? 0}` : ''}
        {status.localUpdatedAt ? `${status.cloudUpdatedAt ? ' · ' : ''}Local data updated ${new Date(status.localUpdatedAt).toLocaleString()}` : ''}
      </p> : null}
      {status?.signedIn ? <>
        {status.signInPending ? <div className="flex flex-col gap-2">
          <p className="text-2xs" role="status">Approve GitHub sign-in using the same account to sign out other devices.</p>
          <Button disabled={busy} onClick={() => void run({ type: 'cancelSignIn' })}>Cancel sign-in</Button>
        </div> : <>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || status.state === 'syncing' || status.workspaceApprovalRequired} onClick={() => void run({ type: 'sync' })}>Sync now</Button>
          <Button disabled={busy} onClick={() => void run({ type: 'disconnect' })}>Disconnect sync</Button>
          <Button disabled={busy || !status.encryptionAvailable} onClick={() => setConfirmSessions(true)}>Sign out other devices</Button>
        </div>
        {confirmSessions && <div className="border border-border p-2 text-2xs">
          <p>Sign in with the same GitHub account again to end its other sessions. This device will stay connected.</p>
          <div className="mt-2 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void run({ type: 'revokeOtherSessions' })}>Verify with GitHub</Button><Button disabled={busy} onClick={() => setConfirmSessions(false)}>Cancel</Button></div>
        </div>}
        {status.workspaceApprovalRequired && <div className="border border-border p-2 text-2xs" data-workspace-approval>
          <p>This device has saved data that is not linked to this account. Sync stays paused until you choose a copy.</p>
          <div className="mt-2 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => setWorkspaceChoice('local')}>Import this device’s data</Button><Button disabled={busy} onClick={() => setWorkspaceChoice('cloud')}>Restore account’s cloud copy</Button></div>
          {workspaceChoice && <div className="mt-2" role="alert">
            <p>{workspaceChoice === 'local' ? 'Allow this account to receive this device’s saved portfolios, finance, articles, cards and preferences? If its cloud copy differs, you will choose which copy to keep next.' : 'Replace this device’s saved data with this account’s cloud copy? A local recovery backup will be saved first. An account with no cloud copy cannot replace local data.'}</p>
            <div className="mt-2 flex gap-2"><Button disabled={busy} onClick={() => void run({ type: 'confirmWorkspace', use: workspaceChoice })}>Confirm workspace choice</Button><Button disabled={busy} onClick={() => setWorkspaceChoice(null)}>Cancel</Button></div>
          </div>}
        </div>}
        </>}
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
        {status.message && status.state !== 'error' && <p className="text-2xs" role="status">{status.message}</p>}
      </> : status?.signInPending ? <div className="flex flex-col gap-2">
        <p className="text-2xs" role="status">{status.message ?? 'Waiting for GitHub approval in your browser…'}</p>
        <Button disabled={busy} onClick={() => void run({ type: 'cancelSignIn' })}>Cancel sign-in</Button>
      </div> : <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void run({ type: 'signInGitHub', url }) }}>
        <label className="text-2xs">Convex deployment URL<input className={inputClass} type="url" required aria-label="Convex deployment URL" placeholder="https://your-deployment.convex.cloud" value={url} disabled={busy} onChange={event => setUrl(event.target.value)} /></label>
        <Button type="submit" variant="accent" disabled={busy || status?.credentialCleanupRequired || !status?.encryptionAvailable || !url.trim()}>Sign in with GitHub</Button>
        <p className="text-2xs text-text-muted">Approve sign-in in your system browser, then return here. No Convex developer login or deployment key is needed in the app.</p>
        <p className="text-2xs text-text-muted">Secured by Convex Auth v2. Reconnect with your existing GitHub account after upgrading. Email-code sign-in is unavailable in v2.</p>
        {status?.message && status.state !== 'error' ? <p role="status" className="text-2xs">{status.message}</p> : null}
        {status && !status.encryptionAvailable ? <p className="text-2xs text-warn">Enable your OS credential keyring to connect sync. Local saves remain available.</p> : null}
        <p className="text-2xs text-text-dim">Deploy this repository’s Convex backend first; setup instructions are in docs/convex-sync.md. No deployment key is needed in the app.</p>
      </form>}
      {status?.revocation === 'unconfirmed' && <p className="text-2xs text-warn" role="status">Local sign-out is complete. Server revocation is unconfirmed; a previously copied credential could remain usable until it expires or is revoked.</p>}
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
