import { useState, useSyncExternalStore } from 'react'
import { browserConnection, logoutBrowser, onBrowserConnection } from '@/api/browser'

export function BrowserConnection() {
  const state = useSyncExternalStore(onBrowserConnection, browserConnection)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <div className="browser-connection flex shrink-0 items-center gap-2 text-2xs" role="status">
    <span className={state === 'connected' ? 'text-up' : 'text-warn'} title="Connection to your Budget Terminal PC">{state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting…' : 'Disconnected · reconnecting…'}</span>
    <button type="button" disabled={busy} className="rounded border border-border-strong px-2 py-1 text-text-muted disabled:opacity-50" onClick={() => {
      setBusy(true)
      setError('')
      void logoutBrowser().catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Logout failed.')
        setBusy(false)
      })
    }}>{busy ? 'Logging out…' : 'Log out'}</button>
    {error ? <span role="alert" className="max-w-64 text-down">{error}</span> : null}
  </div>
}
