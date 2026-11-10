import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentsService } from '../electron/services/agents.js'
import { AgentWorkspace } from '../electron/services/agentWorkspace.js'
import { NotificationCenter } from '../electron/services/notifications.js'
import { liveStatusEvents } from '../electron/services/liveStatusEvents.js'
import type { CodexTransport } from '../electron/services/codexClient.js'
import type { LiveStatusChanged } from '../electron/shared/liveStatus.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-live-status-'))
process.env.APPDATA = join(scratch, 'roaming')
process.env.LOCALAPPDATA = join(scratch, 'local')
const events: LiveStatusChanged[] = []
const stop = liveStatusEvents.subscribe(event => events.push(event))
const wait = () => new Promise(resolve => setTimeout(resolve, 750))
let receive!: Parameters<NonNullable<ConstructorParameters<typeof AgentsService>[0]['clientFactory']>>[0]
const transport: CodexTransport = {
  start: async () => {}, close: () => {}, write: () => {},
  async request(method) {
    if (method === 'account/read') return { account: { type: 'fixture' } }
    if (method === 'config/read') return { config: {} }
    if (method === 'model/list') return { data: [{ model: 'fixture', displayName: 'Fixture', defaultReasoningEffort: 'low', supportedReasoningEfforts: [] }] }
    if (method === 'thread/start') return { thread: { id: 'fixture-thread' }, model: 'fixture' }
    return { turn: { id: 'fixture-turn' } }
  },
}
const center = new NotificationCenter({ deliver: async () => {}, supported: () => true })
const workspace = new AgentWorkspace({ notifications: center })
const agent = new AgentsService({ workspace, executable: 'unused', cwd: scratch, routes: new Map(), clientFactory: receiver => { receive = receiver; return transport } })
try {
  await agent.command({ type: 'connect' })
  await wait()
  assert(events.some(event => event.kind === 'agents'))
  const idle = events.length
  await wait()
  assert.equal(events.length, idle, 'A connected idle agent must not publish repeated full-status work')
  await agent.command({ type: 'send', text: 'Synthetic research' })
  for (let index = 0; index < 100; index++) receive({ method: 'item/agentMessage/delta', params: { threadId: 'fixture-thread', itemId: 'answer', delta: 'x' } })
  receive({ method: 'item/completed', params: { threadId: 'fixture-thread', item: { id: 'answer', type: 'agentMessage', text: 'Final synthetic answer' } } })
  receive({ method: 'turn/completed', params: { threadId: 'fixture-thread', turn: { status: 'completed' } } })
  await wait()
  assert.equal(events.length - idle, 1, 'Real streaming packets must coalesce at the existing cadence')
  assert.equal(agent.snapshot().messages.find(message => message.id === 'answer')?.text, 'Final synthetic answer')
  assert.equal(agent.snapshot().busy, false)
  await agent.command({ type: 'send', text: 'Navigate' })
  const navigation = agent.callTool('terminal_show_page', { page: 'charts', symbol: 'TEST' })
  await wait()
  assert(agent.snapshot().navigation, 'Navigation remains available while Agents is unvisited')
  const navigationId = agent.snapshot().navigation!.id
  await agent.command({ type: 'navigationResult', id: navigationId })
  await navigation
  await agent.command({ type: 'stop' })
  const beforeNotification = events.length
  await center.command({ type: 'test' })
  await wait()
  assert(events.slice(beforeNotification).some(event => event.kind === 'notifications'), 'Durable background notifications publish inbox changes')
  const id = center.snapshot().notifications[0].id
  await center.command({ type: 'read', id })
  await wait()
  assert(center.snapshot().notifications[0].read)
  assert(events.every((event, index) => index === 0 || event.revision > events[index - 1].revision))
  console.log('PASS: real source events for connect, idle, 100 stream chunks/final state, background navigation, notification delivery/read and monotonic revisions')
} finally {
  stop(); agent.close(); await workspace.close(); await center.close()
  await rm(scratch, { recursive: true, force: true })
}
