import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'node:test'
import { AgentsService, agentTools } from '../electron/services/agents.js'
import type { CodexTransport } from '../electron/services/codexClient.js'
import type { Operation } from '../mcp/operations.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-agents-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const routes = new Map<Operation, (request: unknown) => unknown>([['portfolio', () => ({ data: { portfolios: [] }, meta: { freshness: 'partial', source: 'fixture' }, errors: [{ reason: 'Fixture missing data' }] })]])
let receiver: (packet: any) => void = () => {}
let disconnected: (error: string) => void = () => {}
let calls: Array<{ method: string; params: any }> = []
let writes: any[] = []
let closes = 0
let authenticated = true
const client: CodexTransport = {
  async start() {},
  async request(method, params) {
    calls.push({ method, params })
    if (method === 'account/read') return { account: authenticated ? { type: 'chatgpt' } : null }
    if (method === 'config/read') return { config: { mcp_servers: { unrelated: {} } } }
    if (method === 'thread/start') return { thread: { id: 'thread-1' } }
    return { turn: { id: 'turn-1' } }
  },
  write(packet) { writes.push(packet) },
  close() { closes++ },
}
const service = new AgentsService({ executable: 'unused', cwd: directory, routes, clientFactory: (receive, ended) => { receiver = receive; disconnected = ended; return client } })
const complete = (status = 'completed') => receiver({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { status } } })

try {
  assert.equal(service.snapshot().autonomy, false)
  assert.equal(service.snapshot().connected, false)
  assert.equal(calls.length, 0, 'Startup status never starts Codex or inference')
  await assert.rejects(() => service.command({ type: 'send', text: 'hello' }), /Connect Codex/)
  await assert.rejects(() => service.command({ type: 'autonomy', enabled: true, objective: 'test', intervalMinutes: 1 }), /too_small|Too small/)
  await service.command({ type: 'connect' })
  assert(service.snapshot().connected)
  const start = calls.find(call => call.method === 'thread/start')!.params
  assert.equal(start.ephemeral, true)
  assert.deepEqual(start.environments, [])
  assert.equal(start.config['mcp_servers.unrelated.enabled'], false)
  assert.equal(start.config['features.shell_tool'], false)
  assert(!agentTools.some(tool => /mutate|maintenance|openExternal|shell/.test(tool.name)))
  await service.command({ type: 'send', text: 'Show AAPL and inspect the portfolio' })
  assert(service.snapshot().busy)
  await assert.rejects(() => service.command({ type: 'send', text: 'overlap' }), /working/)
  const portfolio = await service.callTool('budget_terminal_portfolio', { request: {} }) as any
  assert.equal(portfolio.meta.freshness, 'partial', 'Keep partial data metadata')
  assert.equal(portfolio.errors[0].reason, 'Fixture missing data')
  await assert.rejects(() => service.callTool('budget_terminal_mutate_portfolio', { request: {} }), /not available/)
  await assert.rejects(() => service.callTool('budget_terminal_portfolio', { request: { unknown: true } }), /Invalid tool arguments/)
  await assert.rejects(() => service.callTool('terminal_show_page', { page: 'bad' }))
  await assert.rejects(() => service.callTool('terminal_show_page', { page: 'news', symbol: 'AAPL' }), /Ticker selection/)
  const navigation = service.callTool('terminal_show_page', { page: 'charts', symbol: 'AAPL' })
  const command = service.snapshot().navigation!
  assert.equal(command.page, 'charts')
  assert.equal(command.symbol, 'AAPL')
  await service.command({ type: 'navigationResult', id: command.id })
  assert.deepEqual(await navigation, { shown: true })
  receiver({ method: 'item/agentMessage/delta', params: { threadId: 'other', itemId: 'ignored', delta: 'wrong thread' } })
  receiver({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', itemId: 'answer', delta: 'Opened ' } })
  receiver({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', itemId: 'answer', delta: 'AAPL.' } })
  receiver({ id: 55, method: 'item/commandExecution/requestApproval', params: {} })
  assert.equal(writes.at(-1).error.code, -32601)
  complete()
  assert.equal(service.snapshot().messages.find(message => message.id === 'answer')?.text, 'Opened AAPL.')
  assert(!service.snapshot().messages.some(message => message.id === 'ignored'))
  assert.equal(service.snapshot().busy, false)
  assert.equal(service.snapshot().autonomy, false)
  await service.command({ type: 'autonomy', enabled: true, objective: 'Check news', runs: 2, intervalMinutes: 5 })
  assert(service.snapshot().busy)
  assert.equal(service.snapshot().runsRemaining, 1)
  complete()
  assert(service.snapshot().nextRunAt! > Date.now())
  await service.command({ type: 'autonomy', enabled: false })
  assert.equal(service.snapshot().nextRunAt, null)
  assert.equal(service.snapshot().autonomy, false)
  assert.equal(service.snapshot().connected, false)
  await service.command({ type: 'connect' })
  await service.command({ type: 'autonomy', enabled: true, objective: 'Check news', runs: 1 })
  complete()
  assert.equal(service.snapshot().autonomy, false)
  await service.command({ type: 'autonomy', enabled: true, objective: 'Check news' })
  complete('failed')
  assert.equal(service.snapshot().autonomy, false)
  assert(service.snapshot().error.includes('failed'))
  await service.command({ type: 'send', text: 'Retry' })
  disconnected('Fixture disconnect')
  assert.equal(service.snapshot().connected, false)
  assert.equal(service.snapshot().busy, false)
  assert.equal(service.snapshot().error, 'Fixture disconnect')
  assert(closes > 0)
  authenticated = false
  await service.command({ type: 'connect' })
  assert(service.snapshot().error.includes('codex login'))
  await service.command({ type: 'newChat' })
  assert.equal(service.snapshot().messages.length, 0)
  assert.equal(service.snapshot().autonomy, false)
  service.close()
  authenticated = true
  const scheduled = new AgentsService({ executable: 'unused', cwd: directory, routes, clientFactory: (receive, ended) => { receiver = receive; disconnected = ended; return client } })
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  try {
    await scheduled.command({ type: 'connect' })
    await scheduled.command({ type: 'autonomy', enabled: true, objective: 'Repeat twice', intervalMinutes: 5, runs: 2 })
    complete()
    assert.equal(scheduled.snapshot().runsRemaining, 1)
    mock.timers.tick(5 * 60_000)
    assert(scheduled.snapshot().busy, 'Scheduled run must start without a mounted page')
    assert.equal(scheduled.snapshot().runsRemaining, 0)
    complete()
    assert.equal(scheduled.snapshot().autonomy, false)
    assert.equal(scheduled.snapshot().nextRunAt, null)
    await scheduled.command({ type: 'autonomy', enabled: true, objective: 'Cancel schedule', runs: 3, intervalMinutes: 5 })
    complete()
    await scheduled.command({ type: 'stop' })
    const before = calls.length
    mock.timers.tick(10 * 60_000)
    assert.equal(calls.length, before, 'Stop must cancel future scheduled inference')
  } finally { scheduled.close(); mock.timers.reset() }
  calls = []; writes = []
  console.log('PASS: idle startup, read-only tool policy, validated arguments, navigation acknowledgment, streaming, bounded autonomy, errors, cancellation and reconnect')

  if (process.argv.includes('--live')) {
    const executable = process.env.BUDGET_TERMINAL_CODEX_PATH ?? (process.platform === 'win32' ? join(previous.LOCALAPPDATA!, 'Programs/OpenAI/Codex/bin/codex.exe') : 'codex')
    const live = new AgentsService({ executable, cwd: directory, routes })
    try {
      await live.command({ type: 'connect' })
      assert.equal(live.snapshot().connected, true, live.snapshot().error)
      console.log('PASS: real Codex app-server initialization, account and dynamic tools')
      await live.command({ type: 'send', text: 'Integration smoke test. Call terminal_pages, then terminal_show_page to show charts with symbol AAPL. Do not fetch market data. Briefly confirm the result.' })
      const until = Date.now() + 90_000
      let shown = false
      while (live.snapshot().busy && Date.now() < until) {
        const nav = live.snapshot().navigation
        if (nav) { assert.equal(nav.page, 'charts'); assert.equal(nav.symbol, 'AAPL'); shown = true; await live.command({ type: 'navigationResult', id: nav.id }) }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.equal(live.snapshot().error, '')
      assert.equal(live.snapshot().busy, false, 'Live Codex run timed out')
      assert(shown, 'Real Codex must invoke the page navigation tool')
      assert(live.snapshot().messages.some(message => message.role === 'assistant'))
      console.log('PASS: real Codex chat, tool calls, navigation and completed response')
    } finally { live.close() }
  }
} finally {
  service.close()
  process.env.APPDATA = previous.APPDATA
  process.env.LOCALAPPDATA = previous.LOCALAPPDATA
  assert(directory.startsWith(join(tmpdir(), 'budget-agents-')))
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
