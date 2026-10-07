import { useEffect, useState } from 'react'
import type { SyncAction, SyncStatus } from '@shared/sync'
import { api } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'

const labels = { portfolio: 'Portfolios', personalFinance: 'Personal finance', cards: 'Cards' }
const inputStyle = 'h-8 border border-border bg-surface px-2 text-xs text-text'

export function PersonalSyncPanel() {
  const [status, setStatus] = useState<SyncStatus>({ email: null, state: 'signedOut', pending: [], conflicts: [] })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    const stop = api.onSyncChanged((next) => { if (live) setStatus(next) })
    void api.syncStatus().then((result) => { if (live) setStatus(result.data) }).catch(() => {
      if (live) setError('Could not read sync status.')
    })
    return () => { live = false; stop() }
  }, [])

  async function run(action: SyncAction) {
    setBusy(true)
    setError('')
    try {
      const result = await api.syncAction(action)
      setStatus(result.data)
      setError(result.meta.failureReason ?? '')
    } catch { setError('Could not contact sync service. Your local data is retained.') }
    finally { setPassword(''); setCode(''); setBusy(false) }
  }

  return <Panel title="Personal Cloud Sync">
    <div className="flex flex-col gap-3 p-3 text-xs text-text-muted">
      <p>Sync portfolios, personal finance, and strategy cards across your PCs. Market data, charts, API keys, and general settings stay on each PC.</p>
      <p role="status">{status.email ? `${status.email} · ${status.state}` : 'Sign in with the same account on every PC.'}</p>
      {status.lastSyncedAt && <p>Last synced: {new Date(status.lastSyncedAt).toLocaleString()}</p>}
      {!!status.pending.length && <p>Pending: {status.pending.map((dataset) => labels[dataset]).join(', ')}</p>}
      {(error || status.message) && <p role="alert" className={status.state === 'error' || error ? 'text-down' : ''}>{error || status.message}</p>}
      {!status.email ? <>
        <p>This PC uploads the initial copy if your cloud account is empty. If another PC already uploaded data, you can review differing copies before replacing anything.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => { void api.openExternal('https://supabase.com/dashboard/project/rclwztheheenuyisyswy/auth/users').catch(() => setError('Could not open the Supabase dashboard.')) }}>Open Supabase dashboard</Button>
          <p>Create your sync user under Authentication → Users, then sign in here. Your dashboard login is separate.</p>
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run({ type: 'signIn', email: email.trim(), password }) }}>
          <input aria-label="Sync email" className={inputStyle} type="email" autoComplete="username" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={busy} />
          <input aria-label="Sync password" className={inputStyle} type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} />
          <Button type="submit" disabled={busy}>Sign in</Button>
          <Button disabled={busy || !email || password.length < 8} onClick={() => void run({ type: 'signUp', email: email.trim(), password })}>Create account</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <input aria-label="Email confirmation code" className={inputStyle} autoComplete="one-time-code" inputMode="numeric" placeholder="Email confirmation code" value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} />
          <Button disabled={busy || !email || !/^\d{6,8}$/.test(code)} onClick={() => void run({ type: 'confirmEmail', email: email.trim(), code })}>Confirm email</Button>
        </div>
      </> : <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void run({ type: 'sync' })}>Sync now / Retry</Button>
        <Button disabled={busy} onClick={() => void run({ type: 'signOut' })}>Sign out</Button>
      </div>}
      {status.conflicts.map((conflict) => <div key={conflict.dataset} className="flex flex-col gap-2 border border-border p-2">
        <p className="text-text">{labels[conflict.dataset]}: both copies differ. Choose the copy to keep for this dataset.</p>
        <p>Cloud updated: {new Date(conflict.updatedAt).toLocaleString()}. A local backup is saved before downloading.</p>
        <details><summary className="cursor-pointer">Compare saved records</summary>
          <div className="grid grid-cols-2 gap-2">
            <div><p>This PC</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(conflict.local, null, 2)}</pre></div>
            <div><p>Cloud</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(conflict.cloud, null, 2)}</pre></div>
          </div>
        </details>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => void run({ type: 'resolve', dataset: conflict.dataset, choice: 'local', token: conflict.token })}>Keep this PC’s copy</Button>
          <Button disabled={busy} onClick={() => void run({ type: 'resolve', dataset: conflict.dataset, choice: 'cloud', token: conflict.token })}>Use cloud copy</Button>
        </div>
      </div>)}
    </div>
  </Panel>
}
