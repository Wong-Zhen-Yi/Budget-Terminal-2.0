/**
 * The message protocol between the Agents service and its model runtime. It is a small subset of
 * the JSON-RPC app-server protocol the service was first written against: requests return
 * results, and the runtime streams notification packets (and tool-call requests) back.
 */
export interface AgentResult {
  model?: string
  reasoningEffort?: string | null
  data?: { model: string; displayName: string; hidden?: boolean; inputModalities?: string[]; defaultReasoningEffort: string; supportedReasoningEfforts: { reasoningEffort: string; description: string }[] }[]
  imageGeneration?: boolean
  nextCursor?: string | null
  account?: unknown
  thread?: { id: string }
  turn?: { id: string }
}
export interface AgentPacket {
  id?: number | string
  method?: string
  params?: {
    threadId?: string
    turnId?: string
    itemId?: string
    delta?: string
    tool?: string
    arguments?: unknown
    item?: { id: string; type: string; phase?: 'commentary' | 'final_answer'; text?: string; status?: string; result?: string; failure?: { type?: string; resetsAt?: number | null } | null }
    turn?: { id?: string; status: string; error?: { message?: string } }
    error?: { message?: string }
    willRetry?: boolean
  }
  result?: AgentResult
  error?: { message: string }
}
export interface AgentTransport {
  start(): Promise<void>
  request(method: string, params: unknown): Promise<AgentResult>
  write(packet: unknown): void
  close(): void
}
