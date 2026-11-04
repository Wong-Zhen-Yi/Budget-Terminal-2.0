import { canonical, mcpExecution, recordRevision, RecordRevisionError, type McpExecution } from '../services/mcpContext.js'
import { shapeResponse } from '../../mcp/response.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { catalog, failed, validateCall } from '../../mcp/catalog.js'
import { mutationDomains, type Operation } from '../../mcp/operations.js'
import type { McpActivity, McpCallSource, McpDiagnostics, McpPolicy } from '../shared/mcpAccess.js'
import { McpError } from '../../mcp/errors.js'
import { requiredPermissions } from '../../mcp/permissions.js'
import { ResearchSnapshots } from './snapshots.js'
import { WriteJournal, receiptKey } from './journal.js'
import { researchWorkflow } from './workflows.js'
import type { CompanyOverviewRequest, PortfolioBriefingRequest, OperationStatusRequest } from '../../mcp/features.js'
import { ok } from '../shared/envelope.js'
import { selectionFields } from '../../mcp/output.js'

export const mcpPolicySchema = z.object({ readOnly: z.boolean(), requireApproval: z.boolean(), browserRequireApproval: z.boolean().optional(), permissions: z.object({
  marketResearch: z.boolean().optional(), portfolioRead: z.boolean().optional(), personalFinanceRead: z.boolean().optional(), savedContentRead: z.boolean().optional(),
  screenshots: z.boolean().optional(), browserContent: z.boolean().optional(), recordEdits: z.boolean().optional(),
}).strict().optional() }).strict()
export const DEFAULT_MCP_POLICY: McpPolicy = { readOnly: true, requireApproval: true }
const RECEIPT_LIMIT = 500
const ACTIVITY_LIMIT = 100

/** Only these intentionally public failures may cross the HTTP error boundary. */
export class McpAccessError extends McpError {
  constructor(message: string, code: ConstructorParameters<typeof McpError>[1] = 'ACCESS_DENIED') { super(message, code) }
}

type Outcome = { result: unknown } | { error: string }
interface Receipt { fingerprint: string; outcome: Promise<Outcome> }
interface Options {
  journalPath?: string
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
  private journal?: WriteJournal
  private snapshots = new ResearchSnapshots()

  constructor(private options: Options) {
    for (const entry of catalog) if (!options.routes.has(entry.operation)) throw new Error(`Missing MCP service route: ${entry.operation}`)
    this.policy = mcpPolicySchema.parse(options.policy ?? DEFAULT_MCP_POLICY)
    this.policyError = options.policyError
    if (options.journalPath) this.journal = new WriteJournal(options.journalPath)
  }
  async initialize() { await this.journal?.load() }

  diagnostics(): McpDiagnostics {
    return { policy: structuredClone(this.policy), policyError: this.policyError, journalError: this.journal?.error, activity: this.activity.map(entry => ({ ...entry })), writeReceipts: this.journal?.size ?? this.receipts.size, writeReceiptLimit: RECEIPT_LIMIT }
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
      this.snapshots.clear()
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
    if (this.journal) await this.journal.load()
    if (this.closed || signal?.aborted) throw new McpAccessError('MCP call was stopped or the app is shutting down.')
    const active = this.activity.filter(entry => entry.durationMs === undefined).length
    if (active >= 32) throw new McpError('Too many active MCP calls. Wait for current calls to finish.', 'RATE_LIMITED', true, 'Wait for active calls to finish, then retry reads. Inspect saved records before retrying writes.')
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
    let durable: { key: string; fingerprint: string } | undefined
    let executing = false
    try {
      const mutation = call.operation in mutationDomains
      const allowed = () => requiredPermissions(call.operation).every(permission => this.policy.permissions?.[permission] !== false)
      if (!allowed()) { entry.state = 'blocked'; throw new McpAccessError('This MCP category is disabled locally in Settings.') }
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
        const durableKey = receiptKey(name, call.requestId!)
        const saved = this.journal?.get(durableKey)
        if (saved) {
          if (saved.fingerprint !== fingerprint) throw new McpAccessError('This requestId was already used with different arguments. Read saved records before creating a new write.')
          entry.state = 'replayed'
          return this.durableReceipt(saved.state)
        }
        // Never evict a receipt and silently allow an old ID to execute again.
        if (this.receipts.size >= RECEIPT_LIMIT) {
          entry.state = 'blocked'
          throw new McpAccessError(this.journal
            ? 'The durable write receipt limit was reached. Inspect records and archive the private journal locally before making more edits.'
            : 'The session write receipt limit was reached. Read saved records and restart Budget Terminal before making further edits.')
        }
        const outcome = new Promise<Outcome>(resolve => { finishReceipt = resolve })
        this.receipts.set(key, { fingerprint, outcome })
        if (this.journal) {
          durable = { key: durableKey, fingerprint }
          await this.journal.put(durableKey, { fingerprint, state: 'uncertain', updatedAt: Date.now() })
        }
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
              throw new McpAccessError('MCP edit was not approved, expired, or permissions changed. No edit was made.', 'APPROVAL_DENIED')
            }
          } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.approval = undefined }
          entry.state = 'running'
        }
      }
      if (this.closed || signal?.aborted || !allowed() || (changesState && this.policy.readOnly)) {
        entry.state = 'blocked'
        throw new McpAccessError('MCP permissions changed, the call was stopped, or the app is shutting down. No edit was made.')
      }
      const result = await mcpExecution.run({ signal: mutation ? undefined : signal, expectedRevision: call.expectedRevision, progress }, async () => {
        progress?.(0)
        const snapshotKey = canonical({ name, request: call.request })
        const snapshot = call.response?.snapshot
        if (snapshot && snapshot !== 'new') return this.snapshots.read(snapshot, snapshotKey)
        executing = mutation
        const value = call.operation === 'companyOverview' || call.operation === 'portfolioBriefing'
          ? await researchWorkflow(call.operation, call.request as CompanyOverviewRequest | PortfolioBriefingRequest, (tool, args) => this.invoke(tool, args, source, signal))
          : call.operation === 'operationStatus' ? this.operationStatus(call.request as OperationStatusRequest)
            : await this.options.routes.get(call.operation)!(call.request)
        if (snapshot === 'new') {
          const id = this.snapshots.create(snapshotKey, value)
          return { ...(value as object), snapshotId: id, snapshotExpiresAt: Date.now() + 300_000 }
        }
        return value
      })
      if (!mutation && signal.aborted) throw new McpError('MCP read was cancelled. Shared provider requests already in flight may finish updating caches.', 'CANCELLED')
      if (!mutation && !allowed()) throw new McpAccessError('MCP category access was revoked while this read was running.')
      const freshness = (result as { meta?: { freshness?: string } } | null)?.meta?.freshness
      entry.state = failed(result) ? 'failed' : freshness === 'partial' || freshness === 'stale' ? 'partial' : 'success'
      if (finishReceipt) {
        if (durable) await this.journal!.put(durable.key, { fingerprint: durable.fingerprint, state: failed(result) ? 'failed' : 'completed', updatedAt: Date.now() })
        // Retain bounded, session-only results. Large writes replay a receipt, not private megabytes.
        const replay = JSON.stringify(result)?.length <= 65_536 ? structuredClone(result) : {
          data: { writeAlreadyAttempted: true, nextStep: 'Read saved records for the current result. Do not repeat this write with a new ID.' },
          meta: { freshness: failed(result) ? 'failed' : 'cached', source: 'session write receipt', fetchedAt: Date.now() }, errors: [],
        }
        finishReceipt({ result: replay })
      }
      if (['portfolio', 'cards', 'personalFinance', 'settings'].includes(call.operation) && result && typeof result === 'object' && 'data' in result && !failed(result)) {
        const envelope = result as { data: unknown; meta: Record<string, unknown> }
        return shapeResponse({ ...envelope, meta: { ...envelope.meta, revision: recordRevision(envelope.data) } }, call.response, selectionFields(call.operation, call.response?.collection))
      }
      return !mutation && !['screenshot', 'browserResearch'].includes(call.operation) ? shapeResponse(result, call.response, selectionFields(call.operation, call.response?.collection)) : result
    } catch (error) {
      if (entry.state !== 'blocked' && entry.state !== 'replayed') entry.state = signal?.aborted ? 'cancelled' : 'failed'
      // Errors can contain private provider data. Neither diagnostics nor receipts retain them.
      finishReceipt?.({ error: 'This write request was already attempted. Read saved records before trying a new requestId; the edit may have completed or been refused.' })
      if (durable && !this.journal?.error) await this.journal!.put(durable.key, { fingerprint: durable.fingerprint, state: executing ? 'uncertain' : 'refused', updatedAt: Date.now() }).catch(() => {})
      if (error instanceof RecordRevisionError) throw new McpError(error.message, 'STALE_REVISION', false, 'Read the latest record and review the intended edit before using a new requestId and revision.')
      if (signal?.aborted && !(error instanceof McpError)) throw new McpError('MCP request was cancelled. An executing edit may have completed.', 'CANCELLED', false, 'Read saved records before repeating an edit.')
      throw error
    } finally { this.controllers.delete(entry.id); entry.durationMs = Math.max(0, Date.now() - entry.startedAt) }
  }
  private durableReceipt(state: string) {
    const result = ok({ writeAlreadyAttempted: true, state, nextStep: 'Read saved records to verify the result. This requestId will not execute again.' }, 'durable write receipt')
    if (state !== 'completed') result.meta.freshness = 'failed'
    return result
  }
  private operationStatus(request: OperationStatusRequest) {
    if (!catalog.some(item => item.tool.name === request.tool && item.operation in mutationDomains) || !/^[A-Za-z0-9_-]{1,128}$/.test(request.requestId)) throw new McpError('Provide a mutation tool name and its original requestId.', 'INVALID_ARGUMENTS')
    if (this.journal?.error) throw new McpError(this.journal.error, 'JOURNAL_UNAVAILABLE')
    const state = this.journal?.get(receiptKey(request.tool, request.requestId))?.state
    return ok({ state: state ?? 'unknown', durable: Boolean(this.journal), nextStep: 'Read saved records to verify the outcome. This tool never executes an edit.' }, 'MCP write journal')
  }
}
