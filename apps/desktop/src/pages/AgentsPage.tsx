import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentImage } from '@shared/agents'
import { useAgentComposer } from '@/api/agentComposer'
import { AgentMessages } from '@/components/agents/AgentMessages'
import { AgentWorkspacePanel } from '@/components/agents/AgentWorkspacePanel'
import { useAgentTranscript } from '@/components/agents/useAgentTranscript'
import { agentQuickPrompts } from '@/lib/agentPrompts'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import '@/styles/agents.css'

export function AgentsPage({ onStatusChange, favorite = false, savingFavorite = false, onToggleFavorite, embedded = false, instanceId }: {
  onStatusChange: (panels: PanelStatus[], path: string) => void
  favorite?: boolean
  savingFavorite?: boolean
  onToggleFavorite?: () => void
  embedded?: boolean
  instanceId?: string
}) {
  const idPrefix = instanceId ?? (embedded ? 'dashboard-agent' : 'agent')
  const { query, agent, draft, objective, interval, runs, images, update, pending, error, readingImages, perform, send, addImages, attachImage } = useAgentComposer()
  const setDraft = (draft: string) => update({ draft })
  const setObjective = (objective: string) => update({ objective })
  const setInterval = (interval: number) => update({ interval })
  const setRuns = (runs: number) => update({ runs })
  const [showControls, setShowControls] = useState(false)
  const { transcript, visibleMessages, readingSelection } = useAgentTranscript(agent?.messages, agent?.currentChatId, agent?.portfolioProposal?.id)
  const imagePicker = useRef<HTMLInputElement>(null)
  const onUseImage = useCallback((image: AgentImage) => {
    if (attachImage(image)) document.getElementById(`${idPrefix}-message`)?.focus()
  }, [attachImage, idPrefix])

  useEffect(() => {
    onStatusChange([{ label: 'Agents', envelope: query.data, loading: query.isPending, error: query.error }], '')
  }, [query.data, query.isPending, query.error, onStatusChange])

  const locked = pending || !!agent?.busy
  const models = agent?.models ?? []
  const selectedModel = models.find(model => model.id === agent?.model)
  const settingsLocked = locked || !agent?.connected || !!agent?.autonomy
  const thinkingLabel = (id: string) => ({ xhigh: 'Extra high', max: 'Maximum' }[id] ?? id.charAt(0).toUpperCase() + id.slice(1))

  return <div className={`agents-page${embedded ? ' agents-embedded' : ''}`} onPaste={event => {
    const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'))
    if (files.length) { event.preventDefault(); void addImages(files) }
  }}>
    <header className="agents-header">
      <h1>Agents <span>Codex</span></h1>
      <div className="agents-model-settings" aria-label="Agent model settings" title={agent?.busy ? 'Settings are locked while Codex is working.' : agent?.autonomy ? 'Turn off autonomous mode to change settings.' : !agent?.connected ? 'Connect Codex to load available models and thinking modes.' : undefined}>
      <label htmlFor={`${idPrefix}-model`}>Model<select id={`${idPrefix}-model`} value={agent?.model ?? ''} disabled={settingsLocked || !models.length}
        onChange={event => void perform({ type: 'configure', model: event.target.value, thinking: null })}>
        {!agent?.model && <option value="">Connect to load models</option>}
        {agent?.model && !selectedModel && <option value={agent.model}>{agent.model}</option>}
        {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select></label>
      <label htmlFor={`${idPrefix}-thinking`}>Thinking<select id={`${idPrefix}-thinking`} value={agent?.thinking ?? ''} disabled={settingsLocked || !selectedModel?.thinkingModes.length}
        onChange={event => agent?.model && void perform({ type: 'configure', model: agent.model, thinking: event.target.value || null })}>
        <option value="">{selectedModel ? `Default (${thinkingLabel(selectedModel.defaultThinking)})` : 'Connect to load modes'}</option>
        {agent?.thinking && !selectedModel?.thinkingModes.some(mode => mode.id === agent.thinking) && <option value={agent.thinking}>{thinkingLabel(agent.thinking)} (current)</option>}
        {selectedModel?.thinkingModes.map(mode => <option key={mode.id} value={mode.id} title={mode.description}>{thinkingLabel(mode.id)}</option>)}
      </select></label>
      </div>
      <div className="agents-actions"><span className={`agents-status ${agent?.busy ? 'working' : agent?.connected ? 'connected' : ''}`}>{agent?.busy ? agent.connected ? 'Working…' : 'Connecting…' : agent?.connected ? 'Connected' : 'Disconnected'}</span>
        {agent?.autonomy && <span className="agents-monitoring" role="status">Monitoring · {agent.runsRemaining} runs remaining</span>}
        <button disabled={locked || !!agent?.connected} onClick={() => void perform({ type: 'connect' })}>Connect Codex</button>
        <button disabled={!agent?.busy && !agent?.autonomy && !agent?.trackers?.some(tracker => tracker.enabled) && !pending} onClick={() => void perform({ type: 'stop' })}>Stop</button>
        <button disabled={locked || !!agent?.autonomy} onClick={() => void perform({ type: 'newChat' })}>New chat</button>
        <button aria-expanded={showControls} aria-controls={`${idPrefix}-controls`} onClick={() => setShowControls(!showControls)}>Controls</button>
        {onToggleFavorite && <button type="button" disabled={savingFavorite} onClick={onToggleFavorite} aria-pressed={favorite} aria-label={favorite ? 'Remove page from favorites' : 'Add page to favorites'} title={favorite ? 'Remove page from favorites' : 'Add page to favorites'}>{favorite ? '★' : '☆'}</button>}
      </div>
    </header>
    {(error || agent?.error || query.error) && <div role="alert" className="agents-error">{error || agent?.error || String(query.error)}</div>}
    <AgentWorkspacePanel agent={agent} locked={locked} perform={perform} setDraft={setDraft} />
    <div className={`agents-layout${showControls ? ' with-controls' : ''}`}>
      <section className="agents-chat" aria-label="Chat with Codex">
        <div ref={transcript} className="agents-transcript" role="log" aria-label="Conversation" aria-live="polite">
          {!agent?.messages.some(message => message.role !== 'activity') && <div className="agents-welcome"><div className="agents-mark" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16v11H9l-5 4V6Z" strokeLinejoin="round"/><path d="m8 10 3 2-3 2m5 0h3" strokeLinecap="round" strokeLinejoin="round"/></svg></div><h2>What would you like to explore?</h2><p>Research your watchlist. Understand your portfolio. Generate or edit images.</p>
            <div className="agents-suggestions">{agentQuickPrompts.map(({ label, prompt }) => <button key={label} onClick={() => {
              setDraft(prompt)
              document.getElementById(`${idPrefix}-message`)?.focus()
            }}>{label} <span>↗</span></button>)}</div>
          </div>}
          <AgentMessages messages={visibleMessages} imagesLocked={locked || readingImages || images.length >= 4} onUseImage={onUseImage} />
          {readingSelection && agent?.busy && <p className="agents-thinking" role="status">Reply display paused while highlighting. Clear the selection to show the latest reply.</p>}
          {agent?.busy && <p className="agents-thinking" role="status">{agent.connected ? 'Codex is working. You can switch pages while it runs.' : 'Connecting to Codex… You can switch pages while it loads.'}</p>}
          {agent?.portfolioProposal && <section className="agents-portfolio-review" aria-label="Review portfolio update">
            <h2>Review portfolio update · {agent.portfolioProposal.portfolioName}</h2>
            <p>{agent.portfolioProposal.summary}</p><p>Check tickers, quantities, currencies and costs against your screenshot. Unlisted positions and omitted fields stay unchanged.</p>
            <div className="agents-review-table"><table><thead><tr><th>Field</th><th>Saved value</th><th>Proposed value</th></tr></thead><tbody>{agent.portfolioProposal.changes.map((change, index) => <tr key={index}><td>{change.field}</td><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody></table></div>
            <div className="agents-review-actions"><button type="button" className="agents-primary" disabled={locked} onClick={() => void perform({ type: 'portfolioDecision', id: agent.portfolioProposal!.id, approve: true })}>Apply portfolio update</button><button type="button" disabled={locked} onClick={() => void perform({ type: 'portfolioDecision', id: agent.portfolioProposal!.id, approve: false })}>Dismiss update</button></div>
          </section>}
        </div>
        <form className="agents-composer" onSubmit={event => { event.preventDefault(); void send() }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => { event.preventDefault(); void addImages([...event.dataTransfer.files]) }}>
          <input ref={imagePicker} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="Attach images" onChange={event => { void addImages([...event.target.files ?? []]); event.target.value = '' }} />
          {images.length > 0 && <div className="agents-image-previews" aria-label="Attached images">{images.map((image, index) => <figure key={index}><img src={image.dataUrl} alt={image.name} /><figcaption>{image.name}</figcaption><button type="button" disabled={locked} aria-label={`Remove image ${image.name}`} onClick={() => update({ images: images.filter((_, position) => position !== index) })}>×</button></figure>)}</div>}
          <label htmlFor={`${idPrefix}-message`} className="agents-sr-only">Message Codex</label><textarea id={`${idPrefix}-message`} placeholder={agent?.connected ? 'Message Codex…' : 'Connect Codex to start a conversation…'} value={draft} maxLength={20_000} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
          <div className="agents-composer-toolbar"><button type="button" disabled={locked || readingImages || images.length >= 4} onClick={() => imagePicker.current?.click()}>{readingImages ? 'Reading image…' : 'Attach image'}</button><span>Ctrl+V to paste · Shift+Enter for a new line</span><button className="agents-primary agents-send" aria-label="Send message" disabled={locked || readingImages || !agent?.connected || !!agent?.portfolioProposal || (!draft.trim() && !images.length)} type="submit"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20V4m-7 7 7-7 7 7" strokeLinecap="round" strokeLinejoin="round"/></svg></button></div>
        </form>
      </section>
      <aside id={`${idPrefix}-controls`} className="agents-aside" hidden={!showControls}>
        <section><div className="agents-section-title"><h2>Autonomous mode</h2><span className={agent?.autonomy ? 'agents-on' : 'agents-off'}>{agent?.autonomy ? 'ON' : 'OFF'}</span></div><p>Run a research objective at an interval while the app stays open. Starts off every time you launch.</p>
          <label htmlFor={`${idPrefix}-objective`}>Monitoring objective</label><textarea id={`${idPrefix}-objective`} placeholder="E.g. Review my portfolio news and flag material changes with sources." value={objective} maxLength={10_000} disabled={!!agent?.autonomy} onChange={event => setObjective(event.target.value)} />
          <div className="agents-monitor-options"><label>Every<select aria-label="Monitoring interval" value={interval} disabled={!!agent?.autonomy} onChange={event => setInterval(Number(event.target.value))}>{[5, 15, 30, 60].map(value => <option key={value} value={value}>{value} min</option>)}</select></label><label>Run limit<select aria-label="Monitoring run limit" value={runs} disabled={!!agent?.autonomy} onChange={event => setRuns(Number(event.target.value))}>{[1, 2, 4, 8, 12].map(value => <option key={value} value={value}>{value} runs</option>)}</select></label></div>
          <button role="switch" aria-checked={agent?.autonomy ?? false} aria-label="Autonomous mode" className={agent?.autonomy ? '' : 'agents-primary'} disabled={!agent?.autonomy && (locked || !agent?.connected || !objective.trim())} onClick={() => void perform(agent?.autonomy ? { type: 'autonomy', enabled: false } : { type: 'autonomy', enabled: true, objective, intervalMinutes: interval, runs })}>{agent?.autonomy ? 'Turn off autonomous mode' : 'Enable autonomous mode'}</button>
          {agent?.autonomy && <p role="status">{agent.runsRemaining} future runs remaining{agent.nextRunAt ? ` · Next at ${new Date(agent.nextRunAt).toLocaleTimeString()}` : ' · Running now'}</p>}
        </section>
        <section><h2>Connected to your terminal</h2><ul><li>Use Budget Terminal MCP research and saved-data tools</li><li>Edit saved records and settings when requested</li><li>Capture app screenshots, open pages and select tickers</li><li>Paste portfolio screenshots with Ctrl+V for reviewed updates</li></ul><p>Portfolio screenshot imports require Apply portfolio update. Autonomous monitoring can create notifications, but cannot edit financial records or tracker definitions. Chats, notifications and tracker definitions are saved locally; uploaded and generated images are stored privately with chat references. Review and start trackers in the Trackers panel. Codex usage follows your signed-in account.</p></section>
        <section><h2>Generate and edit images</h2><p>Ask Codex to generate an image, or attach one and describe the edits. Use for edit on an image card adds its pixels to your next message, including from saved chats. Images use your signed-in Codex account and its image-generation allowance. Native image tools require a compatible Codex runtime/provider. Autonomous monitoring cannot generate images.</p><p>{agent?.imageGeneration === true ? 'Image generation is supported by this provider.' : agent?.imageGeneration === false ? 'This provider does not support image generation. Choose a compatible Codex provider and reconnect.' : 'Image generation availability will be confirmed by the connected runtime when requested.'}</p></section>
        <section><h2>Get connected</h2><p>Each run is limited to ten minutes and 80 tool calls. Use Stop to cancel sooner.</p><p>Codex connects automatically at startup. If connection fails, install Codex CLI and sign in using <code>codex login</code>, then select Connect Codex to retry. New chat keeps the connection and your model settings. The desktop Codex installation is detected automatically on Windows.</p></section>
      </aside>
    </div>
  </div>
}
