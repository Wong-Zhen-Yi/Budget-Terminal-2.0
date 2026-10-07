import { useEffect, useState } from 'react'
import type { LocalSendAction } from '@shared/localSend'
import { useLocalSend } from '@/api/localSendQueries'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'

const inputStyle = 'h-8 border border-border bg-bg px-2 text-2xs text-text'

export function LocalSendPanel() {
  const { query, act } = useLocalSend()
  const status = query.data?.data
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [port, setPort] = useState('53317')
  const [address, setAddress] = useState('')
  const [remotePort, setRemotePort] = useState('53317')
  const [selected, setSelected] = useState('')
  const [code, setCode] = useState('')
  useEffect(() => { if (status?.port) setPort(String(status.port)) }, [status?.port])
  const run = async (action: LocalSendAction) => {
    setBusy(true)
    setNotice('')
    try {
      const result = await act(action)
      setNotice(result.meta.failureReason ?? result.data.message ?? '')
    } catch (error) { setNotice(String(error)) }
    finally { setBusy(false) }
  }

  return <Panel title="LocalSend sync" className="p-3">
    <p className="mt-1 text-2xs text-text-muted">
      Automatically sync portfolios, personal finance, settings and cards between paired Budget Terminal devices on the same network.
      Transfers use encrypted LocalSend connections. Both apps must be running.
    </p>
    <p role="status" className={`mt-2 text-2xs ${status?.error || query.error ? 'text-down' : 'text-text'}`}>
      {status?.error ?? query.error?.message ?? (status?.running ? `Running · ${status.alias} · port ${status.port}` : status?.enabled ? 'Sync could not start' : 'Sync is off')}
    </p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="text-2xs text-text-muted">Listen port <input aria-label="LocalSend listen port" className={`${inputStyle} ml-1 w-20`} type="number" min="1024" max="65535" value={status?.running ? status.port : port} disabled={status?.running || busy} onChange={event => setPort(event.target.value)} /></label>
      <Button disabled={busy || query.isLoading} onClick={() => void run({ type: 'enable', enabled: !status?.running, port: status?.running ? status.port : Number(port) })}>
        {status?.running ? 'Disable sync' : 'Enable sync'}
      </Button>
      <Button disabled={busy || !status?.running} onClick={() => void run({ type: 'discover' })}>Find devices</Button>
      <Button disabled={busy || !status?.running} onClick={() => void run({ type: 'sync' })}>Sync now</Button>
    </div>
    {status?.running && <>
      <p className="mt-2 text-2xs text-text-muted">This device: {status.addresses.map(ip => `${ip}:${status.port}`).join(', ') || `127.0.0.1:${status.port}`}</p>
      <div className="mt-3 border-t border-border pt-3">
        <p className="text-2xs text-text-muted">On the receiving device, open pairing. On the device with the data you want to use, select the receiver and enter its code. The initial sync replaces the receiver’s saved data and keeps a recovery backup.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => void run({ type: 'openPairing' })}>Open pairing on this device</Button>
          {status.pairingCode && <strong className="text-sm tracking-widest text-accent" aria-label="LocalSend pairing code">{status.pairingCode}</strong>}
          {status.pairingCode && <span className="text-2xs text-text-muted">Expires {new Date(status.pairingExpiresAt!).toLocaleTimeString()}</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <select aria-label="LocalSend receiving device" className={inputStyle} value={selected} onChange={event => setSelected(event.target.value)}>
            <option value="">Select receiving device</option>
            {status.devices.filter(device => device.budgetTerminal && device.protocol === 'https').map(device => <option key={device.fingerprint} value={device.fingerprint}>{device.alias} · {device.address}</option>)}
          </select>
          <input aria-label="Receiver pairing code" className={`${inputStyle} w-28`} inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} />
          <Button disabled={busy || !selected || code.length !== 6} onClick={() => void run({ type: 'pair', fingerprint: selected, code })}>Pair & send this data</Button>
        </div>
      </div>
      <details className="mt-3 text-2xs text-text-muted">
        <summary className="cursor-pointer">Connect by IP address</summary>
        <p className="mt-1">Use the receiving device’s address if network discovery is unavailable. Allow Budget Terminal through the firewall on your private network.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input aria-label="LocalSend device IP address" className={inputStyle} placeholder="192.168.1.10" value={address} onChange={event => setAddress(event.target.value.trim())} />
          <input aria-label="LocalSend device port" className={`${inputStyle} w-20`} type="number" min="1024" max="65535" value={remotePort} onChange={event => setRemotePort(event.target.value)} />
          <Button disabled={busy || !address} onClick={() => void run({ type: 'connect', address, port: Number(remotePort) })}>Connect</Button>
        </div>
      </details>
    </>}
    <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto text-2xs" aria-label="LocalSend devices">
      {status?.devices.map(device => <li className="border border-border p-2 text-text" key={device.fingerprint}>
        <div className="flex items-center gap-2"><span className="min-w-0 flex-1 break-words">{device.alias} · {device.address}:{device.port} · {device.paired ? 'Paired' : device.budgetTerminal ? 'Ready to pair' : 'LocalSend file transfers only'}</span>
          {device.paired && <Button disabled={busy} onClick={() => void run({ type: 'forget', fingerprint: device.fingerprint })}>Unpair</Button>}
        </div>
        {device.lastSyncedAt && <p className="mt-1 text-text-muted">Last sync: {new Date(device.lastSyncedAt).toLocaleString()}</p>}
        {device.error && <p className="mt-1 text-down">{device.error}</p>}
      </li>)}
    </ul>
    {status?.pending && <div className="mt-3 border border-down p-3" role="alert">
      <p className="text-2xs text-text">Incoming snapshot from {status.pending.alias} · exported {new Date(status.pending.exportedAt).toLocaleString()}</p>
      <p className="mt-1 text-2xs text-text-muted">Automatic replacement is paused. Applying this snapshot replaces all saved user data, settings and cards. Your current data will be saved in a recovery backup.</p>
      <div className="mt-2 flex gap-2">
        <Button disabled={busy || !status.running} variant="danger" onClick={() => void run({ type: 'resolve', id: status.pending!.id, accept: true })}>Apply incoming data</Button>
        <Button disabled={busy || !status.running} onClick={() => void run({ type: 'resolve', id: status.pending!.id, accept: false })}>Keep local data</Button>
      </div>
    </div>}
    {(notice || status?.message) && <p className="mt-2 text-2xs text-text-muted" role="status">{notice || status?.message}</p>}
    {status?.recoveryPath && <p className="mt-2 break-all text-2xs text-text-muted">Recovery backup: {status.recoveryPath}</p>}
  </Panel>
}
