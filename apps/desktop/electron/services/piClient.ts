import { createAgentSession, createExtensionRuntime, SessionManager, SettingsManager, type AgentSession, type AgentSessionEvent, type ModelRuntime, type ResourceLoader, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { getSupportedThinkingLevels, type Api, type ImageContent, type Model, type TextContent } from '@earendil-works/pi-ai'
import { randomUUID } from 'node:crypto'
import type { AgentPacket, AgentResult, AgentTransport } from './agentTransport.js'
import { isWebTool, runWebTool, webToolDefinitions } from './agentWebTools.js'

type ThinkingLevel = AgentSession['thinkingLevel']
type ToolReply = { result?: unknown; error?: { message?: string } }
interface DynamicTool { name: string; description?: string; inputSchema: unknown }
interface Thread { id: string; session: AgentSession; unsubscribe: () => void }
interface Turn { id: string; thread: Thread; message: number; texts: Map<number, { id: string; text: string }>; finished: boolean }

/** What the host supplies for each connection: Pi's model runtime and the user's saved Pi defaults. */
export interface PiServices {
  runtime: ModelRuntime
  defaults?: { defaultProvider?: string; defaultModel?: string; defaultThinkingLevel?: ThinkingLevel }
}

const MAX_RESULT_TEXT = 200_000
const thinkingDescriptions: Record<ThinkingLevel, string> = {
  off: 'No extended reasoning; fastest replies.',
  minimal: 'Very light reasoning.',
  low: 'Fast replies with light reasoning.',
  medium: 'Balanced depth and usage.',
  high: 'Deeper research for complex questions.',
  xhigh: 'Extended reasoning for long multi-step research.',
  max: 'Maximum depth; slowest and uses the most tokens.',
}
const piInstructions = 'You are running on Pi, the agent runtime embedded in Budget Terminal, with the model the user selected. Budget Terminal tools are provided directly. For public sources outside those tools use web_search, then open the source with web_fetch; fetch only URLs returned by search, linked from a fetched page, or supplied by the user. File, shell and coding tools are not available. Native image generation is not available: if asked to generate or edit an image, say so and offer a chart or text alternative instead.'

export class PiAuthError extends Error {}

export const piModelId = (model: Pick<Model<Api>, 'provider' | 'id'>) => `${model.provider}/${model.id}`

function imageContent(url: string): ImageContent | null {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url)
  return match ? { type: 'image', mimeType: match[1], data: match[2] } : null
}
function clip(text: string) {
  return text.length <= MAX_RESULT_TEXT ? text : `${text.slice(0, MAX_RESULT_TEXT)}\n[Result truncated at ${MAX_RESULT_TEXT} characters. Narrow the request with response fields, summaries or pagination before drawing conclusions.]`
}

/** Models occasionally send an object argument as JSON text; accept it only when it parses to an object. */
export function piArguments(args: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = args && typeof args === 'object' && !Array.isArray(args) ? { ...args as Record<string, unknown> } : {}
  for (const key of ['request', 'response']) {
    const value = result[key]
    if (typeof value !== 'string' || !value.trim().startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result[key] = parsed
    } catch { /* Leave it for validation to reject. */ }
  }
  return result
}

/** Convert the agent service's dynamic tool reply into Pi tool content. A failed result becomes a tool error. */
export function piToolResult(packet: ToolReply): (TextContent | ImageContent)[] {
  if (packet.error) throw new Error(packet.error.message || 'Tool call failed.')
  const result = packet.result as { contentItems?: { type: string; text?: string; imageUrl?: string }[]; success?: boolean } | undefined
  const content: (TextContent | ImageContent)[] = []
  for (const item of result?.contentItems ?? []) {
    if (item.type === 'inputText' && typeof item.text === 'string') content.push({ type: 'text', text: clip(item.text) })
    else if (item.type === 'inputImage' && typeof item.imageUrl === 'string') {
      const image = imageContent(item.imageUrl)
      if (image) content.push(image)
    }
  }
  if (result?.success === false) throw new Error(content.filter(item => item.type === 'text').map(item => (item as TextContent).text).join('\n') || 'Tool call failed.')
  if (!content.length) content.push({ type: 'text', text: '(no output)' })
  return content
}

/** Map Pi's available models to the Agents catalog, grouped by provider. */
export function piModels(runtime: Pick<ModelRuntime, 'getProvider'>, available: readonly Model<Api>[]): NonNullable<AgentResult['data']> {
  const order = new Intl.Collator('en', { numeric: true })
  const providerName = (id: string) => runtime.getProvider(id)?.name ?? id
  return [...available]
    .sort((a, b) => order.compare(providerName(a.provider), providerName(b.provider)) || order.compare(b.name, a.name))
    .map(model => {
      const levels = getSupportedThinkingLevels(model) as ThinkingLevel[]
      const preferred: ThinkingLevel = !model.reasoning ? 'off' : levels.includes('medium') ? 'medium' : levels.at(-1) ?? 'off'
      return { model: piModelId(model), displayName: `${model.name} · ${providerName(model.provider)}`, inputModalities: [...model.input],
        defaultReasoningEffort: levels.includes(preferred) ? preferred : levels[0] ?? 'off',
        supportedReasoningEfforts: (levels.length ? levels : ['off' as const]).map(level => ({ reasoningEffort: level, description: thinkingDescriptions[level] ?? level })) }
    })
}

/** Explain failures without echoing prompts, tool input or credentials. */
export function piFailure(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, '$1…')
  if (/no api key|api key (?:is )?(?:missing|required)|no credentials|not authenticated|unauthori[sz]ed|\b401\b|invalid (?:x-)?api.?key|authentication/i.test(text)) return 'The model provider rejected the credentials. Save a valid API key in Agents → Get connected, or sign in again with `pi` → /login, then select Connect Pi.'
  if (/rate.?limit|usage limit|quota|\b429\b/i.test(text)) return 'The model provider\'s rate or usage limit was reached. Wait for it to reset, then use Continue research.'
  if (/context (?:length|window)|too many tokens|maximum context/i.test(text)) return 'The conversation is larger than the selected model accepts. Start a new chat or choose a model with a larger context window.'
  return text.slice(0, 400) || 'Pi stopped unexpectedly. Connect again.'
}

/** No discovery: Budget Terminal supplies the whole prompt and no user extensions, skills, prompt templates or context files. */
function resourceLoader(systemPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  }
}

/**
 * Pi adapter for the Agents service. It runs Pi's agent loop in-process through the Pi SDK and
 * implements the subset of the app-server protocol the service uses, so tool permissions,
 * approvals, run limits and history stay in the service. Budget Terminal tools are registered as
 * Pi custom tools and every call is routed back to the service, which validates it. Pi's built-in
 * file, shell and edit tools are off, no user extensions, skills, prompt templates, context files
 * or settings are loaded, and sessions are kept in memory only.
 */
export class PiClient implements AgentTransport {
  private runtime: ModelRuntime | null = null
  private defaults: PiServices['defaults'] = {}
  private available: Model<Api>[] = []
  private thread: Thread | null = null
  private turn: Turn | null = null
  private calls = new Map<string, (reply: ToolReply) => void>()
  private closed = false

  // Pi runs in this process, so there is no runtime process that can exit and disconnect.
  constructor(private services: () => Promise<PiServices>, private cwd: string, private receive: (packet: AgentPacket) => void) {}

  async start() { if (this.closed) throw new Error('Pi connection closed.') }

  async request(method: string, params: unknown): Promise<AgentResult> {
    if (this.closed) throw new Error('Pi is not connected.')
    const input = (params ?? {}) as Record<string, unknown>
    if (method === 'account/read') {
      // Reads local credentials and the bundled model catalog only; nothing is sent to a provider.
      try {
        const services = await this.services()
        this.runtime = services.runtime
        this.defaults = services.defaults ?? {}
        this.available = [...await this.runtime.getAvailable()]
      } catch (error) { throw new Error(piFailure(error)) }
      if (!this.available.length) throw new PiAuthError('No model provider is connected to Pi. Save an API key in Agents → Get connected, or sign in with `pi` → /login in a terminal, then select Connect Pi.')
      return { account: { provider: 'pi' } }
    }
    if (method === 'model/list') return { data: this.runtime ? piModels(this.runtime, this.available) : [], nextCursor: null }
    if (method === 'modelProvider/capabilities/read') return { imageGeneration: false }
    if (method === 'thread/start') return this.startThread(input)
    if (method === 'turn/start') {
      const thread = this.thread
      if (!thread || thread.id !== input.threadId) throw new Error('The Pi conversation expired. Start a new chat.')
      if (this.turn) throw new Error('Pi is already working on this conversation.')
      const images: ImageContent[] = []
      let text = ''
      for (const item of (input.input as { type: string; text?: string; url?: string }[] | undefined) ?? []) {
        if (item.type === 'image' && item.url) {
          const image = imageContent(item.url)
          if (!image) throw new Error('Pi accepts PNG, JPEG, WebP or GIF images.')
          images.push(image)
        } else if (item.type === 'text' && item.text) text += (text ? '\n' : '') + item.text
      }
      if (!text && !images.length) throw new Error('Enter a message or attach an image.')
      const requested = typeof input.model === 'string' ? this.find(input.model) : undefined
      if (requested && piModelId(requested) !== piModelId(thread.session.model ?? requested)) await thread.session.setModel(requested)
      const level = typeof input.effort === 'string' ? input.effort as ThinkingLevel : undefined
      if (level && level in thinkingDescriptions && level !== thread.session.thinkingLevel && thread.session.model
        && (getSupportedThinkingLevels(thread.session.model) as string[]).includes(level)) thread.session.setThinkingLevel(level)
      const turn: Turn = { id: randomUUID(), thread, message: 0, texts: new Map(), finished: false }
      this.turn = turn
      // Let the caller record the turn id before the first event arrives.
      setImmediate(() => {
        if (this.turn !== turn) return
        thread.session.prompt(text || 'See the attached image.', { images, expandPromptTemplates: false })
          .catch(error => this.finish(turn, 'failed', piFailure(error)))
      })
      return { turn: { id: turn.id } }
    }
    if (method === 'turn/steer') {
      const turn = this.turn
      if (!turn || turn.id !== input.expectedTurnId) throw new Error('No active Pi turn to steer.')
      const text = ((input.input as { type: string; text?: string }[] | undefined) ?? []).filter(item => item.type === 'text' && item.text).map(item => item.text).join('\n')
      if (text) await turn.thread.session.steer(text)
      return {}
    }
    throw new Error(`Pi does not support ${method}.`)
  }

  /** Receives the agent service's replies to tool-call requests. */
  write(packet: unknown) {
    if (this.closed) throw new Error('Pi is not connected.')
    const reply = packet as { id?: unknown } & ToolReply
    if (typeof reply.id !== 'string') return
    const resolve = this.calls.get(reply.id)
    if (!resolve) return
    this.calls.delete(reply.id)
    resolve(reply)
  }

  close() {
    this.closed = true
    this.turn = null
    this.closeThread()
  }

  private find(id: string) { return this.available.find(model => piModelId(model) === id) }

  private async startThread(input: Record<string, unknown>): Promise<AgentResult> {
    const runtime = this.runtime
    if (!runtime) throw new Error('Connect Pi before starting a conversation.')
    this.closeThread()
    const requested = typeof input.model === 'string' ? this.find(input.model) : undefined
    const tools = (input.dynamicTools as DynamicTool[] | undefined) ?? []
    // In-memory settings only: Pi's settings files, telemetry and attribution headers are never used.
    const settingsManager = SettingsManager.inMemory({
      ...this.defaults, enableInstallTelemetry: false, enableAnalytics: false,
      compaction: { enabled: true }, retry: { enabled: true, maxRetries: 3 },
    })
    const customTools = [...tools.map(tool => this.budgetTool(tool)), ...webToolDefinitions.map(tool => this.webTool(tool))]
    const { session } = await createAgentSession({
      cwd: this.cwd, agentDir: this.cwd, modelRuntime: runtime, settingsManager,
      ...(requested ? { model: requested } : {}),
      resourceLoader: resourceLoader(`${String(input.baseInstructions ?? '')}\n\n${piInstructions}`),
      sessionManager: SessionManager.inMemory(this.cwd),
      noTools: 'all', tools: customTools.map(tool => tool.name), customTools,
    })
    if (this.closed) { session.dispose(); throw new Error('Pi connection closed.') }
    if (!session.model) { session.dispose(); throw new PiAuthError('Pi has no usable model. Save an API key in Agents → Get connected, then select Connect Pi.') }
    const thread: Thread = { id: randomUUID(), session, unsubscribe: () => {} }
    thread.unsubscribe = session.subscribe(event => this.handle(thread, event))
    this.thread = thread
    return { thread: { id: thread.id }, model: piModelId(session.model), reasoningEffort: session.thinkingLevel }
  }

  private closeThread() {
    for (const resolve of this.calls.values()) resolve({ error: { message: 'The run stopped.' } })
    this.calls.clear()
    const thread = this.thread
    this.thread = null
    if (!thread) return
    thread.unsubscribe()
    void thread.session.abort().catch(() => {}).finally(() => thread.session.dispose())
  }

  /** A Budget Terminal tool with its JSON schema unchanged. The service validates and runs every call. */
  private budgetTool(tool: DynamicTool): ToolDefinition {
    return {
      name: tool.name, label: tool.name, description: tool.description ?? '',
      parameters: tool.inputSchema as ToolDefinition['parameters'],
      prepareArguments: args => piArguments(args) as never,
      execute: async (_toolCallId, args, signal) => {
        const turn = this.turn
        if (!turn || turn.finished) throw new Error('No active Budget Terminal run.')
        const id = `pi-${randomUUID()}`
        const reply = await new Promise<ToolReply>(resolve => {
          const abort = () => { if (this.calls.delete(id)) resolve({ error: { message: 'The run stopped.' } }) }
          if (signal?.aborted) { abort(); return }
          signal?.addEventListener('abort', abort, { once: true })
          this.calls.set(id, value => { signal?.removeEventListener('abort', abort); resolve(value) })
          this.receive({ id, method: 'item/tool/call', params: { threadId: turn.thread.id, turnId: turn.id, tool: tool.name, arguments: piArguments(args) } })
        })
        return { content: piToolResult(reply), details: {} }
      },
    }
  }

  /** Public web research runs in this process and is reported to the service like native web search. */
  private webTool(tool: typeof webToolDefinitions[number]): ToolDefinition {
    return {
      name: tool.name, label: tool.name, description: tool.description,
      parameters: tool.inputSchema as unknown as ToolDefinition['parameters'],
      execute: async (toolCallId, args) => {
        const turn = this.turn
        if (!turn || turn.finished || !isWebTool(tool.name)) throw new Error('No active Budget Terminal run.')
        this.emit(turn, 'item/started', { item: { id: toolCallId, type: 'webSearch' } })
        try {
          const text = await runWebTool(tool.name, args as Record<string, unknown>)
          this.emit(turn, 'item/completed', { item: { id: toolCallId, type: 'webSearch', status: 'completed' } })
          return { content: [{ type: 'text', text: clip(text) }], details: {} }
        } catch (error) {
          this.emit(turn, 'item/completed', { item: { id: toolCallId, type: 'webSearch', status: 'failed' } })
          throw new Error(`${error instanceof Error ? error.message : String(error)} Use other sources and disclose the failed request.`)
        }
      },
    }
  }

  private emit(turn: Turn, method: string, params: NonNullable<AgentPacket['params']>) {
    if (this.turn !== turn || turn.finished) return
    this.receive({ method, params: { threadId: turn.thread.id, turnId: turn.id, ...params } })
  }
  private finish(turn: Turn, status: 'completed' | 'failed', message?: string) {
    if (this.turn !== turn || turn.finished) return
    this.emit(turn, 'turn/completed', { turn: { id: turn.id, status, ...(message ? { error: { message } } : {}) } })
    turn.finished = true
    this.turn = null
  }

  private handle(thread: Thread, event: AgentSessionEvent) {
    const turn = this.turn
    if (this.thread !== thread || !turn || turn.thread !== thread) return
    if (event.type === 'message_start' && event.message.role === 'assistant') { turn.message++; turn.texts.clear(); return }
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      const key = (index: number) => `${turn.id}:${turn.message}:${index}`
      if (update.type === 'text_start') turn.texts.set(update.contentIndex, { id: key(update.contentIndex), text: '' })
      else if (update.type === 'text_delta') {
        const entry = turn.texts.get(update.contentIndex)
        if (entry) { entry.text += update.delta; this.emit(turn, 'item/agentMessage/delta', { itemId: entry.id, delta: update.delta }) }
      } else if (update.type === 'text_end') {
        const entry = turn.texts.get(update.contentIndex)
        if (entry) { turn.texts.delete(update.contentIndex); this.emit(turn, 'item/completed', { item: { id: entry.id, type: 'agentMessage', text: update.content } }) }
      } else if (update.type === 'thinking_start') this.emit(turn, 'item/started', { item: { id: key(update.contentIndex), type: 'reasoning' } })
      return
    }
    if (event.type === 'auto_retry_start') { this.emit(turn, 'error', { error: { message: piFailure(event.errorMessage) }, willRetry: true }); return }
    if (event.type === 'agent_settled') {
      const last = [...thread.session.messages].reverse().find(message => message.role === 'assistant') as { stopReason?: string; errorMessage?: string } | undefined
      if (event.aborted || last?.stopReason === 'aborted') this.finish(turn, 'failed', 'The run stopped.')
      else if (last?.stopReason === 'error') this.finish(turn, 'failed', piFailure(last.errorMessage ?? 'The model provider returned an error.'))
      else this.finish(turn, 'completed')
    }
  }
}
