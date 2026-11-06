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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [choice, setChoice] = useState<'local' | 'cloud' | null>(null)

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
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await window.api.cloudSyncCommand(command)
      setStatus(result.data)
      if (result.meta.failureReason) setError(result.meta.failureReason)
      else {
        setChoice(null)
        if (command.type === 'sendCode') { setCodeSent(true); setNotice(result.data.message ?? 'Code sent.') }
        if (command.type === 'verifyCode' || command.type === 'disconnect') {
          setCode(''); setEmail(''); setUrl(''); setCodeSent(false)
        }
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
      </div> : <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void run(codeSent ? { type: 'verifyCode', url, email, code } : { type: 'sendCode', url, email }) }}>
        <label className="text-2xs">Convex deployment URL<input className={inputClass} type="url" required aria-label="Convex deployment URL" placeholder="https://your-deployment.convex.cloud" value={url} disabled={busy || codeSent} onChange={event => setUrl(event.target.value)} /></label>
        <Button variant="accent" disabled={busy || !status?.encryptionAvailable || !url.trim() || codeSent} onClick={() => void run({ type: 'signInGitHub', url })}>Sign in with GitHub</Button>
        <p className="text-2xs text-text-muted">Approve sign-in in your system browser, then return here. No Convex developer login or deployment key is needed in the app.</p>
        <details><summary className="cursor-pointer text-2xs text-text-muted">Use email code instead</summary>
        <div className="mt-2 flex flex-col gap-2">
        <label className="text-2xs">Account email<input className={inputClass} type="email" required autoComplete="email" aria-label="Sync account email" value={email} disabled={busy || codeSent} onChange={event => setEmail(event.target.value)} /></label>
        {codeSent ? <label className="text-2xs">Email code<input className={inputClass} autoComplete="one-time-code" required maxLength={32} aria-label="Sync email code" value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\s/g, ''))} /></label> : null}
        <div className="flex gap-2"><Button type="submit" disabled={busy || !status?.encryptionAvailable}>{codeSent ? 'Verify and connect' : 'Send sign-in code'}</Button>
          {codeSent ? <Button disabled={busy} onClick={() => { setCodeSent(false); setCode(''); setNotice('') }}>Change details / resend</Button> : null}</div>
        </div></details>
        {status && !status.encryptionAvailable ? <p className="text-2xs text-warn">Enable your OS credential keyring to connect sync. Local saves remain available.</p> : null}
        <p className="text-2xs text-text-dim">Deploy this repository’s Convex backend first; setup instructions are in docs/convex-sync.md. No deployment key is needed in the app.</p>
      </form>}
      <p className="text-2xs text-text-dim">Browser sessions, provider API keys, agents and market caches stay on this device. Disconnect keeps your local data and your cloud copy.</p>
      {notice ? <p role="status" className="text-2xs">{notice}</p> : null}
      {error || status?.state === 'error' ? <p role="alert" className="text-2xs text-down">{error || status?.message}</p> : null}
    </div>
  </Panel>
}
