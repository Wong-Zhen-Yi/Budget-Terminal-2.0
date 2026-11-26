import { query as sdkQuery, type EffortLevel, type ModelInfo, type Options, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import type { CodexPacket, CodexResult, CodexTransport } from './codexClient.js'
import { claudeCoreTools } from './claudeClient.js'

type ImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
type UserContent = Extract<SDKUserMessage['message']['content'], unknown[]>[number][]
interface DynamicTool { name: string; description?: string; inputSchema: unknown }
interface Thread { id: string; model: string; effort: EffortLevel; session: Query; input: InputQueue; webTools: Map<string, string> }
interface Turn { id: string; thread: Thread; pending: Set<string>; texts: Map<string, { id: string; text: string }> }

/** Server name: Claude Code exposes these tools as mcp__budget_terminal__<tool>. */
const SERVER = 'budget_terminal'
const PREFIX = `mcp__${SERVER}__`
// Claude Code's own web tools are the only built-in tools. File, shell and agent tools stay off.
const BUILT_IN_TOOLS = ['WebSearch', 'WebFetch']
const MAX_RESULT_TEXT = 200_000
const efforts: { reasoningEffort: EffortLevel; description: string }[] = [
  { reasoningEffort: 'low', description: 'Fastest replies with the fewest tool calls.' },
  { reasoningEffort: 'medium', description: 'Balanced depth and usage.' },
  { reasoningEffort: 'high', description: 'Deeper research for complex questions.' },
  { reasoningEffort: 'xhigh', description: 'Extended reasoning for long multi-step research.' },
  { reasoningEffort: 'max', description: 'Maximum depth; slowest and uses the most of your plan limits.' },
]
/** Model aliases offered by Claude Code, in display order. The CLI resolves each to its current model. */
const ALIASES = ['opus', 'sonnet', 'haiku', 'fable']
const defaultEfforts: Record<string, EffortLevel> = { opus: 'medium', sonnet: 'high', haiku: 'medium', fable: 'high' }
const claudeCodeInstructions = 'You are running on Claude through the user\'s signed-in Claude Code installation. Budget Terminal tools are provided through the budget_terminal MCP server; when a tool you need is not loaded, use tool search with a short topic query to load it, then call it. Claude Code\'s WebSearch and WebFetch tools are available for public sources; fetch only URLs returned by search or supplied by the user. File, shell and coding tools are not available. Native image generation is not available with Claude in Budget Terminal: if asked to generate or edit an image, say so and offer a chart or text alternative instead.'

export class ClaudeCodeAuthError extends Error {}

/** Async message source for one Claude Code session. Messages wait until the session reads them. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null = null
  private ended = false
  push(message: SDKUserMessage) {
    if (this.ended) throw new Error('Claude Code session closed.')
    if (this.waiting) { const resolve = this.waiting; this.waiting = null; resolve({ value: message, done: false }) }
    else this.items.push(message)
  }
  end() {
    this.ended = true
    this.waiting?.({ value: undefined, done: true })
    this.waiting = null
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return { next: () => {
      const item = this.items.shift()
      if (item) return Promise.resolve({ value: item, done: false })
      if (this.ended) return Promise.resolve({ value: undefined, done: true })
      return new Promise(resolve => { this.waiting = resolve })
    } }
  }
}

function imageBlock(url: string) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url)
  return match ? { type: 'image' as const, source: { type: 'base64' as const, media_type: match[1] as ImageType, data: match[2] } } : null
}
function clip(text: string) {
  return text.length <= MAX_RESULT_TEXT ? text : `${text.slice(0, MAX_RESULT_TEXT)}\n[Result truncated at ${MAX_RESULT_TEXT} characters. Narrow the request with response fields, summaries or pagination before drawing conclusions.]`
}

/** Convert the agent service's dynamic tool reply into an MCP tool result. */
export function claudeCodeToolResult(packet: { result?: unknown; error?: { message?: string } }): CallToolResult {
  if (packet.error) return { content: [{ type: 'text', text: packet.error.message || 'Tool call failed.' }], isError: true }
  const result = packet.result as { contentItems?: { type: string; text?: string; imageUrl?: string }[]; success?: boolean } | undefined
  const content: CallToolResult['content'] = []
  for (const item of result?.contentItems ?? []) {
    if (item.type === 'inputText' && typeof item.text === 'string') content.push({ type: 'text', text: clip(item.text) })
    else if (item.type === 'inputImage' && typeof item.imageUrl === 'string') {
      const image = imageBlock(item.imageUrl)
      if (image) content.push({ type: 'image', data: image.source.data, mimeType: image.source.media_type })
    }
  }
  if (!content.length) content.push({ type: 'text', text: '(no output)' })
  return { content, isError: result?.success === false }
}

/** Map Claude Code's model list to the Agents catalog. Only the current alias rows are offered. */
export function claudeCodeModels(listed: ModelInfo[]): NonNullable<CodexResult['data']> {
  const models: NonNullable<CodexResult['data']> = []
  for (const alias of ALIASES) {
    const row = listed.find(model => model.value === alias)
    if (!row) continue
    const id = row.resolvedModel ?? row.value
    if (models.some(model => model.model === id)) continue
    const levels = row.supportedEffortLevels?.length ? efforts.filter(mode => row.supportedEffortLevels!.includes(mode.reasoningEffort)) : []
    const preferred = defaultEfforts[alias]
    models.push({ model: id, displayName: `Claude ${row.displayName}`.replace(/^Claude Claude /, 'Claude '), inputModalities: ['text', 'image'],
      defaultReasoningEffort: levels.some(mode => mode.reasoningEffort === preferred) ? preferred : levels[0]?.reasoningEffort ?? 'medium',
      supportedReasoningEfforts: levels.length ? levels : efforts.filter(mode => mode.reasoningEffort === 'medium') })
  }
  return models
}

/** Never hand the CLI an API key or base URL: this provider always runs on the user's Claude Code login. */
export function claudeCodeEnvironment(environment: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const blocked = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'ELECTRON_RUN_AS_NODE'])
  const result: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(environment)) if (!blocked.has(key.toUpperCase())) result[key] = value
  result.CLAUDE_AGENT_SDK_CLIENT_APP = 'budget-terminal/0.1.0'
  return result
}

/** Explain failures without echoing prompts, tool input or account details. */
export function claudeCodeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/ENOENT|not found|spawn/i.test(text)) return 'Claude Code was not found. Install Claude Code, run `claude` once to sign in, then select Connect Claude Code.'
  if (/log ?in|logged in|auth|401|credential/i.test(text)) return 'Claude Code is not signed in. Run `claude` in a terminal, sign in with /login, then select Connect Claude Code.'
  if (/rate.?limit|usage limit|429/i.test(text)) return 'Your Claude plan usage limit was reached. Wait for it to reset, then use Continue research.'
  return text.slice(0, 400) || 'Claude Code stopped unexpectedly. Connect again.'
}

/**
 * Claude Code adapter for the Agents service. It runs the user's installed, signed-in Claude
 * Code CLI through the Claude Agent SDK and implements the subset of the Codex app-server
 * protocol the service uses, so tool permissions, approvals, run limits and history stay shared.
 * Budget Terminal tools reach the CLI through an in-process MCP server; every call is routed back
 * to the service, which validates it. No settings, CLAUDE.md, hooks, plugins, skills or other MCP
 * servers from the user's Claude Code configuration are loaded, and no transcript is saved.
 */
export class ClaudeCodeClient implements CodexTransport {
  private thread: Thread | null = null
  private turn: Turn | null = null
  private calls = new Map<string, (result: CallToolResult) => void>()
  private models: NonNullable<CodexResult['data']> = []
  private closed = false

  constructor(private executable: () => string | null, private cwd: string, private receive: (packet: CodexPacket) => void,
    private disconnected: (error: string) => void, private run: typeof sdkQuery = sdkQuery) {}

  async start() { if (this.closed) throw new Error('Claude Code connection closed.') }

  private options(extra: Partial<Options>): Options {
    const path = this.executable()
    return {
      cwd: this.cwd, env: claudeCodeEnvironment(), ...(path ? { pathToClaudeCodeExecutable: path } : {}),
      settingSources: [], strictMcpConfig: true, skills: [], persistSession: false, verbatimPrompts: true,
      // Only web research and Budget Terminal tools exist and are pre-approved; dontAsk denies anything else.
      // The service still validates, permission-checks and (where needed) asks the user about every tool call.
      tools: BUILT_IN_TOOLS, allowedTools: [...BUILT_IN_TOOLS, `${PREFIX}*`], permissionMode: 'dontAsk',
      ...extra,
    }
  }

  async request(method: string, params: unknown): Promise<CodexResult> {
    if (this.closed) throw new Error('Claude Code is not connected.')
    const input = (params ?? {}) as Record<string, unknown>
    if (method === 'initialize' || method === 'config/read') return { config: {} }
    if (method === 'account/read') {
      // Control requests only: this never sends a prompt or runs inference.
      const idle = new InputQueue()
      const probe = this.run({ prompt: idle, options: this.options({ tools: [] }) })
      try {
        const account = await probe.accountInfo()
        if ((account.apiProvider ?? 'firstParty') === 'firstParty' && !account.subscriptionType && !account.email && !account.organization) {
          throw new ClaudeCodeAuthError('Claude Code is not signed in. Run `claude` in a terminal, sign in with /login, then select Connect Claude Code.')
        }
        this.models = claudeCodeModels(await probe.supportedModels())
      } catch (error) {
        throw error instanceof ClaudeCodeAuthError ? error : new Error(claudeCodeFailure(error))
      } finally { idle.end(); probe.close() }
      // Only a provider marker reaches the service; email and organization stay here.
      return { account: { provider: 'claude-code' } }
    }
    if (method === 'model/list') return { data: this.models, nextCursor: null }
    if (method === 'modelProvider/capabilities/read') return { imageGeneration: false }
    if (method === 'thread/start') {
      const requested = typeof input.model === 'string' && this.models.some(model => model.model === input.model) ? input.model : this.models[0]?.model
      if (!requested) throw new Error('Claude Code did not list any models for this account. Update Claude Code and connect again.')
      const effort = this.models.find(model => model.model === requested)!.defaultReasoningEffort as EffortLevel
      this.closeThread()
      const tools = (input.dynamicTools as DynamicTool[] | undefined) ?? []
      const queue = new InputQueue()
      const session = this.run({ prompt: queue, options: this.options({
        model: requested, effort, thinking: { type: 'adaptive' }, includePartialMessages: true,
        systemPrompt: `${String(input.baseInstructions ?? '')}\n\n${claudeCodeInstructions}`,
        mcpServers: { [SERVER]: { type: 'sdk', name: SERVER, instance: this.server(tools) } },
      }) })
      const thread: Thread = { id: randomUUID(), model: requested, effort, session, input: queue, webTools: new Map() }
      this.thread = thread
      void this.consume(thread)
      return { thread: { id: thread.id }, model: requested, reasoningEffort: effort }
    }
    if (method === 'turn/start') {
      const thread = this.thread
      if (!thread || thread.id !== input.threadId) throw new Error('The Claude Code conversation expired. Start a new chat.')
      if (this.turn) throw new Error('Claude Code is already working on this conversation.')
      const content: UserContent = []
      for (const item of (input.input as { type: string; text?: string; url?: string }[] | undefined) ?? []) {
        if (item.type === 'image' && item.url) {
          const image = imageBlock(item.url)
          if (!image) throw new Error('Claude accepts PNG, JPEG, WebP or GIF images.')
          content.push(image as UserContent[number])
        }
      }
      for (const item of (input.input as { type: string; text?: string }[] | undefined) ?? []) if (item.type === 'text' && item.text) content.push({ type: 'text', text: item.text })
      if (!content.length) throw new Error('Enter a message or attach an image.')
      if (typeof input.model === 'string' && input.model !== thread.model && this.models.some(model => model.model === input.model)) {
        await thread.session.setModel(input.model)
        thread.model = input.model
      }
      const effort = efforts.find(mode => mode.reasoningEffort === input.effort)?.reasoningEffort
      if (effort && effort !== thread.effort) {
        await thread.session.applyFlagSettings({ effortLevel: effort })
        thread.effort = effort
      }
      const turn: Turn = { id: randomUUID(), thread, pending: new Set(), texts: new Map() }
      this.turn = turn
      // Let the caller record the turn id before the first event arrives.
      setImmediate(() => { if (this.turn === turn) this.send(turn, content) })
      return { turn: { id: turn.id } }
    }
    if (method === 'turn/steer') {
      const turn = this.turn
      if (!turn || turn.id !== input.expectedTurnId) throw new Error('No active Claude Code turn to steer.')
      const text = ((input.input as { type: string; text?: string }[] | undefined) ?? []).filter(item => item.type === 'text' && item.text).map(item => item.text).join('\n')
      if (text) this.send(turn, [{ type: 'text', text }], 'next')
      return {}
    }
    throw new Error(`Claude Code does not support ${method}.`)
  }

  /** Receives the agent service's replies to tool-call requests. */
  write(packet: unknown) {
    if (this.closed) throw new Error('Claude Code is not connected.')
    const reply = packet as { id?: unknown; result?: unknown; error?: { message?: string } }
    if (typeof reply.id !== 'string') return
    const resolve = this.calls.get(reply.id)
    if (!resolve) return
    this.calls.delete(reply.id)
    resolve(claudeCodeToolResult(reply))
  }

  close() {
    this.closed = true
    this.turn = null
    this.closeThread()
  }

  private closeThread() {
    for (const resolve of this.calls.values()) resolve({ content: [{ type: 'text', text: 'The run stopped.' }], isError: true })
    this.calls.clear()
    const thread = this.thread
    this.thread = null
    if (!thread) return
    thread.input.end()
    try { thread.session.close() } catch { /* Already stopped. */ }
  }

  private send(turn: Turn, content: UserContent, priority?: SDKUserMessage['priority']) {
    const uuid = randomUUID()
    turn.pending.add(uuid)
    try {
      turn.thread.input.push({ type: 'user', uuid, parent_tool_use_id: null, message: { role: 'user', content }, ...(priority ? { priority } : {}) } as SDKUserMessage)
    } catch (error) { this.finish(turn, 'failed', claudeCodeFailure(error)) }
  }

  /** Budget Terminal tools, served in-process with their JSON schemas unchanged. */
  private server(tools: DynamicTool[]) {
    const mcp = new McpServer({ name: SERVER, version: '0.1.0' }, { capabilities: { tools: {} } })
    mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(tool => ({
      name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema as { type: 'object' },
      // Everyday tools stay loaded; Claude Code's tool search discovers the rest on demand.
      ...(tool.name.startsWith('budget_terminal_') && !claudeCoreTools.has(tool.name) ? {} : { _meta: { 'anthropic/alwaysLoad': true } }),
    })) }))
    mcp.server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const turn = this.turn
      if (!turn || !tools.some(tool => tool.name === params.name)) return { content: [{ type: 'text', text: 'No active Budget Terminal run.' }], isError: true }
      const id = `claude-code-${randomUUID()}`
      return new Promise<CallToolResult>(resolve => {
        this.calls.set(id, resolve)
        this.receive({ id, method: 'item/tool/call', params: { threadId: turn.thread.id, turnId: turn.id, tool: params.name, arguments: params.arguments ?? {} } })
      })
    })
    return mcp
  }

  private emit(turn: Turn, method: string, params: NonNullable<CodexPacket['params']>) {
    if (this.turn !== turn) return
    this.receive({ method, params: { threadId: turn.thread.id, turnId: turn.id, ...params } })
  }
  private finish(turn: Turn, status: 'completed' | 'failed', message?: string) {
    if (this.turn !== turn) return
    for (const id of turn.thread.webTools.values()) this.emit(turn, 'item/completed', { item: { id, type: 'webSearch', status: 'completed' } })
    turn.thread.webTools.clear()
    this.emit(turn, 'turn/completed', { turn: { id: turn.id, status, ...(message ? { error: { message } } : {}) } })
    this.turn = null
  }

  private async consume(thread: Thread) {
    try {
      for await (const message of thread.session) {
        if (this.thread !== thread) return
        const turn = this.turn
        if (turn?.thread === thread) this.handle(turn, message)
      }
      if (this.thread === thread && !this.closed) { this.thread = null; this.disconnected('Claude Code ended the session. Connect again to continue.') }
    } catch (error) {
      if (this.thread !== thread || this.closed) return
      this.thread = null
      const turn = this.turn
      if (turn) this.finish(turn, 'failed', claudeCodeFailure(error))
      this.disconnected(claudeCodeFailure(error))
    }
  }

  private handle(turn: Turn, message: SDKMessage) {
    // Subagents are disabled; ignore anything nested defensively.
    if ('parent_tool_use_id' in message && message.parent_tool_use_id) return
    if (message.type === 'stream_event') {
      const event = message.event
      const key = (index: number) => `${turn.id}:${message.uuid}:${index}`
      if (event.type === 'message_start') turn.texts.clear()
      else if (event.type === 'content_block_start') {
        const block = event.content_block
        if (block.type === 'text') turn.texts.set(String(event.index), { id: key(event.index), text: '' })
        else if (block.type === 'thinking' || block.type === 'redacted_thinking') this.emit(turn, 'item/started', { item: { id: key(event.index), type: 'reasoning' } })
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const entry = turn.texts.get(String(event.index))
        if (entry) { entry.text += event.delta.text; this.emit(turn, 'item/agentMessage/delta', { itemId: entry.id, delta: event.delta.text }) }
      } else if (event.type === 'content_block_stop') {
        const entry = turn.texts.get(String(event.index))
        if (entry) { turn.texts.delete(String(event.index)); this.emit(turn, 'item/completed', { item: { id: entry.id, type: 'agentMessage', text: entry.text } }) }
      }
      return
    }
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'tool_use' && BUILT_IN_TOOLS.includes(block.name) && !turn.thread.webTools.has(block.id)) {
          turn.thread.webTools.set(block.id, block.id)
          this.emit(turn, 'item/started', { item: { id: block.id, type: 'webSearch' } })
        }
      }
      return
    }
    if (message.type === 'user') {
      const content = message.message.content
      if (!Array.isArray(content)) return
      for (const block of content) {
        if (block.type !== 'tool_result' || !turn.thread.webTools.has(block.tool_use_id)) continue
        turn.thread.webTools.delete(block.tool_use_id)
        this.emit(turn, 'item/completed', { item: { id: block.tool_use_id, type: 'webSearch', status: block.is_error ? 'failed' : 'completed' } })
      }
      return
    }
    if (message.type === 'result') {
      const consumed = message.user_message_uuids ?? (message.user_message_uuid ? [message.user_message_uuid] : null)
      if (consumed) for (const uuid of consumed) turn.pending.delete(uuid)
      // A steering message the CLI queued as its own turn produces a second result; wait for it.
      if (consumed && turn.pending.size && !message.is_error) return
      if (message.subtype === 'success' && !message.is_error) { this.finish(turn, 'completed'); return }
      const detail = message.subtype === 'success' ? message.result : message.subtype === 'error_max_turns' ? 'Claude Code reached its turn limit. Use Continue research.' : (message.errors ?? []).join(' ')
      this.finish(turn, 'failed', claudeCodeFailure(new Error(detail || 'Claude Code could not complete this request.')))
    }
  }
}
