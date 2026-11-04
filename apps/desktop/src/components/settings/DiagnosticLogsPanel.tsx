import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DiagnosticEntry, DiagnosticSnapshot } from '@shared/contract'
import { Panel } from '@/components/ui/Panel'

export function DiagnosticLogsPanel({ active }: { active: boolean }) {
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>({ entries: [], files: 0, bytes: 0 })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [paused, setPaused] = useState(false)
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState('')
  const [area, setArea] = useState('')
  const [session, setSession] = useState('')
  const [selected, setSelected] = useState<DiagnosticEntry | null>(null)
  const [updated, setUpdated] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    try {
      const result = await window.api.diagnosticLogs()
      if (result.meta.freshness === 'failed') { setError(result.meta.failureReason || 'Cannot read log storage.'); return }
      setSnapshot(result.data)
      setError('')
      setUpdated(new Date(result.meta.fetchedAt).toLocaleTimeString())
    } catch { setError('Cannot read log storage. Please try again.') }
  }, [])
  useEffect(() => {
    if (!active || paused) return
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    return () => clearInterval(timer)
  }, [active, paused, refresh])
  const action = async (value: 'folder' | 'export') => {
    setBusy(true)
    try {
      const result = await window.api.diagnosticLogAction(value)
      setNotice(result.data.message)
    } catch { setNotice('The action could not complete. Please try again.') }
    finally { setBusy(false) }
  }
  const matches = useMemo(() => snapshot.entries.filter(entry => (!level || entry.level === level) &&
    (!area || entry.area === area) && (!session || entry.session === session) &&
    JSON.stringify(entry).toLowerCase().includes(search.toLowerCase().trim())), [snapshot, level, area, session, search])
  return <Panel title="Diagnostic logs">
    <div className="diagnostic-logs">
      <p>Local logs · {paused ? 'Live paused' : 'Live every 2 seconds'}{updated && ` · Updated ${updated}`}</p>
      <div className="diagnostic-log-controls">
        <label>Search<input aria-label="Search logs" type="search" placeholder="Event, operation, error category…" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label>Severity<select aria-label="Log severity" value={level} onChange={event => setLevel(event.target.value)}>
          <option value="">All levels</option>{['error', 'warn', 'info', 'debug'].map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label>Area<select aria-label="Log area" value={area} onChange={event => setArea(event.target.value)}>
          <option value="">All areas</option>{[...new Set(snapshot.entries.map(entry => entry.area))].sort().map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label>Session<select aria-label="Log session" value={session} onChange={event => setSession(event.target.value)}>
          <option value="">All sessions</option>{[...new Set(snapshot.entries.map(entry => entry.session))].map(value => <option key={value}>{value}</option>)}
        </select></label>
        <button type="button" onClick={() => setPaused(value => !value)}>{paused ? 'Resume live' : 'Pause live'}</button>
        <button type="button" onClick={() => void refresh()}>Refresh logs</button>
        <button type="button" disabled={busy} onClick={() => void action('export')}>Export snapshot</button>
        <button type="button" disabled={busy} onClick={() => void action('folder')}>Open log folder</button>
      </div>
      {error && <p role="alert">{error} The last successful snapshot remains visible.</p>}
      {notice && <p role="status">{notice}</p>}
      <p role="status">{matches.length} matching / {snapshot.entries.length} loaded records · {snapshot.files} files · Showing up to 500 matches, newest first</p>
      <div className="diagnostic-log-table"><table><thead><tr><th>Time</th><th>Level</th><th>Area</th><th>Event</th><th>Technical details</th></tr></thead>
        <tbody>{matches.slice(0, 500).map((entry, index) => <tr key={`${entry.session}-${entry.time}-${index}`}>
          <td>{new Date(entry.time).toLocaleString()}</td><td>{entry.level}</td><td>{entry.area}</td>
          <td><button type="button" onClick={() => setSelected(entry)}>{entry.event}</button></td><td>{JSON.stringify(entry.details)}</td>
        </tr>)}</tbody></table></div>
      {!matches.length && <p>No records match these filters.</p>}
      <h3>Record details</h3><pre tabIndex={0}>{selected ? JSON.stringify(selected, null, 2) : 'Select an event to inspect its full record.'}</pre>
      <p>Logs stay on this device for up to 15 days with approximately 64 MiB of storage. Nothing is uploaded automatically. Request payloads, browser content, credentials and raw error messages are excluded.</p>
      <p>Export reads the whole retained snapshot, including records hidden by filters. It may include newer events while live reading is paused.</p>
    </div>
  </Panel>
}
