import { canonical, mcpExecution, recordRevision, type McpExecution } from '../services/mcpContext.js'
import { ResponseSelectionError, shapeResponse } from '../../mcp/response.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { catalog, failed, validateCall } from '../../mcp/catalog.js'
import { mutationDomains, type Operation } from '../../mcp/operations.js'
import type { McpActivity, McpCallSource, McpDiagnostics, McpPolicy } from '../shared/mcpAccess.js'

export const mcpPolicySchema = z.object({ readOnly: z.boolean(), requireApproval: z.boolean(), browserRequireApproval: z.boolean().optional() }).strict()
export const DEFAULT_MCP_POLICY: McpPolicy = { readOnly: true, requireApproval: true }
const RECEIPT_LIMIT = 500
const ACTIVITY_LIMIT = 100

/** Only these intentionally public failures may cross the HTTP error boundary. */
export class McpAccessError extends Error {}

type Outcome = { result: unknown } | { error: string }
interface Receipt { fingerprint: string; outcome: Promise<Outcome> }
interface Options {
  routes: Map<Operation, (request: unknown) => unknown>
  policy?: McpPolicy
  policyError?: string
  persistPolicy?: (policy: McpPolicy) => Promise<void>
  approve?: (tool: string, request: unknown, signal: AbortSignal) => Promise<boolean>
}

/** One permission boundary and receipt ledger shared by external MCP and embedded agents. */
export class McpDispatcher {
  private policy: McpPolicy
  private policyError?: string
  private revision = 0
  private closed = false
  private sequence = 0
  private activity: McpActivity[] = []
  private receipts = new Map<string, Receipt>()
  private approval?: AbortController
  private controllers = new Map<number, AbortController>()
  private policyWrites: Promise<unknown> = Promise.resolve()

  constructor(private options: Options) {
    for (const entry of catalog) if (!options.routes.has(entry.operation)) throw new Error(`Missing MCP service route: ${entry.operation}`)
    this.policy = mcpPolicySchema.parse(options.policy ?? DEFAULT_MCP_POLICY)
    this.policyError = options.policyError
  }

  diagnostics(): McpDiagnostics {
    return { policy: { ...this.policy }, policyError: this.policyError, activity: this.activity.map(entry => ({ ...entry })), writeReceipts: this.receipts.size, writeReceiptLimit: RECEIPT_LIMIT }
  }

  async configure(value: unknown): Promise<McpDiagnostics> {
    const policy = mcpPolicySchema.parse(value)
    const run = this.policyWrites.catch(() => {}).then(async () => {
      if (this.closed) throw new Error('MCP is shutting down.')
      // Apply only after durable storage succeeds; agents cannot invoke this method.
      await this.options.persistPolicy?.(policy)
      this.policy = policy
      this.policyError = undefined
      this.revision++
      this.approval?.abort()
      return this.diagnostics()
    })
    this.policyWrites = run
    return run
  }

  cancel(id: number) {
    this.controllers.get(z.number().int().positive().parse(id))?.abort()
    return this.diagnostics()
  }

  close() { this.closed = true; this.approval?.abort(); for (const controller of this.controllers.values()) controller.abort() }

  async invoke(name: string, args: unknown, source: McpCallSource = 'external', signal?: AbortSignal, progress?: McpExecution['progress']): Promise<unknown> {
    // Validate before logging: unknown tool names and arbitrary strings must never enter diagnostics.
    const call = validateCall(name, args)
    if (this.closed || signal?.aborted) throw new McpAccessError('MCP call was stopped or the app is shutting down.')
    const active = this.activity.filter(entry => entry.durationMs === undefined).length
    if (active >= 32) throw new McpAccessError('Too many active MCP calls. Wait for current calls to finish.')
    const entry: McpActivity = { id: ++this.sequence, tool: name, source, startedAt: Date.now(), state: 'running' }
    const controller = new AbortController()
    signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    this.controllers.set(entry.id, controller)
    this.activity.push(entry)
    while (this.activity.length > ACTIVITY_LIMIT) {
      const index = this.activity.findIndex(item => item.durationMs !== undefined)
      if (index < 0) break
      this.activity.splice(index, 1)
    }
    let finishReceipt: ((outcome: Outcome) => void) | undefined
    try {
      const mutation = call.operation in mutationDomains
      const changesState = mutation || call.operation === 'browserResearch'
      if (changesState && this.policy.readOnly) {
        entry.state = 'blocked'
        throw new McpAccessError('MCP is read only. Enable edits in Settings > Data > Local MCP. Browser research also changes the shared browser session.')
      }
      if (mutation) {
        const key = `${name}:${call.requestId!}`
        const fingerprint = createHash('sha256').update(canonical({ request: call.request, expectedRevision: call.expectedRevision })).digest('hex')
        const existing = this.receipts.get(key)
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            entry.state = 'blocked'
            throw new McpAccessError('This requestId was already used with different arguments. Read saved records before creating a new write.')
          }
          const outcome = await existing.outcome
          entry.state = 'replayed'
          if ('error' in outcome) throw new McpAccessError(outcome.error)
          return structuredClone(outcome.result)
        }
        // Never evict a receipt and silently allow an old ID to execute again.
        if (this.receipts.size >= RECEIPT_LIMIT) {
          entry.state = 'blocked'
          throw new McpAccessError('The session write receipt limit was reached. Read saved records and restart Budget Terminal before making further edits.')
        }
        const outcome = new Promise<Outcome>(resolve => { finishReceipt = resolve })
        this.receipts.set(key, { fingerprint, outcome })
        if (this.policy.requireApproval) {
          if (this.approval || !this.options.approve) {
            entry.state = 'blocked'
            throw new McpAccessError('Another edit is awaiting approval, or local approval is unavailable. No edit was made.')
          }
          const revision = this.revision
          const controller = new AbortController()
          this.approval = controller
          const timer = setTimeout(() => controller.abort(), 60_000)
          const cancel = () => controller.abort()
          signal?.addEventListener('abort', cancel, { once: true })
          entry.state = 'approval'
          try {
            const approved = await this.options.approve(name, call.request, controller.signal)
            if (!approved || controller.signal.aborted || this.closed || revision !== this.revision || this.policy.readOnly) {
              entry.state = 'blocked'
              throw new McpAccessError('MCP edit was not approved, expired, or permissions changed. No edit was made.')
            }
          } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.approval = undefined }
          entry.state = 'running'
        }
      }
      if (this.closed || signal?.aborted || (changesState && this.policy.readOnly)) {
        entry.state = 'blocked'
        throw new McpAccessError('MCP permissions changed, the call was stopped, or the app is shutting down. No edit was made.')
      }
      const result = await mcpExecution.run({ signal: mutation ? undefined : signal, expectedRevision: call.expectedRevision, progress }, async () => {
        progress?.(0)
        return this.options.routes.get(call.operation)!(call.request)
      })
      if (!mutation && signal.aborted) throw new McpAccessError('MCP read was cancelled. Shared provider requests already in flight may finish updating caches.')
      const freshness = (result as { meta?: { freshness?: string } } | null)?.meta?.freshness
      entry.state = failed(result) ? 'failed' : freshness === 'partial' || freshness === 'stale' ? 'partial' : 'success'
      if (finishReceipt) {
        // Retain bounded, session-only results. Large writes replay a receipt, not private megabytes.
        const replay = JSON.stringify(result)?.length <= 65_536 ? structuredClone(result) : {
          data: { writeAlreadyAttempted: true, nextStep: 'Read saved records for the current result. Do not repeat this write with a new ID.' },
          meta: { freshness: failed(result) ? 'failed' : 'cached', source: 'session write receipt' }, errors: [],
        }
        finishReceipt({ result: replay })
      }
      if (['portfolio', 'cards', 'personalFinance', 'settings'].includes(call.operation) && result && typeof result === 'object' && 'data' in result && !failed(result)) {
        const envelope = result as { data: unknown; meta: Record<string, unknown> }
        return shapeResponse({ ...envelope, meta: { ...envelope.meta, revision: recordRevision(envelope.data) } }, call.response)
      }
      return !mutation && !['screenshot', 'browserResearch'].includes(call.operation) ? shapeResponse(result, call.response) : result
    } catch (error) {
      if (entry.state !== 'blocked' && entry.state !== 'replayed') entry.state = signal?.aborted ? 'cancelled' : 'failed'
      // Errors can contain private provider data. Neither diagnostics nor receipts retain them.
      finishReceipt?.({ error: 'This write request was already attempted. Read saved records before trying a new requestId; the edit may have completed or been refused.' })
      if (error instanceof ResponseSelectionError) throw new McpAccessError(error.message)
      throw error
    } finally { this.controllers.delete(entry.id); entry.durationMs = Math.max(0, Date.now() - entry.startedAt) }
  }
}
