import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import type { CodexPacket, CodexResult, CodexTransport } from './codexClient.js'

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam
type ToolUnion = Anthropic.Beta.Messages.BetaToolUnion
type ToolResultContent = Anthropic.Beta.Messages.BetaTextBlockParam | Anthropic.Beta.Messages.BetaImageBlockParam
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type ImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

const efforts: { reasoningEffort: Effort; description: string }[] = [
  { reasoningEffort: 'low', description: 'Fastest replies with the fewest tool calls.' },
  { reasoningEffort: 'medium', description: 'Balanced depth and cost.' },
  { reasoningEffort: 'high', description: 'Deeper research for complex questions.' },
  { reasoningEffort: 'xhigh', description: 'Extended reasoning for long multi-step research.' },
  { reasoningEffort: 'max', description: 'Maximum depth; slowest and most expensive.' },
]
/** Curated Claude models. The account's model list filters this catalog at connect time. */
export const claudeModels: NonNullable<CodexResult['data']> = [
  { model: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', inputModalities: ['text', 'image'], defaultReasoningEffort: 'medium', supportedReasoningEfforts: efforts },
  { model: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', inputModalities: ['text', 'image'], defaultReasoningEffort: 'high', supportedReasoningEfforts: efforts },
  { model: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5', inputModalities: ['text', 'image'], defaultReasoningEffort: 'medium', supportedReasoningEfforts: efforts },
  { model: 'claude-fable-5-2', displayName: 'Claude Fable 5.2', inputModalities: ['text', 'image'], defaultReasoningEffort: 'high', supportedReasoningEfforts: efforts },
]
const defaultModel = claudeModels[0].model
// Server-side refusal fallback is available for these models; Haiku has none.
const fallbackModels = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2'])
// Dynamic-filtering web tools are not available on Haiku; it keeps the basic variants.
const basicWebModels = new Set(['claude-haiku-5-5'])
/** Keep the everyday tools loaded; tool search discovers the rest of the large MCP catalog on demand. */
export const claudeCoreTools = new Set([
  'budget_terminal_connection_status', 'budget_terminal_company_overview', 'budget_terminal_portfolio_briefing',
  'budget_terminal_portfolio', 'budget_terminal_quotes', 'budget_terminal_stocks', 'budget_terminal_news',
  'budget_terminal_news_page', 'budget_terminal_screenshot', 'budget_terminal_settings', 'budget_terminal_operation_status',
])
const MAX_RESULT_TEXT = 200_000
const MAX_CONTINUATIONS = 5
const claudeInstructions = 'You are running on Claude through the Anthropic API. Only the most common Budget Terminal tools are loaded up front. When you need another Budget Terminal capability (for example ETFs, options chains, earnings calendars, macro data, crypto, Focus pages, Cards or personal finance), use the tool search tool with a short topic query to load it, then call it. Native web search and web fetch are available for public sources; fetch only URLs returned by search or supplied by the user. Native image generation is not available with Claude in Budget Terminal: if asked to generate or edit an image, say so and offer a chart or text alternative instead.'

interface Thread { id: string; model: string; system: string; tools: ToolUnion[]; messages: MessageParam[] }
interface Turn { id: string; thread: Thread; controller: AbortController; steering: string[] }
interface DynamicTool { name: string; description?: string; inputSchema: unknown }
interface PendingCall { resolve: (value: { content: ToolResultContent[]; isError: boolean }) => void }

export class ClaudeAuthError extends Error {}

/** Explain API failures without echoing request bodies, headers or credentials. */
export function claudeFailure(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'Claude rejected the saved API key. Replace it in Agents → Claude, then connect again.'
  if (error instanceof Anthropic.PermissionDeniedError) return 'This Claude API key is not permitted to use the selected model or feature. Choose another model or check the key\'s workspace in the Claude Console.'
  if (error instanceof Anthropic.NotFoundError) return 'The selected Claude model is unavailable for this API key. Choose another model and try again.'
  if (error instanceof Anthropic.RateLimitError) return 'The Claude API rate limit or spend limit was reached. Wait, then use Continue research.'
  if (error instanceof Anthropic.BadRequestError) return `The Claude API rejected the request: ${error.message.slice(0, 400)}`
  if (error instanceof Anthropic.InternalServerError) return 'The Claude API is temporarily unavailable. Try again shortly or use Continue research.'
  if (error instanceof Anthropic.APIConnectionError) return 'Budget Terminal could not reach the Claude API. Check the network connection and try again.'
  if (error instanceof Anthropic.APIError) return `The Claude API returned an error (${error.status ?? 'unknown status'}). Try again shortly.`
  return error instanceof Error ? error.message : String(error)
}

function imageBlock(url: string): Anthropic.Beta.Messages.BetaImageBlockParam | null {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url)
  return match ? { type: 'image', source: { type: 'base64', media_type: match[1] as ImageType, data: match[2] } } : null
}
function clip(text: string) {
  return text.length <= MAX_RESULT_TEXT ? text : `${text.slice(0, MAX_RESULT_TEXT)}\n[Result truncated at ${MAX_RESULT_TEXT} characters. Narrow the request with response fields, summaries or pagination before drawing conclusions.]`
}
/** Convert the app-server dynamic tool reply into Claude tool_result content. */
export function claudeToolResult(packet: { result?: unknown; error?: { message?: string } }) {
  if (packet.error) return { content: [{ type: 'text' as const, text: packet.error.message || 'Tool call failed.' }], isError: true }
  const result = packet.result as { contentItems?: { type: string; text?: string; imageUrl?: string }[]; success?: boolean } | undefined
  const content: ToolResultContent[] = []
  for (const item of result?.contentItems ?? []) {
    if (item.type === 'inputText' && typeof item.text === 'string') content.push({ type: 'text', text: clip(item.text) })
    else if (item.type === 'inputImage' && typeof item.imageUrl === 'string') {
      const image = imageBlock(item.imageUrl)
      if (image) content.push(image)
    }
  }
  if (!content.length) content.push({ type: 'text', text: '(no output)' })
  return { content, isError: result?.success === false }
}

export function claudeTools(dynamicTools: DynamicTool[], model: string): ToolUnion[] {
  const basic = basicWebModels.has(model)
  const custom = dynamicTools.map((tool): ToolUnion => ({
    name: tool.name, description: tool.description ?? '',
    input_schema: tool.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
    // Inputs are validated by the agent service before any tool runs.
    eager_input_streaming: true,
    ...(tool.name.startsWith('budget_terminal_') && !claudeCoreTools.has(tool.name) ? { defer_loading: true } : {}),
  }))
  return [
    ...custom,
    { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
    basic ? { type: 'web_search_20250305', name: 'web_search' } : { type: 'web_search_20260209', name: 'web_search' },
    basic ? { type: 'web_fetch_20250910', name: 'web_fetch' } : { type: 'web_fetch_20260209', name: 'web_fetch' },
  ]
}

/**
 * Claude adapter for the Agents service. It implements the subset of the Codex app-server
 * protocol the service uses, so tool permissions, run limits and history stay shared.
 * The API key never leaves the main process and is never written to packets or logs.
 */
export class ClaudeClient implements CodexTransport {
  private client: Anthropic | null = null
  private threads = new Map<string, Thread>()
  private turn: Turn | null = null
  private calls = new Map<string, PendingCall>()
  private available: Set<string> | null = null
  private closed = false

  constructor(private apiKey: () => Promise<string | null>, private receive: (packet: CodexPacket) => void,
    private clientOptions: { baseURL?: string; fetch?: typeof fetch } = {}) {}

  async start() {
    const key = await this.apiKey()
    if (!key) throw new ClaudeAuthError('Add a Claude API key in Agents → Claude, then connect. Create one in the Claude Console under API keys.')
    if (this.closed) throw new Error('Claude connection closed.')
    this.client = new Anthropic({ apiKey: key, authToken: null, maxRetries: 2, timeout: 10 * 60_000, ...this.clientOptions })
  }

  async request(method: string, params: unknown): Promise<CodexResult> {
    const client = this.client
    if (!client || this.closed) throw new Error('Claude is not connected.')
    const input = (params ?? {}) as Record<string, unknown>
    if (method === 'initialize' || method === 'config/read') return { config: {} }
    if (method === 'account/read') {
      try {
        const ids = new Set<string>()
        for await (const model of client.models.list({ limit: 100 })) ids.add(model.id)
        this.available = ids
      } catch (error) { throw new Error(claudeFailure(error)) }
      return { account: { provider: 'anthropic' } }
    }
    if (method === 'model/list') {
      const listed = claudeModels.filter(model => !this.available?.size || this.available.has(model.model))
      return { data: listed.length ? listed : claudeModels, nextCursor: null }
    }
    if (method === 'modelProvider/capabilities/read') return { imageGeneration: false }
    if (method === 'thread/start') {
      const requested = typeof input.model === 'string' && claudeModels.some(model => model.model === input.model) ? input.model : defaultModel
      const thread: Thread = { id: randomUUID(), model: requested, system: `${String(input.baseInstructions ?? '')}\n\n${claudeInstructions}`,
        tools: claudeTools((input.dynamicTools as DynamicTool[] | undefined) ?? [], requested), messages: [] }
      // Codex threads are replaced on every new chat; keep only the current one.
      this.threads.clear()
      this.threads.set(thread.id, thread)
      const effort = claudeModels.find(model => model.model === requested)!.defaultReasoningEffort
      return { thread: { id: thread.id }, model: requested, reasoningEffort: effort }
    }
    if (method === 'turn/start') {
      const thread = this.threads.get(String(input.threadId))
      if (!thread) throw new Error('The Claude conversation expired. Start a new chat.')
      if (this.turn) throw new Error('Claude is already working on this conversation.')
      if (typeof input.model === 'string' && claudeModels.some(model => model.model === input.model) && input.model !== thread.model) {
        thread.model = input.model
        // Web tool variants depend on the model.
        thread.tools = claudeTools(thread.tools.filter((tool): tool is Anthropic.Beta.Messages.BetaTool => 'input_schema' in tool)
          .map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.input_schema })), thread.model)
      }
      const content: ContentBlockParam[] = []
      for (const item of (input.input as { type: string; text?: string; url?: string }[] | undefined) ?? []) {
        if (item.type === 'text' && item.text) content.push({ type: 'text', text: item.text })
        if (item.type === 'image' && item.url) {
          const image = imageBlock(item.url)
          if (!image) throw new Error('Claude accepts PNG, JPEG, WebP or GIF images.')
          content.push(image)
        }
      }
      if (!content.length) throw new Error('Enter a message or attach an image.')
      // Images go before the text so Claude reads them with the question.
      content.sort((a, b) => Number(a.type === 'text') - Number(b.type === 'text'))
      const effort = (efforts.some(mode => mode.reasoningEffort === input.effort) ? input.effort : claudeModels.find(model => model.model === thread.model)!.defaultReasoningEffort) as Effort
      const turn: Turn = { id: randomUUID(), thread, controller: new AbortController(), steering: [] }
      this.turn = turn
      thread.messages.push({ role: 'user', content })
      // Let the caller record the turn id before the first event arrives.
      setImmediate(() => void this.runTurn(turn, effort))
      return { turn: { id: turn.id } }
    }
    if (method === 'turn/steer') {
      const turn = this.turn
      if (!turn || turn.id !== input.expectedTurnId) throw new Error('No active Claude turn to steer.')
      for (const item of (input.input as { type: string; text?: string }[] | undefined) ?? []) if (item.type === 'text' && item.text) turn.steering.push(item.text)
      return {}
    }
    throw new Error(`Claude does not support ${method}.`)
  }

  /** Receives the agent service's replies to tool-call requests. */
  write(packet: unknown) {
    if (this.closed) throw new Error('Claude is not connected.')
    const reply = packet as { id?: unknown; result?: unknown; error?: { message?: string } }
    if (typeof reply.id !== 'string') return
    const call = this.calls.get(reply.id)
    if (!call) return
    this.calls.delete(reply.id)
    call.resolve(claudeToolResult(reply))
  }

  close() {
    this.closed = true
    this.turn?.controller.abort()
    this.turn = null
    for (const call of this.calls.values()) call.resolve({ content: [{ type: 'text', text: 'Claude connection closed.' }], isError: true })
    this.calls.clear()
    this.threads.clear()
    this.client = null
  }

  private emit(turn: Turn, method: string, params: NonNullable<CodexPacket['params']>) {
    if (this.turn !== turn) return
    this.receive({ method, params: { threadId: turn.thread.id, turnId: turn.id, ...params } })
  }
  private finish(turn: Turn, status: 'completed' | 'failed', message?: string) {
    if (this.turn !== turn) return
    this.emit(turn, 'turn/completed', { turn: { id: turn.id, status, ...(message ? { error: { message } } : {}) } })
    this.turn = null
  }

  private async runTurn(turn: Turn, effort: Effort) {
    const { thread } = turn
    let continuations = 0
    try {
      for (let round = 0; this.turn === turn; round++) {
        const message = await this.sample(turn, effort, round)
        if (this.turn !== turn) return
        // Append the full assistant content so thinking and server-tool blocks stay intact.
        thread.messages.push({ role: 'assistant', content: message.content as unknown as ContentBlockParam[] })
        if (message.stop_reason === 'refusal') {
          const category = message.stop_details?.category
          this.finish(turn, 'failed', `Claude declined this request${category ? ` (${category})` : ''}. Rephrase it or start a new chat.`)
          return
        }
        if (message.stop_reason === 'model_context_window_exceeded') {
          this.finish(turn, 'failed', 'This conversation exceeded Claude\'s context window. Start a new chat and narrow the research.')
          return
        }
        if (message.stop_reason === 'pause_turn') {
          if (++continuations > MAX_CONTINUATIONS) { this.finish(turn, 'failed', 'Claude paused too many times during web research. Use Continue research.'); return }
          continue
        }
        const uses = message.content.filter((block): block is Anthropic.Beta.Messages.BetaToolUseBlock => block.type === 'tool_use')
        if (!uses.length) {
          if (turn.steering.length) { thread.messages.push({ role: 'user', content: turn.steering.splice(0).join('\n') }); continue }
          this.finish(turn, 'completed')
          return
        }
        // A truncated or refused turn can cut tool input short: never run those calls.
        const results = await Promise.all(uses.map(async (use): Promise<ContentBlockParam> => {
          if (message.stop_reason === 'max_tokens') return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'The tool input was cut off by the output limit. Retry with a smaller request.' }
          const outcome = await this.callTool(turn, use)
          return { type: 'tool_result', tool_use_id: use.id, is_error: outcome.isError, content: outcome.content }
        }))
        if (this.turn !== turn) return
        const steering = turn.steering.splice(0)
        thread.messages.push({ role: 'user', content: [...results, ...steering.map(text => ({ type: 'text' as const, text }))] })
      }
    } catch (error) {
      if (this.turn !== turn || turn.controller.signal.aborted) return
      this.finish(turn, 'failed', claudeFailure(error))
    }
  }

  private callTool(turn: Turn, use: Anthropic.Beta.Messages.BetaToolUseBlock) {
    const id = `claude-${randomUUID()}`
    return new Promise<{ content: ToolResultContent[]; isError: boolean }>(resolve => {
      this.calls.set(id, { resolve })
      if (this.turn !== turn) { this.calls.delete(id); resolve({ content: [{ type: 'text', text: 'The run stopped.' }], isError: true }); return }
      this.receive({ id, method: 'item/tool/call', params: { threadId: turn.thread.id, turnId: turn.id, tool: use.name, arguments: use.input } })
    })
  }

  private async sample(turn: Turn, effort: Effort, round: number) {
    const { thread } = turn
    const fallback = fallbackModels.has(thread.model)
    const stream = this.client!.beta.messages.stream({
      model: thread.model, max_tokens: 64_000,
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      thinking: { type: 'adaptive' }, output_config: { effort },
      // Tools and system are fixed for the thread so the cached prefix stays valid.
      system: [{ type: 'text', text: thread.system, cache_control: { type: 'ephemeral' } }],
      cache_control: { type: 'ephemeral' },
      tools: thread.tools, messages: thread.messages,
    }, { signal: turn.controller.signal })
    const texts = new Map<number, { id: string; text: string }>()
    const webTools = new Map<number, string>()
    const finished = new Set<string>()
    for await (const event of stream) {
      if (this.turn !== turn) { stream.abort(); throw new Error('Claude turn stopped.') }
      if (event.type === 'content_block_start') {
        const block = event.content_block as ContentBlock
        if (block.type === 'text') texts.set(event.index, { id: `${turn.id}:${round}:${event.index}`, text: '' })
        else if (block.type === 'thinking' || block.type === 'redacted_thinking') this.emit(turn, 'item/started', { item: { id: `${turn.id}:${round}:${event.index}`, type: 'reasoning' } })
        else if (block.type === 'server_tool_use' && (block.name === 'web_search' || block.name === 'web_fetch')) {
          webTools.set(event.index, block.id)
          this.emit(turn, 'item/started', { item: { id: block.id, type: 'webSearch' } })
        } else if (block.type === 'web_search_tool_result' || block.type === 'web_fetch_tool_result') {
          const failedResult = !Array.isArray(block.content) && block.content && typeof block.content === 'object' && 'error_code' in block.content
          finished.add(block.tool_use_id)
          this.emit(turn, 'item/completed', { item: { id: block.tool_use_id, type: 'webSearch', status: failedResult ? 'failed' : 'completed' } })
        }
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const entry = texts.get(event.index)
        if (entry) {
          entry.text += event.delta.text
          this.emit(turn, 'item/agentMessage/delta', { itemId: entry.id, delta: event.delta.text })
        }
      } else if (event.type === 'content_block_stop') {
        const entry = texts.get(event.index)
        if (entry) this.emit(turn, 'item/completed', { item: { id: entry.id, type: 'agentMessage', text: entry.text } })
      }
    }
    const message = await stream.finalMessage()
    // The server finished its own tool loop; close any search that returned no separate result block.
    for (const id of webTools.values()) if (!finished.has(id)) this.emit(turn, 'item/completed', { item: { id, type: 'webSearch', status: 'completed' } })
    return message
  }
}
