import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useAgentCommand, useAgents } from '@/api/agentsQueries'
import { isBrowser } from '@/api/browser'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import '@/styles/agents.css'

// Preserve drafts and monitoring choices when the page cache evicts this page.
const useAgentDraft = create<{
  draft: string
  objective: string
  interval: number
  runs: number
  update: (patch: Partial<{ draft: string; objective: string; interval: number; runs: number }>) => void
}>(set => ({ draft: '', objective: '', interval: 15, runs: 4, update: patch => set(patch) }))

export function AgentsPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], path: string) => void }) {
  const query = useAgents()
  const command = useAgentCommand()
  const agent = query.data?.data
  const { draft, objective, interval, runs, update } = useAgentDraft()
  const setDraft = (draft: string) => update({ draft })
  const setObjective = (objective: string) => update({ objective })
  const setInterval = (interval: number) => update({ interval })
  const setRuns = (runs: number) => update({ runs })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const transcript = useRef<HTMLDivElement>(null)
  const lastMessage = agent?.messages.at(-1)

  useEffect(() => {
    onStatusChange([{ label: 'Agents', envelope: query.data, loading: query.isPending, error: query.error }], '')
  }, [query.data, query.isPending, query.error, onStatusChange])
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight }) }, [lastMessage?.id, lastMessage?.text])

  const perform = async (action: Parameters<typeof command>[0]) => {
    setPending(true)
    setError('')
    try { await command(action); return true }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return false }
    finally { setPending(false) }
  }
  const send = async () => {
    const text = draft.trim()
    if (!text || pending || agent?.busy || !agent?.connected) return
    if (await perform({ type: 'send', text })) setDraft('')
  }
  const locked = pending || !!agent?.busy || isBrowser

  return <div className="agents-page">
    <header className="agents-header">
      <div><div className="agents-eyebrow">YOUR TERMINAL ASSISTANT</div><h1>Agents <span>Codex</span></h1><p>Ask a question. Explore your data. Let the terminal show you.</p></div>
      <div className="agents-actions"><span className={`agents-status ${agent?.busy ? 'working' : ''}`}>{agent?.busy ? 'Working…' : agent?.connected ? 'Connected' : 'Disconnected'}</span>
        <button disabled={locked || !!agent?.connected} onClick={() => void perform({ type: 'connect' })}>Connect Codex</button>
        <button disabled={isBrowser || (!agent?.busy && !agent?.autonomy && !pending)} onClick={() => void perform({ type: 'stop' })}>Stop</button>
        <button disabled={locked || !!agent?.autonomy} onClick={() => void perform({ type: 'newChat' })}>New chat</button></div>
    </header>
    {(error || agent?.error || query.error) && <div role="alert" className="agents-error">{error || agent?.error || String(query.error)}</div>}
    <div className="agents-layout">
      <section className="agents-chat" aria-label="Chat with Codex">
        <div ref={transcript} className="agents-transcript" role="log" aria-label="Conversation" aria-live="polite">
          {!agent?.messages.length && <div className="agents-welcome"><div className="agents-mark">✳</div><h2>What would you like to explore?</h2><p>Codex can read your terminal’s research and open pages for you.</p>
            <div className="agents-suggestions">{['Show me the charts for AAPL', 'Summarize my portfolio and flag missing data', 'Compare NVDA and AMD fundamentals'].map(text => <button key={text} onClick={() => setDraft(text)}>{text} <span>↗</span></button>)}</div>
          </div>}
          {agent?.messages.map(message => <article key={message.id} className={`agents-message ${message.role}`}><div>{message.role === 'assistant' ? 'CODEX' : message.role === 'user' ? 'YOU' : 'ACTIVITY'} <time>{new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.text}</p></article>)}
          {agent?.busy && <p className="agents-thinking" role="status">Codex is working. You can switch pages while it runs.</p>}
        </div>
        <form className="agents-composer" onSubmit={event => { event.preventDefault(); void send() }}>
          <label htmlFor="agent-message">Message Codex</label><textarea id="agent-message" placeholder="Ask Codex to research or show something in Budget Terminal…" value={draft} maxLength={20_000} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} />
          <div><span>Enter to send · Shift + Enter for a new line</span><button className="agents-primary" disabled={locked || !agent?.connected || !draft.trim()} type="submit">Send ↗</button></div>
        </form>
      </section>
      <aside className="agents-aside">
        <section><div className="agents-section-title"><h2>Autonomous mode</h2><span className={agent?.autonomy ? 'agents-on' : 'agents-off'}>{agent?.autonomy ? 'ON' : 'OFF'}</span></div><p>Run a research objective at an interval while the app stays open. Starts off every time you launch.</p>
          <label htmlFor="agent-objective">Monitoring objective</label><textarea id="agent-objective" placeholder="E.g. Review my portfolio news and flag material changes with sources." value={objective} maxLength={10_000} disabled={!!agent?.autonomy} onChange={event => setObjective(event.target.value)} />
          <div className="agents-monitor-options"><label>Every<select aria-label="Monitoring interval" value={interval} disabled={!!agent?.autonomy} onChange={event => setInterval(Number(event.target.value))}>{[5, 15, 30, 60].map(value => <option key={value} value={value}>{value} min</option>)}</select></label><label>Run limit<select aria-label="Monitoring run limit" value={runs} disabled={!!agent?.autonomy} onChange={event => setRuns(Number(event.target.value))}>{[1, 2, 4, 8, 12].map(value => <option key={value} value={value}>{value} runs</option>)}</select></label></div>
          <button role="switch" aria-checked={agent?.autonomy ?? false} aria-label="Autonomous mode" className={agent?.autonomy ? '' : 'agents-primary'} disabled={isBrowser || (!agent?.autonomy && (locked || !agent?.connected || !objective.trim()))} onClick={() => void perform(agent?.autonomy ? { type: 'autonomy', enabled: false } : { type: 'autonomy', enabled: true, objective, intervalMinutes: interval, runs })}>{agent?.autonomy ? 'Turn off autonomous mode' : 'Enable autonomous mode'}</button>
          {agent?.autonomy && <p role="status">{agent.runsRemaining} future runs remaining{agent.nextRunAt ? ` · Next at ${new Date(agent.nextRunAt).toLocaleTimeString()}` : ' · Running now'}</p>}
        </section>
        <section><h2>Connected to your terminal</h2><ul><li>Read research, holdings and news</li><li>Open pages and select tickers</li><li>Keep sources and data gaps visible</li></ul><p>Research access is read only. Conversations last for this app session. Codex usage follows your signed-in account.</p></section>
        <section><h2>Get connected</h2><p>Install Codex CLI and sign in using <code>codex login</code>, then select Connect Codex. The desktop Codex installation is detected automatically on Windows.</p>{isBrowser && <p>Use Agents in the desktop app.</p>}</section>
      </aside>
    </div>
  </div>
}
