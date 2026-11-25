import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentsService } from '../electron/services/agents.js'
import { ClaudeClient, claudeCoreTools, claudeToolResult } from '../electron/services/claudeClient.js'
import { connectionTool } from '../mcp/catalog.js'
import type { Operation } from '../mcp/operations.js'
import { claudeApiKeyPattern } from '../electron/shared/agents.js'

// Offline: a fake Anthropic endpoint. Persistence stays inside a temporary profile.
const directory = await mkdtemp(join(tmpdir(), 'budget-claude-agent-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const KEY = 'sk-ant-fixture-not-a-real-key-000000'

type Block = Record<string, unknown>
interface Reply { content: Block[]; stop_reason: string; stop_details?: Record<string, unknown> }
let replies: Reply[] = []
let requests: { url: string; headers: Headers; body: any }[] = []
let modelsStatus = 200
const models = ['claude-opus-5-5', 'claude-haiku-5-5', 'claude-unlisted-fixture']

function sse(reply: Reply) {
  const events: unknown[] = [{ type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }]
  reply.content.forEach((block, index) => {
    if (block.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      for (const part of String(block.text).match(/.{1,4}/gs) ?? []) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } })
    } else if (block.type === 'tool_use') {
      events.push({ type: 'content_block_start', index, content_block: { ...block, input: {} } })
      events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
    } else events.push({ type: 'content_block_start', index, content_block: block })
    events.push({ type: 'content_block_stop', index })
  })
  events.push({ type: 'message_delta', delta: { stop_reason: reply.stop_reason, stop_sequence: null, ...(reply.stop_details ? { stop_details: reply.stop_details } : {}) }, usage: { output_tokens: 5 } })
  events.push({ type: 'message_stop' })
  return events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value))
  const text = init?.body ? String(init.body) : input instanceof Request ? await input.text() : ''
  const body = text ? JSON.parse(text) : null
  requests.push({ url, headers, body })
  if (url.includes('/v1/models')) {
    if (modelsStatus !== 200) return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: modelsStatus, headers: { 'content-type': 'application/json' } })
    return Response.json({ data: models.map(id => ({ id, type: 'model', display_name: id, created_at: '2026-01-01T00:00:00Z' })), has_more: false, first_id: models[0], last_id: models.at(-1) })
  }
  const reply = replies.shift()
  if (!reply) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'No fixture reply queued' } }), { status: 400, headers: { 'content-type': 'application/json' } })
  return new Response(sse(reply), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const routes = new Map<Operation, (request: unknown) => unknown>()
let key: string | null = KEY
const service = new AgentsService({ executable: 'unused', cwd: directory, routes, label: () => 'Claude',
  connectionStatus: () => ({ available: true, tools: 99 }),
  clientFactory: receive => new ClaudeClient(async () => key, receive, { baseURL: 'http://claude.fixture', fetch: fakeFetch }) })
async function settle() {
  for (let index = 0; index < 400 && service.snapshot().busy; index++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(service.snapshot().busy, false, 'Claude turn finished')
}

try {
  assert(claudeApiKeyPattern.test(KEY) && !claudeApiKeyPattern.test('sk-proj-openai') && !claudeApiKeyPattern.test(`${KEY} extra`))

  // Missing key: descriptive startup failure, no network call.
  key = null
  await service.command({ type: 'connect' })
  assert.match(service.snapshot().error, /Add a Claude API key/)
  assert.equal(requests.length, 0)

  // Rejected key: plain explanation, never the key itself.
  key = KEY; modelsStatus = 401
  await service.command({ type: 'connect' })
  assert.match(service.snapshot().error, /rejected the saved API key/)
  assert(!JSON.stringify(service.snapshot()).includes(KEY), 'API key never reaches renderer state')
  // The SDK sends the saved key (x-api-key or Bearer, depending on API version), never an environment credential.
  assert(requests[0].headers.get('x-api-key') === KEY || requests[0].headers.get('authorization') === `Bearer ${KEY}`)

  // Connect: the account's model list filters the curated catalog.
  modelsStatus = 200; requests = []
  await service.command({ type: 'connect' })
  let state = service.snapshot()
  assert.equal(state.connected, true, state.error)
  assert.deepEqual(state.models.map(model => model.id), ['claude-opus-5-5', 'claude-haiku-5-5'])
  assert.equal(state.model, 'claude-opus-5-5')
  assert.equal(state.imageGeneration, false)
  assert(state.models[0].thinkingModes.some(mode => mode.id === 'xhigh'))

  // A tool round trip through the shared agent tool path, then a streamed answer.
  replies = [
    { content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'toolu_1', name: connectionTool.name, input: {} },
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'fixture' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [] }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: 'Budget Terminal is available.' }], stop_reason: 'end_turn' },
  ]
  await service.command({ type: 'send', text: 'Is the terminal connected?' })
  await settle()
  state = service.snapshot()
  assert.equal(state.error, '')
  assert.equal(state.activity, 'done')
  assert.equal(state.messages.filter(message => message.role === 'assistant').at(-1)?.text, 'Budget Terminal is available.')
  const run = state.messages.find(message => message.run)?.run
  assert.equal(run?.status, 'completed')
  assert.deepEqual(run?.tools.map(tool => tool.name).sort(), [connectionTool.name, 'web_search'].sort())

  const [first, second] = requests.filter(request => request.url.includes('/v1/messages')).map(request => request)
  assert.equal(first.body.model, 'claude-opus-5-5')
  assert.equal(first.body.stream, true)
  assert.deepEqual(first.body.thinking, { type: 'adaptive' })
  assert.equal(first.body.output_config.effort, 'medium')
  assert.equal(first.body.fallbacks, 'default')
  assert.match(first.headers.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/)
  assert.deepEqual(first.body.system[0].cache_control, { type: 'ephemeral' })
  assert.match(first.body.system[0].text, /You are the Claude agent inside Budget Terminal/)
  const tools = first.body.tools as Block[]
  assert(tools.some(tool => tool.type === 'tool_search_tool_bm25_20251119'))
  assert(tools.some(tool => tool.type === 'web_search_20260209') && tools.some(tool => tool.type === 'web_fetch_20260209'))
  const custom = tools.filter(tool => 'input_schema' in tool)
  assert(custom.every(tool => tool.eager_input_streaming === true))
  assert(custom.filter(tool => !tool.defer_loading).length < 30, 'Only core tools load up front')
  for (const name of claudeCoreTools) assert(custom.some(tool => tool.name === name && !tool.defer_loading), `${name} stays loaded`)
  assert(custom.some(tool => tool.name === 'terminal_show_page' && !tool.defer_loading))
  assert(custom.some(tool => tool.name === 'budget_terminal_options_chain' && tool.defer_loading === true))
  assert.equal(first.body.messages[0].role, 'user')
  // History is append-only: the assistant turn is replayed unchanged, then the tool result.
  assert.equal(second.body.messages.length, 3)
  assert.deepEqual(second.body.messages[1].content.map((block: Block) => block.type), ['text', 'tool_use', 'server_tool_use', 'web_search_tool_result'])
  const result = second.body.messages[2].content[0]
  assert.equal(result.type, 'tool_result')
  assert.equal(result.tool_use_id, 'toolu_1')
  assert.match(JSON.stringify(result.content), /available/)

  // Refusals end the turn with a clear message.
  replies = [{ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'fixture' } }]
  await service.command({ type: 'send', text: 'Fixture refusal' })
  await settle()
  assert.match(service.snapshot().error, /declined this request \(cyber\)/)

  // Truncated tool input is never executed.
  await service.command({ type: 'newChat' })
  requests = []
  replies = [
    { content: [{ type: 'tool_use', id: 'toolu_cut', name: connectionTool.name, input: {} }], stop_reason: 'max_tokens' },
    { content: [{ type: 'text', text: 'Retried safely.' }], stop_reason: 'end_turn' },
  ]
  if (!service.snapshot().connected) await service.command({ type: 'connect' })
  await service.command({ type: 'send', text: 'Long request' })
  await settle()
  const truncated = requests.filter(request => request.url.includes('/v1/messages')).at(-1)!.body.messages.at(-1).content[0]
  assert.equal(truncated.is_error, true)
  assert.match(truncated.content, /cut off/)
  assert.equal(service.snapshot().messages.filter(message => message.role === 'assistant').at(-1)?.text, 'Retried safely.')

  // Haiku keeps the basic web tools and has no server-side fallback.
  await service.command({ type: 'configure', model: 'claude-haiku-5-5', thinking: 'low' })
  requests = []
  replies = [{ content: [{ type: 'text', text: 'Haiku answer.' }], stop_reason: 'end_turn' }]
  await service.command({ type: 'send', text: 'Quick question' })
  await settle()
  const haiku = requests.find(request => request.url.includes('/v1/messages'))!
  assert.equal(haiku.body.model, 'claude-haiku-5-5')
  assert.equal(haiku.body.output_config.effort, 'low')
  assert.equal(haiku.body.fallbacks, undefined)
  assert((haiku.body.tools as Block[]).some(tool => tool.type === 'web_search_20250305'))

  // Tool results: images become image blocks, failures stay errors, huge text is bounded.
  const converted = claudeToolResult({ result: { success: false, contentItems: [{ type: 'inputText', text: 'x'.repeat(250_000) }, { type: 'inputImage', imageUrl: 'data:image/png;base64,cGl4ZWxz' }] } })
  assert.equal(converted.isError, true)
  assert.equal(converted.content[1].type, 'image')
  assert((converted.content[0] as { text: string }).text.length < 201_000)
  assert.equal(claudeToolResult({ error: { message: 'Only Budget Terminal MCP and navigation tools are available.' } }).isError, true)

  service.close()
  console.log('PASS: Claude provider key handling, model catalog, tool search/deferred tools, web tools, fallbacks, adaptive effort, append-only history, tool round trips, refusals, truncated tool input and bounded results')
} finally {
  service.close()
  process.env.APPDATA = previous.APPDATA
  process.env.LOCALAPPDATA = previous.LOCALAPPDATA
  await rm(directory, { recursive: true, force: true })
}
