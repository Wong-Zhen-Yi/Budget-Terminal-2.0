import { useEffect, useRef, useState } from 'react'
import type { CloudSyncStatus } from '@shared/cloudSync'
import { useCloudSyncCommand } from '@/api/cloudSyncQueries'
import { Button } from '@/components/ui/Button'

export function AuthPopup({ status, statusError, onRetry, onContinue, onDontShowAgain }: {
  status?: CloudSyncStatus
  statusError?: string
  onRetry: () => void
  onContinue: () => void
  onDontShowAgain: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [url, setUrl] = useState(status?.url ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const command = useCloudSyncCommand()

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  useEffect(() => {
    if (status?.url) setUrl(current => current || status.url)
  }, [status?.url])

  const run = async (cancel = false, retrySession = false, cleanup = false) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await command(cleanup ? { type: 'retryCredentialCleanup' } : retrySession ? { type: 'retrySession' } : cancel ? { type: 'cancelSignIn' } : { type: 'signInGitHub', url: url.trim() })
      setError(result.meta.failureReason ?? '')
    } catch {
      setError('Unable to complete sign-in. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  const failure = error || statusError || (status?.state === 'error' ? status.message : '')

  return <dialog ref={dialog} className="auth-popup" aria-labelledby="auth-title" aria-describedby="auth-description"
    onCancel={event => { event.preventDefault(); if (!busy) onContinue() }}
    onKeyDown={event => event.stopPropagation()}>
    <button type="button" className="auth-popup-close" aria-label="Close sign-in popup" disabled={busy} onClick={onContinue}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
    </button>
    <div className="auth-popup-brand"><span aria-hidden="true">BT</span><span>Budget Terminal</span></div>
    <h1 id="auth-title">{mode === 'signIn' ? 'Sign in to your workspace' : 'Create your account'}</h1>
    <p id="auth-description">Your portfolios, preferences and saved work.<br />Together on every device.</p>
    {!status ? <div className="auth-popup-actions">
      <p role="alert">Account status is unavailable. Try again or continue on this device.</p>
      <Button onClick={onRetry}>Try again</Button>
    </div> : status.signInPending ? <div className="auth-popup-actions">
      <div className="auth-popup-pending" role="status"><span className="auth-popup-spinner" aria-hidden="true" /><strong>Check your browser</strong><p>{status.message ?? 'Complete sign-in in your browser, then return here.'}</p></div>
      <Button disabled={busy} onClick={() => void run(true)}>Cancel sign-in</Button>
    </div> : <form className="auth-popup-actions" onSubmit={event => { event.preventDefault(); void run() }}>
      {!status.url && <label htmlFor="auth-deployment">Cloud deployment URL
        <input id="auth-deployment" type="url" required placeholder="https://your-deployment.convex.cloud"
          value={url} disabled={busy} onChange={event => setUrl(event.target.value)} />
        <span className="auth-popup-hint">Use the deployment URL for your Budget Terminal cloud setup.</span>
      </label>}
      <Button type="submit" variant="accent" className="auth-popup-primary" disabled={busy || status.credentialCleanupRequired || !status.encryptionAvailable || !url.trim()}>
        {busy ? <span className="auth-popup-spinner" aria-hidden="true" /> : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.4-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15A10.8 10.8 0 0 1 12 6.16c.96 0 1.92.13 2.81.38 2.15-1.46 3.09-1.15 3.09-1.15.62 1.55.23 2.7.12 2.98.72.79 1.15 1.79 1.15 3.02 0 4.32-2.63 5.27-5.14 5.55.41.35.77 1.03.77 2.08v3.11c0 .3.2.65.77.54A11.25 11.25 0 0 0 12 .75Z" /></svg>}
        {busy ? 'Opening GitHub…' : 'Continue with GitHub'}
      </Button>
      <p className="auth-popup-session"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>You’ll stay signed in on this device</p>
      {mode === 'signUp' && <p className="auth-popup-hint">Your first GitHub sign-in creates your account.</p>}
      {!status.encryptionAvailable && <p className="text-warn" role="status">Enable your operating system’s credential keyring to sign in.</p>}
      {status.credentialCleanupRequired ? <Button disabled={busy} onClick={() => void run(false, false, true)}>Retry credential cleanup</Button> :
        ['keyringUnavailable', 'storageError'].includes(status.authState ?? '') && <Button disabled={busy} onClick={() => void run(false, true)}>Retry saved sign-in</Button>}
    </form>}
    {failure && <p className="auth-popup-error" role="alert">{failure}</p>}
    <p className="auth-popup-switch">{mode === 'signIn' ? 'New to Budget Terminal?' : 'Already have an account?'}{' '}
      <button type="button" disabled={busy || status?.signInPending} onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>{mode === 'signIn' ? 'Sign up' : 'Sign in'}</button>
    </p>
    <div className="auth-popup-footer">
      <Button disabled={busy} onClick={onContinue}>Continue locally</Button>
      <button type="button" className="auth-popup-dismiss" disabled={busy} onClick={onDontShowAgain}>Don’t show again</button>
      <p>Sign in anytime in Settings → Cloud sync.</p>
    </div>
  </dialog>
}
