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
import { AGENT_CANDLESTICK_MAX_CANDLES, AGENT_CANDLESTICK_MAX_LENGTH, AGENT_PIE_MAX_LENGTH, parseAgentCandlestick, parseAgentPie } from '../electron/shared/agentCharts.js'

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
let starts = 0
let nextThreadId = 'thread-1'
let threadError = false
let threadGate: Promise<void> | null = null
const client: CodexTransport = {
  async start() { starts++ },
  async request(method, params) {
    calls.push({ method, params })
    if (method === 'account/read') return { account: authenticated ? { type: 'chatgpt' } : null }
    if (method === 'config/read') return { config: { mcp_servers: { unrelated: {} } } }
    if (method === 'model/list') return { data: [
      { model: 'fixture-fast', displayName: 'Fixture Fast', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Quick' }, { reasoningEffort: 'high', description: 'Deeper' }] },
      { model: 'fixture-deep', displayName: 'Fixture Deep', inputModalities: ['text'], defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }] },
    ], nextCursor: null }
    if (method === 'thread/start') {
      if (threadGate) await threadGate
      if (threadError) throw new Error('Fixture thread creation failed')
      return { thread: { id: nextThreadId }, model: (params as { model?: string }).model ?? 'fixture-fast', reasoningEffort: null }
    }
    return { turn: { id: 'turn-1' } }
  },
  write(packet) { writes.push(packet) },
  close() { closes++ },
}
const service = new AgentsService({ executable: 'unused', cwd: directory, routes, clientFactory: (receive, ended) => { receiver = receive; disconnected = ended; return client } })
const complete = (status = 'completed') => receiver({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { status } } })

try {
  const pie = { title: 'Allocation', unit: 'USD', slices: [{ label: 'Stocks', value: 75 }, { label: 'Cash', value: 25 }, { label: 'Empty', value: 0 }], caption: 'Fixture source' }
  assert.deepEqual(parseAgentPie(JSON.stringify(pie)), pie)
  assert(parseAgentPie(JSON.stringify({ title: 'One category', slices: [{ label: 'Cash', value: 1 }] })))
  for (const invalid of [
    '', '{"title":', 'null', '[]',
    JSON.stringify({ ...pie, slices: [] }),
    JSON.stringify({ ...pie, slices: [{ label: '', value: 1 }] }),
    JSON.stringify({ ...pie, slices: [{ label: 'Debt', value: -1 }] }),
    JSON.stringify({ ...pie, slices: [{ label: 'Empty', value: 0 }] }),
    JSON.stringify({ ...pie, slices: [{ label: 'Cash', value: '25' }] }),
    JSON.stringify({ ...pie, slices: [{ label: 'Cash', value: null }] }),
    JSON.stringify({ ...pie, slices: Array(31).fill({ label: 'Cash', value: 1 }) }),
    JSON.stringify({ ...pie, slices: Array(2).fill({ label: 'Overflow', value: 1e308 }) }),
    JSON.stringify({ ...pie, slices: [{ label: 'Cash', value: 1, color: 'url(https://example.com)' }] }),
    JSON.stringify(pie) + ' '.repeat(AGENT_PIE_MAX_LENGTH),
    '{"title":"Overflow","slices":[{"label":"Cash","value":1e999}]}',
  ]) assert.equal(parseAgentPie(invalid), null, `Reject invalid pie: ${invalid.slice(0, 100)}`)
  assert.equal(service.snapshot().autonomy, false)
  assert.equal(service.snapshot().connected, false)
  const candle = { time: '2026-10-15', open: 210, high: 215, low: 208, close: 214 }
  const candlestick = { title: 'AAPL daily', unit: 'USD', candles: [candle, { ...candle, time: '2026-10-16' }], caption: 'Fixture source and as-of date' }
  assert.deepEqual(parseAgentCandlestick(JSON.stringify(candlestick)), candlestick)
  for (const candles of [
    [{ ...candle, open: 0, high: 0, low: 0, close: 0 }],
    [{ ...candle, open: -5, high: 0, low: -10, close: -2 }],
    [{ ...candle, time: '2024-02-29' }],
    [{ ...candle, time: '2026-10-15T09:30:00Z' }, { ...candle, time: '2026-10-15T09:30:00.001Z' }],
    Array.from({ length: AGENT_CANDLESTICK_MAX_CANDLES }, (_, index) => ({ ...candle, time: new Date(Date.UTC(2026, 0, index + 1)).toISOString() })),
  ]) assert(parseAgentCandlestick(JSON.stringify({ ...candlestick, candles })), 'Accept flat, negative, leap date, intraday and maximum-length charts')
  for (const invalid of [
    '', '{"title":', 'null', '[]',
    JSON.stringify({ ...candlestick, title: ' ' }),
    JSON.stringify({ ...candlestick, candles: [] }),
    JSON.stringify({ ...candlestick, candles: [candle, candle] }),
    JSON.stringify({ ...candlestick, candles: [...candlestick.candles].reverse() }),
    JSON.stringify({ ...candlestick, candles: [{ ...candle, time: '2026-10-15T00:00:00Z' }, candle] }),
    ...['2026-02-29', '2026-13-01', '2026-10-15T25:00:00Z', '2026-10-15T09:30:00', 'yesterday', 1792022400].map(time => JSON.stringify({ ...candlestick, candles: [{ ...candle, time }] })),
    ...[{ open: 216 }, { close: 207 }, { high: 200 }, { low: 220 }, { open: '210' }, { close: null }, { open: undefined }, { color: 'url(https://example.com)' }].map(fields => JSON.stringify({ ...candlestick, candles: [{ ...candle, ...fields }] })),
    JSON.stringify({ ...candlestick, candles: Array(AGENT_CANDLESTICK_MAX_CANDLES + 1).fill(candle) }),
    JSON.stringify({ ...candlestick, script: 'alert(1)' }),
    JSON.stringify(candlestick) + ' '.repeat(AGENT_CANDLESTICK_MAX_LENGTH),
    '{"title":"Overflow","candles":[{"time":"2026-10-15","open":1e999,"high":1e999,"low":0,"close":1}]}',
  ]) assert.equal(parseAgentCandlestick(invalid), null, `Reject invalid candlestick: ${invalid.slice(0, 100)}`)
  console.log('PASS: native pie and candlestick parsing, OHLC bounds, UTC dates, chronological uniqueness, finite numbers and bounded payloads')
  assert.equal(calls.length, 0, 'Constructing a service or reading its snapshot never runs inference; the desktop host starts the connection')
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
  assert(start.baseInstructions.includes('```pie') && start.baseInstructions.includes('native pie charts'), 'Agent must know the native pie format')
  assert(start.baseInstructions.includes('```candlestick') && start.baseInstructions.includes('"symbol":"AAPL"')
    && start.baseInstructions.includes('Never truncate') && start.baseInstructions.includes('do not invent a ticker or prices'), 'Agent must use symbol-backed full-history charts and real evidence, not sampled or fabricated candles')
  assert.equal(start.ephemeral, true)
  assert.deepEqual(start.environments, [])
  assert.equal(start.config['mcp_servers.unrelated.enabled'], false)
  assert.equal(start.config['features.shell_tool'], false)
  assert.equal(start.config.web_search, 'disabled', 'Native web search remains disabled')
  assert(start.baseInstructions.includes('To search for websites, use action search with query'), 'General agent instructions retain browser search')
  const browserTool = agentTools.find(tool => tool.name === 'budget_terminal_browser_research')!
  assert.equal(browserTool.description, catalog.find(entry => entry.operation === 'browserResearch')!.tool.description, 'Agent browser tool retains the shared catalog description')
  for (const tool of [...catalog.map(entry => entry.tool), connectionTool]) assert(agentTools.some(entry => entry.name === tool.name), `${tool.name} must be available in Agents`)
  assert(!agentTools.some(tool => /maintenance|openExternal|shell/.test(tool.name)))
  await service.command({ type: 'send', text: 'Show AAPL and inspect the portfolio' })
  assert.equal(calls.at(-1)!.params.model, 'fixture-fast')
  assert.equal(calls.at(-1)!.params.effort, 'high')
  assert.equal(service.snapshot().activity, 'thinking', 'New runs begin thinking, not done')
  await assert.rejects(() => service.command({ type: 'configure', model: 'fixture-fast', thinking: 'low' }), /working/)
  assert(service.snapshot().busy)
  await assert.rejects(() => service.command({ type: 'send', text: 'overlap' }), /working/)
  await assert.rejects(() => service.command({ type: 'newChat' }), /working/)
  const browserRequests: unknown[] = []
  routes.set('browserResearch', request => { browserRequests.push(request); return ok({ state: {} }, 'fixture') })
  await service.callTool('budget_terminal_browser_research', { request: { action: 'search', query: 'portfolio news' } })
  await service.callTool('budget_terminal_browser_research', { request: { action: 'read' } })
  assert.deepEqual(browserRequests, [{ action: 'search', query: 'portfolio news' }, { action: 'read' }], 'Browser search and page reading remain available for manual Agent requests')
  routes.delete('browserResearch')
  const portfolio = await service.callTool('budget_terminal_portfolio', { request: {} }) as any
  assert.equal(portfolio.meta.freshness, 'partial', 'Keep partial data metadata')
  assert.equal(portfolio.errors[0].reason, 'Fixture missing data')
  const originalPortfolio = routes.get('portfolio')!
  const researchResolvers: Array<(value: unknown) => void> = []
  routes.set('portfolio', () => new Promise(resolve => researchResolvers.push(resolve)))
  const firstResearch = service.callTool('budget_terminal_portfolio', { request: {} })
  const secondResearch = service.callTool('budget_terminal_portfolio', { request: {} })
  assert.equal(service.snapshot().activity, 'researching', 'Active research tools report real activity')
  researchResolvers[0](ok({ portfolios: [] }, 'fixture')); await firstResearch
  assert.equal(service.snapshot().activity, 'researching', 'Parallel research stays active until every tool returns')
  researchResolvers[1](ok({ portfolios: [] }, 'fixture')); await secondResearch
  assert.equal(service.snapshot().activity, 'thinking')
  routes.set('portfolio', originalPortfolio)
  const edit = { type: 'add', title: 'Agent MCP test', content: 'Fixture article', topic: 'Research', status: 'draft' }
  await service.callTool('budget_terminal_mutate_articles', { request: edit, requestId: 'agent-article-edit' })
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
  assert.equal(service.snapshot().activity, 'responding')
  receiver({ method: 'item/started', params: { threadId: 'thread-1', item: { id: 'reasoning', type: 'reasoning' } } })
  assert.equal(service.snapshot().activity, 'thinking', 'New reasoning is not incorrectly labelled writing')
  receiver({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', itemId: 'answer', delta: 'AAPL.' } })
  receiver({ id: 55, method: 'item/commandExecution/requestApproval', params: {} })
  assert.equal(writes.at(-1).error.code, -32601)
  assert.equal(service.snapshot().activity, 'responding')
  complete()
  assert.equal(service.snapshot().activity, 'done', 'Only a successful completed turn is done')
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
  await assert.rejects(() => service.command({ type: 'newChat' }), /autonomous mode/)
  await service.command({ type: 'autonomy', enabled: false })
  assert.equal(service.snapshot().nextRunAt, null)
  assert.equal(service.snapshot().autonomy, false)
  assert.equal(service.snapshot().activity, 'stopped')
  assert.equal(service.snapshot().connected, false)
  await service.command({ type: 'connect' })
  await service.command({ type: 'autonomy', enabled: true, objective: 'Check news', runs: 1 })
  complete()
  assert.equal(service.snapshot().autonomy, false)
  await service.command({ type: 'autonomy', enabled: true, objective: 'Check news' })
  complete('failed')
  assert.equal(service.snapshot().autonomy, false)
  assert(service.snapshot().error.includes('failed'))
  assert.equal(service.snapshot().activity, 'error', 'Failed runs must never report done')
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
  assert.equal(service.snapshot().connected, false, 'New chat while disconnected does not silently reconnect')
  authenticated = true
  await service.command({ type: 'connect' })
  await service.command({ type: 'configure', model: 'fixture-fast', thinking: 'high' })
  const connectionCounts = { starts, closes, accounts: calls.filter(call => call.method === 'account/read').length }
  threadError = true
  const previousMessages = service.snapshot().messages
  await service.command({ type: 'newChat' })
  assert(service.snapshot().connected)
  assert(service.snapshot().error.includes('thread creation failed'))
  assert.deepEqual(service.snapshot().messages, previousMessages, 'Failed new thread retains the old conversation')
  threadError = false
  nextThreadId = 'thread-new'
  await service.command({ type: 'newChat' })
  assert.equal(service.snapshot().messages.length, 0)
  assert.equal(service.snapshot().connected, true)
  assert.equal(service.snapshot().activity, 'idle', 'New chat clears old completion status')
  assert.equal(service.snapshot().model, 'fixture-fast')
  assert.equal(service.snapshot().thinking, 'high')
  assert.deepEqual({ starts, closes, accounts: calls.filter(call => call.method === 'account/read').length }, connectionCounts, 'New chat reuses the signed-in Codex transport')
  assert.equal(calls.at(-1)!.method, 'thread/start')
  assert.equal(calls.at(-1)!.params.config.model_reasoning_effort, 'high')
  assert(calls.at(-1)!.params.dynamicTools.some((tool: any) => tool.name === 'terminal_pages'))
  receiver({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', itemId: 'late', delta: 'Old response' } })
  assert.equal(service.snapshot().messages.length, 0, 'Late output from the old conversation must be ignored')
  await service.command({ type: 'send', text: 'Fresh conversation' })
  assert.equal(calls.at(-1)!.params.threadId, 'thread-new')
  receiver({ method: 'turn/completed', params: { threadId: 'thread-new', turn: { status: 'completed' } } })
  let releaseThread!: () => void
  threadGate = new Promise(resolve => { releaseThread = resolve })
  const resetting = service.command({ type: 'newChat' })
  assert(service.snapshot().busy)
  await service.command({ type: 'stop' })
  releaseThread()
  await resetting
  assert.equal(service.snapshot().connected, false, 'Stop during thread creation must not revive the connection')
  threadGate = null
  nextThreadId = 'thread-1'
  service.close()
  const scheduled = new AgentsService({ executable: 'unused', cwd: directory, routes, clientFactory: (receive, ended) => { receiver = receive; disconnected = ended; return client } })
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  try {
    await scheduled.command({ type: 'connect' })
    await scheduled.command({ type: 'send', text: 'Bound manual research' })
    mock.timers.tick(9 * 60_000)
    assert(scheduled.snapshot().connected && scheduled.snapshot().busy, 'Manual research stays active before the ten-minute limit')
    receiver({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', itemId: 'partial-answer', delta: 'Research in progress.' } })
    mock.timers.tick(60_000)
    assert(!scheduled.snapshot().connected && !scheduled.snapshot().busy, 'Manual research stops at ten minutes even when output is streaming')
    assert(scheduled.snapshot().error.includes('run reached its 10-minute limit'))
    receiver({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', itemId: 'late-answer', delta: 'Ignore after timeout' } })
    assert(!scheduled.snapshot().messages.some(message => message.id === 'late-answer'), 'Timed-out runs cannot revive from late output')
    await scheduled.command({ type: 'connect' })
    await scheduled.command({ type: 'send', text: 'Finish within the deadline' })
    mock.timers.tick(9 * 60_000)
    complete()
    mock.timers.tick(2 * 60_000)
    assert(scheduled.snapshot().connected && !scheduled.snapshot().busy && scheduled.snapshot().activity === 'done', 'Completed manual runs cancel their deadline')
    assert.equal(scheduled.snapshot().error, '')
    await scheduled.command({ type: 'autonomy', enabled: true, objective: 'Bound unattended work', runs: 1 })
    mock.timers.tick(10 * 60_000)
    assert(!scheduled.snapshot().connected && !scheduled.snapshot().busy && !scheduled.snapshot().autonomy, 'Unattended monitoring retains its hard deadline')
    assert(scheduled.snapshot().error.includes('run reached its 10-minute limit'))
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
  const trackerDeadline = new AgentsService({ executable: 'unused', cwd: directory, routes, trackerId: 'deadline-fixture', clientFactory: (receive, ended) => { receiver = receive; disconnected = ended; return client } })
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  try {
    await trackerDeadline.command({ type: 'connect' })
    await trackerDeadline.command({ type: 'send', text: 'Bound unattended tracker check' })
    mock.timers.tick(10 * 60_000)
    assert(!trackerDeadline.snapshot().busy && !trackerDeadline.snapshot().connected, 'Tracker checks retain their hard deadline')
    assert(trackerDeadline.snapshot().error.includes('run reached its 10-minute limit'))
  } finally { trackerDeadline.close(); mock.timers.reset() }
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
    const beforeNewChat = await readPortfolios()
    const discardedId = imports.snapshot().portfolioProposal!.id
    await imports.command({ type: 'newChat' })
    assert(imports.snapshot().connected)
    assert.equal(imports.snapshot().portfolioProposal, null, 'New chat discards the pending review without applying it')
    assert.deepEqual(await readPortfolios(), beforeNewChat)
    await assert.rejects(() => imports.command({ type: 'portfolioDecision', id: discardedId, approve: true }), /no longer/)
    await imports.command({ type: 'autonomy', enabled: true, objective: 'Research only' })
    await assert.rejects(() => imports.callTool('terminal_propose_portfolio_update', proposal), /manual chat/)
    complete()
    console.log('PASS: image validation and transport, reviewed portfolio/option writes, on-disk verification, omitted fields, stale-write protection and autonomous write rejection')
  } finally { imports.close() }
  calls = []; writes = []
  console.log('PASS: connected New chat, model preservation, thread isolation, failed thread rollback, Stop during reset, full MCP catalog, validated edits, screenshot image results, failed envelopes, read-only autonomy, navigation, streaming, cancellation and reconnect')

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
