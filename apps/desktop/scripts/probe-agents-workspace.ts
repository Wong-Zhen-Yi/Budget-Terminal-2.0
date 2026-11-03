import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'node:test'
import { AgentWorkspace, agentWorkspacePath } from '../electron/services/agentWorkspace.js'
import { AgentsService } from '../electron/services/agents.js'
import { resetTelegramConversation, telegramResearchCommand, telegramHistoryAction, telegramHistorySnapshot, telegramModelChoices } from '../electron/services/telegramResearch.js'
import type { CodexPacket, CodexTransport } from '../electron/services/codexClient.js'
import type { AgentTrackerReport } from '../electron/shared/agentWorkspace.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-agents-workspace-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory; process.env.LOCALAPPDATA = directory
const resources: AgentWorkspace[] = []
const services: AgentsService[] = []
const workspace = (options: ConstructorParameters<typeof AgentWorkspace>[0] = {}) => {
  const value = new AgentWorkspace(options); resources.push(value); return value
}
const definition = { title: 'Custom research tracker', instructions: 'Check the user-defined research condition with fresh cited data. Retain baseline context. Report unknown on missing data.', intervalMinutes: 1, cooldownMinutes: 2, runLimit: 3 }
const until = async (condition: () => boolean, label: string) => {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) { if (condition()) return; await new Promise(resolve => setImmediate(resolve)) }
  assert.fail('Timed out: ' + label)
}

try {
  assert(agentWorkspacePath().startsWith(directory), 'Never use the real user profile')
  let deliveries = 0
  const store = workspace({ deliver: () => { deliveries++; throw new Error('OS permissions denied') } })
  await store.initialize()
  let receive: (packet: CodexPacket) => void = () => {}
  let thread = '', sequence = 0, transportStarts = 0
  const requests: { method: string; params: any }[] = []
  const client: CodexTransport = {
    async start() { transportStarts++ }, close() {}, write() {},
    async request(method, params) {
      requests.push({ method, params })
      if (method === 'account/read') return { account: {} }
      if (method === 'config/read') return { config: { mcp_servers: { untrusted: {} } } }
      if (method === 'model/list') return { data: [
        { model: 'fixture', displayName: 'Fixture', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Quick' }, { reasoningEffort: 'high', description: 'Deeper' }] },
        { model: 'fixture-other', displayName: 'Other fixture', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }] },
      ] }
      if (method === 'thread/start') { thread = 'thread-' + (++sequence); return { thread: { id: thread }, model: 'fixture' } }
      return { turn: { id: 'turn' } }
    },
  }
  const service = new AgentsService({ executable: 'unused', cwd: directory, routes: new Map(), workspace: store, clientFactory: receiver => { receive = receiver; return client } })
  services.push(service)
  const complete = async (text = 'Fixture assistant response') => {
    receive({ method: 'item/agentMessage/delta', params: { threadId: thread, itemId: 'answer-' + sequence, delta: text } })
    receive({ method: 'turn/completed', params: { threadId: thread, turn: { status: 'completed' } } })
    await store.flush()
  }
  await service.command({ type: 'connect' })
  assert.deepEqual(service.snapshot().messages, [], 'Connecting must not add a startup notice to chat')
  const firstId = service.snapshot().currentChatId!
  await service.command({ type: 'send', text: 'Research my portfolio and retain the source date' })
  await service.callTool('terminal_notify', { title: 'Research update', body: 'Fixture source · as of 2026-10-17', eventKey: 'research-1' })
  const tracker = await service.callTool('terminal_save_tracker', definition) as { tracker: { id: string }; running: boolean }
  assert.equal(tracker.running, false, 'Agent-authored trackers are saved paused')
  await complete()
  await service.command({ type: 'newChat' })
  assert.equal(service.snapshot().connected, true)
  assert.equal(transportStarts, 1, 'New chat retains the connection')
  assert.equal(service.snapshot().history.length, 2)
  assert.equal(service.snapshot().history.find(chat => chat.id === firstId)?.messageCount, 2)
  assert(!requests.at(-1)?.params?.baseInstructions?.includes('Research my portfolio'), 'New chat must not inherit the old transcript')
  await service.command({ type: 'openChat', id: firstId })
  assert(service.snapshot().messages.some(message => message.text === 'Fixture assistant response'))
  assert(requests.at(-1)!.params.baseInstructions.includes('untrusted historical evidence'))
  assert(requests.at(-1)!.params.baseInstructions.includes('Research my portfolio'))
  await assert.rejects(() => service.command({ type: 'deleteChat', id: firstId }), /active chat/)
  await service.command({ type: 'autonomy', enabled: true, objective: 'Notify only for an evidenced change', runs: 1 })
  await service.callTool('terminal_notify', { title: 'Autonomous update', body: 'Cited fixture · fresh', eventKey: 'autonomy-1' })
  await assert.rejects(() => service.callTool('terminal_save_tracker', definition), /read only/)
  await assert.rejects(() => service.callTool('terminal_remove_tracker', { id: tracker.tracker.id }), /read only/)
  const duplicate = await service.callTool('terminal_notify', { title: 'Repeat', body: 'Same event', eventKey: 'autonomy-1' }) as { duplicate: boolean }
  assert(duplicate.duplicate)
  await complete('Monitoring complete')
  assert.equal(deliveries, 2, 'Duplicate events do not produce more desktop notifications')
  assert.equal(store.snapshot().notifications.length, 2)
  assert(store.snapshot().notifications.every(value => value.deliveryError?.includes('permissions denied')))
  await service.command({ type: 'readNotifications' })
  assert(store.snapshot().notifications.every(value => value.read))
  await service.command({ type: 'newChat' })
  await service.command({ type: 'deleteChat', id: firstId })
  assert(!store.snapshot().history.some(chat => chat.id === firstId))
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  await service.command({ type: 'send', text: 'Persist this latest chat', images: [{ name: 'Synthetic.png', dataUrl: pixel }] })
  await complete('Restored conversation evidence')
  await store.flush()
  const bytes = await readFile(agentWorkspacePath(), 'utf8')
  assert(!bytes.includes('thread-') && !bytes.includes('baseInstructions') && !bytes.includes('data:image'), 'Persist no thread IDs, tool configuration or image bytes')
  service.close(); await store.close()
  const legacy = JSON.parse(bytes)
  const connectionNotice = 'Codex connected. Budget Terminal MCP tools are available for research, screenshots and requested saved-data edits.'
  for (const chat of legacy.conversations) chat.messages.push({ id: 'legacy-connect-' + chat.id, role: 'activity', text: connectionNotice, at: Date.now() })
  await writeFile(agentWorkspacePath(), JSON.stringify(legacy))
  const restored = workspace()
  await restored.initialize()
  for (const chat of legacy.conversations) {
    assert.deepEqual(restored.conversation(chat.id)?.messages, chat.messages.slice(0, -1), 'Restore removes only the old connection notice from every saved chat')
  }
  await restored.flush()
  assert(!(await readFile(agentWorkspacePath(), 'utf8')).includes(connectionNotice), 'Old connection notices stay removed on subsequent launches')
  assert.equal(restored.snapshot().notifications.length, 2)
  assert(restored.snapshot().notifications.every(value => value.read))
  assert.equal(restored.snapshot().trackers[0].enabled, false)
  assert.equal(deliveries, 2, 'Restoring notifications never replays popups')
  const restarted = new AgentsService({ executable: 'unused', cwd: directory, workspace: restored, routes: new Map(), clientFactory: receiver => { receive = receiver; return client } })
  services.push(restarted)
  const requestsBeforeRestore = requests.length
  await restarted.initialize()
  assert.equal(requests.length, requestsBeforeRestore, 'Loading history alone never starts inference or Codex')
  assert(restarted.snapshot().messages.some(message => message.text === 'Restored conversation evidence'))
  assert.deepEqual(restarted.snapshot().messages.find(message => message.text === 'Persist this latest chat')?.images, ['Synthetic.png'])
  const restoredMessages = restarted.snapshot().messages
  await restarted.command({ type: 'connect' })
  assert.deepEqual(restarted.snapshot().messages, restoredMessages, 'Reconnecting after launch must preserve the transcript without adding a notice')
  assert(requests.at(-1)!.params.baseInstructions.includes('Persist this latest chat'))

  // A fresh lazy Telegram worker must honor /new before its first question after restart.
  restarted.close()
  const telegramStore = workspace({ path: join(directory, 'telegram-agents.json') })
  await telegramStore.initialize()
  telegramStore.createConversation()
  telegramStore.recordConversation([{ id: 'old-message', role: 'user', text: 'OLD_TELEGRAM_CONTEXT', at: Date.now() }], null, null)
  await telegramStore.flush()
  const oldTelegramId = telegramStore.snapshot().currentChatId!
  const telegramReloaded = workspace({ path: join(directory, 'telegram-agents.json') })
  await telegramReloaded.initialize()
  const beforeHistoryView = requests.length
  const viewedId = await telegramHistoryAction(telegramReloaded, { type: 'telegramViewChat', id: oldTelegramId }, true)
  const telegramHistory = telegramHistorySnapshot(telegramReloaded, viewedId, true)
  assert.equal(telegramHistory.history[0].id, oldTelegramId, 'Saved Telegram history loads without a configured bot or Codex connection')
  assert.equal(telegramHistory.selected?.messages[0].text, 'OLD_TELEGRAM_CONTEXT')
  assert.equal(telegramReloaded.snapshot().currentChatId, oldTelegramId, 'Viewing does not change the selected Telegram chat')
  assert.equal(requests.length, beforeHistoryView, 'History viewing never starts Codex or inference')
  await assert.rejects(() => telegramHistoryAction(telegramReloaded, { type: 'telegramViewChat', id: 'missing' }, false), /no longer exists/)
  await assert.rejects(() => telegramHistoryAction(telegramReloaded, { type: 'telegramDeleteChat', id: oldTelegramId }, true), /finish/)
  await assert.rejects(() => telegramHistoryAction(telegramReloaded, { type: 'telegramDeleteChat', id: oldTelegramId }, false), /active chat/)
  assert.equal(await telegramHistoryAction(telegramReloaded, { type: 'telegramViewChat', id: null }, false), null)
  const telegramWorker = new AgentsService({ executable: 'unused', cwd: directory, workspace: telegramReloaded, remoteResearch: true, routes: new Map(), clientFactory: receiver => { receive = receiver; return client } })
  services.push(telegramWorker)
  await resetTelegramConversation(telegramWorker)
  assert.notEqual(telegramWorker.snapshot().currentChatId, oldTelegramId)
  const freshTelegramId = telegramWorker.snapshot().currentChatId!
  assert.equal(telegramHistorySnapshot(telegramReloaded, oldTelegramId, false).selected?.id, oldTelegramId, 'Viewing an older chat never resumes it')
  assert.deepEqual(telegramWorker.snapshot().messages, [])
  await telegramWorker.command({ type: 'connect' })
  assert(!requests.at(-1)!.params.baseInstructions.includes('OLD_TELEGRAM_CONTEXT'), '/new before first message must exclude saved context')
  await telegramWorker.command({ type: 'openChat', id: oldTelegramId })
  assert(requests.at(-1)!.params.baseInstructions.includes('OLD_TELEGRAM_CONTEXT'))
  assert.deepEqual(await telegramModelChoices(telegramWorker), [
    { id: 'fixture', name: 'Fixture', current: true, reasoning: [
      { id: 'default', name: 'Model default (low)', current: true }, { id: 'low', name: 'low', current: false }, { id: 'high', name: 'high', current: false },
    ] },
    { id: 'fixture-other', name: 'Other fixture', current: false, reasoning: [
      { id: 'default', name: 'Model default (medium)', current: true }, { id: 'medium', name: 'medium', current: false },
    ] },
  ])
  assert.match(await telegramResearchCommand(telegramWorker, 'model', 'unknown'), /Unknown model/)
  assert.match(await telegramResearchCommand(telegramWorker, 'model', 'fixture'), /context is retained/)
  assert((await telegramModelChoices(telegramWorker))[0].reasoning.some(mode => mode.id === 'high'))
  assert.match(await telegramResearchCommand(telegramWorker, 'reasoning', 'invalid'), /Unsupported reasoning/)
  assert.equal(telegramWorker.snapshot().thinking, null, 'Invalid reasoning does not change settings')
  assert.match(await telegramResearchCommand(telegramWorker, 'reasoning', 'high'), /Reasoning: high/)
  assert.equal(telegramWorker.snapshot().thinking, 'high')
  assert.equal(telegramReloaded.conversation()?.thinking, 'high', 'Reasoning choice is saved with the conversation')
  await telegramResearchCommand(telegramWorker, 'model', 'fixture')
  assert.equal(telegramWorker.snapshot().thinking, 'high', 'Model choice keeps compatible reasoning')
  await telegramResearchCommand(telegramWorker, 'model', 'fixture-other')
  assert.equal(telegramWorker.snapshot().thinking, null, 'Incompatible reasoning falls back to the new model default')
  assert((await telegramModelChoices(telegramWorker)).find(model => model.current)?.reasoning.some(mode => mode.id === 'medium'))
  assert.match(await telegramResearchCommand(telegramWorker, 'reasoning', 'high'), /Unsupported reasoning/)
  await telegramResearchCommand(telegramWorker, 'reasoning', 'medium')
  await telegramResearchCommand(telegramWorker, 'reasoning', 'default')
  assert.equal(telegramWorker.snapshot().thinking, null)
  assert.equal(telegramWorker.snapshot().model, 'fixture-other')
  assert.deepEqual(telegramWorker.snapshot().messages.map(message => message.text), ['OLD_TELEGRAM_CONTEXT'])
  telegramWorker.close()
  await telegramHistoryAction(telegramReloaded, { type: 'telegramDeleteChat', id: freshTelegramId }, false)
  assert(!telegramHistorySnapshot(telegramReloaded, freshTelegramId, false).selected, 'Deleted transcripts disappear from the viewer')
  assert(!JSON.parse(await readFile(join(directory, 'telegram-agents.json'), 'utf8')).conversations.some((chat: { id: string }) => chat.id === freshTelegramId), 'Telegram history deletion is persisted')
  assert(restored.conversation(), 'Telegram history changes leave desktop history intact')
  console.log('PASS: desktop Telegram history loads without Codex, views without switching context, and safely persists deletion')

  const worker = new AgentsService({ executable: 'unused', cwd: directory, workspace: restored, trackerId: tracker.tracker.id, routes: new Map(), clientFactory: receiver => { receive = receiver; return client } })
  services.push(worker)
  await worker.command({ type: 'connect' }); await worker.command({ type: 'send', text: 'Perform one check' })
  for (const [name, args] of [
    ['terminal_notify', { title: 'Bypass', body: 'No', eventKey: 'bypass' }],
    ['terminal_save_tracker', definition], ['terminal_remove_tracker', { id: tracker.tracker.id }],
    ['terminal_show_page', { page: 'stocks', symbol: 'AAPL' }],
    ['budget_terminal_mutate_articles', { request: {} }],
    ['terminal_propose_portfolio_update', {}],
  ] as const) await assert.rejects(() => worker.callTool(name, args), /tracker|read only|manual chat|navigate/i)
  await assert.rejects(() => worker.callTool('terminal_tracker_report', { outcome: 'quiet', summary: 'No match', memory: '', notification: { title: 'Invalid', body: 'No', eventKey: 'quiet' } }))
  await worker.callTool('terminal_tracker_report', { outcome: 'unknown', summary: 'Provider failed; no match can be established', memory: 'Retain prior baseline' })
  assert.equal(worker.trackerReport()?.outcome, 'unknown')
  await assert.rejects(() => worker.callTool('terminal_tracker_report', { outcome: 'quiet', summary: 'Second', memory: '' }), /already/)
  worker.close()
  console.log('PASS: saved/reopened/deleted chats, context isolation, atomic persistence, notification inbox/read state/deduplication, OS failure fallback and read-only tracker tools')

  const path = join(directory, 'scheduler.json')
  let checks = 0, popups = 0
  const memories: string[] = []
  const scheduled = workspace({ path, deliver: () => { popups++ }, check: async tracker => {
    checks++; memories.push(tracker.memory)
    return { outcome: 'triggered', summary: `Fresh fixture evidence ${checks}`, memory: `baseline-${checks}`, notification: { title: 'Match', body: 'Fixture source/as-of time', eventKey: `event-${checks}` } }
  } })
  await scheduled.initialize()
  const saved = scheduled.saveTracker(definition)
  await scheduled.flush()
  assert.equal(checks, 0, 'Saving does not execute a tracker')
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 })
  try {
    await scheduled.setTrackerEnabled(saved.id, true)
    mock.timers.tick(0)
    await until(() => scheduled.snapshot().trackers[0].lastSummary.endsWith('1') && !scheduled.snapshot().trackers[0].running, 'first scheduled check')
    await scheduled.flush()
    assert.equal(popups, 1)
    mock.timers.tick(60_000)
    await until(() => checks === 2 && !scheduled.snapshot().trackers[0].running, 'second check')
    await scheduled.flush()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(popups, 1, 'Cooldown suppresses repeated alerts even for distinct event keys')
    mock.timers.tick(60_000)
    await until(() => checks === 3 && !scheduled.snapshot().trackers[0].running, 'third check')
    await scheduled.flush()
    assert.equal(popups, 2)
    assert.deepEqual(memories, ['', 'baseline-1', 'baseline-2'])
    assert.equal(scheduled.snapshot().trackers[0].enabled, false, 'Run budget stops the tracker')
    mock.timers.tick(24 * 60 * 60_000)
    assert.equal(checks, 3)
    console.log('PASS: explicit start, scheduled checks, persistent context, cooldowns, bounded runs and no checks after completion')
  } finally { mock.timers.reset() }

  const crashPath = join(directory, 'crash-recovery.json')
  const crashData = JSON.parse(await readFile(path, 'utf8'))
  crashData.trackers[0].enabled = true; crashData.trackers[0].running = true; crashData.trackers[0].nextRunAt = Date.now()
  await writeFile(crashPath, JSON.stringify(crashData))
  let resumedChecks = 0
  const crashRestored = workspace({ path: crashPath, check: async () => { resumedChecks++; return { outcome: 'quiet', summary: 'Should not run', memory: '' } } })
  await crashRestored.initialize()
  assert.equal(crashRestored.snapshot().trackers[0].enabled, false)
  assert.equal(crashRestored.snapshot().trackers[0].running, false)
  assert(crashRestored.snapshot().trackers[0].error.includes('app closed'))
  assert.equal(resumedChecks, 0, 'Restoring a saved active tracker never starts inference')

  let release!: (report: AgentTrackerReport) => void
  let canceled = false
  const cancellation = workspace({ path: join(directory, 'cancel.json'), check: async (_tracker, signal) => {
    signal.addEventListener('abort', () => { canceled = true; release({ outcome: 'triggered', summary: 'Late', memory: '', notification: { title: 'Late', body: 'Must not notify', eventKey: 'late' } }) })
    return new Promise(resolve => { release = resolve })
  } })
  await cancellation.initialize()
  const cancelTracker = cancellation.saveTracker(definition)
  await cancellation.setTrackerEnabled(cancelTracker.id, true)
  await until(() => cancellation.snapshot().trackers[0].running, 'running cancellation fixture')
  // Wait until the executor has installed its abort handler, not only until disk flush starts.
  await until(() => !!release, 'executor started')
  await cancellation.setTrackerEnabled(cancelTracker.id, false)
  assert(canceled)
  assert.equal(cancellation.snapshot().notifications.length, 0, 'Late reports after Pause must never notify')
  assert.equal(cancellation.snapshot().trackers[0].enabled, false)

  const failing = workspace({ path: join(directory, 'failure.json'), check: async () => { throw new Error('Fixture provider unavailable') } })
  await failing.initialize()
  const failingTracker = failing.saveTracker(definition)
  await failing.setTrackerEnabled(failingTracker.id, true)
  await until(() => !!failing.snapshot().trackers[0].error, 'visible tracker failure')
  assert.equal(failing.snapshot().trackers[0].enabled, false)
  assert.equal(failing.snapshot().notifications.length, 0)
  console.log('PASS: Pause cancels checks and ignores late reports; failed checks pause with a visible error rather than false alerts')

  const corruptPath = join(directory, 'corrupt.json')
  await writeFile(corruptPath, '{broken')
  const corrupt = workspace({ path: corruptPath })
  await assert.rejects(() => corrupt.initialize(), /left untouched/)
  assert.equal(await readFile(corruptPath, 'utf8'), '{broken')
  assert(corrupt.snapshot().storageError)
  const blockedParent = join(directory, 'blocked')
  const blocked = workspace({ path: join(blockedParent, 'agents.json') })
  await blocked.initialize(); blocked.createConversation()
  await writeFile(blockedParent, 'not a directory')
  await assert.rejects(() => blocked.flush())
  assert(blocked.snapshot().storageError)
  await rm(blockedParent)
  await blocked.flush()
  assert.equal(blocked.snapshot().storageError, '')
  assert.equal(JSON.parse(await readFile(join(blockedParent, 'agents.json'), 'utf8')).conversations.length, 1)
  console.log('PASS: corrupt-file preservation, visible persistence failures, queued retry and isolated temporary profiles')
} finally {
  mock.timers.reset()
  for (const service of services) service.close()
  for (const value of resources) await value.close().catch(() => {})
  if (previous.APPDATA === undefined) delete process.env.APPDATA; else process.env.APPDATA = previous.APPDATA
  if (previous.LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previous.LOCALAPPDATA
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
