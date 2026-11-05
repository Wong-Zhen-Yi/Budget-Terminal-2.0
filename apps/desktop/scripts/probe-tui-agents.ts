import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentsCommand, AgentsState } from '../electron/shared/agents.js'
import { createAgentsPanel, wrapAgentText } from '../tui/agents.js'
import type { AgentsBackend } from '../tui/agents.js'
import type { CodexPacket, CodexResult } from '../electron/services/codexClient.js'

const settle = () => new Promise(resolve => setImmediate(resolve))
export const fixtureAgentsState = (): AgentsState => ({
  currentChatId: 'one', history: [{ id: 'one', title: 'Fixture chat', createdAt: 1, updatedAt: 1, model: 'fixture', thinking: 'low', messageCount: 1 }],
  notifications: [], trackers: [], storageError: '', portfolioProposal: null,
  model: 'fixture', thinking: 'low', models: [{ id: 'fixture', name: 'Fixture', defaultThinking: 'low', supportsImages: false, thinkingModes: [{ id: 'low', description: 'Quick' }, { id: 'high', description: 'Deep' }] }],
  connected: true, busy: false, autonomy: false, objective: '', intervalMinutes: 15, runsRemaining: 0, nextRunAt: null,
  messages: [{ id: 'answer', role: 'assistant', text: 'Saved fixture reply', at: 1 }], error: '', navigation: null,
})

export function fixtureAgentsBackend(): AgentsBackend {
  const state = fixtureAgentsState()
  return { snapshot: () => structuredClone(state), command: async () => structuredClone(state), close: async () => {} }
}

export async function probeTuiAgents() {
  const state = fixtureAgentsState()
  const commands: AgentsCommand[] = []
  let closed = false
  const panel = createAgentsPanel(() => {}, async () => ({
    snapshot: () => structuredClone(state),
    command: async command => {
      commands.push(command)
      if (command.type === 'send') state.messages.push({ id: 'user', role: 'user', text: command.text, at: 2 })
      return structuredClone(state)
    },
    close: async () => { closed = true },
  }))
  await panel.start()
  const frame = () => panel.render(80, 24).join('\n')
  const enter = async (text: string) => {
    panel.keypress('', { name: 'escape' })
    panel.keypress(text, {})
    panel.keypress('', { name: 'return' })
    await settle()
  }
  assert.equal(commands[0].type, 'connect')
  assert(frame().includes('Saved fixture reply'))
  await enter('question about q, r and a')
  assert(commands.some(command => command.type === 'send' && command.text === 'question about q, r and a'))
  await enter('/history')
  assert(frame().includes('1. Fixture chat'))
  await enter('/open 1')
  assert(commands.some(command => command.type === 'openChat' && command.id === 'one'))
  await enter('/model fixture')
  await enter('/thinking high')
  assert(commands.some(command => command.type === 'configure' && command.thinking === 'high'))
  await enter('/new')
  await enter('/limit 15')
  assert(commands.some(command => command.type === 'configureRun' && command.minutes === 15))
  const count = commands.length
  await enter('/limit 99')
  assert.equal(commands.length, count)
  await enter('/stop')
  assert.equal(commands.at(-1)!.type, 'stop')
  state.messages.push({ id: 'run', role: 'activity', text: 'Interrupted', at: 2, run: { id: 'interrupted-run', startedAt: 1, status: 'failed', limitMinutes: 10, wrappingUp: false, runtimeRetries: 0, tools: [] } })
  await new Promise(resolve => setTimeout(resolve, 120))
  await enter('/continue')
  assert(commands.some(command => command.type === 'continueResearch' && command.runId === 'interrupted-run'))
  panel.keypress('', { name: 'escape' })
  panel.keypress('ac', {})
  panel.keypress('', { name: 'left' })
  panel.keypress('b', {})
  panel.keypress('', { name: 'return' })
  await settle()
  assert(commands.some(command => command.type === 'send' && command.text === 'abc'))
  state.messages.push({ id: 'unsafe', role: 'assistant', text: '\x1b[2Junsafe\x07\n' + 'long reply '.repeat(500), at: 3 })
  // Poll once as the real streaming UI does.
  await new Promise(resolve => setTimeout(resolve, 120))
  panel.keypress('', { name: 'pageup' })
  const anchor = panel.render(80, 24)[4]
  state.messages.at(-1)!.text += '\nNew streamed line\nAnother streamed line'
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.equal(panel.render(80, 24)[4], anchor, 'Scrolling up preserves the transcript position during streaming')
  for (const [width, height] of [[120, 36], [80, 24], [40, 10], [12, 3], [1, 1]]) {
    const lines = panel.render(width, height)
    assert(lines.length <= height && lines.every(line => line.length < width))
    assert(!lines.join('').includes('\x1b') && !lines.join('').includes('\x07'))
  }
  assert.deepEqual(wrapAgentText('ab\ncd', 1), ['a', 'b', 'c', 'd'])
  await panel.close()
  assert(closed)
}

export async function probeTuiAgentsBackend() {
  const directory = await mkdtemp(join(tmpdir(), 'bt-tui-agents-'))
  const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
  process.env.APPDATA = directory
  process.env.LOCALAPPDATA = directory
  let backend: AgentsBackend | undefined
  let reopened: AgentsBackend | undefined
  let receive: (packet: CodexPacket) => void = () => {}
  const requests: Array<{ method: string; params: unknown }> = []
  try {
    const { createAgentsBackend } = await import('../tui/agentsBackend.js')
    const options = { clientFactory: (receiver: (packet: CodexPacket) => void) => {
      receive = receiver
      return {
        start: async () => {}, close: () => {}, write: () => {},
        request: async (method: string, params: unknown): Promise<CodexResult> => {
          requests.push({ method, params })
          if (method === 'account/read') return { account: { type: 'fixture' } }
          if (method === 'config/read') return { config: {} }
          if (method === 'model/list') return { data: [{ model: 'fixture', displayName: 'Fixture', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Quick' }] }] }
          if (method === 'thread/start') return { thread: { id: 'fixture-thread' }, model: 'fixture' }
          return { turn: { id: 'fixture-turn' } }
        },
      }
    } }
    backend = await createAgentsBackend(options)
    await assert.rejects(createAgentsBackend(options), /Another TUI/)
    await backend.command({ type: 'connect' })
    assert(backend.snapshot().connected)
    const thread = requests.find(request => request.method === 'thread/start')!.params as { dynamicTools: Array<{ name: string }>; baseInstructions: string }
    assert(thread.baseInstructions.includes('private TUI research'))
    assert(thread.dynamicTools.some(tool => tool.name === 'budget_terminal_portfolio'))
    assert(!thread.dynamicTools.some(tool => /mutate|terminal_telegram_send|terminal_show_page|screenshot|browser/.test(tool.name)))
    await backend.command({ type: 'send', text: 'Fixture research request' })
    receive({ method: 'item/agentMessage/delta', params: { threadId: 'fixture-thread', itemId: 'answer', delta: 'Fixture streamed' } })
    assert(backend.snapshot().messages.some(message => message.text.includes('Fixture streamed')))
    receive({ method: 'item/completed', params: { threadId: 'fixture-thread', item: { id: 'answer', type: 'agentMessage', text: 'Fixture research answer' } } })
    receive({ method: 'turn/completed', params: { threadId: 'fixture-thread', turn: { status: 'completed' } } })
    assert(backend.snapshot().messages.some(message => message.text === 'Fixture research answer'))
    await backend.close()
    backend = undefined
    const saved = await readFile(join(directory, 'BudgetTerminalElectron', 'tui-agents.json'), 'utf8')
    assert(saved.includes('Fixture research answer'))
    reopened = await createAgentsBackend(options)
    assert(reopened.snapshot().messages.some(message => message.text === 'Fixture research answer'))
    assert(!reopened.snapshot().autonomy)
    await reopened.command({ type: 'connect' })
    await reopened.command({ type: 'send', text: 'Interrupted fixture request' })
    await reopened.close()
    reopened = undefined
    backend = await createAgentsBackend(options)
    assert(backend.snapshot().messages.some(message => message.run?.status === 'stopped'), 'Shutdown persists the interrupted run for recovery')
  } finally {
    await backend?.close()
    await reopened?.close()
    const { cache } = await import('../electron/services/cache.js')
    await cache.close()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
}
