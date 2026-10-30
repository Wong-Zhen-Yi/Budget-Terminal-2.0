import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { mock } from 'node:test'
import { AgentsService } from '../electron/services/agents.js'
import { AgentWorkspace, agentWorkspacePath } from '../electron/services/agentWorkspace.js'
import type { CodexPacket, CodexTransport } from '../electron/services/codexClient.js'
import type { Operation } from '../mcp/operations.js'
import { dynamicToolResult, toolResult } from '../mcp/toolResult.js'
import { failed, ok, partial } from '../electron/shared/envelope.js'
import { agentFailureReason } from '../electron/shared/agentRuns.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-agent-recovery-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory; process.env.LOCALAPPDATA = directory
const services: AgentsService[] = []
const stores: AgentWorkspace[] = []
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
let storeSequence = 0

async function fixture(path = join(directory, `fixture-${storeSequence++}.json`)) {
  const store = new AgentWorkspace({ path }); stores.push(store)
  let receive: (packet: CodexPacket) => void = () => {}
  let disconnect: (error: string) => void = () => {}
  let thread = '', turn = '', sequence = 0, starts = 0
  const requests: { method: string; params: any }[] = []
  const writes: any[] = []
  const routes = new Map<Operation, (request: unknown) => unknown>()
  routes.set('portfolio', () => ok({ portfolios: [], evidence: 'saved-evidence-fixture' }, 'fixture'))
  const client: CodexTransport = {
    async start() { starts++ }, close() {}, write(packet) { writes.push(packet) },
    async request(method, params) {
      requests.push({ method, params })
      if (method === 'account/read') return { account: {} }
      if (method === 'config/read') return { config: {} }
      if (method === 'model/list') return { data: [{ model: 'fixture', displayName: 'Fixture', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Quick' }] }] }
      if (method === 'thread/start') { thread = 'private-thread-' + (++sequence); return { thread: { id: thread }, model: 'fixture' } }
      if (method === 'turn/start') { turn = 'private-turn-' + (++sequence); return { turn: { id: turn } } }
      return {}
    },
  }
  const service = new AgentsService({ executable: 'unused', cwd: directory, workspace: store, routes,
    clientFactory: (receiver, ended) => { receive = receiver; disconnect = ended; return client } })
  services.push(service)
  await service.command({ type: 'connect' })
  const emit = (packet: CodexPacket) => receive({ ...packet, params: { threadId: thread, turnId: turn, ...packet.params } })
  const run = () => service.snapshot().messages.findLast(message => message.run)!.run!
  const answer = () => {
    emit({ method: 'item/completed', params: { item: { id: 'answer-' + sequence, type: 'agentMessage', text: 'Partial fixture answer. Source: fixture; incomplete coverage disclosed.' } } })
    emit({ method: 'turn/completed', params: { turn: { id: turn, status: 'completed' } } })
  }
  return { service, store, routes, requests, writes, emit, disconnect: (error: string) => disconnect(error), run, answer, starts: () => starts }
}

try {
  assert(agentWorkspacePath().startsWith(directory), 'Always isolate persistence from the real profile')
  const large = ok({ headlines: Array.from({ length: 180 }, (_, i) => ({ title: 'Headline ' + i + 'x'.repeat(65), url: 'https://example.com/' + i })) }, 'fixture')
  assert(!toolResult('budget_terminal_news', large).content.some(item => item.type === 'text' && item.text.includes('Headline 179')), 'External MCP uses structuredContent for larger research')
  const dynamic = dynamicToolResult('budget_terminal_news', large)
  assert(dynamic.contentItems.some(item => item.type === 'inputText' && item.text.includes('Headline 179')), 'Embedded app-server must receive the actual large evidence')
  const capture = dynamicToolResult('budget_terminal_screenshot', ok({ screenshots: [{ pageId: 'charts', label: 'Charts', mimeType: 'image/png', base64: 'cGl4ZWxz' }] }, 'fixture'))
  assert(capture.contentItems.some(item => item.type === 'inputImage'))
  assert(!capture.contentItems.some(item => item.type === 'inputText' && item.text.includes('cGl4ZWxz')), 'Never copy screenshot pixels into text')
  console.log('PASS: large dynamic-tool evidence and native screenshot image transport')

  const f = await fixture()
  let attempts = 0
  f.routes.set('portfolio', () => {
    attempts++
    if (attempts === 1) throw new Error('fetch failed with password=synthetic-secret')
    if (attempts === 2) return failed(null, '503 temporarily unavailable', 'fixture')
    return ok({ evidence: 'saved-evidence-fixture' }, 'fixture')
  })
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  try {
    await f.service.command({ type: 'send', text: 'Research a fixture portfolio' })
    const read = f.service.callTool('budget_terminal_portfolio', { request: {} })
    await settle(); assert.equal(attempts, 1)
    mock.timers.tick(500); await settle(); assert.equal(attempts, 2)
    mock.timers.tick(1500); await settle()
    assert.equal((await read as any).data.evidence, 'saved-evidence-fixture')
    assert.equal(attempts, 3)
    assert.equal(f.run().tools.at(-1)?.attempts, 3)
    assert.equal(f.run().tools.at(-1)?.status, 'succeeded')
    let writes = 0
    f.routes.set('mutateArticles', () => { writes++; throw new Error('503 network unavailable') })
    await assert.rejects(() => f.service.callTool('budget_terminal_mutate_articles', { requestId: 'fixture-edit', request: { type: 'add', title: 'Fixture', content: 'Fixture', topic: 'Research', status: 'draft' } }))
    assert.equal(writes, 1, 'Never automatically retry mutations')
    f.routes.set('portfolio', () => { attempts++; return failed(null, '403 permission denied', 'fixture') })
    const before = attempts
    await f.service.callTool('budget_terminal_portfolio', { request: {} })
    assert.equal(attempts, before + 1, 'Permission errors are not transient')
    f.routes.set('portfolio', () => { attempts++; return partial({ evidence: 'partial' }, [{ source: 'fixture', operation: 'fetch', reason: '503 one source failed' }], 'fixture') })
    await f.service.callTool('budget_terminal_portfolio', { request: {} })
    assert.equal(attempts, before + 2, 'Preserve partial evidence without refetching the entire tool')
    assert.equal(f.run().tools.at(-1)?.status, 'partial')
    let release: (value: unknown) => void = () => {}
    f.routes.set('portfolio', () => { attempts++; return new Promise(resolveRead => { release = resolveRead }) })
    const hanging = assert.rejects(f.service.callTool('budget_terminal_portfolio', { request: {} }), /deadline/)
    mock.timers.tick(60_000); await settle(); await hanging
    assert.equal(f.run().tools.at(-1)?.status, 'timedOut')
    const savedBeforeLate = JSON.stringify(f.store.conversation()?.checkpoint)
    release(ok({ evidence: 'late-evidence-must-not-save' }, 'fixture')); await settle()
    assert.equal(JSON.stringify(f.store.conversation()?.checkpoint), savedBeforeLate, 'Ignore a late timed-out provider result')
    assert(f.service.snapshot().busy, 'One timed-out source must not terminate the agent turn')
    f.answer()
    assert.equal(f.run().status, 'partial', 'Successful answers retain failed-source coverage')
  } finally { mock.timers.reset() }
  await f.store.flush()
  const bytes = await readFile(join(directory, 'fixture-0.json'), 'utf8')
  assert(!bytes.includes('synthetic-secret') && !bytes.includes('private-thread-') && !bytes.includes('private-turn-'), 'Diagnostics never save raw provider errors or runtime IDs')
  assert(!JSON.stringify(f.service.snapshot()).includes('saved-evidence-fixture'), 'Private tool checkpoints must not be exposed in polled state or history summaries')
  console.log('PASS: bounded backoff, failed-envelope retries, no mutation/permission retries, partial evidence, per-tool deadline and late-result isolation')

  const failedRun = f.run().id
  f.disconnect('Codex process exited (code 7, signal none).')
  await f.service.command({ type: 'continueResearch', runId: failedRun })
  assert.equal(f.starts(), 2, 'Explicit continuation reconnects automatically')
  const resumed = f.requests.findLast(request => request.method === 'turn/start')!.params.input[0].text
  assert(resumed.includes('Research a fixture portfolio') && resumed.includes('saved-evidence-fixture'), 'Continue receives the original request and saved evidence')
  assert(resumed.includes('current-news tools must be fetched again'), 'Saved evidence never establishes current news')
  await assert.rejects(() => f.service.callTool('budget_terminal_mutate_articles', { request: {} }), /read only/)
  await assert.rejects(() => f.service.callTool('terminal_notify', {}), /cannot create/)
  await assert.rejects(() => f.service.callTool('terminal_show_page', { page: 'charts' }), /cannot navigate/)
  f.answer()
  await f.service.command({ type: 'send', text: 'A new manual request' })
  let mutations = 0
  f.routes.set('mutateArticles', () => { mutations++; return ok({ saved: true }, 'fixture') })
  await f.service.callTool('budget_terminal_mutate_articles', { requestId: 'new-manual-edit', request: { type: 'add', title: 'Fixture', content: 'Fixture', topic: 'Research', status: 'draft' } })
  assert.equal(mutations, 1, 'A later normal manual request restores normal authorized tools')
  f.emit({ method: 'turn/completed', params: { turn: { status: 'completed' } } })
  assert.equal(f.run().status, 'failed')
  assert(f.run().error?.includes('without an answer'), 'Empty completed turns are visible failures')
  await f.service.command({ type: 'continueResearch', runId: f.run().id })
  f.emit({ method: 'item/completed', params: { item: { id: 'commentary-only', type: 'agentMessage', phase: 'commentary', text: 'I am still researching.' } } })
  f.emit({ method: 'turn/completed', params: { turn: { status: 'completed' } } })
  assert.equal(f.run().status, 'failed', 'Commentary without a final answer is not a completed reply')
  await f.service.command({ type: 'continueResearch', runId: f.run().id })
  f.emit({ method: 'error', params: { willRetry: true, error: { message: 'synthetic-private-runtime-error' } } })
  assert(f.service.snapshot().busy)
  assert.equal(f.run().runtimeRetries, 1)
  f.disconnect('Codex process exited (code 7, signal none).')
  assert.equal(f.run().status, 'failed')
  assert.equal(f.run().error, 'Codex disconnected (exit code 7).')
  console.log('PASS: explicit reconnect/continuation with private checkpoints, enforced research-only recovery, runtime retry visibility and empty-answer failures')

  const budget = await fixture()
  await budget.service.command({ type: 'configureRun', minutes: 5 })
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  try {
    await budget.service.command({ type: 'send', text: 'Bounded research with partial streamed answer' })
    budget.emit({ method: 'item/agentMessage/delta', params: { itemId: 'partial', delta: 'Verified fixture evidence so far.' } })
    mock.timers.tick(270_000); await settle()
    assert(budget.run().wrappingUp)
    assert(budget.requests.some(request => request.method === 'turn/steer' && request.params.expectedTurnId), 'Reserve time for the model to finish its answer')
    const wrapped = await budget.service.callTool('budget_terminal_portfolio', { request: {} }) as { error: string }
    assert(wrapped.error.includes('Produce a final answer'))
    mock.timers.tick(30_000); await settle()
    assert.equal(budget.run().status, 'failed')
    assert(budget.service.snapshot().messages.some(message => message.text === 'Verified fixture evidence so far.'), 'Hard timeouts preserve partial streamed output')
    const messages = budget.service.snapshot().messages.length
    budget.emit({ method: 'item/agentMessage/delta', params: { itemId: 'late-answer', delta: 'Ignore late answer' } })
    assert.equal(budget.service.snapshot().messages.length, messages)
  } finally { mock.timers.reset() }
  const cancelled = await fixture()
  await cancelled.service.command({ type: 'send', text: 'Cancel during retry' })
  let retries = 0
  cancelled.routes.set('portfolio', () => { retries++; throw new Error('fetch failed') })
  const stopped = assert.rejects(cancelled.service.callTool('budget_terminal_portfolio', { request: {} }), /cancelled/)
  await settle(); await cancelled.service.command({ type: 'stop' }); await stopped
  assert.equal(retries, 1)
  assert.equal(cancelled.run().status, 'stopped')
  console.log('PASS: configurable budgets, early final-answer steering, hard limits, preserved partial output and cancellable backoff')

  const toolBudget = await fixture()
  await toolBudget.service.command({ type: 'send', text: 'Bound tool attempts' })
  for (let i = 0; i < 70; i++) await toolBudget.service.callTool('terminal_pages', {})
  assert(toolBudget.run().wrappingUp && toolBudget.requests.some(request => request.method === 'turn/steer'), 'Reserve the last ten tool attempts for finishing')
  for (let i = 70; i < 80; i++) await toolBudget.service.callTool('terminal_pages', {})
  await assert.rejects(() => toolBudget.service.callTool('terminal_pages', {}), /80-tool limit/)
  assert.equal(toolBudget.run().status, 'failed')
  assert.equal(toolBudget.run().tools.length, 80, 'Persist bounded diagnostics at the hard tool cap')
  assert(!toolBudget.service.snapshot().busy && !toolBudget.service.snapshot().connected)

  const restartPath = join(directory, 'restart.json')
  const beforeRestart = await fixture(restartPath)
  await beforeRestart.service.command({ type: 'send', text: 'Recover after relaunch' })
  await beforeRestart.service.callTool('budget_terminal_portfolio', { request: {} })
  await beforeRestart.store.flush()
  const restored = await fixture(restartPath)
  assert.equal(restored.run().status, 'failed', 'Relaunch marks a running saved run as interrupted')
  assert(restored.run().endedAt! <= beforeRestart.store.conversation()!.updatedAt, 'Offline time is not counted as active research')
  const turnsBefore = restored.requests.filter(request => request.method === 'turn/start').length
  assert.equal(turnsBefore, 0, 'Restoring a checkpoint never starts inference automatically')
  await restored.service.command({ type: 'continueResearch', runId: restored.run().id })
  assert(restored.requests.at(-1)!.params.input[0].text.includes('saved-evidence-fixture'))
  restored.answer()
  for (const sample of ['password=synthetic-secret', 'https://user:synthetic-secret@example.com/?api_key=synthetic-secret', 'C:/private/synthetic-secret']) {
    assert(!agentFailureReason(sample).includes('synthetic-secret'))
  }
  console.log('PASS: durable interrupted-run recovery, no automatic inference on restore and safe diagnostic categories')
} finally {
  for (const service of services) service.close()
  for (const store of stores) await store.close()
  if (previous.APPDATA === undefined) delete process.env.APPDATA; else process.env.APPDATA = previous.APPDATA
  if (previous.LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previous.LOCALAPPDATA
  assert(resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes('budget-agent-recovery-'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
