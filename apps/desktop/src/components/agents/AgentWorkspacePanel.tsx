import { useState } from 'react'
import type { AgentsCommand, AgentsState } from '@shared/agents'
import { agentRuntimeLabel } from '@shared/agents'
import { AgentHistory } from './AgentHistory'
import { TelegramSettings } from './TelegramSettings'

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
  const label = agentRuntimeLabel
  const latestRun = [...agent?.messages ?? []].reverse().find(message => message.run)?.run
  const recoverable = latestRun && ['failed', 'partial', 'stopped'].includes(latestRun.status)
  const date = (at: number) => new Date(at).toLocaleString()
  const switchTab = (value: typeof tab) => { setTab(tab === value ? null : value); setConfirm('') }
  const removeTracker = (id: string) => {
    if (confirm !== id) { setConfirm(id); return }
    void perform({ type: 'deleteTracker', id }).then(success => { if (success) setConfirm('') })
  }

  return <section className="agents-workspace" aria-label="Saved Agents workspace">
    <div className="agents-workspace-tabs">
      {recoverable && <button type="button" disabled={locked || !!agent?.autonomy || !!agent?.portfolioProposal} title="Reconnect if needed and continue with saved research evidence. Saved-data edits and image generation are disabled." onClick={() => void perform({ type: 'continueResearch', runId: latestRun.id })}>Continue research</button>}
      <button type="button" aria-expanded={tab === 'history'} onClick={() => switchTab('history')}>History</button>
      <button type="button" aria-label="Trackers" aria-expanded={tab === 'trackers'} onClick={() => switchTab('trackers')}>Trackers{trackers.some(tracker => tracker.enabled) ? ` (${trackers.filter(tracker => tracker.enabled).length} active)` : ''}</button>
      {showTelegram && <button type="button" aria-expanded={tab === 'telegram'} onClick={() => switchTab('telegram')}>Telegram · {agent?.telegram?.error ? 'Needs attention' : agent?.telegram?.enabled ? agent.telegram.connected ? 'Connected' : 'Connecting' : 'Off'}</button>}
      {agent?.storageError && <span role="alert">{agent.storageError}</span>}
    </div>
    {tab === 'history' && <AgentHistory agent={agent} locked={locked} pending={pending} perform={perform} />}
    {tab && tab !== 'history' && <div className="agents-workspace-content" aria-label={tab === 'telegram' ? 'Telegram settings' : 'Saved trackers'}>
      {tab === 'telegram' && <TelegramSettings state={agent?.telegram} perform={perform} pending={pending} />}
      {tab === 'trackers' && <>
        <div className="agents-saved-heading"><p>{label} writes the instructions; you review and Start. Checks use read-only research tools and your connected model provider while the app is open. All trackers pause on relaunch. No arbitrary scripts or trades.</p>
          <button onClick={() => setDraft('Write a tracker for me. Ask what I want to track, the comparison baseline, how often to check, and when to notify me. Save it paused so I can review and start it.')}>Ask {label} to write a tracker</button></div>
        {!trackers.length && <p>No trackers yet. Describe any research condition or reminder to {label} in chat.</p>}
        {trackers.map(tracker => <article key={tracker.id} className="agents-saved-item">
          <div className="agents-saved-heading"><h3>{tracker.title}</h3><strong>{tracker.running ? 'Checking…' : tracker.enabled ? 'Scheduled' : 'Paused'}</strong></div>
          <small>Every {tracker.intervalMinutes} min · {tracker.runsRemaining} checks left · Notification cooldown {tracker.cooldownMinutes} min{tracker.nextRunAt ? ` · Next ${date(tracker.nextRunAt)}` : ''}</small>
          <details><summary>Review tracker instructions</summary><p className="agents-saved-text">{tracker.instructions}</p><p>Run limit: {tracker.runLimit}. Starting restarts this allowance. Alerts with the same event key are deduplicated for 24 hours.</p></details>
          {tracker.lastRunAt && <p>Last check: {date(tracker.lastRunAt)} · {tracker.lastOutcome ?? (tracker.running ? 'Running' : 'Incomplete')}</p>}
          {tracker.lastSummary && <p className="agents-saved-text">{tracker.lastSummary}</p>}
          {tracker.error && <p className="agents-saved-warning" role="status">{tracker.error}</p>}
          {tracker.memory && <details><summary>Saved check context</summary><p className="agents-saved-text">{tracker.memory}</p></details>}
          <div className="agents-saved-actions"><button disabled={locked && !tracker.enabled} onClick={() => void perform({ type: 'trackerEnabled', id: tracker.id, enabled: !tracker.enabled })}>{tracker.enabled ? 'Pause tracker' : 'Start tracker'}</button>
            <button disabled={tracker.enabled || tracker.running} onClick={() => removeTracker(tracker.id)}>{confirm === tracker.id ? 'Confirm delete tracker' : 'Delete tracker'}</button>
          </div>
        </article>)}
      </>}
    </div>}
  </section>
}
