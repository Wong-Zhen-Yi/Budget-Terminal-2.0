import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'

export interface McpExecution {
  signal?: AbortSignal
  expectedRevision?: string
  progress?: (completed: number, total?: number) => void
}
export const mcpExecution = new AsyncLocalStorage<McpExecution>()

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

/** Hash only saved, editable fields; local paths and backup timestamps are incidental. */
export function recordRevision(payload: unknown): string {
  const { sourcePath: _path, lastBackupAt: _backup, automaticBackup: _automaticBackup, ...saved } = payload as Record<string, unknown>
  return createHash('sha256').update(canonical(saved)).digest('hex')
}

/** Call inside the store write queue, immediately before applying the mutation. */
export class RecordRevisionError extends Error {}

export function checkRecordRevision(payload: unknown) {
  const expected = mcpExecution.getStore()?.expectedRevision
  if (expected && expected !== recordRevision(payload)) throw new RecordRevisionError('Saved records changed. Read the current records and review the edit before using a new requestId and revision.')
}

export function checkMcpCancellation() {
  mcpExecution.getStore()?.signal?.throwIfAborted()
}

export function mcpProgress(completed: number, total?: number) {
  checkMcpCancellation()
  mcpExecution.getStore()?.progress?.(completed, total)
  checkMcpCancellation()
}

/** Bound MCP scan fan-out and stop scheduling new work after cancellation.
 * Individual cached/provider reads already in flight are allowed to finish. */
export async function mapMcpWork<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  if (!mcpExecution.getStore()) return Promise.allSettled(items.map(run))
  const outcomes: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  let completed = 0
  mcpProgress(0, items.length)
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      if (mcpExecution.getStore()?.signal?.aborted) return
      const index = next++
      try { outcomes[index] = { status: 'fulfilled', value: await run(items[index]) } }
      catch (reason) { outcomes[index] = { status: 'rejected', reason } }
      completed++
      if (!mcpExecution.getStore()?.signal?.aborted) mcpProgress(completed, items.length)
    }
  }))
  checkMcpCancellation()
  return outcomes
}
