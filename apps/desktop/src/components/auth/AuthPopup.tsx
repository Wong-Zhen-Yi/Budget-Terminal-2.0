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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const command = useCloudSyncCommand()

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  const [opening, setOpening] = useState(false)
  const run = async (cancel = false, retrySession = false, cleanup = false) => {
    if (busy) return
    setBusy(true)
    setError('')
    if (!cancel && !retrySession && !cleanup) setOpening(true)
    try {
      const result = await command(cleanup ? { type: 'retryCredentialCleanup' } : retrySession ? { type: 'retrySession' } : cancel ? { type: 'cancelSignIn' }
        : { type: 'signInGoogle' })
      setError(result.meta.failureReason ?? '')
    } catch {
      setError('Unable to complete sign-in. Please try again.')
    } finally {
      setBusy(false)
      setOpening(false)
    }
  }
  const signInDisabled = busy || status?.credentialCleanupRequired || !status?.encryptionAvailable
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
      <Button type="submit" variant="accent" className="auth-popup-primary" disabled={signInDisabled}>
        {opening ? <span className="auth-popup-spinner" aria-hidden="true" /> : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.6 10.2H12v3.9h5.5c-.5 2.5-2.7 4.1-5.5 4.1a6.2 6.2 0 1 1 4-10.9l2.9-2.9A10.2 10.2 0 1 0 12 22.2c5.9 0 9.8-4.1 9.8-9.9 0-.7-.1-1.4-.2-2.1Z" /></svg>}
        {opening ? 'Opening Google…' : 'Continue with Google'}
      </Button>
      <p className="auth-popup-session"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>You’ll stay signed in on this device</p>
      {mode === 'signUp' && <p className="auth-popup-hint">Your first Google sign-in creates your account.</p>}
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
