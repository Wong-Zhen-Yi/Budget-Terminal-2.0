import { useEffect, useState } from 'react'
import type { CloudSyncCommand, CloudSyncStatus } from '@shared/cloudSync'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'

export function CloudSyncPanel() {
  const [status, setStatus] = useState<CloudSyncStatus | null>(null)
  const [url, setUrl] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeUrl, setCodeUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [choice, setChoice] = useState<{ use: 'local' | 'cloud'; key?: string; token?: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const deployment = advanced ? url : ''
  const available = Boolean((codeSent ? codeUrl : deployment).trim() || status?.url)

  useEffect(() => {
    if (status?.signedIn) { setCode(''); setEmail(''); setUrl(''); setCodeSent(false); setNotice(''); setError('') }
  }, [status?.signedIn])
  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const result = await window.api.cloudSyncStatus()
        if (mounted) { setStatus(result.data); if (result.meta.failureReason) setError(result.meta.failureReason) }
      } catch { if (mounted) setError('Sync settings are unavailable. Local saves continue as usual.') }
    }
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => { mounted = false; clearInterval(timer) }
  }, [])
  const run = async (command: CloudSyncCommand) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await window.api.cloudSyncCommand(command)
      setStatus(result.data)
      if (result.meta.failureReason) setError(result.meta.failureReason)
      else {
        setChoice(null)
        if (command.type === 'sendCode') { setCodeSent(true); setCodeUrl(command.url); setNotice(result.data.message ?? 'Code sent.') }
        if (command.type === 'exportAccount') setNotice(result.data.message ?? '')
        if (['verifyCode', 'disconnect', 'deleteAccount'].includes(command.type)) {
          setCode(''); setEmail(''); setUrl(''); setCodeSent(false); setCodeUrl(''); setAdvanced(false); setDeleting(false); setConfirmation('')
        }
      }
    } catch { setError('Unable to complete sync. Local saves continue as usual.') }
    finally { setBusy(false) }
  }
  const inputClass = 'h-8 min-w-0 w-full border border-border bg-bg px-2 text-xs text-text'
  const stateLabels = { disconnected: 'Not connected', idle: 'Changes pending', syncing: 'Syncing', synced: 'Up to date', conflict: 'Review competing edits', review: 'Review local data', error: 'Needs attention' }
  const select = (use: 'local' | 'cloud', key?: string) => setChoice({ use, key,
    token: key ? status?.conflicts?.find(row => row.key === key)?.token : status?.reviewToken })

  return <Panel title="Cloud sync">
    <div className="flex flex-col gap-2 p-2" data-cloud-sync>
      <p className="text-2xs text-text-muted">Your data always saves on this device. Sign in to sync portfolios, finance, watchlists, cards, articles and preferences. The app works normally without a cloud connection.</p>
      <p className="text-xs" role="status">{status ? stateLabels[status.state] : 'Checking sync settings…'}
        {status?.lastSyncedAt ? ` · Last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : ''}
        {status?.pending ? ' · Local changes pending' : ''}</p>
      {status?.signedIn && (status.localUpdatedAt || status.cloudUpdatedAt) ? <p className="text-2xs text-text-muted">
        {status.cloudUpdatedAt ? `Cloud data updated ${new Date(status.cloudUpdatedAt).toLocaleString()} · Revision ${status.revision ?? 0}` : ''}
        {status.localUpdatedAt ? `${status.cloudUpdatedAt ? ' · ' : ''}Local data updated ${new Date(status.localUpdatedAt).toLocaleString()}` : ''}
      </p> : null}
      {status?.signedIn ? <>
        <p className="break-all text-2xs text-text-muted">Account: {status.accountLabel ?? 'Signed-in account'}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || status.state === 'syncing'} onClick={() => void run({ type: 'sync' })}>Sync now</Button>
          <Button disabled={busy} onClick={() => void run({ type: 'disconnect' })}>Disconnect sync</Button>
          <Button disabled={busy} onClick={() => void run({ type: 'exportAccount' })}>Export cloud data</Button>
        </div>
        {status.state === 'review' ? <div className="flex flex-col gap-2 border border-border p-2">
          <p className="text-2xs">{status.message}</p>
          <p className="text-2xs text-text-muted">Import combines this device’s library with the account’s library and uses this device’s version where IDs match. Using cloud data replaces this device’s library, with a recovery backup first. An empty cloud account restores factory defaults.</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => select('local')}>Import this device’s data</Button>
            <Button disabled={busy} onClick={() => select('cloud')}>Use cloud data from this account</Button>
          </div>
        </div> : null}
        {status.state === 'conflict' ? <div className="flex flex-col gap-2 border border-border p-2">
          <p className="text-2xs">{status.message}</p>
          {(status.conflictCount ?? 0) > 20 ? <p className="text-2xs text-text-muted">{status.conflictCount} records need review. Showing the first 20; more appear as you resolve them.</p> : null}
          {status.conflicts?.map(conflict => <details key={conflict.key} className="text-2xs" data-sync-conflict>
            <summary className="cursor-pointer">Review {conflict.kind}: {conflict.key}</summary>
            <p className="mt-2 text-text-muted">This device</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{conflict.local ?? '(deleted)'}</pre>
            <p className="mt-2 text-text-muted">Cloud</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{conflict.cloud ?? '(deleted)'}</pre>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => select('local', conflict.key)}>Keep device version</Button>
              <Button disabled={busy} onClick={() => select('cloud', conflict.key)}>Keep cloud version</Button>
            </div>
          </details>)}
        </div> : null}
        {choice ? <div role="alert" className="border border-border p-2 text-2xs">
          <p>{choice.key ? 'Apply this choice to the selected record? For a deleted portfolio, this also chooses its holdings and options. Both libraries are saved in a private local recovery file before resolving. Other records keep syncing.' : choice.use === 'local' ? 'Confirm that this device’s data belongs to this account. Import it into the cloud library? Matching record IDs use this device’s version.' : 'Replace local data with this account’s cloud library? Your current local data will be backed up first.'}</p>
          <div className="mt-2 flex gap-2"><Button disabled={busy} onClick={() => void run({ type: 'resolve', ...choice })}>Confirm choice</Button><Button disabled={busy} onClick={() => setChoice(null)}>Cancel</Button></div>
        </div> : null}
        <details><summary className="cursor-pointer text-2xs text-text-muted">Delete cloud account</summary>
          <p className="mt-2 text-2xs">Deletes this account’s cloud records, archived snapshots, history and sign-in account. All connected devices stop uploading. Local files, local recovery backups and files you exported remain on your devices. This cannot be undone.</p>
          {!deleting ? <Button disabled={busy} onClick={() => setDeleting(true)}>Delete account</Button> : <div className="mt-2 flex flex-col gap-2">
            <label className="text-2xs">Type DELETE MY ACCOUNT<input className={inputClass} aria-label="Confirm cloud account deletion" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
            <div className="flex gap-2"><Button disabled={busy || confirmation !== 'DELETE MY ACCOUNT'} onClick={() => void run({ type: 'deleteAccount', confirmation: 'DELETE MY ACCOUNT' })}>Permanently delete account</Button><Button disabled={busy} onClick={() => { setDeleting(false); setConfirmation('') }}>Cancel deletion</Button></div>
          </div>}
        </details>
        {status.metrics ? <details><summary className="cursor-pointer text-2xs text-text-muted">Sync diagnostics</summary>
          <p className="mt-2 text-2xs text-text-muted">This session: {status.metrics.attempts} attempts, {status.metrics.failures} failures; last attempt {status.metrics.lastDurationMs} ms. Sent {status.metrics.sentRecords} records ({status.metrics.sentBytes.toLocaleString()} bytes); received {status.metrics.receivedRecords} records ({status.metrics.receivedBytes.toLocaleString()} bytes). Pending records: {status.pendingRecords ?? 0}.</p>
        </details> : null}
      </> : status?.signInPending ? <div className="flex flex-col gap-2">
        <p className="text-2xs" role="status">{status.message ?? 'Waiting for GitHub approval in your browser…'}</p>
        <Button disabled={busy} onClick={() => void run({ type: 'cancelSignIn' })}>Cancel sign-in</Button>
      </div> : <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void run(codeSent ? { type: 'verifyCode', url: codeUrl, email, code } : { type: 'sendCode', url: deployment, email }) }}>
        <p className="text-xs">Sign in to sync your data</p>
        {!available && status ? <p className="text-2xs text-warn">Cloud sign-in is not configured in this build. You can keep using all local features. The service operator must configure a production release.</p> : null}
        <label className="text-2xs">Account email<input className={inputClass} type="email" required autoComplete="email" aria-label="Sync account email" value={email} disabled={busy || codeSent} onChange={event => setEmail(event.target.value)} /></label>
        {codeSent ? <label className="text-2xs">Email code<input className={inputClass} autoComplete="one-time-code" required maxLength={32} aria-label="Sync email code" value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\s/g, ''))} /></label> : null}
        <div className="flex flex-wrap gap-2"><Button type="submit" variant="accent" disabled={busy || !status?.encryptionAvailable || !available}>{codeSent ? 'Verify and connect' : 'Send sign-in code'}</Button>
          {codeSent ? <Button disabled={busy} onClick={() => { setCodeSent(false); setCode(''); setNotice('') }}>Change details / resend</Button> : <Button disabled={busy || !status?.encryptionAvailable || !available} onClick={() => void run({ type: 'signInGitHub', url: deployment })}>Sign in with GitHub</Button>}</div>
        <details onToggle={event => setAdvanced(event.currentTarget.open)}><summary className="cursor-pointer text-2xs text-text-muted">Advanced: custom sync server</summary>
          <label className="text-2xs">Convex deployment URL<input className={inputClass} type="url" aria-label="Convex deployment URL" placeholder="https://your-deployment.convex.cloud" value={url} disabled={busy || codeSent} onChange={event => setUrl(event.target.value)} /></label>
          <p className="text-2xs text-text-muted">Use a trusted server only. It receives your saved financial records. Developer setup: docs/convex-sync.md.</p>
        </details>
        {status && !status.encryptionAvailable ? <p className="text-2xs text-warn">Enable your OS credential keyring to connect sync. Local saves remain available.</p> : null}
      </form>}
      <p className="text-2xs text-text-dim">Browser sessions, provider API keys, agents and market caches stay on this device. Disconnect keeps local data and the cloud copy. Cloud data is not end-to-end encrypted.</p>
      {status?.message && !['error', 'conflict', 'review'].includes(status.state) && !status.signInPending ? <p className="text-2xs">{status.message}</p> : null}
      {notice ? <p role="status" className="text-2xs">{notice}</p> : null}
      {error || status?.state === 'error' ? <p role="alert" className="text-2xs text-down">{error || status?.message}</p> : null}
    </div>
  </Panel>
}
