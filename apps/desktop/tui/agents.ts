import type { Key } from 'node:readline'
import type { AgentsCommand, AgentsState } from '../electron/shared/agents.js'
import { agentFailureReason } from '../electron/shared/agentRuns.js'

export interface AgentsBackend {
  snapshot: () => AgentsState
  command: (command: AgentsCommand) => Promise<AgentsState>
  close: () => Promise<void>
}

export type AgentsFactory = () => Promise<AgentsBackend>
const clean = (value: string) => value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\t/g, '  ')

export function wrapAgentText(text: string, width: number): string[] {
  if (width < 1) return ['']
  return clean(text).split(/\r?\n/).flatMap(line => {
    const chars = Array.from(line)
    if (!chars.length) return ['']
    const rows: string[] = []
    for (let index = 0; index < chars.length; index += width) rows.push(chars.slice(index, index + width).join(''))
    return rows
  })
}

export function createAgentsPanel(redraw: () => void, factory: AgentsFactory = async () => {
  const { createAgentsBackend } = await import('./agentsBackend.js')
  return createAgentsBackend()
}) {
  let backend: AgentsBackend | undefined
  let state: AgentsState | undefined
  let starting: Promise<void> | undefined
  let closed = false
  let commandBusy = false
  let draft = ''
  let cursor = 0
  let scroll = 0
  let notice = ''
  let history = false
  let timer: ReturnType<typeof setInterval> | undefined
  let signature = ''
  let previousLines = 0

  function update() {
    if (closed || !backend) return
    state = backend.snapshot()
    const next = JSON.stringify(state)
    if (next !== signature) { signature = next; redraw() }
  }

  async function command(value: AgentsCommand) {
    if (closed || !backend) { notice = 'Agents unavailable. Use /connect to retry.'; redraw(); return }
    // Stop must remain available while connect/send/configure awaits the runtime.
    if (commandBusy && value.type !== 'stop') return
    commandBusy = true
    notice = ''
    redraw()
    try { await backend.command(value) }
    catch (error) { notice = agentFailureReason(error) }
    finally { commandBusy = false; update(); if (!closed) redraw() }
  }

  function start() {
    if (starting) return starting
    starting = (async () => {
      try {
        const created = await factory()
        if (closed) { await created.close(); return }
        backend = created
        update()
        timer = setInterval(update, 100)
        timer.unref()
        await command({ type: 'connect' })
      } catch {
        notice = 'Agents could not start. Close any other TUI using Agents, then /connect to retry.'
        starting = undefined
        if (!closed) redraw()
      }
    })()
    return starting
  }

  async function submit() {
    const text = draft.trim()
    if (!text) return
    const [name, ...args] = text.split(/\s+/)
    if (name === '/history') { history = !history; draft = ''; cursor = 0; scroll = 0; redraw(); return }
    if (name === '/help') {
      notice = '/connect /new /history /open N /model [ID] /thinking [MODE] /limit 5..30 /continue /stop'
      draft = ''; cursor = 0; redraw(); return
    }
    if (commandBusy && name !== '/stop') { notice = 'A command is pending. /stop cancels the run.'; redraw(); return }
    let value: AgentsCommand
    if (name === '/connect') {
      draft = ''; cursor = 0
      if (!backend) { void start(); return }
      value = { type: 'connect' }
    } else if (!backend || !state) { notice = 'Agents unavailable. Use /connect to retry.'; redraw(); return }
    else if (name === '/new') value = { type: 'newChat' }
    else if (name === '/stop') value = { type: 'stop' }
    else if (name === '/open') {
      const index = Number(args[0])
      const chat = Number.isInteger(index) && index > 0 ? state.history[index - 1] : undefined
      if (!chat) { notice = 'Use /history, then /open N with a listed chat number.'; redraw(); return }
      value = { type: 'openChat', id: chat.id }
      history = false
    } else if (name === '/model') {
      const model = state.models.find(model => model.id === args[0])
      if (!model) { notice = `Models: ${state.models.map(model => model.id).join(', ') || 'Connect Codex first.'}`; redraw(); return }
      value = { type: 'configure', model: model.id, thinking: model.defaultThinking || null }
    } else if (name === '/thinking') {
      const selected = state.model
      const model = state.models.find(model => model.id === selected)
      if (!model || !model.thinkingModes.some(mode => mode.id === args[0])) {
        notice = `Thinking: ${model?.thinkingModes.map(mode => mode.id).join(', ') || 'Connect Codex first.'}`; redraw(); return
      }
      value = { type: 'configure', model: model.id, thinking: args[0] }
    } else if (name === '/limit') {
      const minutes = Number(args[0])
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 30) { notice = 'Use /limit with whole minutes from 5 to 30.'; redraw(); return }
      value = { type: 'configureRun', minutes }
    } else if (name === '/continue') {
      const run = [...state.messages].reverse().find(message => message.run)?.run
      if (!run || !['failed', 'partial', 'stopped'].includes(run.status)) { notice = 'No interrupted research run to continue.'; redraw(); return }
      value = { type: 'continueResearch', runId: run.id }
    } else if (name.startsWith('/')) { notice = 'Unknown command. Type /help for commands.'; redraw(); return }
    else {
      if (!state.connected || state.busy) { notice = state.busy ? 'Agent is working. /stop cancels it.' : 'Connect Codex with /connect before sending.'; redraw(); return }
      value = { type: 'send', text }
      history = false
    }
    const submitted = draft
    draft = ''; cursor = 0; scroll = 0
    await command(value)
    if (notice && value.type === 'send' && !draft) { draft = submitted; cursor = draft.length; redraw() }
  }

  function keypress(text: string | undefined, key: Key) {
    if (closed) return
    if (key.name === 'return' || key.name === 'enter') { void submit(); return }
    if (key.name === 'escape') { draft = ''; cursor = 0; notice = ''; history = false }
    else if (key.name === 'pageup') scroll += 8
    else if (key.name === 'pagedown') scroll = Math.max(0, scroll - 8)
    else if (key.name === 'up') scroll += 1
    else if (key.name === 'down') scroll = Math.max(0, scroll - 1)
    else if (key.name === 'left') cursor = Math.max(0, cursor - 1)
    else if (key.name === 'right') cursor = Math.min(draft.length, cursor + 1)
    else if (key.name === 'home') cursor = 0
    else if (key.name === 'end') cursor = draft.length
    else if (key.ctrl && key.name === 'u') { draft = ''; cursor = 0 }
    else if (key.name === 'backspace' && cursor > 0) { draft = draft.slice(0, cursor - 1) + draft.slice(cursor); cursor-- }
    else if (key.name === 'delete') draft = draft.slice(0, cursor) + draft.slice(cursor + 1)
    else if (text && !key.ctrl && !key.meta) {
      const insert = clean(text).replace(/[\r\n]/g, ' ').slice(0, 20_000 - draft.length)
      draft = draft.slice(0, cursor) + insert + draft.slice(cursor)
      cursor += insert.length
    }
    redraw()
  }

  function render(width: number, height: number): string[] {
    const size = Math.max(1, width - 1)
    const lines = ['BT TUI  |  Agents', '[F1] Portfolio  [F2] Agents  [Ctrl+C] exit', '[Enter] send  [PgUp/PgDn] scroll  /help for commands',
      `${state?.connected ? 'Connected' : commandBusy ? 'Connecting' : 'Disconnected'} | ${state?.model ?? 'Codex'} | ${state?.thinking ?? 'default thinking'} | ${state?.activity ?? 'starting'} | ${state?.runLimitMinutes ?? 10} min`]
    const body: string[] = []
    if (history) {
      body.push('SAVED TUI CHATS  (use /open N)')
      for (const [index, chat] of (state?.history ?? []).entries()) body.push(`${index + 1}. ${chat.title} (${chat.messageCount} messages)`)
      if (!state?.history.length) body.push('No saved chats yet.')
    } else {
      for (const message of state?.messages ?? []) {
        body.push(`${message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Agent' : 'Activity'}: ${message.text}`)
        if (message.run) body.push(`Run: ${message.run.status} | ${message.run.tools.length} tool calls`)
        if (message.images?.length || message.imageArtifacts?.length) body.push('[Image attachments are available in saved chat storage.]')
        body.push('')
      }
      if (!body.length) body.push('Ask a research question. TUI chats are saved locally.', 'Uses your Codex sign-in. Research reads only; desktop actions stay in the desktop app.')
    }
    if (state?.storageError) body.push('Chat history could not be saved or loaded. Check local storage before closing.')
    if (state?.error) body.push(agentFailureReason(state.error), 'Install/sign in to Codex CLI with codex login, then /connect.')
    if (notice) body.push(notice)
    const wrapped = body.flatMap(line => wrapAgentText(line, size))
    if (scroll > 0 && wrapped.length > previousLines) scroll += wrapped.length - previousLines
    previousLines = wrapped.length
    const available = Math.max(0, height - lines.length - 2)
    scroll = Math.min(scroll, Math.max(0, wrapped.length - available))
    const end = Math.max(0, wrapped.length - scroll)
    lines.push(...wrapped.slice(Math.max(0, end - available), end))
    while (lines.length < height - 2) lines.push('')
    lines.push(scroll ? `${scroll} lines below | PgDn to follow replies` : state?.busy ? 'Working... /stop cancels | /continue recovers interrupted research' : '/new /history /model /thinking /connect /stop')
    const start = Math.max(0, cursor - Math.max(1, size - 4))
    lines.push(`> ${draft.slice(start, cursor)}▏${draft.slice(cursor)}`)
    return lines.slice(0, height).map(line => clean(line).replace(/[\r\n]/g, ' ').slice(0, Math.max(0, width - 1)))
  }

  async function close() {
    if (closed) return
    closed = true
    if (timer) clearInterval(timer)
    await backend?.close()
  }
  return { start, render, keypress, close }
}
