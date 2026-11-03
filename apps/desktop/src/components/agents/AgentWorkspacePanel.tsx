import { useState } from 'react'
import type { AgentsCommand, AgentsState } from '@shared/agents'
import { TelegramSettings } from './TelegramSettings'
import { AgentMessages } from './AgentMessages'

const ignoreImage = () => {}

export function AgentWorkspacePanel({ agent, locked, perform, setDraft, showTelegram = false, pending = false }: {
  agent?: AgentsState
  locked: boolean
  perform: (command: AgentsCommand) => Promise<boolean>
  setDraft: (text: string) => void
  showTelegram?: boolean
  pending?: boolean
}) {
  const [tab, setTab] = useState<'history' | 'trackers' | 'telegram' | null>(null)
  const [confirm, setConfirm] = useState('')
  const trackers = agent?.trackers ?? []
  const latestRun = [...agent?.messages ?? []].reverse().find(message => message.run)?.run
  const recoverable = latestRun && ['failed', 'partial', 'stopped'].includes(latestRun.status)
  const date = (at: number) => new Date(at).toLocaleString()
  const switchTab = (value: typeof tab) => { setTab(tab === value ? null : value); setConfirm('') }
  const remove = (type: 'deleteChat' | 'deleteTracker' | 'telegramDeleteChat', id: string) => {
    const key = `${type}:${id}`
    if (confirm !== key) { setConfirm(key); return }
    void perform({ type, id }).then(success => { if (success) setConfirm('') })
  }
  const history = [
    ...(agent?.history ?? []).map(chat => ({ chat, telegram: false })),
    ...(agent?.telegramHistory?.history ?? []).map(chat => ({ chat, telegram: true })),
  ].sort((a, b) => b.chat.updatedAt - a.chat.updatedAt)
  const telegramChat = agent?.telegramHistory?.selected

  return <section className="agents-workspace" aria-label="Saved Agents workspace">
    <div className="agents-workspace-tabs">
      {recoverable && <button type="button" disabled={locked || !!agent?.autonomy || !!agent?.portfolioProposal} title="Reconnect if needed and continue with saved research evidence. Saved-data edits and image generation are disabled." onClick={() => void perform({ type: 'continueResearch', runId: latestRun.id })}>Continue research</button>}
      <button type="button" aria-expanded={tab === 'history'} onClick={() => switchTab('history')}>History</button>
      <button type="button" aria-label="Trackers" aria-expanded={tab === 'trackers'} onClick={() => switchTab('trackers')}>Trackers{trackers.some(tracker => tracker.enabled) ? ` (${trackers.filter(tracker => tracker.enabled).length} active)` : ''}</button>
      {showTelegram && <button type="button" aria-expanded={tab === 'telegram'} onClick={() => switchTab('telegram')}>Telegram · {agent?.telegram?.error ? 'Needs attention' : agent?.telegram?.enabled ? agent.telegram.connected ? 'Connected' : 'Connecting' : 'Off'}</button>}
      {agent?.storageError && <span role="alert">{agent.storageError}</span>}
    </div>
    {tab && <div className="agents-workspace-content" aria-label={tab === 'history' ? 'Chat history' : tab === 'telegram' ? 'Telegram settings' : 'Saved trackers'}>
      {tab === 'telegram' && <TelegramSettings state={agent?.telegram} perform={perform} pending={pending} />}
      {tab === 'history' && <>
        <p>Desktop and Telegram chats are saved locally across app restarts. Telegram transcripts can be viewed here. Each channel keeps up to 100 chats with the latest 300 messages each. Continue research recovers bounded saved evidence with edits disabled.</p>
        {agent?.telegramHistory?.error && <p role="alert">{agent.telegramHistory.error}</p>}
        {!history.length && <p>No saved chats yet.</p>}
        {history.map(({ chat, telegram }) => {
          const current = telegram ? chat.id === agent?.telegramHistory?.currentChatId : chat.id === agent?.currentChatId
          const deleteType = telegram ? 'telegramDeleteChat' : 'deleteChat'
          return <article key={`${telegram ? 'telegram' : 'desktop'}:${chat.id}`} className="agents-saved-item">
            <div className="agents-saved-heading"><button disabled={telegram ? pending : locked || !!agent?.autonomy || current} aria-label={telegram ? `View Telegram chat: ${chat.title || 'New chat'}` : undefined} aria-current={current ? 'true' : undefined} onClick={() => void perform({ type: telegram ? 'telegramViewChat' : 'openChat', id: chat.id })}>{chat.title || 'New chat'}{current ? ' · Current' : ''}</button>
              <button disabled={pending || (telegram ? !!agent?.telegramHistory?.busy : locked) || current} title={current ? telegram ? 'Send /new in Telegram before deleting its active chat' : 'Open a different chat before deleting this one' : 'Delete saved chat'} onClick={() => remove(deleteType, chat.id)}>{confirm === `${deleteType}:${chat.id}` ? 'Confirm delete chat' : 'Delete chat'}</button>
            </div><small>{telegram ? 'Telegram' : 'Desktop'} · {date(chat.updatedAt)} · {chat.messageCount} messages{chat.model ? ` · ${chat.model}` : ''}</small>
            {telegram && telegramChat?.id === chat.id && <section aria-label="Telegram chat transcript">
              <div className="agents-saved-heading"><p>Viewing saved Telegram history. New Telegram messages continue its current chat.</p><button disabled={pending} onClick={() => void perform({ type: 'telegramViewChat', id: null })}>Close Telegram transcript</button></div>
              <AgentMessages messages={telegramChat.messages} imagesLocked onUseImage={ignoreImage} />
              {!telegramChat.messages.length && <p>No messages in this Telegram chat yet.</p>}
            </section>}
          </article>
        })}
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
            <button disabled={tracker.enabled || tracker.running} onClick={() => remove('deleteTracker', tracker.id)}>{confirm === `deleteTracker:${tracker.id}` ? 'Confirm delete tracker' : 'Delete tracker'}</button>
          </div>
        </article>)}
      </>}
    </div>}
  </section>
}
