import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mock } from 'node:test'
import { AgentsService, agentTools } from '../electron/services/agents.js'
import { catalog, connectionTool } from '../mcp/catalog.js'
import type { CodexTransport } from '../electron/services/codexClient.js'
import type { Operation } from '../mcp/operations.js'
import { validateAgentImages } from '../electron/services/agentImages.js'
import { failed, ok } from '../electron/shared/envelope.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-agents-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const routes = new Map<Operation, (request: unknown) => unknown>([['portfolio', () => ({ data: { portfolios: [] }, meta: { freshness: 'partial', source: 'fixture' }, errors: [{ reason: 'Fixture missing data' }] })]])
const mutations: unknown[] = []
routes.set('mutateArticles', request => { mutations.push(request); return ok({ saved: true }, 'fixture') })
routes.set('settings', () => failed({}, 'Fixture settings failure', 'fixture'))
routes.set('screenshot', () => ok({ screenshots: [{ pageId: 'charts', label: 'Charts', mimeType: 'image/png', base64: 'cGl4ZWxz' }] }, 'fixture'))
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
    if (method === 'model/list') return { data: [
      { model: 'fixture-fast', displayName: 'Fixture Fast', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Quick' }, { reasoningEffort: 'high', description: 'Deeper' }] },
      { model: 'fixture-deep', displayName: 'Fixture Deep', inputModalities: ['text'], defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }] },
    ], nextCursor: null }
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: (params as { model?: string }).model ?? 'fixture-fast', reasoningEffort: null }
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
  assert.equal(service.snapshot().model, 'fixture-fast')
  assert.equal(service.snapshot().models.length, 2)
  await assert.rejects(() => service.command({ type: 'configure', model: 'invented', thinking: null }), /catalog/)
  await assert.rejects(() => service.command({ type: 'configure', model: 'fixture-deep', thinking: 'high' }), /not supported/)
  await service.command({ type: 'configure', model: 'fixture-fast', thinking: 'high' })
  const start = calls.find(call => call.method === 'thread/start')!.params
  assert.equal(start.ephemeral, true)
  assert.deepEqual(start.environments, [])
  assert.equal(start.config['mcp_servers.unrelated.enabled'], false)
  assert.equal(start.config['features.shell_tool'], false)
  for (const tool of [...catalog.map(entry => entry.tool), connectionTool]) assert(agentTools.some(entry => entry.name === tool.name), `${tool.name} must be available in Agents`)
  assert(!agentTools.some(tool => /maintenance|openExternal|shell/.test(tool.name)))
  await service.command({ type: 'send', text: 'Show AAPL and inspect the portfolio' })
  assert.equal(calls.at(-1)!.params.model, 'fixture-fast')
  assert.equal(calls.at(-1)!.params.effort, 'high')
  await assert.rejects(() => service.command({ type: 'configure', model: 'fixture-fast', thinking: 'low' }), /working/)
  assert(service.snapshot().busy)
  await assert.rejects(() => service.command({ type: 'send', text: 'overlap' }), /working/)
  const portfolio = await service.callTool('budget_terminal_portfolio', { request: {} }) as any
  assert.equal(portfolio.meta.freshness, 'partial', 'Keep partial data metadata')
  assert.equal(portfolio.errors[0].reason, 'Fixture missing data')
  const edit = { type: 'add', title: 'Agent MCP test', content: 'Fixture article', topic: 'Research', status: 'draft' }
  await service.callTool('budget_terminal_mutate_articles', { request: edit })
  assert.deepEqual(mutations, [edit], 'Manual MCP mutations use validated app routes')
  await assert.rejects(() => service.callTool('budget_terminal_mutate_articles', { request: { type: 'invalid' } }), /Invalid tool arguments/)
  assert.equal(mutations.length, 1, 'Invalid edits must never reach the service')
  assert.deepEqual(await service.callTool('budget_terminal_connection_status', {}), { available: true, tools: catalog.length + 1 })
  await assert.rejects(() => service.callTool('budget_terminal_connection_status', { unknown: true }))
  receiver({ id: 61, method: 'item/tool/call', params: { threadId: 'thread-1', tool: 'budget_terminal_screenshot', arguments: { request: { page: 'charts' } } } })
  await new Promise(resolve => setImmediate(resolve))
  const captureReply = writes.find(packet => packet.id === 61).result
  assert(captureReply.success)
  assert(captureReply.contentItems.some((item: any) => item.type === 'inputImage' && item.imageUrl === 'data:image/png;base64,cGl4ZWxz'))
  assert(!captureReply.contentItems.filter((item: any) => item.type === 'inputText').some((item: any) => item.text.includes('cGl4ZWxz')), 'Pixels must not be serialized into text')
  receiver({ id: 62, method: 'item/tool/call', params: { threadId: 'thread-1', tool: 'budget_terminal_settings', arguments: { request: {} } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(writes.find(packet => packet.id === 62).result.success, false, 'Failed service envelopes must be failed tool calls')
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
  await service.command({ type: 'configure', model: 'fixture-deep', thinking: null })
  await service.command({ type: 'autonomy', enabled: true, objective: 'Check news', runs: 2, intervalMinutes: 5 })
  assert.equal(calls.at(-1)!.params.model, 'fixture-deep')
  assert.equal(calls.at(-1)!.params.effort, 'medium', 'Default effort must follow the newly selected model')
  assert(service.snapshot().busy)
  assert.equal(service.snapshot().runsRemaining, 1)
  for (const entry of catalog.filter(entry => !entry.tool.annotations?.readOnlyHint)) {
    await assert.rejects(() => service.callTool(entry.tool.name, { request: {} }), /read only/)
  }
  assert.equal(mutations.length, 1, 'Autonomy must never dispatch saved-data edits')
  complete()
  assert(service.snapshot().nextRunAt! > Date.now())
  await assert.rejects(() => service.command({ type: 'configure', model: 'fixture-fast', thinking: 'low' }), /autonomous mode/)
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
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  const image = { name: 'Portfolio.png', dataUrl: pixel }
  assert.equal(validateAgentImages([image]).length, 1)
  assert.throws(() => validateAgentImages([{ ...image, dataUrl: 'file:///private/portfolio.png' }]), /not links/)
  assert.throws(() => validateAgentImages([{ ...image, dataUrl: pixel.replace('image/png', 'image/jpeg') }]), /do not match/)
  assert.throws(() => validateAgentImages(Array(5).fill(image)))
  const { readPortfolios, mutatePortfolios, applyAgentPortfolioUpdate, verifyStoredData } = await import('../electron/services/portfolioStore.js')
  const initial = await readPortfolios()
  const portfolioId = initial.portfolios.find(portfolio => !portfolio.readOnly)!.id
  await mutatePortfolios({ type: 'addPosition', portfolioId, ticker: 'AAPL' })
  await mutatePortfolios({ type: 'setPosition', portfolioId, ticker: 'AAPL', shares: 2, avgPrice: 5, includeInWeight: false })
  await mutatePortfolios({ type: 'addPosition', portfolioId, ticker: 'MSFT' })
  await mutatePortfolios({ type: 'setPosition', portfolioId, ticker: 'MSFT', shares: 3, avgPrice: 10 })
  const imports = new AgentsService({ executable: 'unused', cwd: directory, routes,
    portfolio: { read: readPortfolios, apply: applyAgentPortfolioUpdate },
    clientFactory: (receive, ended) => { receiver = receive; disconnected = ended; return client } })
  try {
    await imports.command({ type: 'connect' })
    await imports.command({ type: 'configure', model: 'fixture-deep', thinking: null })
    await assert.rejects(() => imports.command({ type: 'send', text: '', images: [image] }), /does not accept images/)
    await imports.command({ type: 'configure', model: 'fixture-fast', thinking: null })
    await imports.command({ type: 'send', text: '', images: [image] })
    assert.deepEqual(calls.at(-1)!.params.input[1], { type: 'image', url: pixel })
    assert.deepEqual(imports.snapshot().messages.at(-1)?.images, ['Portfolio.png'])
    assert(!JSON.stringify(imports.snapshot()).includes('base64'), 'Image bytes must not be copied into polled chat snapshots')
    const proposal = { portfolioId, summary: 'Screenshot fixture', positions: [{ ticker: 'AAPL', shares: 12 }, { ticker: 'TEST', shares: 4, avgPrice: 20 }], cashBalance: 250,
      options: [{ ticker: 'AAPL', strategy: 'Calls', expiry: '2026-12-18', strike: 100, contracts: 1, premium: 2.5, status: 'Open', openDate: '2026-10-17' }] }
    await assert.rejects(() => imports.callTool('terminal_propose_portfolio_update', { ...proposal, positions: [{ ticker: 'NEW', shares: 1 }] }), /average cost/)
    const old = await readPortfolios()
    await imports.callTool('terminal_propose_portfolio_update', proposal)
    assert.deepEqual(await readPortfolios(), old, 'A proposal must never write the portfolio')
    complete()
    await assert.rejects(() => imports.command({ type: 'send', text: 'overwrite review' }), /dismiss/)
    const id = imports.snapshot().portfolioProposal!.id
    await assert.rejects(() => imports.command({ type: 'portfolioDecision', id: 'forged', approve: true }), /no longer/)
    await imports.command({ type: 'portfolioDecision', id, approve: true })
    const updated = await readPortfolios()
    const saved = updated.portfolios.find(portfolio => portfolio.id === portfolioId)!
    assert.equal(saved.holdings.AAPL.shares, 12)
    assert.equal(saved.holdings.AAPL.avgPrice, 5, 'Omitted average cost stays unchanged')
    assert.equal(saved.holdings.AAPL.includeInWeight, false)
    assert.equal(saved.holdings.MSFT.shares, 3, 'Unlisted positions stay unchanged')
    assert.equal(saved.cashBalance, 250)
    assert.equal(saved.holdings.TEST.avgPrice, 20)
    assert.equal(saved.options[0].premium, 2.5)
    assert(await verifyStoredData({ kind: 'portfolio', expected: updated }))
    await imports.command({ type: 'send', text: 'Change AAPL' })
    await imports.callTool('terminal_propose_portfolio_update', { portfolioId, summary: 'Stale test', positions: [{ ticker: 'AAPL', shares: 99 }] })
    complete()
    await mutatePortfolios({ type: 'setCash', portfolioId, cashBalance: 999 })
    await assert.rejects(() => imports.command({ type: 'portfolioDecision', id: imports.snapshot().portfolioProposal!.id, approve: true }), /changed after the preview/)
    assert.equal((await readPortfolios()).portfolios[0].holdings.AAPL.shares, 12, 'Stale approval must not partly write')
    await imports.command({ type: 'portfolioDecision', id: imports.snapshot().portfolioProposal!.id, approve: false })
    await imports.command({ type: 'autonomy', enabled: true, objective: 'Research only' })
    await assert.rejects(() => imports.callTool('terminal_propose_portfolio_update', proposal), /manual chat/)
    complete()
    console.log('PASS: image validation and transport, reviewed portfolio/option writes, on-disk verification, omitted fields, stale-write protection and autonomous write rejection')
  } finally { imports.close() }
  calls = []; writes = []
  console.log('PASS: idle startup, full MCP catalog, validated edits, screenshot image results, failed envelopes, read-only autonomy, navigation, streaming, cancellation and reconnect')

  if (process.argv.includes('--live')) {
    const executable = process.env.BUDGET_TERMINAL_CODEX_PATH ?? (process.platform === 'win32' ? join(previous.LOCALAPPDATA!, 'Programs/OpenAI/Codex/bin/codex.exe') : 'codex')
    const liveRoutes = new Map(routes)
    liveRoutes.set('portfolio', async () => ok(await readPortfolios(), 'fixture portfolio'))
    const live = new AgentsService({ executable, cwd: directory, routes: liveRoutes, portfolio: { read: readPortfolios, apply: applyAgentPortfolioUpdate } })
    try {
      await live.command({ type: 'connect' })
      assert.equal(live.snapshot().connected, true, live.snapshot().error)
      assert(live.snapshot().model, 'Real Codex must report the active model')
      assert(live.snapshot().models.length > 0, 'Real model catalog must load')
      const model = live.snapshot().models.find(model => model.id === live.snapshot().model)!
      assert(model, 'Active model must be discoverable')
      await live.command({ type: 'configure', model: model.id, thinking: model.defaultThinking })
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
      if (process.argv.includes('--live-image')) {
        const bytes = await readFile(resolve(import.meta.dirname, '../../../output/playwright/agent-portfolio-fixture.png'))
        await live.command({ type: 'send', text: `The attached synthetic screenshot is for my existing portfolio ${portfolioId}. Read my saved portfolio, then use terminal_propose_portfolio_update to update only AAPL shares and average cost from the image. Do not fetch market data.`, images: [{ name: 'Synthetic portfolio.png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }] })
        const until = Date.now() + 90_000
        while (live.snapshot().busy && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100))
        assert.equal(live.snapshot().error, '')
        assert(live.snapshot().portfolioProposal, 'Real Codex must read the image and propose portfolio changes')
        const changes = live.snapshot().portfolioProposal!.changes
        assert(changes.some(change => change.field === 'AAPL · Shares' && change.after === '25'))
        assert(changes.some(change => change.field === 'AAPL · Average cost' && change.after === '123.45'))
        await live.command({ type: 'portfolioDecision', id: live.snapshot().portfolioProposal!.id, approve: true })
        assert.equal((await readPortfolios()).portfolios[0].holdings.AAPL.shares, 25)
        assert(await verifyStoredData({ kind: 'portfolio', expected: await readPortfolios() }))
        console.log('PASS: real Codex image reading, portfolio proposal, approval and verified temporary-store update')
      }
    } finally { live.close() }
  }
} finally {
  service.close()
  process.env.APPDATA = previous.APPDATA
  process.env.LOCALAPPDATA = previous.LOCALAPPDATA
  assert(directory.startsWith(join(tmpdir(), 'budget-agents-')))
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
