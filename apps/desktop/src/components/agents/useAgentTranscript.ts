import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AgentMessage } from '@shared/agents'

const emptyMessages: AgentMessage[] = []

/** Let native text selection run without streamed Markdown replacing its text nodes. */
export function useAgentTranscript(messages = emptyMessages, chatId?: string | null, proposalId?: string) {
  const transcript = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const dragging = useRef(false)
  const latest = useRef({ messages, chatId })
  latest.current = { messages, chatId }
  const held = useRef<typeof latest.current | null>(null)
  const [selection, setSelection] = useState<typeof latest.current | null>(null)
  const reading = selection?.chatId === chatId ? selection : null
  const visibleMessages = reading?.messages ?? messages
  const lastMessage = visibleMessages.at(-1)

  useEffect(() => {
    const element = transcript.current
    if (!element) return
    const hasSelection = () => {
      const selected = element.ownerDocument.getSelection()
      return !!selected && !selected.isCollapsed
        && (element.contains(selected.anchorNode) || element.contains(selected.focusNode))
    }
    const syncSelection = () => {
      // Only enter/leave reading mode; dragging across words never updates React state.
      if (hasSelection()) pause()
      else if (!dragging.current && held.current) {
        held.current = null
        setSelection(null)
      }
    }
    const pause = () => {
      if (held.current) return
      held.current = latest.current
      setSelection(held.current)
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)
        || !event.target.closest('.agents-message')
        || event.target.closest('button, input, select, textarea, .agents-market-chart')) return
      dragging.current = true
      pause()
    }
    const up = () => { dragging.current = false; syncSelection() }
    const scroll = () => {
      // Selection autoscroll is a reading gesture too, so keep its final position.
      following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48
    }
    element.addEventListener('pointerdown', down)
    element.addEventListener('scroll', scroll, { passive: true })
    element.ownerDocument.addEventListener('selectionchange', syncSelection)
    element.ownerDocument.addEventListener('pointerup', up)
    element.ownerDocument.addEventListener('pointercancel', up)
    window.addEventListener('blur', up)
    return () => {
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('scroll', scroll)
      element.ownerDocument.removeEventListener('selectionchange', syncSelection)
      element.ownerDocument.removeEventListener('pointerup', up)
      element.ownerDocument.removeEventListener('pointercancel', up)
      window.removeEventListener('blur', up)
    }
  }, [])

  useLayoutEffect(() => {
    following.current = true
    dragging.current = false
    if (held.current) {
      held.current = null
      setSelection(null)
    }
  }, [chatId])

  useLayoutEffect(() => {
    const element = transcript.current
    if (element && !reading && following.current) element.scrollTo({ top: element.scrollHeight, behavior: 'instant' })
  }, [chatId, lastMessage?.id, lastMessage?.text, proposalId, reading])

  return { transcript, visibleMessages, readingSelection: !!reading }
}
