import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { QueryClient } from '@tanstack/react-query'
import { catalog, failed, validateCall } from '../mcp/catalog.js'
import { operations, toolName, type Operation } from '../mcp/operations.js'
import { APP_CLOSED, invokeBridge, runtimePath } from '../mcp/runtime.js'
import { startBridge } from '../electron/mcp/bridge.js'
import { refreshSavedData } from '../src/api/mcpChanges.js'
import type { DesktopApi, SavedDataDomain } from '../electron/shared/contract.js'
import { TABS } from '../electron/shared/contract.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-terminal-mcp-'))
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
process.env.BUDGET_TERMINAL_DATA_DIR = join(directory, 'BudgetTerminalElectron')
const descriptorPath = runtimePath()
const clients: Client[] = []
let bridge: Awaited<ReturnType<typeof startBridge>> | undefined
let release: (() => void) | undefined
let closeCache: (() => void) | undefined

async function connect(serverPath = resolve(import.meta.dirname, '../out/mcp/server.mjs')) {
  const client = new Client({ name: 'mcp-probe', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [serverPath],
    env: { ...process.env as Record<string, string> }, stderr: 'pipe' })
  await client.connect(transport)
  clients.push(client)
  return client
}

// Generate a valid representative input from every published JSON schema.
interface Schema {
  $ref?: string
  const?: unknown
  enum?: unknown[]
  anyOf?: Schema[]
  oneOf?: Schema[]
  allOf?: Schema[]
  type?: string
  required?: string[]
  properties?: Record<string, Schema>
  items?: Schema | Schema[]
  minItems?: number
}
function example(schema: unknown, root: unknown): unknown {
  const value = schema as Schema
  if (value.$ref) {
    const target = value.$ref.slice(2).split('/').reduce<unknown>((item, key) => (item as Record<string, unknown>)[decodeURIComponent(key.replace(/~1/g, '/').replace(/~0/g, '~'))], root)
    return example(target, root)
  }
  if ('const' in value) return value.const
  if (value.enum) return value.enum[0]
  if (value.anyOf || value.oneOf) return example((value.anyOf ?? value.oneOf)![0], root)
  if (value.allOf) return Object.assign({}, ...value.allOf.map((item: unknown) => example(item, root)))
  if (value.type === 'object') return Object.fromEntries((value.required ?? []).map((key) => [key, example(value.properties![key], root)]))
  if (value.type === 'array') return Array.isArray(value.items)
    ? value.items.map((item: unknown) => example(item, root))
    : Array.from({ length: value.minItems ?? 0 }, () => example(value.items, root))
  if (value.type === 'string') return 'TEST'
  if (value.type === 'number' || value.type === 'integer') return 1
  if (value.type === 'boolean') return true
  if (value.type === 'null') return null
  throw new Error(`No example for ${JSON.stringify(schema)}`)
}

function branches(schema: Schema, root: unknown): Schema[] {
  if (schema.$ref) {
    const target = schema.$ref.slice(2).split('/').reduce<unknown>((item, key) => (item as Record<string, unknown>)[decodeURIComponent(key.replace(/~1/g, '/').replace(/~0/g, '~'))], root)
    return branches(target as Schema, root)
  }
  if (schema.anyOf || schema.oneOf) return (schema.anyOf ?? schema.oneOf)!.flatMap((branch) => branches(branch, root))
  return [schema]
}

try {
  const client = await connect()
  const tools = (await client.listTools()).tools
  assert.equal(tools.length, Object.keys(operations).length + 1)
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length)
  const closed = await client.callTool({ name: 'budget_terminal_portfolio', arguments: { request: {} } })
  assert.equal(closed.isError, true)
  assert.match(JSON.stringify(closed), new RegExp(APP_CLOSED.replace('.', '\\.')))
  const pluginClient = await connect(resolve(import.meta.dirname, '../../../plugins/budget-terminal/server/server.mjs'))
  assert.equal((await pluginClient.listTools()).tools.length, tools.length)
  const events: SavedDataDomain[][] = []
  const routes = new Map<Operation, (request: unknown) => unknown>()
  for (const entry of catalog) routes.set(entry.operation, (request) => ({ data: { operation: entry.operation, request }, meta: { freshness: 'cached', source: 'probe', fetchedAt: 123 }, errors: [] }))
  bridge = await startBridge({ routes, onChanged: (domains) => events.push(domains) })
  assert.equal(bridge.status.connected, false)
  assert.equal(bridge.status.active, false)
  await new Promise((done) => setTimeout(done, 5_500))
  assert.equal(bridge.status.connected, true, 'Initialized idle clients must reconnect through heartbeats')
  assert.equal(bridge.status.active, false, 'Idle client heartbeats must not count as tool activity')
  const status = await client.callTool({ name: 'budget_terminal_connection_status', arguments: {} })
  assert.equal(status.isError, false)
  assert.equal(bridge.status.connected, true)
  assert.equal(bridge.status.active, false, 'Heartbeats must not light the activity indicator')
  const clock = Date.now
  try {
    Date.now = () => clock() + 16_000
    assert.equal(bridge.status.connected, false, 'Missing heartbeats must expire the connection')
  } finally { Date.now = clock }
  assert.equal((await pluginClient.callTool({ name: 'budget_terminal_connection_status', arguments: {} })).isError, false)
  let mutationVariants = 0
  for (const entry of catalog) {
    const args = example(entry.tool.inputSchema, entry.tool.inputSchema) as Record<string, unknown>
    validateCall(entry.tool.name, args)
    assert.throws(() => validateCall(entry.tool.name, { ...args, surprise: true }), /Invalid/)
    assert.throws(() => validateCall(entry.tool.name, { request: { ...(args.request as object), background: true } }), /Invalid/)
    const result = await client.callTool({ name: entry.tool.name, arguments: args })
    assert.equal(result.isError, false, entry.operation)
    const structured = result.structuredContent as Record<string, unknown>
    assert.equal((structured.data as { operation: string }).operation, entry.operation)
    assert.equal((structured.meta as { freshness: string }).freshness, 'cached')
    if (entry.operation.startsWith('mutate')) {
      const root = entry.tool.inputSchema as unknown as Schema
      for (const branch of branches(root.properties!.request, root)) {
        validateCall(entry.tool.name, { request: example(branch, root) })
        mutationVariants += 1
      }
    }
  }
  assert.equal(mutationVariants, 44)
  assert.equal(events.length, 5)
  assert(events.some(domains => domains.includes('articles')), 'Article edits must notify the renderer')
  const screenshotTool = tools.find((tool) => tool.name === toolName('screenshot'))!
  assert(tools.some(tool => tool.name === toolName('amzn')), 'AMZN must expose a company research read tool')
  validateCall(toolName('amzn'), { request: { force: true } })
  assert.throws(() => validateCall(toolName('amzn'), { request: { symbol: 'AAPL' } }), /Invalid/)
  assert.equal(screenshotTool.annotations?.readOnlyHint, true)
  assert.equal(screenshotTool.annotations?.openWorldHint, false)
  for (const page of ['current', 'all', ...TABS.filter((tab) => tab.implemented).map((tab) => tab.id)]) {
    validateCall(toolName('screenshot'), { request: { page } })
  }
  assert.throws(() => validateCall(toolName('screenshot'), { request: { page: 'unknown' } }), /Invalid/)
  assert.throws(() => validateCall(toolName('screenshot'), { request: { path: 'private.png' } }), /Invalid/)
  // Native images must reach both direct and plugin clients without duplicate pixel JSON.
  const pixels = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  routes.set('screenshot', () => ({ data: { screenshots: [
    { pageId: 'dictionary', label: 'Dictionary', capturedAt: 123, width: 1, height: 1, mimeType: 'image/png', base64: pixels, obscured: false, startupLoading: true, status: 'Loading pages' },
  ] }, meta: { freshness: 'fresh', source: 'probe', fetchedAt: 123 }, errors: [] }))
  for (const screenshotClient of [client, pluginClient]) {
    const result = await screenshotClient.callTool({ name: toolName('screenshot'), arguments: { request: { page: 'dictionary' } } })
    assert.equal(result.isError, false)
    const images = (result.content as Array<{ type: string; data?: string; mimeType?: string }>).filter((block) => block.type === 'image')
    assert.deepEqual(images, [{ type: 'image', data: pixels, mimeType: 'image/png' }])
    assert.ok(!JSON.stringify(result.structuredContent).includes(pixels))
    assert.ok(!(result.content as Array<{ type: string; text?: string }>).filter((block) => block.type === 'text').some((block) => block.text?.includes(pixels)))
  }
  routes.set('screenshot', () => ({ data: { screenshots: [] }, meta: { freshness: 'failed', source: 'probe', fetchedAt: 123 }, errors: [{ reason: 'Window closed' }] }))
  assert.equal((await client.callTool({ name: toolName('screenshot'), arguments: { request: {} } })).isError, true)
  assert.throws(() => validateCall('budget_terminal_clear_user_data', { request: {} }), /Unknown/)
  assert.throws(() => validateCall(toolName('mutatePortfolio'), { request: { type: 'setCash', portfolioId: 'p', cashBalance: 'bad' } }), /Invalid/)
  assert.throws(() => validateCall(toolName('mutateSettings'), { request: { type: 'setQuantPage', value: {} } }), /Invalid/)
  routes.set('stocks', () => ({ data: null, meta: { freshness: 'failed', source: 'probe', fetchedAt: 123 }, errors: [{ reason: 'offline' }] }))
  assert.equal((await client.callTool({ name: toolName('stocks'), arguments: { request: { symbol: 'TEST' } } })).isError, true)
  routes.set('stocks', () => ({ data: {}, meta: { freshness: 'partial', source: 'probe', fetchedAt: 123 }, errors: [{ reason: 'coverage' }] }))
  const partial = await client.callTool({ name: toolName('stocks'), arguments: { request: { symbol: 'TEST' } } })
  assert.equal(partial.isError, false, JSON.stringify(partial))

  const runtime = JSON.parse(await readFile(descriptorPath, 'utf8'))
  const url = `http://127.0.0.1:${runtime.port}/invoke`
  const send = (body: string, headers: Record<string, string> = {}) => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json', ...headers }, body })
  assert.equal((await send('{}', { Authorization: 'Bearer wrong' })).status, 403)
  assert.equal((await send('{}', { Origin: 'https://evil.test' })).status, 403)
  assert.equal((await send('{')).status, 400)
  assert.equal((await send(JSON.stringify({ name: 'unknown', arguments: {} }))).status, 400)
  assert.equal((await send('x'.repeat(2 * 1024 * 1024 + 1))).status, 413)
  assert.equal((await send('{}', { 'Content-Type': 'text/plain' })).status, 415)
  const second = await connect()
  assert.equal((await second.callTool({ name: toolName('portfolio'), arguments: { request: {} } })).isError, false)
  await bridge.stop()
  await assert.rejects(readFile(descriptorPath), /ENOENT/)
  assert.equal((await client.callTool({ name: toolName('portfolio'), arguments: { request: {} } })).isError, true)
  bridge = await startBridge({ routes, onChanged: () => {} })
  assert.equal((await client.callTool({ name: toolName('portfolio'), arguments: { request: {} } })).isError, false)
  await bridge.stop()

  const { acquireDataSession } = await import('../electron/services/dataSession.js')
  release = acquireDataSession()
  const backup = await import('../electron/services/automaticBackup.js')
  const downloads = join(directory, 'Downloads')
  await mkdir(downloads)
  backup.configureAutomaticBackup(downloads)
  await backup.initializeAutomaticBackup()
  const { createServiceRoutes } = await import('../electron/mcp/routes.js')
  const { cache } = await import('../electron/services/cache.js')
  closeCache = () => cache.close()
  bridge = await startBridge({ routes: createServiceRoutes(), onChanged: (domains) => events.push(domains) })
  async function call<Key extends Exclude<Operation, 'screenshot'>>(operation: Key, request: unknown = {}): Promise<Awaited<ReturnType<DesktopApi[Key]>>> {
    const result = await invokeBridge(toolName(operation), { request })
    assert.equal(failed(result), false, JSON.stringify(result))
    return result as Awaited<ReturnType<DesktopApi[Key]>>
  }
  const portfolioId = (await call('portfolio')).data.mainId
  assert.ok(portfolioId)
  await call('mutatePortfolio', { type: 'addPosition', portfolioId, ticker: 'TEST' })
  await call('mutatePortfolio', { type: 'setPosition', portfolioId, ticker: 'TEST', shares: 9 })
  const withOption = await call('mutatePortfolio', { type: 'addOption', portfolioId })
  const rowId = withOption.data.portfolios.find((portfolio) => portfolio.id === portfolioId)?.options[0].rowId
  assert.ok(rowId)
  await call('mutatePortfolio', { type: 'setOption', portfolioId, rowId, patch: { ticker: 'TEST', strike: 100, contracts: 2 } })
  await call('mutatePersonalFinance', { type: 'addEntry', category: 'cash' })
  const entryId = (await call('personalFinance')).data.cash[0].id
  await call('mutatePersonalFinance', { type: 'setEntry', category: 'cash', id: entryId, amount: 456 })
  await call('mutateCards', { type: 'add', name: 'MCP Card', symbols: ['TEST'], weighting: 'equal', weights: {} })
  await call('mutateSettings', { type: 'setClockCountry', code: 'SG' })
  await Promise.all(Array.from({ length: 5 }, (_, index) => call('mutatePortfolio', { type: 'setCash', portfolioId, cashBalance: index })))
  // HTTP arrival order is not guaranteed for concurrent clients. Set the final
  // expected balance after the contention exercise has drained.
  await call('mutatePortfolio', { type: 'setCash', portfolioId, cashBalance: 4 })
  const snapshot = JSON.parse(await readFile(join(downloads, 'budget-terminal-backup.json'), 'utf8'))
  assert.equal(snapshot.userData.portfolios[portfolioId].holdings.TEST.shares, 9)
  assert.equal(snapshot.userData.portfolios[portfolioId].options[0].contracts, 2)
  assert.equal(snapshot.userData.personalFinance.cash[0].amount, 456)
  assert.ok(snapshot.cards.customCards.some((card: { name: string }) => card.name === 'MCP Card'))
  assert.equal(snapshot.settings.clockCountry, 'SG')
  assert.equal((await call('portfolio')).data.portfolios.find((p) => p.id === portfolioId)?.cashBalance, 4)

  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const fetched: string[] = []
  for (const key of ['portfolio', 'cards', 'personalFinance', 'settings', 'cardsPerformance', 'quotes']) {
    await queries.fetchQuery({ queryKey: [key], queryFn: async () => { fetched.push(key); return 1 } })
  }
  fetched.length = 0
  await refreshSavedData(queries, { domains: ['portfolio', 'cards', 'personalFinance', 'settings'] })
  assert.deepEqual(fetched.sort(), ['cards', 'cardsPerformance', 'personalFinance', 'portfolio', 'settings'])
  queries.clear()

  // Accepted writes drain before shutdown resolves, and new calls are refused.
  await bridge.stop()
  let finishWrite!: () => void
  let startedWrite!: () => void
  const started = new Promise<void>((resolveStarted) => { startedWrite = resolveStarted })
  routes.set('mutateSettings', async () => { startedWrite(); await new Promise<void>((done) => { finishWrite = done }); return { data: {}, meta: { freshness: 'fresh' }, errors: [] } })
  bridge = await startBridge({ routes, onChanged: () => {} })
  const writing = invokeBridge(toolName('mutateSettings'), { request: { type: 'setTime12h', value: true } })
  await started
  assert.equal(bridge.status.active, true, 'Pending tool calls must light the activity indicator')
  assert.equal(bridge.status.connected, true)
  try {
    Date.now = () => clock() + 16_000
    assert.equal(bridge.status.active, true, 'Long tool calls must stay active')
    assert.equal(bridge.status.connected, true, 'Long tool calls must stay connected')
  } finally { Date.now = clock }
  let stopped = false
  const stopping = bridge.stop().then(() => { stopped = true })
  await new Promise((done) => setTimeout(done, 20))
  assert.equal(stopped, false)
  finishWrite()
  await writing
  await stopping
  assert.equal(bridge.status.available, false)
  assert.equal(bridge.status.active, false)
  assert.equal(bridge.status.connected, false)
  console.log(`PASS: ${catalog.length + 1} MCP tools, ${mutationVariants} mutation variants, routing, auth, three stdio clients, portable plugin, restart recovery, saved records, backups, query refresh and shutdown drain`)
} finally {
  await Promise.allSettled(clients.map((client) => client.close()))
  await bridge?.stop()
  closeCache?.()
  release?.()
  await rm(directory, { recursive: true, force: true })
}
