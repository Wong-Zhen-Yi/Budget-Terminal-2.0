import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAgentComposer } from '@/api/agentComposer'
import { AgentsPage } from '@/pages/AgentsPage'
import { isTextEntry } from '@/lib/shortcuts'
import { topBarAgentActivity } from '@/lib/agentActivity'
import '@/styles/topbarAgent.css'

const ignorePageStatus = () => {}
const panelId = 'topbar-agent-chat'

export const TopBarAgent = memo(function TopBarAgent({ available = true }: { available?: boolean }) {
  const { agent, query, draft, images, update, pending, sending, error, readingImages, send, addImages, chatOpenRequested } = useAgentComposer()
  const activity = topBarAgentActivity(agent, { available, sending, loading: query.isPending, error: !!error, queryError: !!query.error })
  const [open, setOpen] = useState(false)
  const [top, setTop] = useState(48)
  const launcher = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const shown = open && available

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) input.current?.focus()
  }
  const openChat = (focusComposer = false) => {
    setOpen(true)
    if (focusComposer) requestAnimationFrame(() => panel.current?.querySelector<HTMLTextAreaElement>('#topbar-agent-message')?.focus())
  }

  useEffect(() => {
    update({ chatAvailable: available })
    if (!available) setOpen(false)
    return () => update({ chatAvailable: false })
  }, [available, update])
  useEffect(() => {
    if (!chatOpenRequested) return
    update({ chatOpenRequested: false })
    if (available) {
      setOpen(true)
      requestAnimationFrame(() => panel.current?.querySelector<HTMLTextAreaElement>('#topbar-agent-message')?.focus())
    }
  }, [chatOpenRequested, available, update])
  useEffect(() => {
    if (!shown) return
    const measure = () => setTop(launcher.current?.closest('.terminal-topbar')?.getBoundingClientRect().bottom ?? 48)
    measure()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !launcher.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      input.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', measure)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', measure)
    }
  }, [shown])

  const blocked = pending || readingImages || !!agent?.busy || !agent?.connected || !!agent?.portfolioProposal
  return <>
    <form ref={launcher} className="terminal-agent-launcher no-drag" onSubmit={event => {
      event.preventDefault()
      if (!available) return
      openChat(true)
      void send()
    }} onPaste={event => {
      if (!available) return
      const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'))
      if (files.length) { event.preventDefault(); openChat(true); void addImages(files) }
    }}>
      <div className="terminal-agent-input-wrap">
        <input ref={input} aria-label="Ask Agent" aria-busy={activity.active} aria-haspopup="dialog" aria-expanded={shown} aria-controls={shown ? panelId : undefined}
          placeholder={available ? 'Ask Agent…' : 'Agent chat hidden'} disabled={!available} maxLength={20_000}
          title={available ? 'Type a message and press Enter to send, or open the full Agent chat.' : 'Agent chat is hidden during screenshots or while Agents is obscured. Reveal Agents to chat.'}
          value={available ? draft : ''} onClick={() => openChat()} onChange={event => { update({ draft: event.target.value }); openChat() }}
          onKeyDown={event => {
            // Keep literal code/backticks and navigation keys out of shell shortcuts.
            if (event.key === '`') event.stopPropagation()
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
          }} />
        <span className={`terminal-agent-activity ${activity.phase}${activity.active ? ' is-active' : ''}`} role="status" aria-live="polite" aria-atomic="true" data-agent-activity={activity.phase} title={`Agent: ${activity.label}`}>
          <span className="terminal-agent-light" aria-hidden="true" />{activity.label}
        </span>
        <button type="submit" aria-label="Send to Agent" title="Send to Agent" disabled={!available || blocked || (!draft.trim() && !images.length)}>↑</button>
        <button type="button" aria-label={shown ? 'Close Agent chat' : 'Open Agent chat'} aria-expanded={shown} aria-controls={shown ? panelId : undefined}
          disabled={!available} title={shown ? 'Close Agent chat (Esc)' : 'Open full Agent chat'} onClick={() => shown ? close(true) : openChat(true)}>{shown ? '▴' : '▾'}</button>
      </div>
    </form>
    {shown && createPortal(<div ref={panel} id={panelId} role="dialog" aria-modal="false" aria-labelledby="topbar-agent-title" className="topbar-agent-dropdown no-drag"
      onKeyDown={event => { if (event.key === '`' && isTextEntry(event.target)) event.stopPropagation() }}
      style={{ top: top + 6, height: `min(760px, calc(100dvh - ${top + 22}px))` }}>
      <div className="topbar-agent-heading"><h2 id="topbar-agent-title">Agent chat</h2><span>Chat without leaving your page</span>
        <button type="button" aria-label="Close Agent chat panel" onClick={() => close(true)}>Close (Esc)</button>
      </div>
      <AgentsPage embedded instanceId="topbar-agent" onStatusChange={ignorePageStatus} />
    </div>, document.body)}
  </>
})
