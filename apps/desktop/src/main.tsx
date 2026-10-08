import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { browserAccessRequest, browserSession, clearBrowserState, installBrowserApi, isBrowser, pairBrowser } from './api/browser'
import type { BrowserAccessRequest } from './api/browser'
import './styles/theme.css'

// Service modules read window.api during evaluation. Load them after pairing
// installs the browser bridge; Electron already has its bridge at startup.
const Terminal = lazy(() => import('./TerminalRoot'))

function Entry() {
  const [ready, setReady] = useState<boolean>(!isBrowser)
  const [checking, setChecking] = useState<boolean>(isBrowser)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [access, setAccess] = useState<BrowserAccessRequest | null>(null)
  useEffect(() => {
    if (!isBrowser) return
    let current = true
    setChecking(true)
    setError('')
    void browserSession().then(async (session) => {
      if (!current) return
      if (session.authenticated && session.csrf) {
        installBrowserApi(session.csrf)
        setReady(true)
      } else {
        clearBrowserState()
        const request = await browserAccessRequest()
        if (!current) return
        if (request.state === 'approved' && request.csrf) {
          installBrowserApi(request.csrf)
          setReady(true)
        } else setAccess(request)
      }
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : 'Could not connect to the desktop.')
    }).finally(() => { if (current) setChecking(false) })
    return () => { current = false }
  }, [attempt])

  useEffect(() => {
    if (ready || access?.state !== 'pending') return
    let current = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await browserAccessRequest()
        if (!current) return
        setError('')
        if (result.state === 'approved' && result.csrf) {
          installBrowserApi(result.csrf)
          setReady(true)
          return
        }
        if (result.state !== 'pending') { setAccess({ ...result, id: result.id ?? access.id }); return }
      } catch (reason) {
        if (current) setError(reason instanceof Error ? reason.message : 'Could not check access approval. Retrying…')
      }
      if (current) timer = setTimeout(() => void poll(), 2_000)
    }
    timer = setTimeout(() => void poll(), 2_000)
    return () => { current = false; clearTimeout(timer) }
  }, [ready, access?.state, access?.id])

  if (ready) return <Suspense fallback={<div className="flex h-full items-center justify-center text-text-muted">Opening Budget Terminal…</div>}><Terminal /></Suspense>

  return <main className="flex h-full overflow-y-auto p-5">
    <form className="m-auto w-full max-w-md shrink-0 rounded border border-border-strong bg-surface p-6" onSubmit={(event) => {
      event.preventDefault()
      if (checking || busy || !/^\d{4}$/.test(code)) return
      setBusy(true)
      setError('')
      void pairBrowser(code).then((session) => {
        installBrowserApi(session.csrf!)
        setReady(true)
      }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Pairing failed.'))
        .finally(() => setBusy(false))
    }}>
      <p className="mb-3 text-2xs font-semibold tracking-widest text-accent-hover">BUDGET TERMINAL</p>
      <h1 className="text-sm font-semibold">Pair this browser</h1>
      <p className="mt-3 text-2xs text-text-muted">Enter the four-digit code from PC Settings → Remote, or request approval from your PC. Keep Budget Terminal running and both devices connected to Tailscale.</p>
      <label htmlFor="pair-code" className="mt-5 block text-2xs">Pairing code</label>
      <input id="pair-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="0000" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} required disabled={checking || busy}
        className="num mt-2 w-full rounded border border-border-strong bg-bg p-3 text-base text-text" />
      {error ? <p role="alert" className="mt-3 text-2xs text-down">{error}</p> : null}
      <button type="submit" disabled={checking || busy || !/^\d{4}$/.test(code)} className="mt-4 min-h-11 w-full rounded border border-accent bg-accent-dim px-4 py-2 text-text disabled:opacity-50">{checking ? 'Checking connection…' : busy ? 'Connecting…' : 'Pair browser'}</button>
      <button type="button" disabled={checking || busy || access?.state === 'pending'} className="mt-3 min-h-11 w-full rounded border border-accent bg-accent-dim px-4 py-2 text-text disabled:opacity-50" onClick={() => {
        setBusy(true)
        setError('')
        void browserAccessRequest(true).then(setAccess)
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not request access.'))
          .finally(() => setBusy(false))
      }}>{access?.state === 'pending' ? 'Access requested' : 'Request Access'}</button>
      {access?.state === 'pending' ? <p role="status" className="mt-3 text-2xs text-text-muted">Waiting for approval on your PC. Open Review access beside Remote in the top bar, or Settings → Remote. Match request <strong className="num text-text">{access.id}</strong>. {access.expiresAt ? `Expires at ${new Date(access.expiresAt).toLocaleTimeString()}.` : ''}</p> : null}
      {access?.state === 'denied' ? <p role="status" className="mt-3 text-2xs text-warn">Your PC declined this request. You can request access again or enter a pairing code.</p> : null}
      {access?.state === 'expired' && access.id ? <p role="status" className="mt-3 text-2xs text-warn">Access request expired. Request access again or enter a pairing code.</p> : null}
      <button type="button" onClick={() => setAttempt((value) => value + 1)} disabled={checking || busy} className="mt-3 min-h-11 w-full rounded border border-border px-4 py-2 text-2xs text-text-muted">Retry connection</button>
      <p className="mt-4 text-2xs text-text-dim">Once approved, this browser is remembered across PC and app restarts. Access renews for 30 days when reopened. This browser can view and edit your saved data. Use Log out when finished on a shared device.</p>
    </form>
  </main>
}

createRoot(document.getElementById('root')!).render(<Entry />)
