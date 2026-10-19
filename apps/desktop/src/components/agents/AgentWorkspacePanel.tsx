import { useState } from 'react'
import type { AgentsCommand, AgentsState } from '@shared/agents'

export function AgentWorkspacePanel({ agent, locked, perform, setDraft }: {
  agent?: AgentsState
  locked: boolean
  perform: (command: AgentsCommand) => Promise<boolean>
  setDraft: (text: string) => void
}) {
  const [tab, setTab] = useState<'history' | 'notifications' | 'trackers' | null>(null)
  const [confirm, setConfirm] = useState('')
  const notifications = agent?.notifications ?? []
  const trackers = agent?.trackers ?? []
  const unread = notifications.filter(notification => !notification.read).length
  const date = (at: number) => new Date(at).toLocaleString()
  const switchTab = (value: typeof tab) => { setTab(tab === value ? null : value); setConfirm('') }
  const remove = (type: 'deleteChat' | 'deleteTracker', id: string) => {
    if (confirm !== id) { setConfirm(id); return }
    void perform({ type, id }).then(success => { if (success) setConfirm('') })
  }

  return <section className="agents-workspace" aria-label="Saved Agents workspace">
    <div className="agents-workspace-tabs">
      <button type="button" aria-expanded={tab === 'history'} onClick={() => switchTab('history')}>History</button>
      <button type="button" aria-label="Notifications" aria-expanded={tab === 'notifications'} onClick={() => switchTab('notifications')}>Notifications{unread > 0 ? ` (${unread} unread)` : ''}</button>
      <button type="button" aria-label="Trackers" aria-expanded={tab === 'trackers'} onClick={() => switchTab('trackers')}>Trackers{trackers.some(tracker => tracker.enabled) ? ` (${trackers.filter(tracker => tracker.enabled).length} active)` : ''}</button>
      {agent?.storageError && <span role="alert">{agent.storageError}</span>}
    </div>
    {tab && <div className="agents-workspace-content" aria-label={tab === 'history' ? 'Chat history' : tab === 'notifications' ? 'Notification inbox' : 'Saved trackers'}>
      {tab === 'history' && <>
        <p>Chats are saved locally across app restarts. Open one to continue with recent transcript context. Images are not stored. Up to 100 chats; each retains its latest 300 messages.</p>
        {!agent?.history?.length && <p>No saved chats yet.</p>}
        {agent?.history?.map(chat => <article key={chat.id} className="agents-saved-item">
          <div className="agents-saved-heading"><button disabled={locked || !!agent.autonomy || chat.id === agent.currentChatId} aria-current={chat.id === agent.currentChatId ? 'true' : undefined} onClick={() => void perform({ type: 'openChat', id: chat.id })}>{chat.title || 'New chat'}{chat.id === agent.currentChatId ? ' · Current' : ''}</button>
            <button disabled={locked || chat.id === agent.currentChatId} title={chat.id === agent.currentChatId ? 'Open a different chat before deleting this one' : 'Delete saved chat'} onClick={() => remove('deleteChat', chat.id)}>{confirm === chat.id ? 'Confirm delete chat' : 'Delete chat'}</button>
          </div><small>{date(chat.updatedAt)} · {chat.messageCount} messages{chat.model ? ` · ${chat.model}` : ''}</small>
        </article>)}
      </>}
      {tab === 'notifications' && <>
        <div className="agents-saved-heading"><p>Notifications from chat, autonomous monitoring and trackers. Desktop delivery depends on OS permissions.</p><button disabled={!unread} onClick={() => void perform({ type: 'readNotifications' })}>Mark all read</button></div>
        {!notifications.length && <p>No notifications yet. Ask Codex to notify you when your monitoring objective finds something important.</p>}
        {notifications.map(notification => <article key={notification.id} className={`agents-saved-item${notification.read ? '' : ' unread'}`}>
          <div className="agents-saved-heading"><h3>{notification.title}</h3><small>{notification.read ? 'Read' : 'Unread'} · {date(notification.at)} · {notification.source}</small></div>
          <p className="agents-saved-text">{notification.body}</p>
          {notification.deliveryError && <p className="agents-saved-warning">Desktop popup unavailable: {notification.deliveryError}. Saved in this inbox.</p>}
          <div className="agents-saved-actions">{!notification.read && <button onClick={() => void perform({ type: 'readNotifications', id: notification.id })}>Mark read</button>}<button onClick={() => void perform({ type: 'deleteNotification', id: notification.id })}>Dismiss notification</button></div>
        </article>)}
      </>}
      {tab === 'trackers' && <>
        <div className="agents-saved-heading"><p>Codex writes the instructions; you review and Start. Checks use read-only research tools and your Codex account while the app is open. All trackers pause on relaunch. No arbitrary scripts or trades.</p>
          <button onClick={() => setDraft('Write a tracker for me. Ask what I want to track, the comparison baseline, how often to check, and when to notify me. Save it paused so I can review and start it.')}>Ask Codex to write a tracker</button></div>
        {!trackers.length && <p>No trackers yet. Describe any research condition or reminder to Codex in chat.</p>}
        {trackers.map(tracker => <article key={tracker.id} className="agents-saved-item">
          <div className="agents-saved-heading"><h3>{tracker.title}</h3><strong>{tracker.running ? 'Checking…' : tracker.enabled ? 'Scheduled' : 'Paused'}</strong></div>
          <small>Every {tracker.intervalMinutes} min · {tracker.runsRemaining} checks left · Notification cooldown {tracker.cooldownMinutes} min{tracker.nextRunAt ? ` · Next ${date(tracker.nextRunAt)}` : ''}</small>
          <details><summary>Review tracker instructions</summary><p className="agents-saved-text">{tracker.instructions}</p><p>Run limit: {tracker.runLimit}. Starting restarts this allowance. Alerts with the same event key are deduplicated for 24 hours.</p></details>
          {tracker.lastRunAt && <p>Last check: {date(tracker.lastRunAt)} · {tracker.lastOutcome ?? (tracker.running ? 'Running' : 'Incomplete')}</p>}
          {tracker.lastSummary && <p className="agents-saved-text">{tracker.lastSummary}</p>}
          {tracker.error && <p className="agents-saved-warning" role="status">{tracker.error}</p>}
          {tracker.memory && <details><summary>Saved check context</summary><p className="agents-saved-text">{tracker.memory}</p></details>}
          <div className="agents-saved-actions"><button disabled={locked && !tracker.enabled} onClick={() => void perform({ type: 'trackerEnabled', id: tracker.id, enabled: !tracker.enabled })}>{tracker.enabled ? 'Pause tracker' : 'Start tracker'}</button>
            <button disabled={tracker.enabled || tracker.running} onClick={() => remove('deleteTracker', tracker.id)}>{confirm === tracker.id ? 'Confirm delete tracker' : 'Delete tracker'}</button>
          </div>
        </article>)}
      </>}
    </div>}
  </section>
}
