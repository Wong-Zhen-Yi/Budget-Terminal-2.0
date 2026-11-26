import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AccountInfo, ModelInfo, Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AgentsService } from '../electron/services/agents.js'
import { ClaudeCodeClient, claudeCodeArguments, claudeCodeEnvironment, claudeCodeModels, claudeCodeToolResult } from '../electron/services/claudeCodeClient.js'
import { claudeCoreTools } from '../electron/services/claudeClient.js'
import { connectionTool } from '../mcp/catalog.js'
import type { Operation } from '../mcp/operations.js'
import { agentProviderLabels, isAgentProvider } from '../electron/shared/agents.js'
import { findClaude } from '../../../scripts/codex-runtime.cjs'

// Offline: a fake Claude Agent SDK session. Persistence stays inside a temporary profile.
const directory = await mkdtemp(join(tmpdir(), 'budget-claude-code-agent-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory

const listedModels: ModelInfo[] = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: '' },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', description: '', supportedEffortLevels: ['low', 'medium', 'high'] },
  { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8', displayName: 'Opus 4.8', description: '' },
]
type Reply = (context: { tools: Client; message: SDKUserMessage; emit: (message: SDKMessage) => void; uuids: string[] }) => Promise<void>
let account: AccountInfo = { email: 'fixture@example.invalid', subscriptionType: 'Claude Pro', apiProvider: 'firstParty' }
let replies: Reply[] = []
const sessions: { options: Options; prompts: SDKUserMessage[]; model?: string; effort?: string; closed: boolean }[] = []

/** Emulates query(): control requests, the MCP tool round trip and the streamed message protocol. */
function fakeQuery({ prompt, options = {} }: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) {
  const session = { options, prompts: [] as SDKUserMessage[], closed: false } as (typeof sessions)[number]
  sessions.push(session)
  const output: SDKMessage[] = []
  const waiters: (() => void)[] = []
  const wake = () => { for (const resolve of waiters.splice(0)) resolve() }
  let ended = false
  const emit = (message: SDKMessage) => { output.push(message); wake() }
  const server = (options.mcpServers?.budget_terminal as { instance?: McpServer } | undefined)?.instance
  const tools = server ? (async () => {
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
    await server.connect(serverSide)
    const client = new Client({ name: 'fixture', version: '0.0.0' })
    await client.connect(clientSide)
    return client
  })() : null
  void (async () => {
    if (typeof prompt === 'string') return
    for await (const message of prompt) {
      session.prompts.push(message)
      const reply = replies.shift()
      if (!reply) { emit({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['No fixture reply queued'], user_message_uuids: [message.uuid!] } as unknown as SDKMessage); continue }
      await reply({ tools: (await tools)!, message, emit, uuids: [message.uuid!] })
    }
    ended = true
    wake()
  })()
  const iterator: AsyncGenerator<SDKMessage, void> = {
    async next() {
      while (!output.length && !ended && !session.closed) await new Promise<void>(resolve => { waiters.push(resolve) })
      const value = output.shift()
      return value ? { value, done: false } : { value: undefined, done: true }
    },
    async return() { return { value: undefined, done: true } },
    async throw(error) { throw error },
    [Symbol.asyncIterator]() { return this },
    async [Symbol.asyncDispose]() {},
  }
  return Object.assign(iterator, {
    accountInfo: async () => account,
    supportedModels: async () => listedModels,
    setModel: async (model?: string) => { session.model = model },
    applyFlagSettings: async (settings: { effortLevel?: string | null }) => { session.effort = settings.effortLevel ?? undefined },
    close: () => { session.closed = true; wake() },
  }) as unknown as ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>
}

const text = (uuid: string, value: string): SDKMessage[] => [
  { type: 'stream_event', uuid, session_id: 's', parent_tool_use_id: null, event: { type: 'message_start', message: {} } },
  { type: 'stream_event', uuid, session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
  ...value.match(/.{1,5}/gs)!.map(part => ({ type: 'stream_event', uuid, session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } } })),
  { type: 'stream_event', uuid, session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_stop', index: 0 } },
] as unknown as SDKMessage[]
const result = (uuids: string[], extra: Record<string, unknown> = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: '', user_message_uuids: uuids, ...extra }) as unknown as SDKMessage

const routes = new Map<Operation, (request: unknown) => unknown>()
let executable: string | null = '/fixture/claude'
const service = new AgentsService({ executable: 'unused', cwd: directory, routes, provider: () => 'claude-code',
  connectionStatus: () => ({ available: true, tools: 99 }),
  clientFactory: (receive, disconnected) => new ClaudeCodeClient(() => executable, directory, receive, disconnected, fakeQuery) })
async function settle() {
  for (let index = 0; index < 400 && service.snapshot().busy; index++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(service.snapshot().busy, false, 'Claude Code turn finished')
}

try {
  assert.equal(agentProviderLabels['claude-code'], 'Claude Code')
  assert(isAgentProvider('claude-code') && !isAgentProvider('gpt'))

  // The CLI never receives an API key, so it always runs on the Claude Code login.
  const environment = claudeCodeEnvironment({ PATH: '/bin', HOME: '/home/fixture', ANTHROPIC_API_KEY: 'sk-ant-fixture', anthropic_auth_token: 'x', ANTHROPIC_BASE_URL: 'http://proxy', CLAUDE_CODE_OAUTH_TOKEN: 'y' })
  assert.deepEqual(Object.keys(environment).sort(), ['CLAUDE_AGENT_SDK_CLIENT_APP', 'HOME', 'PATH'])

  // Executable lookup: explicit override, PATH, then the native installer location.
  assert.equal(findClaude({ platform: 'linux', environment: { BUDGET_TERMINAL_CLAUDE_PATH: '/custom/claude', PATH: '/bin' }, exists: path => path === '/custom/claude' }), '/custom/claude')
  assert.equal(findClaude({ platform: 'linux', environment: { PATH: '/usr/bin', HOME: '/home/fixture' }, exists: path => path === '/home/fixture/.local/bin/claude' }), '/home/fixture/.local/bin/claude')
  assert.equal(findClaude({ platform: 'win32', environment: { Path: 'C:\\Tools', USERPROFILE: 'C:\\Users\\fixture' }, exists: path => path === 'C:\\Users\\fixture\\.local\\bin\\claude.exe' }), 'C:\\Users\\fixture\\.local\\bin\\claude.exe')
  assert.equal(findClaude({ platform: 'linux', environment: { PATH: '/bin' }, exists: () => false }), null)

  // Only the current alias rows are offered, with their supported effort levels.
  const catalog = claudeCodeModels(listedModels)
  assert.deepEqual(catalog.map(model => [model.model, model.displayName, model.defaultReasoningEffort]),
    [['claude-opus-5-5', 'Claude Opus 5.5', 'medium'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 'high'], ['claude-haiku-5-5', 'Claude Haiku 5.5', 'medium']])
  assert.deepEqual(catalog[2].supportedReasoningEfforts.map(mode => mode.reasoningEffort), ['low', 'medium', 'high'])

  // Signed out: a clear instruction, and no session is started for a conversation.
  account = { apiProvider: 'firstParty' }
  await service.command({ type: 'connect' })
  assert.match(service.snapshot().error, /not signed in.*\/login/)
  assert.equal(sessions.length, 1, 'Only the control-request probe ran')
  assert.equal(sessions[0].prompts.length, 0, 'Checking the account never sends a prompt')

  // Connect: the account check runs without tools, then one isolated session per conversation.
  account = { email: 'fixture@example.invalid', subscriptionType: 'Claude Pro', apiProvider: 'firstParty' }
  sessions.length = 0
  await service.command({ type: 'connect' })
  let state = service.snapshot()
  assert.equal(state.connected, true, state.error)
  assert(!JSON.stringify(state).includes('fixture@example.invalid'), 'The account email never reaches renderer state')
  assert.deepEqual(state.models.map(model => model.id), ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
  assert.equal(state.model, 'claude-opus-5-5')
  assert.equal(state.imageGeneration, false)
  assert.equal(sessions.length, 2)
  assert.deepEqual(sessions[0].options.tools, [])
  const options = sessions[1].options
  assert.equal(options.pathToClaudeCodeExecutable, '/fixture/claude')
  assert.deepEqual(options.settingSources, [], 'User settings, CLAUDE.md, hooks and plugins never load')
  assert.equal(options.strictMcpConfig, true, 'Only the Budget Terminal MCP server is available')
  assert.deepEqual(options.skills, [])
  assert.equal(options.persistSession, false, 'Chats are not saved to Claude Code history')
  assert.equal(options.verbatimPrompts, true, 'Prompts never dispatch slash commands or expand file mentions')
  assert.deepEqual(options.tools, ['WebSearch', 'WebFetch'], 'File, shell and agent tools stay off')
  assert.equal(options.permissionMode, 'dontAsk')
  assert.equal(options.model, 'claude-opus-5-5')
  assert.equal(options.effort, 'medium')
  assert.deepEqual(options.thinking, { type: 'adaptive' })
  assert.equal(options.includePartialMessages, true)
  assert.match(String(options.systemPrompt), /Claude Code installation/)
  assert.equal(options.env?.ANTHROPIC_API_KEY, undefined)
  assert.deepEqual(options.allowedTools, ['WebSearch', 'WebFetch', 'mcp__budget_terminal__*'], 'Only web research and Budget Terminal tools are pre-approved; dontAsk denies the rest')
  assert.equal(options.canUseTool, undefined)

  // A Budget Terminal tool round trip over MCP, a web search, then a streamed answer.
  let listed: Awaited<ReturnType<Client['listTools']>>['tools'] = []
  replies = [async ({ tools, emit, uuids }) => {
    listed = (await tools.listTools()).tools
    emit({ type: 'assistant', uuid: 'a1', session_id: 's', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'web_1', name: 'WebSearch', input: { query: 'fixture' } }] } } as unknown as SDKMessage)
    emit({ type: 'user', uuid: 'u1', session_id: 's', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'web_1', content: 'results' }] } } as unknown as SDKMessage)
    const called = await tools.callTool({ name: connectionTool.name, arguments: {} })
    assert.match(JSON.stringify(called.content), /available/)
    for (const message of text('m1', 'Budget Terminal is available.')) emit(message)
    emit(result(uuids))
  }]
  await service.command({ type: 'send', text: 'Is the terminal connected?' })
  await settle()
  state = service.snapshot()
  assert.equal(state.error, '')
  assert.equal(state.activity, 'done')
  assert.equal(state.messages.filter(message => message.role === 'assistant').at(-1)?.text, 'Budget Terminal is available.')
  const run = state.messages.find(message => message.run)?.run
  assert.equal(run?.status, 'completed')
  assert.deepEqual(run?.tools.map(tool => tool.name).sort(), [connectionTool.name, 'web_search'].sort())
  const sent = sessions[1].prompts[0]
  assert.equal(sent.message.role, 'user')
  assert.match(JSON.stringify(sent.message.content), /Is the terminal connected/)
  assert(listed.length > 30, 'The full Budget Terminal catalog is served')
  const alwaysLoaded = listed.filter(tool => tool._meta?.['anthropic/alwaysLoad'])
  for (const name of claudeCoreTools) assert(alwaysLoaded.some(tool => tool.name === name), `${name} stays loaded`)
  assert(alwaysLoaded.some(tool => tool.name === 'terminal_show_page'))
  assert(!alwaysLoaded.some(tool => tool.name === 'budget_terminal_options_chain'), 'Specialised tools load through tool search')
  assert(alwaysLoaded.length < 40)

  // Model and effort changes apply to the live session without restarting it.
  await service.command({ type: 'configure', model: 'claude-haiku-5-5', thinking: 'low' })
  replies = [async ({ emit, uuids }) => { for (const message of text('m2', 'Haiku answer.')) emit(message); emit(result(uuids)) }]
  await service.command({ type: 'send', text: 'Quick question' })
  await settle()
  const live = sessions.at(-1)!
  assert.equal(live.model, 'claude-haiku-5-5')
  assert.equal(live.effort, 'low')
  assert.equal(service.snapshot().messages.filter(message => message.role === 'assistant').at(-1)?.text, 'Haiku answer.')

  // Failed results end the run with an explanation; plan limits are named plainly.
  replies = [async ({ emit, uuids }) => { emit(result(uuids, { is_error: true, result: 'Claude usage limit reached. Resets 5pm.' })) }]
  await service.command({ type: 'send', text: 'Another question' })
  await settle()
  assert.match(service.snapshot().error, /plan usage limit/)

  // Tool results: images become MCP image content, failures stay errors, huge text is bounded.
  const converted = claudeCodeToolResult({ result: { success: false, contentItems: [{ type: 'inputText', text: 'x'.repeat(250_000) }, { type: 'inputImage', imageUrl: 'data:image/png;base64,cGl4ZWxz' }] } })
  assert.equal(converted.isError, true)
  assert.deepEqual(converted.content[1], { type: 'image', data: 'cGl4ZWxz', mimeType: 'image/png' })
  assert((converted.content[0] as { text: string }).text.length < 201_000)
  assert.equal(claudeCodeToolResult({ error: { message: 'Denied.' } }).isError, true)
  // Object arguments sent as JSON text are parsed; anything else is left for validation to reject.
  assert.deepEqual(claudeCodeArguments({ request: '{}', response: '{"mode":"summary"}' }), { request: {}, response: { mode: 'summary' } })
  assert.deepEqual(claudeCodeArguments({ request: '[1]' }), { request: '[1]' })
  assert.deepEqual(claudeCodeArguments({ request: '{bad' }), { request: '{bad' })
  assert.deepEqual(claudeCodeArguments(undefined), {})

  service.close()
  assert(sessions.every(session => session.closed), 'Every Claude Code session closes with the service')
  console.log('PASS: Claude Code provider login check, isolated CLI options, tool policy, model aliases, effort, MCP tool round trips, web tools, streamed answers, failures and bounded results')
} finally {
  service.close()
  process.env.APPDATA = previous.APPDATA
  process.env.LOCALAPPDATA = previous.LOCALAPPDATA
  await rm(directory, { recursive: true, force: true })
}
