import { useEffect, useState } from 'react'
import type { NotificationCommand } from '@shared/notifications'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { useNotificationCommand, useNotifications } from '@/api/notificationsQueries'
import '@/styles/reminders.css'

const date = (at: number | null) => at === null ? '—' : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
export function RemindersPage({ inbox = false, onNavigate, onStatusChange }: {
  inbox?: boolean
  onNavigate: (id: string) => void
  onStatusChange: (panels: PanelStatus[], path: string) => void
}) {
  const query = useNotifications()
  const command = useNotificationCommand()
  const state = query.data?.data
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(Date.now())
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [source, setSource] = useState('all')
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => onStatusChange([{ label: 'Notifications', envelope: query.data, loading: query.isPending, error: query.error }], ''),
    [onStatusChange, query.data, query.isPending, query.error])
  const unavailable = !state || !!query.error || query.data?.meta.freshness === 'failed'
  const perform = async (input: NotificationCommand) => {
    setBusy(true); setMessage('')
    try {
      const result = await command(input)
      if (input.type === 'test') {
        const test = result.notifications.find(item => item.source === 'test')
        setMessage(test?.desktopStatus === 'shown'
          ? 'Test sent to your desktop and saved in Notifications. If no banner appeared, check Windows notification settings and Do not disturb.'
          : `Test saved in Notifications. Desktop popup unavailable: ${test?.deliveryError || 'delivery was not confirmed'}`)
      }
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  const remaining = Math.max(0, Math.ceil(((state?.movement.nextAt ?? now) - now) / 1000))
  const countdown = `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`
  const notifications = state?.notifications ?? []
  const unread = notifications.filter(item => !item.read).length
  const visible = notifications.filter(item => (!unreadOnly || !item.read) && (source === 'all' || (source === 'agents' ? ['chat', 'autonomy', 'tracker'].includes(item.source) : item.source === source)))

  return <main className="reminders-page">
    <header className="reminders-heading"><div><p className="reminders-eyebrow">{inbox ? 'YOUR TERMINAL, KEEPING YOU POSTED' : 'A SMALL BREAK GOES A LONG WAY'}</p><h1>{inbox ? 'Notifications' : 'Make room to move.'}</h1><p>{inbox ? 'One inbox for movement reminders, Agents, and test notifications.' : 'Step away from the screen. Come back refreshed.'}</p></div>
      <button onClick={() => onNavigate(inbox ? 'movement' : 'notifications')}>{inbox ? 'Movement reminders' : `Open notifications${unread ? ` (${unread})` : ''}`} →</button></header>
    {unavailable && <div role="alert" className="reminders-warning">{query.isPending ? 'Loading reminders and notifications…' : query.error ? String(query.error) : query.data?.meta.failureReason}<button disabled={query.isFetching} onClick={() => void query.refetch()}>Retry</button></div>}
    {state?.storageError && <p role="alert" className="reminders-warning">{state.storageError}</p>}
    {!inbox && <section className="movement-hero" aria-label="Movement reminder">
      <div className="movement-orbit" aria-hidden="true"><svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><circle cx="57" cy="20" r="7"/><path d="m40 45 14-13 12 13 13 2 M54 34l-7 28 16 12 3 17 M47 62 32 82 20 83 M41 45l-15 6"/></svg></div>
      <div className="movement-copy"><span className={`reminders-badge ${state?.movement.enabled ? 'is-on' : ''}`}>{state?.movement.enabled ? 'REMINDERS ON' : 'REMINDERS PAUSED'}</span><h2>A fresh interval. Every time.</h2><p>A desktop nudge at a random interval between <strong>30 and 45 minutes</strong>. Stand up, stretch, or take a short walk.</p><div className="reminders-actions"><button className="reminders-primary" disabled={busy || unavailable} onClick={() => void perform({ type: 'movement', enabled: !state?.movement.enabled })}>{state?.movement.enabled ? 'Pause reminders' : 'Start reminders'}</button><button disabled={busy || unavailable} onClick={() => void perform({ type: 'test' })}>{busy ? 'Working…' : 'Send test notification'}</button></div></div>
      <div className="movement-clock"><span>NEXT REMINDER IN</span><strong>{state?.movement.enabled ? countdown : '— : —'}</strong><p>{state?.movement.enabled ? `Scheduled for ${date(state.movement.nextAt)}` : 'Start when you’re ready'}<br/>Last reminder: {date(state?.movement.lastAt ?? null)}</p></div>
    </section>}
    {message && <p role="status" className="reminders-message">{message}</p>}
    <section className="reminders-delivery"><div><h2>Desktop delivery</h2><p>{state?.supported ? 'Native desktop notifications are available.' : 'Desktop notification support is unavailable or still loading.'} Reminders keep running while Budget Terminal is open, including when minimized. Closing the app stops delivery; enabled reminders restart with a fresh interval on launch.</p>{state?.setupError && <p className="reminders-warning">Windows setup: {state.setupError}</p>}<p>Windows can suppress banners when Do not disturb is on. Check Settings → System → Notifications → Budget Terminal.</p></div>{inbox && <button disabled={busy || unavailable} onClick={() => void perform({ type: 'test' })}>{busy ? 'Working…' : 'Send test notification'}</button>}</section>
    {inbox && <section aria-label="Notification inbox" className="reminders-inbox"><div className="reminders-inbox-heading"><h2>Inbox <span>{unread} unread</span></h2><div className="reminders-actions"><label><input type="checkbox" checked={unreadOnly} onChange={event => setUnreadOnly(event.target.checked)}/> Unread only</label><select aria-label="Notification source" value={source} onChange={event => setSource(event.target.value)}><option value="all">All sources</option><option value="movement">Movement</option><option value="agents">Agents</option><option value="test">Tests</option></select><button disabled={busy || unavailable || !unread} onClick={() => void perform({ type: 'read' })}>Mark all read</button></div></div>
      {!visible.length && <div className="reminders-empty"><h3>{notifications.length ? 'You’re all caught up.' : 'Your inbox is ready.'}</h3><p>{notifications.length ? 'No notifications match these filters.' : 'Send a test notification to try desktop delivery.'}</p></div>}
      {visible.map(item => <article key={item.id} className={`reminders-item ${item.read ? '' : 'is-unread'}`}><div className="reminders-item-meta"><span>{item.source}</span><time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleString()}</time><span>{item.read ? 'Read' : 'Unread'}</span></div><h3>{item.title}</h3><p>{item.body}</p><small>{item.desktopStatus === 'shown' ? 'Sent to desktop' : item.desktopStatus === 'pending' ? 'Desktop delivery pending' : item.deliveryError ? 'Desktop delivery failed' : 'Saved notification'}</small>{item.deliveryError && <p className="reminders-warning">{item.deliveryError}</p>}<div className="reminders-actions">{!item.read && <button disabled={busy || unavailable} onClick={() => void perform({ type: 'read', id: item.id })}>Mark read</button>}<button disabled={busy || unavailable} onClick={() => void perform({ type: 'dismiss', id: item.id })}>Dismiss</button></div></article>)}
    </section>}
    {!inbox && <div className="reminders-footnote"><span>30–45 min<br/><small>New random interval after every reminder</small></span><span>Works across pages<br/><small>No Agent connection required</small></span><span>Your pace, your choice<br/><small>Pause and resume any time</small></span></div>}
  </main>
}
